import { test, expect, Page } from '@playwright/test';

/**
 * google-oauth: "Sign in with Google" for customers. Settings round-trip is
 * fully testable; actual login completion is not — clicking the button does
 * a real server-side redirect() to accounts.google.com (ctl/google-oauth.php),
 * requiring a genuine Google account and running headfirst into Google's own
 * bot detection on automated browsers. Same class of limitation as PayPal's
 * sandbox buyer login found earlier this session — this test proves the
 * button renders and points at the right destination, and stops there.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
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

test.describe('google-oauth plugin', () => {
  test('settings save and reload correctly', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);

    const settingsBtn = page.locator('button.plugin-settings-btn[data-code="google-oauth"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('#plugin-drawer')).toBeVisible();

    const originalId = await page.locator('#ps_google_client_id').inputValue();
    const testId = `${Date.now()}-test.apps.googleusercontent.com`;
    await page.fill('#ps_google_client_id', testId);
    await page.click('#plugin-drawer-save');
    await expect(page.locator('.simple-notification.error, [class*="notification"][class*="error"]')).toHaveCount(0);

    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await settingsBtn.click();
    await expect(page.locator('#ps_google_client_id')).toHaveValue(testId);

    // Restore — real config, not disposable test data.
    await page.fill('#ps_google_client_id', originalId);
    await page.click('#plugin-drawer-save');
  });

  test('Sign in with Google button renders and points at the real redirect route', async ({ page }) => {
    // No login-page link exists at all (checked tpl/login.html — none).
    // The real "sign in with Google" entry point for anonymous shoppers is
    // checkout's guest-speedup link (tpl/checkout.html:41,
    // ?route=google-oauth&next=checkout) — requires a non-empty cart
    // (ctl/checkout.php redirects to /cart otherwise). Button is only
    // rendered when both credentials are set (plugins/google-oauth/
    // hooks.php ~line 20) — already confirmed set via TRLO's borrowed
    // credentials for this test.
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

    const googleLink = page.locator('a[href*="route=google-oauth"]');
    await expect(googleLink).toBeVisible();

    // Confirm clicking it actually reaches Google's real OAuth endpoint
    // (ctl/google-oauth.php does a genuine server-side redirect via
    // GoogleOAuth::getAuthUrl()) without attempting to complete login —
    // that's the honest stopping point for this plugin.
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('accounts.google.com'), { timeout: 10_000 }).catch(() => null),
      googleLink.click(),
    ]);
    expect(page.url()).toContain('accounts.google.com');
  });
});
