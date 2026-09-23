import { test, expect, Page } from '@playwright/test';

/**
 * Storefront: browse a product, add to cart, and complete checkout — two
 * payment paths.
 *
 * Checkout always creates the order server-side on "Place Order" (ctl/
 * checkout.php ~line 31-186) *before* any payment is collected — for the
 * "Check" path that's the entire flow (redirect straight to /order-complete,
 * js/checkout.js:605). For Stripe, #btn-place-order is swapped for
 * #btn-pay-stripe and a real Stripe Payment Element mounts into
 * #stripe-payment-element (plugins/stripe/catalog/stripe-checkout.js:52-87)
 * — that's Stripe's own hosted iframe, filled here via frameLocator() with
 * Stripe's standard test card (4242 4242 4242 4242), not app markup.
 *
 * Selecting a shipping method is mandatory before the payment section even
 * appears (js/checkout.js:535-538, tpl/checkout.html:192) — skipping straight
 * to #btn-place-order without picking a rate leaves it hidden/blocked.
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
 *   BASE_URL     - set in playwright.config.ts, but this file needs the
 *                  storefront's own base, not admin
 *   PRODUCT_SLUG - slug of any active, in-stock product to buy (e.g. a
 *                  seeded sample product's slug)
 *
 * Stripe path additionally requires the store to actually have
 * stripe_test_publishable_key/stripe_test_secret_key configured (Settings →
 * ... plugin settings drawer) — skipped otherwise, same env-gated pattern
 * used for the OpenCart importer test.
 */

const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

async function addProductToCart(page: Page) {
  await page.goto(`/product/${PRODUCT_SLUG}`);
  // Product options (Size, etc.) render as a <select id="opt-{id}"> per
  // option when type=select — pick the first real value on any that exist,
  // required options block Add to Cart otherwise (js/product.js:316-334).
  const optionSelects = page.locator('#product-options select.option-dropdown');
  const optionCount = await optionSelects.count();
  for (let i = 0; i < optionCount; i++) {
    await optionSelects.nth(i).selectOption({ index: 1 });
  }
  await page.click('#btn-add-to-cart');
  // No page navigation on add — the button shows a green check overlay
  // instead (js/product.js:352-362). Give the AJAX call a moment, then go
  // look at the actual cart rather than trust the animation.
  await page.waitForTimeout(500);
}

async function proceedThroughShipping(page: Page) {
  await page.goto('/cart');
  await expect(page.locator('#cart-table')).toBeVisible();
  await page.click('.cart-checkout-button a');
  await expect(page).toHaveURL(/checkout/);

  await page.fill('#co-first', 'Playwright');
  await page.fill('#co-last', 'Tester');
  await page.fill('#co-email', `checkout-test-${Date.now()}@playwright-test.example`);
  await page.fill('#co-phone', '555-0100');

  // Only present when the cart requires physical shipping.
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
}

