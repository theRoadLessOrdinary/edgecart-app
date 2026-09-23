import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * reviews: product reviews with star ratings and verified-purchase
 * enforcement. catalog.product.can_review.instead (plugins/reviews/
 * hooks.php) only returns true for a logged-in customer with a non-pending
 * order containing the product — the storefront form is never shown
 * otherwise (tpl/product.html gates #review-form on $can_review). This test
 * places a real order (creating a login-able account via the checkout's
 * optional password field, same pattern as admin-digital-download.spec.ts),
 * marks it paid in admin (the same fulfillment-triggering action used
 * throughout this suite — a plain status-dropdown change is NOT enough,
 * confirmed in edgecart-purchase-fulfillment.spec.ts), then submits a real
 * review as that customer and confirms it appears once approved.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PRODUCT_SLUG - slug of a purchasable product
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

test('reviews: a verified purchaser can submit a review, admin can approve it', async ({ page }) => {
  const email = `review-test-${Date.now()}@playwright-test.example`;
  const password = 'TestPass123!';

  // ── Real purchase, creating a login-able account ───────────────────────
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
  await page.fill('#co-first', 'Review');
  await page.fill('#co-last', 'Tester');
  await page.fill('#co-email', email);
  await page.fill('#co-phone', '555-0100');
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
  await page.fill('#co-password', password);
  const checkRadio = page.locator('input[name="payment_method"][value="check"]');
  if (await checkRadio.count() > 0) await checkRadio.check();
  await page.click('#btn-place-order');
  await expect(page).toHaveURL(/order-complete/, { timeout: 15_000 });
  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/Your order #(\d+) has been placed/);
  if (!match) throw new Error('Could not find an order number on the order-complete page.');
  const orderId = match[1];

  // ── Mark it paid (triggers real fulfillment, satisfies "non-pending") ──
  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=orders`);
  const orderRow = page.locator('#ord-tbody tr').filter({
    has: page.locator('td.ord-id-cell', { hasText: new RegExp(`^${orderId}$`) }),
  });
  await orderRow.locator('td.ord-id-cell').click();
  await expect(page.locator('#ord-drawer')).toBeVisible();
  await page.click('#btn-ord-mark-paid');
  await expect(page.locator('text=/fulfillment triggered/i')).toBeVisible({ timeout: 10_000 });

  // ── Log in as the customer and submit a real review ────────────────────
  await page.goto('/?route=logout');
  await page.goto('/?route=login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#login-form button[type="submit"]');

  await page.goto(`/product/${PRODUCT_SLUG}`);
  await expect(page.locator('#review-form')).toBeVisible();
  // The visible .star span has its own explicit click handler (js/
  // product.js ~line 440-449: preventDefault, then manually checks the
  // radio + dispatches 'change') — click that exact element, not the
  // wrapping label, which risks landing on a different part of the label's
  // bounding box that has no equivalent handler.
  await page.locator('#rating-input .star[data-rating="5"]').click();
  const reviewTitle = `Playwright Review ${Date.now()}`;
  await page.fill('#review-title', reviewTitle);
  await page.fill('#review-body', 'This is a real test review submitted end-to-end via Playwright.');
  await page.click('#btn-submit-review');

  // ── Admin moderation: approve it ────────────────────────────────────────
  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=reviews`);
  const reviewRow = page.locator('#reviews-tbody tr', { hasText: reviewTitle });
  await expect(reviewRow).toBeVisible();
  await reviewRow.click();
  await expect(page.locator('#review-drawer')).toBeVisible();
  await page.click('#btn-approve');

  await page.goto(`/${ADMIN_PATH}/?route=reviews`);
  await expect(page.locator('#reviews-tbody')).toContainText(reviewTitle);
});

