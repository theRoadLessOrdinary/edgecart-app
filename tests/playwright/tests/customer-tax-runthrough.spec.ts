import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Full customer checkout run-throughs against the now-fixed, now-imported
 * core tax engine — not just the tax_calculation AJAX endpoint (already
 * covered in admin-locations-tax.spec.ts), but a real end-to-end purchase:
 * cart -> checkout -> visible tax in the order summary -> placed order ->
 * correct `tax` column in nc_orders.
 *
 * Two real cities, chosen to illustrate the "one representative rate per
 * state" approximation honestly rather than hide it:
 *   - Sacramento, CA (95814) is the exact zip used as California's
 *     OpenSalesTax representative zip, so this should match the real
 *     combined rate (8.75%) exactly.
 *   - Poughkeepsie, NY (12601) is NOT New York's representative zip
 *     (Albany, 12207, is) — its real combined rate is 8.125%, while the
 *     imported statewide NY rate is 8.00%. This is expected to differ
 *     slightly; the test asserts against the imported rate actually stored
 *     in nc_tax_rates (what the app will really charge), not the live
 *     OpenSalesTax value for that specific zip.
 *
 * REQUIRED ENV VARS:
 *   PRODUCT_SLUG - slug of a purchasable PHYSICAL (shippable) product
 */

const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

function dbVal(sql: string): string {
  return execSync(
    `mysql -u toffee_cart -p'Buyer+Hunger%Ratio&Money^0' toffee_cart -N -e "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }
  ).trim();
}

type RunThrough = {
  city: string;
  state: string;
  zip: string;
};

async function runCustomerPurchase(page: Page, { city, state, zip }: RunThrough) {
  const email = `tax-runthrough-${state.toLowerCase()}-${Date.now()}@playwright-test.example`;

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

  await page.fill('#co-first', 'Playwright');
  await page.fill('#co-last', 'Customer');
  await page.fill('#co-email', email);
  await page.fill('#co-phone', '555-0100');
  const addr1 = page.locator('#co-addr1');
  test.skip(await addr1.count() === 0, `${PRODUCT_SLUG} is digital-only, no shipping/tax address to test against`);
  await addr1.fill('1 Playwright Way');
  await page.fill('#co-zip', zip);
  await page.fill('#co-city', city);
  await page.fill('#co-state', state);
  await page.selectOption('#co-country', { index: 0 });

  await page.click('#btn-get-rates');
  const firstRate = page.locator('input[name="shipping_rate"]').first();
  await firstRate.waitFor({ state: 'visible', timeout: 15_000 });

  // Selecting a rate is what actually triggers calculateTax() (js/
  // checkout.js selectRate()) — confirmed earlier this session; the tax row
  // only appears/updates after this, not directly off the address fields.
  // Read the actual rendered price rather than intercepting the AJAX
  // response — postData() unreliably matches multipart FormData bodies, but
  // more importantly this is what the real customer sees.
  await firstRate.check();
  const taxRow = page.locator('#summary-tax');
  await expect(taxRow).toBeVisible({ timeout: 10_000 });
  const taxPriceText = await page.locator('#summary-tax-price').innerText();
  await expect(page.locator('#summary-tax-price')).toContainText('$');
  const displayedTax = parseFloat(taxPriceText.replace(/[^0-9.]/g, ''));
  await page.click('#btn-use-rate');

  // ── Complete the order ──────────────────────────────────────────────────
  const checkRadio = page.locator('input[name="payment_method"][value="check"]');
  if (await checkRadio.count() > 0) await checkRadio.check();
  await page.click('#btn-place-order');
  await expect(page).toHaveURL(/order-complete/, { timeout: 15_000 });
  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/Your order #(\d+) has been placed/);
  if (!match) throw new Error('Could not find an order number on the order-complete page.');
  const orderId = match[1];

  const orderTax = dbVal(`SELECT tax FROM nc_orders WHERE id = ${orderId}`);
  const orderSubtotal = dbVal(`SELECT subtotal FROM nc_orders WHERE id = ${orderId}`);

  return {
    orderId,
    displayedTax,
    orderTax: parseFloat(orderTax),
    orderSubtotal: parseFloat(orderSubtotal),
  };
}

test.describe('Real customer run-throughs against the imported tax data', () => {
  test('Poughkeepsie, NY (12601) — approximated by the statewide NY import rate', async ({ page }) => {
    const nyRate = parseFloat(
      dbVal(
        `SELECT tr.rate FROM nc_tax_zones tz JOIN nc_tax_rates tr ON tr.zone_id=tz.zone_id WHERE tz.state_code='NY' ORDER BY tz.priority DESC LIMIT 1`
      )
    );
    expect(nyRate, 'NY must have an imported rate for this run-through to mean anything').toBeGreaterThan(0);

    const result = await runCustomerPurchase(page, { city: 'Poughkeepsie', state: 'NY', zip: '12601' });

    const expectedTax = Math.round(result.orderSubtotal * nyRate * 100) / 100;
    expect(result.displayedTax).toBeCloseTo(expectedTax, 2);
    expect(result.orderTax).toBeCloseTo(expectedTax, 2);
    expect(result.orderTax).toBeGreaterThan(0);

    console.log(
      `Poughkeepsie NY order #${result.orderId}: charged $${result.orderTax} ` +
      `(${(nyRate * 100).toFixed(2)}% statewide-import rate). ` +
      `Real Poughkeepsie combined rate is 8.125% per OpenSalesTax — the ` +
      `statewide import (Albany's rate) is a known approximation, not an ` +
      `exact per-zip match.`
    );
  });

  test('Sacramento, CA (95814) — exact match, since this is CA\'s own representative zip', async ({ page }) => {
    const caRate = parseFloat(
      dbVal(
        `SELECT tr.rate FROM nc_tax_zones tz JOIN nc_tax_rates tr ON tr.zone_id=tz.zone_id WHERE tz.state_code='CA' ORDER BY tz.priority DESC LIMIT 1`
      )
    );
    expect(caRate, 'CA must have an imported rate for this run-through to mean anything').toBeGreaterThan(0);
    // 95814 is literally the zip this session used to import CA's rate, so
    // this run-through should land on the real combined rate exactly.
    expect(caRate).toBeCloseTo(0.0875, 4);

    const result = await runCustomerPurchase(page, { city: 'Sacramento', state: 'CA', zip: '95814' });

    const expectedTax = Math.round(result.orderSubtotal * caRate * 100) / 100;
    expect(result.displayedTax).toBeCloseTo(expectedTax, 2);
    expect(result.orderTax).toBeCloseTo(expectedTax, 2);
    expect(result.orderTax).toBeGreaterThan(0);

    console.log(`Sacramento CA order #${result.orderId}: charged $${result.orderTax} (8.75% — exact real-world match).`);
  });
});
