import { test, expect, Page } from '@playwright/test';

/**
 * api-keys: "Centralized management interface for all API keys and OAuth
 * credentials." It's a read/write VIEW over the same nc_settings rows every
 * other plugin's own settings.php already reads/writes (stripe_secret_key,
 * paypal_sandbox_secret_key, shippo_test_api_key, taxjar_api_key, etc.) —
 * not a separate credential store. Its own ajax.php requires the key to
 * already exist (UPDATE ... WHERE key=?, 404s "Key not found" otherwise),
 * so it can only edit values other plugins' settings screens already
 * expose, never create new ones.
 *
 * This test edits stripe_test_publishable_key's value through api-keys'
 * own UI and confirms it round-trips through the SAME row Stripe's own
 * settings screen reads — proving this is genuinely a shared view, not a
 * parallel/duplicate store that could silently drift out of sync.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

test('api-keys edits the same row Stripe\'s own settings screen uses', async ({ page }) => {
  await loginAdmin(page);

  // Capture Stripe's current value first via its own settings screen so
  // this test can restore it afterward — it's real config, not disposable
  // test data.
  await page.goto(`/${ADMIN_PATH}/?route=plugins`);
  await page.click('button.plugin-settings-btn[data-code="stripe"]');
  await expect(page.locator('#plugin-drawer')).toBeVisible();
  const original = await page.locator('#stripe_test_publishable_key').inputValue();
  await page.click('#plugin-drawer-close');

  const testValue = `pk_test_playwright_${Date.now()}`;

  try {
    await page.goto(`/${ADMIN_PATH}/?route=api-keys`);
    // Save is one button per origin-group section (save-button.save-group-
    // keys, admin/tpl/api-keys.html:25), not per individual row.
    const row = page.locator('.api-key-row[data-key="stripe_test_publishable_key"]');
    await expect(row).toBeVisible();
    await row.locator('input.api-key-input').fill(testValue);
    await row.locator('xpath=ancestor::div[contains(@class,"api-keys-section")]').locator('.save-group-keys').click();
    await expect(page.locator('.simple-notification.error, [class*="notification"][class*="error"]')).toHaveCount(0);

    // Confirm it actually lands in the SAME row Stripe's own screen reads —
    // proving api-keys isn't a separate/parallel store.
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await page.click('button.plugin-settings-btn[data-code="stripe"]');
    await expect(page.locator('#stripe_test_publishable_key')).toHaveValue(testValue);
    await page.click('#plugin-drawer-close');
  } finally {
    await page.goto(`/${ADMIN_PATH}/?route=api-keys`);
    const row = page.locator('.api-key-row[data-key="stripe_test_publishable_key"]');
    await row.locator('input.api-key-input').fill(original);
    await row.locator('xpath=ancestor::div[contains(@class,"api-keys-section")]').locator('.save-group-keys').click();
  }
});
