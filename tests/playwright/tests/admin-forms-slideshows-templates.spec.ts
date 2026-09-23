import { test, expect, Page } from '@playwright/test';

/**
 * forms and slideshows: both plugins' own admin list.html used
 * {extends file="../layout.html"} instead of {extends file="layout.html"}.
 * Smarty resolves a bare relative filename by searching every registered
 * template_dir (each active plugin's admin/tpl/ plus core admin/tpl/, see
 * admin/index.php's $tpl_dirs) — but a "../"-prefixed path is resolved only
 * within the CURRENT template's own template_dir, and neither plugin ships
 * its own layout.html, so it always failed with "Unable to load template".
 * Every other plugin's list.html already used the correct bare form.
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

test('forms and slideshows admin pages render, not a template-load error', async ({ page }) => {
  await loginAdmin(page);

  const formsResp = await page.goto(`/${ADMIN_PATH}/?route=forms`);
  expect(formsResp?.status()).toBe(200);
  await expect(page.locator('body')).not.toContainText('An error occurred');

  const slideshowsResp = await page.goto(`/${ADMIN_PATH}/?route=slideshows`);
  expect(slideshowsResp?.status()).toBe(200);
  await expect(page.locator('body')).not.toContainText('An error occurred');
});
