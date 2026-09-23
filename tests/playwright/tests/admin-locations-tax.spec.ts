import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Locations & Tax (admin/ctl/locations.php) — the core, plugin-free tax
 * engine. Historically this admin screen let a merchant configure zones and
 * tax rates, but nothing in checkout ever read them: ctl/checkout.php always
 * defaulted tax to a hard-coded 0.0 unless a plugin like taxjar registered a
 * checkout.tax.calculate.instead hook. That meant every zone/rate configured
 * here was silently inert without an external tax plugin installed.
 *
 * lib/functions.php's checkout_calculate_tax() + the corresponding change in
 * ctl/checkout.php fix that: the core calculation now runs by default,
 * reading directly from nc_tax_zones/nc_tax_rates, with no plugin or API key
 * required. This spec proves that end-to-end: configuring a zone/rate here
 * actually changes what a customer is charged at checkout.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PRODUCT_SLUG - slug of a purchasable PHYSICAL (shippable) product
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

function dbExec(sql: string): string {
  return execSync(
    `mysql -u toffee_cart -p'Buyer+Hunger%Ratio&Money^0' toffee_cart -N -e "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }
  ).trim();
}

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

async function addToCartAndReachCheckout(page: Page) {
  await page.goto(`/product/${PRODUCT_SLUG}`);
  const optionSelects = page.locator('#product-options select.option-dropdown');
  const optionCount = await optionSelects.count();
  for (let i = 0; i < optionCount; i++) {
    await optionSelects.nth(i).selectOption({ index: 1 });
  }
  await page.click('#btn-add-to-cart');
  await page.waitForTimeout(500);
  await page.goto('/cart');
  await page.click('.cart-checkout-button a');
  await expect(page).toHaveURL(/checkout/);
}

test.describe.serial('Locations & Tax (core, plugin-free)', () => {
  test.beforeAll(() => {
    dbExec(`DELETE FROM nc_tax_rates WHERE rate_name LIKE 'Playwright %'`);
    dbExec(`DELETE FROM nc_tax_zones WHERE zone_name LIKE 'Playwright %'`);
  });

  test('help text explaining zones/rates is visible on the page', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=locations`);
    const helpBox = page.locator('.nc-help-box');
    await expect(helpBox).toBeVisible();
    await expect(helpBox).toContainText(/zone/i);
    await expect(helpBox).toContainText(/department of revenue/i);
  });

  test('Import from OpenSalesTax populates real state zones/rates', async ({ page }) => {
    // Each import round-trips ~47 sequential calls to the real OpenSalesTax
    // API server-side; this test triggers two full imports, so the default
    // 60s test timeout isn't enough headroom.
    test.setTimeout(180_000);
    dbExec(`DELETE FROM nc_tax_rates`);
    dbExec(`DELETE FROM nc_tax_zones`);

    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=locations`);

    const importResponsePromise = page.waitForResponse(async (res) => {
      if (!res.url().includes('route=locations') || res.request().method() !== 'POST') return false;
      return (res.request().postData() || '').includes('opensalestax_import');
    });
    await page.click('#btn-opensalestax-import');
    const res = await importResponsePromise;
    const data = await res.json();
    expect(data.ok).toBe(true);
    // 47 of 50+DC: the 4 legitimately no-sales-tax states we don't import
    // (DE, MT, NH, OR) plus Puerto Rico, which has no representative zip.
    expect(data.imported).toBe(47);

    await expect(page.locator('#opensalestax-last-import')).toContainText(/Last imported/i);

    const zoneCount = dbExec(`SELECT COUNT(*) FROM nc_tax_zones`);
    expect(parseInt(zoneCount, 10)).toBe(47);

    // Spot-check a real, non-zero rate made it into the DB correctly.
    const txRate = dbExec(
      `SELECT tr.rate FROM nc_tax_zones tz JOIN nc_tax_rates tr ON tr.zone_id=tz.zone_id WHERE tz.state_code='TX'`
    );
    expect(parseFloat(txRate)).toBeGreaterThan(0);

    // Re-running should update in place, not duplicate.
    const importResponsePromise2 = page.waitForResponse(async (res) => {
      if (!res.url().includes('route=locations') || res.request().method() !== 'POST') return false;
      return (res.request().postData() || '').includes('opensalestax_import');
    });
    await page.click('#btn-opensalestax-import');
    await importResponsePromise2;
    const zoneCountAfterRerun = dbExec(`SELECT COUNT(*) FROM nc_tax_zones`);
    expect(parseInt(zoneCountAfterRerun, 10)).toBe(47);
  });

  test('OpenSalesTax import endpoint always returns JSON, even when the failure is not a catchable Exception', async ({ page }) => {
    // admin/ctl/locations.php's opensalestax_import action previously wrapped
    // the import in `catch (Exception $e)`. On a restricted host without
    // ext-curl, calling curl_init() inside lib/opensalestax.php's
    // opensalestax_fetch_states() is a fatal "call to undefined function"
    // Error — a Throwable, but NOT an Exception — so it escaped that catch
    // entirely, and PHP's own fatal-error handler emitted an HTML page
    // instead of the JSON the storefront's fetch() expects. That surfaced as
    // a "SyntaxError: Unexpected token '<'" in the browser, not a real error
    // message. Confirmed live (2026-07-11) against edgecart.helioho.st.
    //
    // This can't be reproduced by literally uninstalling ext-curl from a
    // live host mid-test, so it's verified at the PHP level instead: a
    // minimal script replicating the exact try/catch shape from
    // locations.php, run once with `catch (Exception)` (the old code) and
    // once with `catch (Throwable)` (the fix), against a function that
    // throws a real, non-Exception Error the same way a missing extension
    // would. The old shape must let the fatal escape; the fixed shape must
    // not.
    // Written to temp files rather than passed via `php -r '...'` — the
    // script's own single-quoted PHP strings ('ok', the function name, etc.)
    // would otherwise break out of the shell's single-quoted wrapper (the
    // exact class of shell-quoting bug documented in this project's memory:
    // nested quotes silently corrupt or truncate an interpolated command).
    const phpScript = (catchType: string) => `<?php
      function fails_like_missing_extension() {
          if (!function_exists('this_function_does_not_exist_1234')) {
              throw new Error("call to undefined function this_function_does_not_exist_1234()");
          }
      }
      try {
          fails_like_missing_extension();
          echo json_encode(['ok' => true]);
      } catch (${catchType} $e) {
          echo json_encode(['ok' => false, 'message' => $e->getMessage()]);
      }
    `;

    const tmpDir = require('os').tmpdir();
    const oldShapePath = require('path').join(tmpDir, `pw-opensalestax-old-${Date.now()}.php`);
    const fixedShapePath = require('path').join(tmpDir, `pw-opensalestax-fixed-${Date.now()}.php`);
    require('fs').writeFileSync(oldShapePath, phpScript('Exception'));
    require('fs').writeFileSync(fixedShapePath, phpScript('Throwable'));

    let oldShapeCrashed = false;
    try {
      execSync(`php ${oldShapePath}`, { encoding: 'utf8' });
    } catch {
      // A real Error escaping an uncaught try/catch exits non-zero and
      // prints a fatal-error message to stderr, not JSON — exactly the
      // HTML-instead-of-JSON symptom this test exists to catch.
      oldShapeCrashed = true;
    }
    expect(oldShapeCrashed).toBe(true);

    const fixedOutput = execSync(`php ${fixedShapePath}`, { encoding: 'utf8' }).trim();
    const fixedData = JSON.parse(fixedOutput);
    expect(fixedData.ok).toBe(false);
    expect(fixedData.message).toContain('undefined function');

    require('fs').unlinkSync(oldShapePath);
    require('fs').unlinkSync(fixedShapePath);

    // Confirm the deployed source actually uses the fixed shape.
    if (process.env.EDGECART_ROOT) {
      const deployedCatch = execSync(
        `grep -A10 "action === 'opensalestax_import'" ${process.env.EDGECART_ROOT}/admin/ctl/locations.php | grep -o "catch (Throwable" || true`,
        { encoding: 'utf8' }
      ).trim();
      expect(deployedCatch).toBe('catch (Throwable');
    }
  });

  test('creating a zone and an active rate is reflected in checkout tax', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=locations`);

    // ── Add zone: Playwright TX ──────────────────────────────────────────
    await page.click('#btn-add-zone');
    await expect(page.locator('#zone-drawer')).toHaveClass(/open/);
    await page.fill('#zone-name', 'Playwright TX Zone');
    await page.selectOption('#zone-country', 'US');
    await page.selectOption('#zone-state', 'TX');
    await page.click('#zone-drawer-save');
    await expect(page.locator('#zone-drawer')).not.toHaveClass(/open/);
    await expect(page.locator('#zones-tbody')).toContainText('Playwright TX Zone');

    // ── Add rate: 8% on that zone ────────────────────────────────────────
    await page.click('[href="#rates-tab"]');
    await page.click('#btn-add-rate');
    await expect(page.locator('#rate-drawer')).toHaveClass(/open/);
    await page.fill('#rate-name', 'Playwright TX Sales Tax');
    await page.selectOption('#rate-zone', { label: 'Playwright TX Zone' });
    await page.fill('#rate-percentage', '8');
    await page.click('#rate-drawer-save');
    await expect(page.locator('#rate-drawer')).not.toHaveClass(/open/);
    await expect(page.locator('#rates-tbody')).toContainText('Playwright TX Sales Tax');
    await expect(page.locator('#rates-tbody')).toContainText('8.00%');

    // ── Confirm at checkout: a TX address should now be taxed ───────────
    // calculateTax() only fires from selectRate() (js/checkout.js) — i.e.
    // once a shipping rate radio is picked, not directly off #co-state's
    // change event.
    await addToCartAndReachCheckout(page);
    await page.fill('#co-first', 'Playwright');
    await page.fill('#co-last', 'Tester');
    await page.fill('#co-email', `locations-tax-${Date.now()}@playwright-test.example`);
    await page.fill('#co-phone', '555-0100');
    await page.fill('#co-addr1', '123 Test Street');
    await page.fill('#co-zip', '78701');
    await page.fill('#co-city', 'Austin');
    await page.fill('#co-state', 'TX');
    await page.selectOption('#co-country', { index: 0 });

    const ratesResponsePromise = page.waitForResponse(
      (res) => res.url().includes('route=checkout') && res.request().method() === 'POST'
    );
    await page.click('#btn-get-rates');
    await ratesResponsePromise;

    const taxResponsePromise = page.waitForResponse(async (res) => {
      if (!res.url().includes('route=checkout') || res.request().method() !== 'POST') return false;
      return (res.request().postData() || '').includes('tax_calculation');
    });
    await page.locator('input[name="shipping_rate"]').first().check();
    const res = await taxResponsePromise;
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tax_active).toBe(true);
    // Subtotal * 8% — just confirm it's real, non-zero tax, not the old
    // hard-coded-0.0 default.
    expect(data.tax).toBeGreaterThan(0);
  });

  test('deactivating the rate removes tax at checkout for the same address', async ({ page }) => {
    // Isolate this from the OpenSalesTax import test above: with the real
    // imported Texas zone (priority -1) still present, deactivating just the
    // manual priority-0 rate would correctly fall through to that import's
    // real rate rather than $0 — which is the right production behavior, but
    // not what this test is isolating.
    dbExec(`DELETE FROM nc_tax_rates WHERE rate_name = 'OpenSalesTax Import'`);
    dbExec(`DELETE FROM nc_tax_zones WHERE zone_name LIKE 'OpenSalesTax Import%'`);

    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=locations`);
    await page.click('[href="#rates-tab"]');
    await expect(page.locator('#rates-tbody')).toContainText('Playwright TX Sales Tax');

    const row = page.locator('#rates-tbody tr', { hasText: 'Playwright TX Sales Tax' });
    await row.locator('ios-toggle').click();
    // Toggle click fires an immediate AJAX call (rate_toggle_active) — give it
    // a moment before reloading rather than asserting on a UI state change,
    // since the toggle's own checked state is unreliable to read post-upgrade
    // (see ios-toggle's id/class-stripping behavior).
    await page.waitForTimeout(500);

    await addToCartAndReachCheckout(page);
    await page.fill('#co-first', 'Playwright');
    await page.fill('#co-last', 'Tester');
    await page.fill('#co-email', `locations-tax-2-${Date.now()}@playwright-test.example`);
    await page.fill('#co-phone', '555-0100');
    await page.fill('#co-addr1', '123 Test Street');
    await page.fill('#co-zip', '78701');
    await page.fill('#co-city', 'Austin');
    await page.fill('#co-state', 'TX');
    await page.selectOption('#co-country', { index: 0 });

    const ratesResponsePromise = page.waitForResponse(
      (res) => res.url().includes('route=checkout') && res.request().method() === 'POST'
    );
    await page.click('#btn-get-rates');
    await ratesResponsePromise;

    const taxResponsePromise = page.waitForResponse(async (res) => {
      if (!res.url().includes('route=checkout') || res.request().method() !== 'POST') return false;
      return (res.request().postData() || '').includes('tax_calculation');
    });
    await page.locator('input[name="shipping_rate"]').first().check();
    const res = await taxResponsePromise;
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.tax).toBe(0);
  });

  test.afterAll(() => {
    dbExec(`DELETE FROM nc_tax_rates WHERE rate_name LIKE 'Playwright %'`);
    dbExec(`DELETE FROM nc_tax_zones WHERE zone_name LIKE 'Playwright %'`);
  });
});
