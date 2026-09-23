import { test, expect, Page } from '@playwright/test';

/**
 * goshippo: live shipping rates at checkout via the Shippo API. Unlike
 * PayPal/Google, this is a pure server-to-server API call (no browser
 * redirect, no human login) — fully automatable once a real (free-tier)
 * Shippo test API key and ship-from address are configured. This test's
 * credentials were borrowed from TRLO (test-mode key, not live).
 *
 * Important finding from research: ctl/checkout.php has a free-shipping
 * fallback — if goshippo's rate fetch returns empty (unconfigured or
 * failed), checkout silently injects a synthetic {id:'free', service:
 * 'Standard Shipping', rate:0} option instead. storefront-checkout.spec.ts's
 * existing shipping-rate step only asserts a rate radio exists and is
 * checkable, which passes identically whether the rate came from Shippo or
 * that fallback — it does NOT prove Shippo's integration actually works.
 * This test asserts on the real carrier/service data Shippo returns, which
 * the fallback can never produce, to close that gap.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PRODUCT_SLUG - slug of a purchasable PHYSICAL (shippable) product
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

test.describe('goshippo plugin', () => {
  test('settings save and reload correctly', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);

    const settingsBtn = page.locator('button.plugin-settings-btn[data-code="goshippo"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('#plugin-drawer')).toBeVisible();
    await expect(page.locator('#shippo_mode')).toHaveValue('test');
    await expect(page.locator('#shippo_test_api_key')).not.toHaveValue('');
    await page.click('#plugin-drawer-close');
  });

  test('checkout fetches real carrier rates from the Shippo API, not the free fallback', async ({ page }) => {
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

    const addr1 = page.locator('#co-addr1');
    test.skip(await addr1.count() === 0, 'This product is digital-only, no shipping rates to fetch');

    await page.fill('#co-first', 'Playwright');
    await page.fill('#co-last', 'Tester');
    await page.fill('#co-email', `goshippo-test-${Date.now()}@playwright-test.example`);
    await page.fill('#co-phone', '555-0100');
    await addr1.fill('123 Test Street');
    await page.fill('#co-zip', '78701');
    await page.fill('#co-city', 'Austin');
    await page.fill('#co-state', 'TX');
    await page.selectOption('#co-country', { index: 0 });

    const ratesResponsePromise = page.waitForResponse(
      (res) => res.url().includes('route=checkout') && res.request().method() === 'POST'
    );
    await page.click('#btn-get-rates');
    const res = await ratesResponsePromise;
    const data = await res.json();

    // A real Shippo response carries a real carrier name (e.g. "USPS",
    // "UPS") — the free-shipping fallback's synthetic rate never does
    // (ctl/checkout.php ~line 260-269: carrier: '').
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.rates)).toBe(true);
    expect(data.rates.length, 'expected at least one real Shippo rate').toBeGreaterThan(0);
    const hasRealCarrier = data.rates.some((r: any) => r.carrier && r.carrier.length > 0);
    expect(hasRealCarrier, 'expected a real carrier name from Shippo, not just the free-shipping fallback').toBe(true);
  });
});
