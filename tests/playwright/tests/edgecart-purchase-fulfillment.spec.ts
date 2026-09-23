import { test, expect, Page } from '@playwright/test';

/**
 * Admin: order fulfillment, following on from a real storefront purchase
 * (storefront-checkout.spec.ts). Places an order via the storefront (Check
 * payment — no external dependency needed here), then works that same order
 * through the admin side: view it, mark it paid, and confirm fulfillment
 * actually fires.
 *
 * Important distinction found while researching this (admin/ctl/orders/
 * ajax.php ~line 70-87, comment there): the list-row inline status <select>
 * only calls the `set_status` action, which updates orders.status and fires
 * hook `admin.order.status.changed` — nothing else. It does NOT trigger
 * fulfillment. Only `mark_paid` (the "Mark Payment Received" button in the
 * order drawer, shown for payment_method='check' orders not yet paid) fires
 * `catalog.order.payment_complete`, the hook that actually does fulfillment
 * work (e.g. plugins/digital-download's token generation + email, hooks.php
 * ~line 39-101) — same hook a real Stripe/PayPal webhook would fire on a
 * completed payment. A test that only exercises set_status would look like
 * it covers fulfillment while actually testing something that explicitly
 * does not fulfill anything.
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
 *   ADMIN_PATH   - the obscured admin URL segment
 *   ADMIN_USER   - admin username
 *   ADMIN_PASS   - admin password
 *   PRODUCT_SLUG - slug of a purchasable product (same one storefront-
 *                  checkout.spec.ts uses is fine)
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

/**
 * Places a real order via the storefront using the Check payment method
 * (no external dependency, unlike Stripe) and returns its order number,
 * scraped from the order-complete page text ("Your order #123 has been
 * placed.", tpl/order-complete.html).
 */
async function placeOrderViaStorefront(page: Page): Promise<string> {
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

  const email = `fulfillment-test-${Date.now()}@playwright-test.example`;
  await page.fill('#co-first', 'Fulfillment');
  await page.fill('#co-last', 'Tester');
  await page.fill('#co-email', email);
  await page.fill('#co-phone', '555-0100');

  const addr1 = page.locator('#co-addr1');
  if (await addr1.count() > 0 && await addr1.isVisible()) {
    await addr1.fill('123 Test Street');
    await page.fill('#co-zip', '78701');
    await page.fill('#co-city', 'Austin');
    // co-state is a free-text abbreviation input, not a <select> — only
    // co-country actually is (tpl/checkout.html:83-106).
    await page.fill('#co-state', 'TX');
    await page.selectOption('#co-country', { index: 0 });

    await page.click('#btn-get-rates');
    const firstRate = page.locator('input[name="shipping_rate"]').first();
    await firstRate.waitFor({ state: 'visible', timeout: 15_000 });
    await firstRate.check();
    await page.click('#btn-use-rate');
  }

  const checkRadio = page.locator('input[name="payment_method"][value="check"]');
  if (await checkRadio.count() > 0) await checkRadio.check();

  await page.click('#btn-place-order');
  await expect(page).toHaveURL(/order-complete/, { timeout: 15_000 });

  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/Your order #(\d+) has been placed/);
  if (!match) throw new Error('Could not find an order number on the order-complete page.');
  return match[1];
}

// Find the row directly by its order-number cell's exact text rather than
// via #ord-search: that box's dt.search()+.draw() (admin/js/orders.js:100-103)
// wasn't reliably narrowing results by the time later assertions ran, and
// the order-number cell renders the bare number (no "#" prefix) anyway, so
// a loose row-level hasText scan risks matching the wrong row (e.g. a date
// like "Jul 9" also contains the digit being searched for).
function findOrderRow(page: Page, orderId: string) {
  return page.locator('#ord-tbody tr').filter({
    has: page.locator('td.ord-id-cell', { hasText: new RegExp(`^${orderId}$`) }),
  });
}

test.describe('Purchase fulfillment', () => {
  test('order placed via checkout appears in admin and can be marked paid', async ({ page }) => {
    const orderId = await placeOrderViaStorefront(page);

    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=orders`);

    const orderRow = findOrderRow(page, orderId);
    await expect(orderRow).toBeVisible();

    // Status starts "Pending" — a real placed order, not a fixture row.
    const statusSelect = orderRow.locator('select.status-select');
    await expect(statusSelect).toBeVisible();

    // Open the order drawer via the order-number cell (the customer cell
    // opens a different, unrelated "customer peek" drawer instead).
    await orderRow.locator('td.ord-id-cell').click();
    await expect(page.locator('#ord-drawer')).toBeVisible();
    await expect(page.locator('#ord-d-email')).toContainText('fulfillment-test-');

    // "Mark Payment Received" only shows for payment_method='check' orders
    // not yet paid (admin/tpl/orders/list.html ~line 177-180) — this is the
    // action that actually fires catalog.order.payment_complete, unlike the
    // status dropdown.
    const markPaidBtn = page.locator('#btn-ord-mark-paid');
    await expect(markPaidBtn).toBeVisible();
    await markPaidBtn.click();

    await expect(page.locator('text=/fulfillment triggered/i')).toBeVisible({ timeout: 10_000 });

    // Reload the list and confirm the row's own status reflects "paid" now
    // — not just trusting the toast, same rule used throughout this suite.
    await page.goto(`/${ADMIN_PATH}/?route=orders`);
    const updatedRow = findOrderRow(page, orderId);
    await expect(updatedRow.locator('select.status-select')).toHaveValue('paid');
  });

  test('set_status alone does not trigger fulfillment (documents real app behavior)', async ({ page }) => {
    const orderId = await placeOrderViaStorefront(page);

    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=orders`);
    const row = findOrderRow(page, orderId);

    // Changing status via the inline dropdown only calls `set_status` —
    // confirmed in admin/ctl/orders/ajax.php to update orders.status and
    // fire admin.order.status.changed only, explicitly NOT fulfillment.
    // set_status has no success toast at all (admin/js/orders.js:106-119,
    // only posts an error toast on failure) — confirm the select's own value
    // actually changed instead of asserting invented toast text.
    const statusSelect = row.locator('select.status-select');
    await statusSelect.selectOption('shipped');
    await expect(statusSelect).not.toHaveClass(/saving/);
    await expect(statusSelect).toHaveValue('shipped');

    // The order drawer's "Mark Payment Received" button should still be
    // present/actionable — proof the order is not actually considered paid
    // yet, since only mark_paid (not set_status) flips that.
    await row.locator('td.ord-id-cell').click();
    await expect(page.locator('#ord-drawer')).toBeVisible();
    await expect(page.locator('#btn-ord-mark-paid')).toBeVisible();
  });
});
