import { test, expect } from '@playwright/test';

/**
 * zippopotam: auto-fills city/state from a US zipcode on checkout using the
 * free, keyless, public api.zippopotam.us API (plugins/zippopotam/catalog/
 * zippopotam.js). No credentials, no external account — the one plugin in
 * this batch fully testable end-to-end with zero setup.
 *
 * Fires on both blur AND input events on #co-zip, debounced 500ms, then
 * fetches https://api.zippopotam.us/us/<zip> and fills #co-city/#co-state,
 * dispatching 'change' events afterward for any listeners.
 *
 * REQUIRED ENV VARS:
 *   PRODUCT_SLUG - slug of a purchasable physical (shippable) product
 */

const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

test('zippopotam auto-fills city/state from a real zip code at checkout', async ({ page }) => {
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
  test.skip(await addr1.count() === 0, 'This product is digital-only, no address fields to test zippopotam against');

  // 78701 is a real Austin, TX zip — assert the actual real-world values
  // the public API returns, not just "something got filled in."
  await page.fill('#co-zip', '78701');
  await page.locator('#co-zip').blur();
  await expect(page.locator('#co-city')).toHaveValue(/austin/i, { timeout: 5_000 });
  await expect(page.locator('#co-state')).toHaveValue(/tx/i);
});