test('reviews: Verified Purchases Only off lets a non-purchasing customer see and submit the review form', async ({ page }) => {
  // Two independent bugs previously made this setting a no-op:
  //  1. plugins/reviews/catalog/index.php's submit handler enforced the
  //     purchase check unconditionally, regardless of the setting.
  //  2. plugins/reviews/hooks.php's catalog.product.can_review.instead hook
  //     (which gates whether tpl/product.html even shows #review-form) also
  //     enforced the purchase check unconditionally — so even with (1) fixed,
  //     a non-purchasing customer would never see the form to submit through.
  // This test exercises the full real path: a logged-in customer who never
  // bought anything, with the setting off, must see and be able to use the
  // form.
  const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
  const user = process.env.DB_MYSQL_USER || 'root';
  const pass = process.env.DB_MYSQL_PASS;
  const db = process.env.DB_NAME || 'toffee_cart';
  const dbExec = (sql: string) =>
    execSync(`mysql -h ${host} -u ${user} -N -B -e "${sql}" ${db}`, {
      env: { ...process.env, MYSQL_PWD: pass || '' },
    }).toString().trim();

  const email = `no-purchase-review-${Date.now()}@playwright-test.example`;
  const password = 'TestPass123!';
  const rawHash = execSync(`php -r "echo password_hash('${password}', PASSWORD_DEFAULT);"`).toString().trim();
  // bcrypt hashes contain '$' (e.g. "$2y$10$..."), which bash treats as
  // positional-parameter expansion inside the double-quoted `mysql -e "..."`
  // string below — silently mangling the hash before it reaches MySQL.
  const hash = rawHash.replace(/\$/g, '\\$');
  dbExec(
    `INSERT INTO nc_customers (email, password, first_name, last_name, status, address1, address2, city, state, zip, country) ` +
    `VALUES ('${email}', '${hash}', 'No', 'Purchase', 1, '123 Test St', '', 'Austin', 'TX', '78701', 'US')`
  );
  const custId = dbExec(`SELECT id FROM nc_customers WHERE email='${email}'`);
  expect(custId).toMatch(/^\d+$/);

  try {
    // Turn Verified Purchases Only OFF.
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=setup`);
    await page.click('a[href="#tab-options"]');
    await page.click('button.sub-tab[data-sub="reviews"]');
    const verifiedOnly = page.locator('#s_reviews_verified_only');
    if (await verifiedOnly.locator('input').isChecked()) {
      await verifiedOnly.click();
      await page.click('#btn-save-all');
      await page.waitForTimeout(500);
    }

    // Log in as the non-purchasing customer and confirm the form shows.
    await page.goto('/?route=logout');
    await page.goto('/?route=login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('#login-form button[type="submit"]');

    await page.goto(`/product/${PRODUCT_SLUG}`);
    await expect(page.locator('#review-form')).toBeVisible();

    await page.locator('#rating-input .star[data-rating="4"]').click();
    const reviewTitle = `Playwright Unverified Review ${Date.now()}`;
    await page.fill('#review-title', reviewTitle);
    await page.fill('#review-body', 'Submitted with no purchase, while Verified Purchases Only is off.');
    await page.click('#btn-submit-review');
    // #review-msg is an aria-live region — content lands immediately, but its
    // own visibility toggle (opacity/animation) doesn't satisfy Playwright's
    // strict toBeVisible(), so assert on the text content directly instead.
    await expect(page.locator('#review-msg')).toContainText(/pending moderation|now published/i, { timeout: 10_000 });

    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=reviews`);
    await expect(page.locator('#reviews-tbody')).toContainText(reviewTitle);
  } finally {
    dbExec(`DELETE FROM nc_reviews WHERE customer_id=${custId}`);
    dbExec(`DELETE FROM nc_customers WHERE id=${custId}`);
    // Restore the default (verified purchases only on).
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=setup`);
    await page.click('a[href="#tab-options"]');
    await page.click('button.sub-tab[data-sub="reviews"]');
    if (!(await page.locator('#s_reviews_verified_only').locator('input').isChecked())) {
      await page.locator('#s_reviews_verified_only').click();
      await page.click('#btn-save-all');
      await page.waitForTimeout(500);
    }
  }
});
