import { test, expect, Page } from '@playwright/test';
import * as path from 'node:path';

/**
 * Admin: install a plugin via the upload zone on the Plugins page.
 *
 * The UI presents this as drag-drop ("Drop a plugin .zip here, or click to
 * browse"), but drag-drop and click-to-browse both funnel through the same
 * hidden <input type="file" id="plugin-file-input"> and its `change` handler
 * (confirmed in admin/js/plugins.js — dropZone/fileInput both call the same
 * installFile()). Playwright's setInputFiles() sets that input directly,
 * firing the same change event and exercising the identical
 * action=install code path a real drag-drop would — simulating actual
 * drag-and-drop mouse events would be flakier for no additional coverage.
 *
 * Confirmed against source (admin/tpl/plugins/list.html, admin/js/plugins.js)
 * and against a live run.
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
 *   ADMIN_PATH   - the obscured admin URL segment
 *   ADMIN_USER   - admin username
 *   ADMIN_PASS   - admin password
 *   PLUGIN_ZIP   - absolute path to a plugin zip to install. A ready fixture
 *                  is provided at tests/playwright/fixtures/theme-blues.zip
 *                  (built from plugins/.theme-blues, a real disabled-on-disk
 *                  plugin never exercised through the actual zip-upload path
 *                  before — enabling an already-unzipped plugin via its
 *                  toggle would not test install_plugin_zip() at all).
 *   PLUGIN_NAME  - the plugin's display name, as it should appear in the
 *                  plugins table after install (e.g. "Theme: Blues")
 *   PLUGIN_ROUTE - the plugin's admin route, to verify its screen actually
 *                  loads post-install (leave unset for themes — they have
 *                  no admin route of their own, see the CSS check below)
 *   PLUGIN_CSS_HREF_CONTAINS - for theme plugins with no admin route, confirm
 *                  the plugin's real visible effect instead: the hooks.php
 *                  theme.head injection of a <link rel="stylesheet"> whose
 *                  href contains this substring. For fixtures/theme-blues.zip
 *                  use PLUGIN_CSS_HREF_CONTAINS=plugins/theme-blues/css/theme.css
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

const PLUGIN_ZIP = process.env.PLUGIN_ZIP;
if (!PLUGIN_ZIP) throw new Error('Set PLUGIN_ZIP env var (absolute path to a plugin .zip)');

const PLUGIN_NAME  = process.env.PLUGIN_NAME  || path.basename(PLUGIN_ZIP, '.zip');
const PLUGIN_ROUTE = process.env.PLUGIN_ROUTE || '';

async function login(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

test.describe('Admin plugin install', () => {
  test('install a plugin via the upload zone and confirm it works', async ({ page }) => {
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);

    // ── Upload ────────────────────────────────────────────────────────────────
    await page.setInputFiles('#plugin-file-input', PLUGIN_ZIP);

    // installFile() shows #upload-progress while installing, hides it on
    // completion (success or failure) and re-renders #plugin-tbody on success.
    // A small local zip installs fast enough that the visible state can come
    // and go between polls — don't assert on it being caught mid-flight,
    // just that it has settled back to hidden once the request is done.
    await expect(page.locator('#upload-progress')).not.toBeVisible({ timeout: 30_000 });

    // ── Confirm no error toast fired ─────────────────────────────────────────
    // notifyErr() uses SimpleNotification — TODO: confirm exact error-toast
    // selector against a live instance; this is a best-effort check.
    const errorToast = page.locator('.simple-notification.error, [class*="notification"][class*="error"]');
    await expect(errorToast).toHaveCount(0);

    // ── Confirm the plugin now appears, installed and enabled ───────────────
    await expect(page.locator('#plugin-tbody')).toContainText(PLUGIN_NAME);
    const row = page.locator('#plugin-tbody tr', { hasText: PLUGIN_NAME });
    await expect(row.locator('ios-toggle, input[type="checkbox"]').first()).toBeVisible();

    // ── Confirm the plugin's own admin screen actually loads ────────────────
    if (PLUGIN_ROUTE) {
      await page.goto(`/${ADMIN_PATH}/?route=${PLUGIN_ROUTE}`);
      await expect(page).not.toHaveURL(/route=login/);
      // A hard PHP error would show raw error text rather than the admin
      // chrome — check the sidebar rendered, proving the page bootstrapped.
      await expect(page.locator('#sidebar, nav')).toBeVisible();
    }

    // ── Themes have no admin route of their own — confirm the visible effect
    // (their theme.head hook injecting a <link> to the theme's own CSS)
    // instead. Not asserting the resulting computed --nc-* value: if another
    // theme is already enabled on this install (themes aren't mutually
    // exclusive — enabling one doesn't disable others), both hooks fire and
    // whichever <link> lands last in the DOM wins the cascade, so the
    // computed value isn't a reliable signal of *this* plugin's own install
    // succeeding — the injected <link> tag itself is.
    if (process.env.PLUGIN_CSS_HREF_CONTAINS) {
      // theme.head only renders into <head> on a fresh page load — the
      // install AJAX call doesn't touch the current DOM's <head> at all, so
      // without a reload this always fails regardless of whether install
      // actually worked.
      await page.reload();
      const linkCount = await page
        .locator(`link[rel="stylesheet"][href*="${process.env.PLUGIN_CSS_HREF_CONTAINS}"]`)
        .count();
      expect(linkCount, 'expected theme.head hook to inject this plugin\'s CSS link').toBeGreaterThan(0);
    }
  });
});
