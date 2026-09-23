import { test, expect, Page } from '@playwright/test';
import * as path from 'node:path';

/**
 * digital-download plugin: attach a file to a product in admin, buy that
 * product via a real storefront checkout, mark the order paid (which fires
 * catalog.order.payment_complete, the hook that actually generates download
 * tokens — same distinction already established in edgecart-purchase-
 * fulfillment.spec.ts), then confirm the customer's own account page shows
 * a working download link for it.
 *
 * The Downloads tab is disabled until the product has been saved at least
 * once (plugins/digital-download/hooks.php ~line 104-108, "Save the product
 * first" title/disabled attribute) — this test uses an existing sample
 * product (already saved) rather than a brand-new one to avoid that step.
 *
 * No PDF/binary fixture exists elsewhere in this suite for this purpose;
 * reusing fixtures/theme-blues.zip is fine — .zip is an allowed extension
 * for digital-download uploads (admin/ajax.php's allowed-extensions list
 * includes zip, pdf, epub, mp3, mp4, png, jpg, svg, txt, csv) and it's a
 * real, already-tracked small file rather than a new binary added just for
 * this one test.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   DD_PRODUCT_SLUG - slug of an existing (already-saved) product to attach
 *                     a digital file to and purchase
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

const PRODUCT_SLUG = process.env.DD_PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set DD_PRODUCT_SLUG env var (slug of an existing product)');

const FIXTURE_ZIP = path.join(__dirname, '..', 'fixtures', 'theme-blues.zip');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  // Already-logged-in visits to ?route=login redirect straight to the
  // dashboard before the form ever renders — this test logs in as admin
  // twice (once to attach the file, again later to mark the order paid),
  // so the second call must tolerate the session still being active rather
  // than waiting on a #username field that's about to disappear.
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

test('digital-download: attach a file, buy it, download it from the account page', async ({ page }) => {
  test.setTimeout(90_000);

  // ── Attach a digital file to the product in admin ──────────────────────
  // Slug isn't the visible link text in the admin list, and slug-to-name is
  // not a reliable hyphen-to-space guess (e.g. "3-4-sleeve-tee" is really
  // "3/4 Sleeve Tee", not "3 4 Sleeve Tee") — read the real name straight
  // off the storefront product page (tpl/product.html:37) instead.
  await page.goto(`/product/${PRODUCT_SLUG}`);
  // The page layout's own header logo is also an <h1> (tpl/layout.html:80,
  // id="store-logo") and sorts first in the DOM — exclude it explicitly
  // rather than relying on :first() to land on the product's own title.
  const productName = (await page.locator('h1:not(#store-logo)').first().innerText()).trim();
  expect(productName, `product slug ${PRODUCT_SLUG} should exist and have a name`).not.toBe('');

  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=products`);
  await page.fill('#flt-name', productName);
  await page.locator('.prod-name-link', { hasText: productName }).first().click();
  await expect(page.locator('.drawer-tab[data-panel="downloads"]')).not.toBeDisabled();

  await page.click('.drawer-tab[data-panel="downloads"]');
  await page.setInputFiles('#dd-file-input', FIXTURE_ZIP);
  await page.fill('#dd-file-label', 'Bonus Content');
  await page.click('#dd-upload-btn');
  await expect(page.locator('#dd-file-list')).toContainText('Bonus Content', { timeout: 10_000 });

  const productId = await page.locator('#prod-id').inputValue();

  // ── Buy it via a real storefront checkout, creating a login-able account ──
  const email = `dd-test-${Date.now()}@playwright-test.example`;
  const password = 'TestPass123!';

  await page.goto(`/product/${PRODUCT_SLUG}`);
  // Required options (e.g. Size) block Add to Cart with "Please select all
  // required options" if left unselected (js/product.js:316-334) — same
  // step storefront-checkout.spec.ts and edgecart-purchase-fulfillment.
  // spec.ts already do, missing here originally, which silently left the
  // cart empty for the rest of this test.
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

  await page.fill('#co-first', 'Digital');
  await page.fill('#co-last', 'Download');
  await page.fill('#co-email', email);
  await page.fill('#co-phone', '555-0100');
  // Digital-only products hide the real address fields (hidden dummy inputs
  // take over instead, tpl/checkout.html:141-146) — only fill if present.
  const addr1 = page.locator('#co-addr1');
  if (await addr1.count() > 0 && await addr1.isVisible()) {
    await addr1.fill('123 Test Street');
    await page.fill('#co-zip', '78701');
    await page.fill('#co-city', 'Austin');
    await page.fill('#co-state', 'TX');
    await page.selectOption('#co-country', { index: 0 });
    await page.click('#btn-get-rates');
    const firstRate = page.locator('input[name="shipping_rate"]').first();
    await firstRate.waitFor({ state: 'visible', timeout: 15_000 });
    await firstRate.check();
    await page.click('#btn-use-rate');
  }

  // Creating an account (>=8 char password, ctl/checkout.php:162-171) is
  // what makes the download link reachable afterward via a real login,
  // rather than needing to intercept an email.
  await page.fill('#co-password', password);

  const checkRadio = page.locator('input[name="payment_method"][value="check"]');
  if (await checkRadio.count() > 0) await checkRadio.check();
  await page.click('#btn-place-order');
  await expect(page).toHaveURL(/order-complete/, { timeout: 15_000 });

  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/Your order #(\d+) has been placed/);
  if (!match) throw new Error('Could not find an order number on the order-complete page.');
  const orderId = match[1];

  // ── Mark it paid in admin — the hook that actually generates tokens ────
  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=orders`);
  const orderRow = page.locator('#ord-tbody tr').filter({
    has: page.locator('td.ord-id-cell', { hasText: new RegExp(`^${orderId}$`) }),
  });
  await orderRow.locator('td.ord-id-cell').click();
  await expect(page.locator('#ord-drawer')).toBeVisible();
  await page.click('#btn-ord-mark-paid');
  await expect(page.locator('text=/fulfillment triggered/i')).toBeVisible({ timeout: 10_000 });

  // ── Log in as the customer and confirm a real, working download link ──
  await page.goto('/?route=logout');
  await page.goto('/?route=login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#login-form button[type="submit"]');

  await page.goto('/?route=account');
  // .first(): reruns against the same install accumulate duplicate "Bonus
  // Content" files on this product (no automated cleanup between runs, a
  // known gap in this suite) — any one of them proves the real behavior.
  const downloadRow = page.locator('li[data-download-row]', { hasText: 'Bonus Content' }).first();
  await expect(downloadRow).toBeVisible({ timeout: 10_000 });

  const downloadLink = downloadRow.locator('a[href*="digital-download/download"]');
  await expect(downloadLink).toBeVisible();
  const href = await downloadLink.getAttribute('href');

  const download = await page.request.get(href!);
  expect(download.ok(), 'download link should actually serve the file, not error').toBeTruthy();
  expect(download.headers()['content-disposition'] || '').toContain('attachment');
});
