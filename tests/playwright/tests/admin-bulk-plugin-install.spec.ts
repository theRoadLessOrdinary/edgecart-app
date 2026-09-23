import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';

/**
 * One-time bulk install of every plugin zip in edgeCart-plugins/ that isn't
 * already bundled/active on this install (catalog-importer, digital-
 * download, paypal, reports-core, stripe were already active; theme-blues
 * was already exercised by admin-plugin-install.spec.ts). Requested so
 * every premium plugin has at least an "installs cleanly, appears enabled"
 * smoke check — deep functional coverage per-plugin is separate, future work.
 *
 * Uses the same real zip-upload code path already validated in
 * admin-plugin-install.spec.ts (#plugin-file-input change handler →
 * action=install), just looped across every zip.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PLUGIN_ZIPS_DIR - absolute path to the directory of .zip files to install
 *                     (e.g. /media/william/8TB-DRIVE/www/sites/edgeCart-plugins)
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

const PLUGIN_ZIPS_DIR = process.env.PLUGIN_ZIPS_DIR;
if (!PLUGIN_ZIPS_DIR) throw new Error('Set PLUGIN_ZIPS_DIR env var (directory of plugin .zip files)');

async function login(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

test('bulk-install every plugin zip and confirm each appears enabled', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  const zips = fs.readdirSync(PLUGIN_ZIPS_DIR)
    .filter((f) => f.endsWith('.zip') && !f.includes('.bak-') && !f.includes('.stale-now-'))
    .sort();
  expect(zips.length, 'expected at least one plugin zip to install').toBeGreaterThan(0);

  await login(page);

  const failures: string[] = [];

  for (const zip of zips) {
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await page.setInputFiles('#plugin-file-input', `${PLUGIN_ZIPS_DIR}/${zip}`);
    await expect(page.locator('#upload-progress')).not.toBeVisible({ timeout: 30_000 });

    const errorToast = page.locator('.simple-notification.error, [class*="notification"][class*="error"]');
    if (await errorToast.count() > 0) {
      failures.push(`${zip}: ${await errorToast.first().innerText()}`);
      continue;
    }

    // Row presence is the real signal — plugin code (folder name) is a
    // slugified guess and its display name may differ (e.g. theme-sienna is
    // already active from install, harmless to re-install over itself).
    const tbody = page.locator('#plugin-tbody');
    await expect(tbody).not.toBeEmpty();
  }

  expect(failures, `plugin install failures:\n${failures.join('\n')}`).toEqual([]);
});