test.describe('Storefront checkout', () => {
  // Regression test for a real bug found on a fresh install: when every
  // available shipping rate is priced at or above the "expensive" threshold
  // (js/checkout.js PRICE_LIMIT=15), the old logic hid all of them behind a
  // "Show other, more expensive options…" toggle, leaving zero visibly-
  // selectable rates on page load — a checkout dead end for any customer who
  // didn't notice the toggle link. Mocks the shipping_rates AJAX response
  // directly so this doesn't depend on any real shipping method being
  // configured on whatever store runs this suite.
  test('a single expensive shipping rate is visible without needing the "show more" toggle', async ({ page }) => {
    await addProductToCart(page);
    await page.goto('/cart');
    await expect(page.locator('#cart-table')).toBeVisible();
    await page.click('.cart-checkout-button a');
    await expect(page).toHaveURL(/checkout/);

    const addr1 = page.locator('#co-addr1');
    test.skip(await addr1.count() === 0, `${PRODUCT_SLUG} is digital-only, no shipping rates to test`);

    // A literal glob string is wrong here: "?" is a single-character wildcard
    // in Playwright's glob syntax, not the query-string separator, so it
    // silently never matches "?route=checkout". A RegExp matches literally.
    await page.route(/\?route=checkout/, async (route) => {
      const request = route.request();
      // The form posts as multipart/form-data, not urlencoded — the field
      // name and value sit in separate lines of the body ("action=shipping_rates"
      // never appears as a literal substring), so just look for the value.
      if (request.method() === 'POST' && (request.postData() || '').includes('shipping_rates')) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            rates: [{ id: 'mock-expensive', carrier: 'MockCarrier', service: 'Expedited', rate: 20, days: 2 }],
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.fill('#co-first', 'Playwright');
    await page.fill('#co-last', 'Tester');
    await page.fill('#co-email', `checkout-test-${Date.now()}@playwright-test.example`);
    await page.fill('#co-phone', '555-0100');
    await addr1.fill('123 Test Street');
    await page.fill('#co-zip', '78701');
    await page.fill('#co-city', 'Austin');
    await page.fill('#co-state', 'TX');
    await page.selectOption('#co-country', { index: 0 });

    await page.click('#btn-get-rates');

    // The whole point of the fix: this must be visible immediately, no click
    // on "Show other, more expensive options…" required.
    const rateRadio = page.locator('input[name="shipping_rate"]');
    await expect(rateRadio).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#expensive-toggle')).toHaveCount(0);
  });

  test('checkout with Check payment method', async ({ page }) => {
    await addProductToCart(page);
    await proceedThroughShipping(page);

    // "Check" is a core payment method (Settings → Server →
    // s_enable_check_payment), no external dependency — exercises the full
    // real order-creation path without needing Stripe/PayPal configured.
    const checkRadio = page.locator('input[name="payment_method"][value="check"]');
    if (await checkRadio.count() > 0) {
      await checkRadio.check();
    }

    await page.click('#btn-place-order');

    await expect(page).toHaveURL(/order-complete/, { timeout: 15_000 });
    await expect(page.locator('text=Thank you for your order')).toBeVisible();
    await expect(page.locator('text=/Your order #\\d+ has been placed/')).toBeVisible();
  });

  test('checkout with Stripe payment (test mode)', async ({ page }) => {
    test.skip(
      process.env.SKIP_STRIPE_CHECKOUT === '1',
      'Set SKIP_STRIPE_CHECKOUT=1 to skip if this store has no Stripe test keys configured'
    );

    await addProductToCart(page);
    await proceedThroughShipping(page);

    const stripeRadio = page.locator('input[name="payment_method"][value="stripe"]');
    if (await stripeRadio.count() > 0) {
      await stripeRadio.check();
    }

    // #btn-place-order must actually be clicked first — that's what creates
    // the real order server-side (action=place_order, js/checkout.js:534-604)
    // and, on success, calls window.initStripe() (dispatched by payment
    // method name), which is what creates the PaymentIntent and mounts the
    // element. Nothing mounts on its own just by selecting the radio.
    await page.click('#btn-place-order');

    // stripe-checkout.js then swaps #btn-place-order out for #btn-pay-stripe
    // (line 81-86) once the element is mounted.
    const payButton = page.locator('#btn-pay-stripe, #btn-place-order');
    await expect(page.locator('#stripe-payment-element iframe').first()).toBeVisible({ timeout: 15_000 });

    // Stripe's own hosted iframe — not app markup, can't be targeted by id.
    const stripeFrame = page.frameLocator('#stripe-payment-element iframe').first();
    await stripeFrame.locator('input[name="number"]').fill('4242424242424242');
    await stripeFrame.locator('input[name="expiry"]').fill('12/34');
    await stripeFrame.locator('input[name="cvc"]').fill('123');
    const postal = stripeFrame.locator('input[name="postalCode"]');
    if (await postal.count() > 0) await postal.fill('78701');

    await payButton.first().click();

    await expect(page).toHaveURL(/order-complete/, { timeout: 30_000 });
    await expect(page.locator('text=Thank you for your order')).toBeVisible();
    await expect(page.locator('text=/Your order #\\d+ has been placed/')).toBeVisible();
  });
});
