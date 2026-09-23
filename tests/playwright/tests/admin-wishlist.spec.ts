import { test, expect, Page } from '@playwright/test';

/**
 * wishlist: "Add to Wish List" is injected client-side next to Add to Cart
 * on any product page (plugins/wishlist/js/wishlist.js), not template-based
 * — server-side gated (catalog/ajax.php: login required regardless of UI
 * state). The share-as-gift-registry link is token-based, same
 * bin2hex(random_bytes(24)) pattern as digital-download's download tokens,
 * passed as a query string (?share=token), and viewing a shared wishlist is
 * public (no login required).
 *
 * This test creates a real customer account directly via checkout (reusing
 * the established pattern elsewhere in this suite), adds a product to their
 * wishlist, makes it public, and confirms the resulting share link actually
 * works when visited from a completely logged-out context.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PRODUCT_SLUG - slug of a purchasable product
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

async function createCustomerAccount(page: Page, email: string, password: string) {
  // Cheapest real way to create a login-able customer account is via
  // checkout's optional password field (ctl/checkout.php ~line 162-171) —
  // reused from admin-digital-download.spec.ts / admin-reviews.spec.ts.
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
  await page.fill('#co-first', 'Wishlist');
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
}

test('wishlist: add a product, share it, confirm the public link works logged out', async ({ browser }) => {
  const email = `wishlist-test-${Date.now()}@playwright-test.example`;
  const password = 'TestPass123!';

  const context = await browser.newContext();
  const page = await context.newPage();

  await createCustomerAccount(page, email, password);

  // ── Add to wishlist (button is JS-injected next to Add to Cart) ────────
  // Clicking it doesn't add directly — it opens a picker of the customer's
  // own wishlists (plugins/wishlist/js/wishlist.js ~line 65-100). A brand
  // new account has none yet, so the picker shows only "+ Add to new list",
  // requiring a name + confirm before anything actually gets added.
  await page.goto(`/product/${PRODUCT_SLUG}`);
  const wishlistBtn = page.locator('button.btn-wishlist');
  await expect(wishlistBtn).toBeVisible();
  await wishlistBtn.click();
  await page.locator('.wl-picker-new').click();
  await page.locator('.wl-picker-new-input').fill('Playwright Test List');
  await page.locator('.wl-picker-new-add').click();
  await expect(wishlistBtn).toHaveClass(/in-list/);

  // ── Make it public, grab the share link ─────────────────────────────────
  // Every account also gets a default, always-present "My Wish List" tab —
  // it's the one shown/active by default, NOT the "Playwright Test List"
  // just created, which sits inert in a separate, hidden (display:none)
  // tab panel (tpl/wishlist/wishlist.html ~line 48-62, .wl-tab[data-list-
  // id]) until its own tab is clicked. An unscoped ios-toggle selector
  // risked matching the wrong (currently-hidden) list's toggle.
  await page.goto('/?route=wishlist/index');
  await page.locator('.wl-tab', { hasText: 'Playwright Test List' }).click();
  // ios-toggle custom element (tpl/wishlist/wishlist.html:79-81), not a
  // plain checkbox — click the element itself, same rule established
  // elsewhere in this suite for ios-toggle interactions.
  // Playwright's :visible pseudo-class (not a real CSS selector, a
  // Playwright extension) rather than string-matching the style attribute
  // — the template actually emits "display:none" with no space, which an
  // earlier version of this selector's [style*="display: none"] (with a
  // space) never matched, silently defeating the whole :not() filter.
  //
  // No .wl-public-toggle class selector: ios-toggle strips its own class/
  // id/style/name attributes on upgrade (js/vendor/ios-toggle.js line 56)
  // and moves the class specifically onto a HIDDEN inner input, not the
  // visible checkbox — the class never matches the host element post-
  // upgrade. data-list-id survives (not in the strip list), but since
  // .wl-list:visible already scopes to the one correct panel, and it
  // contains exactly one ios-toggle, no further selector is needed.
  await page.locator('.wl-list:visible ios-toggle').click();
  const shareInput = page.locator('.wl-list:visible .wl-share-url');
  await expect(shareInput).toBeVisible({ timeout: 5_000 });
  const shareUrl = await shareInput.inputValue();
  expect(shareUrl).toContain('share=');

  // ── Visit the share link from a completely separate, logged-out context ──
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(shareUrl);
  await expect(guestPage.locator('.wl-card')).toHaveCount(1);

  await context.close();
  await guestContext.close();
});
