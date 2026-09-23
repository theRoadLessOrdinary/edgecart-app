import { test, expect, Page } from '@playwright/test';

/**
 * PayPal plugin: settings save/reload, and confirming the real PayPal JS
 * SDK button actually renders on checkout once sandbox credentials are set
 * — but NOT completing a real payment.
 *
 * Unlike Stripe (a hosted Payment Element *iframe*, fillable with a test
 * card and no external account needed), PayPal's Buttons() is a hosted
 * Smart Button that opens a real popup/redirect to paypal.com requiring a
 * genuine PayPal Developer sandbox buyer login (email+password from the
 * PayPal developer dashboard). There is no no-login sandbox auto-approve
 * mode this plugin's create-order/capture-order server round trip can use
 * (confirmed against plugins/paypal/catalog/create-order.php and
 * capture-order.php, which always call the real sandbox REST API with a
 * real client-id/secret pair). So completing an actual PayPal payment is a
 * manual/human-in-the-loop test only — this spec stops at confirming the
 * button renders, matching the honest limitation rather than faking
 * coverage of something that can't run headlessly.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PRODUCT_SLUG - slug of a purchasable product (same one used elsewhere)
 *
 * OPTIONAL (skips the button-render check if unset):
 *   PAYPAL_SANDBOX_CLIENT_ID, PAYPAL_SANDBOX_SECRET_KEY - a real PayPal
 *     Developer sandbox app's credentials. Without these, paypal_sandbox_
 *     client_id stays empty and the "paypal" payment method never appears
 *     on checkout at all (hooks.php's _paypal_client_id() gate) — same
 *     env-gated skip pattern as SKIP_STRIPE_CHECKOUT.
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

test.describe('PayPal plugin', () => {
  test('settings save and reload correctly', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);

    const settingsBtn = page.locator('button.plugin-settings-btn[data-code="paypal"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('#plugin-drawer')).toBeVisible();

    await page.selectOption('#paypal_mode', 'sandbox');
    const clientId = process.env.PAYPAL_SANDBOX_CLIENT_ID || `test-client-id-${Date.now()}`;
    await page.fill('#paypal_sandbox_client_id', clientId);
    if (process.env.PAYPAL_SANDBOX_SECRET_KEY) {
      await page.fill('#paypal_sandbox_secret_key', process.env.PAYPAL_SANDBOX_SECRET_KEY);
    }
    // Plugin settings intentionally leave the drawer open after saving
    // (admin/js/plugins.js:272-286 only calls showSuccess(), never
    // closeDrawer() — unlike category/product drawers elsewhere in this
    // admin) — no error toast is the real signal here, not the drawer
    // closing.
    await page.click('#plugin-drawer-save');
    const errorToast = page.locator('.simple-notification.error, [class*="notification"][class*="error"]');
    await expect(errorToast).toHaveCount(0);
    await page.click('#plugin-drawer-close');

    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await settingsBtn.click();
    await expect(page.locator('#plugin-drawer')).toBeVisible();
    await expect(page.locator('#paypal_mode')).toHaveValue('sandbox');
    await expect(page.locator('#paypal_sandbox_client_id')).toHaveValue(clientId);
  });

  test('PayPal button renders on checkout once configured (not completing payment)', async ({ page }) => {
    test.skip(
      !process.env.PAYPAL_SANDBOX_CLIENT_ID,
      'Set PAYPAL_SANDBOX_CLIENT_ID (a real PayPal Developer sandbox app client id) to run this check'
    );

    await page.goto(`/product/${PRODUCT_SLUG}`);
    await page.click('#btn-add-to-cart');
    await page.waitForTimeout(500);

    await page.goto('/cart');
    await page.click('.cart-checkout-button a');
    await expect(page).toHaveURL(/checkout/);

    await page.fill('#co-first', 'Playwright');
    await page.fill('#co-last', 'Tester');
    await page.fill('#co-email', `paypal-test-${Date.now()}@playwright-test.example`);
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

    const paypalRadio = page.locator('input[name="payment_method"][value="paypal"]');
    await expect(paypalRadio, 'paypal payment method should appear once sandbox client id is set').toBeVisible();
    await paypalRadio.check();

    // #btn-place-order creates the real order server-side and, on success,
    // calls window.initPaypal() (js/checkout.js's dispatch-by-method-name
    // pattern, same as Stripe) — that's what actually renders the button.
    await page.click('#btn-place-order');

    // PayPal's hosted button injects its own iframe into this container —
    // confirms the SDK loaded and .render() succeeded. Deliberately stops
    // here: clicking it would open a real paypal.com popup requiring a
    // genuine sandbox buyer login this suite cannot provide headlessly.
    await expect(page.locator('#paypal-button-container iframe').first()).toBeVisible({ timeout: 15_000 });
  });
});
