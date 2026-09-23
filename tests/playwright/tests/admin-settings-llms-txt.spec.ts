import { test, expect, Page } from '@playwright/test';

/**
 * llms.txt: an admin-editable file (Settings > SEO tab), same pattern as
 * the pre-existing robots.txt editor — a plain-text summary of the store
 * for AI/LLM tools to read, written straight to the site root.
 *
 * This test edits it through the admin UI, confirms it's actually written
 * to /llms.txt on the live site, then restores the original content.
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

test('llms.txt is editable in Settings and is written to the site root', async ({ page, baseURL }) => {
  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=setup`);
  await page.click('a[href="#tab-seo"]');

  const textarea = page.locator('#s_llms_txt');
  await expect(textarea).toBeVisible();
  const original = await textarea.inputValue();

  const marker = `# Playwright test ${Date.now()}`;

  try {
    await textarea.fill(marker);
    const saveResponse = page.waitForResponse(resp => resp.url().includes('route=settings/ajax') && resp.request().method() === 'POST');
    await page.click('#btn-save-all');
    await saveResponse;
    await expect(page.locator('.simple-notification.error, [class*="notification"][class*="error"]')).toHaveCount(0);

    const res = await page.request.get(`${baseURL}/llms.txt`);
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toContain(marker);

    // Confirm it reloads from the file (not just held in memory) on a fresh visit.
    await page.reload();
    await page.click('a[href="#tab-seo"]');
    await expect(page.locator('#s_llms_txt')).toHaveValue(marker);
  } finally {
    await textarea.fill(original);
    await page.click('#btn-save-all');
  }
});
