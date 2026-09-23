import { test, expect, Page } from '@playwright/test';

/**
 * Admin: Plugins list — the "Settings" button shown per plugin row.
 *
 * admin/ctl/plugins/ajax.php's `load_plugin_settings` action only ever
 * renders manifest-declared <settings> keys or an admin/settings.php
 * template (or the taxjar-style admin.plugin.settings.{code}.load hook
 * override). It never uses admin/index.php. The list action's `has_settings`
 * flag previously didn't account for that, and the button was gated on
 * `has_settings || has_admin` (admin/js/plugins.js) — so any plugin whose
 * only admin surface was its own full page (admin/index.php, usually
 * reached via <admin_menu> in the sidebar, e.g. Catalog Importer, API Keys,
 * DB Backup) showed a "Settings" button that opened to a dead-end
 * "This plugin has no configurable settings." message. Confirmed live
 * (2026-07-11) for catalog-importer, api-keys, dashboard, reviews, and
 * customer-exclusive before the fix.
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
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

test.describe('Admin Plugins list', () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await page.waitForTimeout(1000);
  });

  test('a plugin with only its own admin page (no drawer settings) shows no Settings button', async ({ page }) => {
    // catalog-importer has a real, substantial admin/index.php (the import
    // wizard, reached via its own <admin_menu> sidebar entry) but no
    // admin/settings.php and no manifest-declared <settings> keys — there is
    // nothing for the drawer to show.
    const row = page.locator('#plugin-tbody tr[data-code="catalog-importer"]');
    await expect(row).toBeVisible();
    await expect(row.locator('.plugin-settings-btn')).toHaveCount(0);
  });

  test('a plugin with real declared settings still shows a working Settings button', async ({ page }) => {
    // stripe has manifest-declared <settings> keys and its own
    // admin/settings.php template — the button must still appear and open
    // to real content, not regress from the has_admin removal.
    const row = page.locator('#plugin-tbody tr[data-code="stripe"]');
    await expect(row).toBeVisible();
    const btn = row.locator('.plugin-settings-btn');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#plugin-drawer-content')).not.toContainText('no configurable settings');
    await page.click('#plugin-drawer-close');
  });

  test('plugins with no settings drawer point to their real admin location in the description', async ({ page }) => {
    // Previously these descriptions said nothing about where to actually
    // manage the plugin, and the (now-removed) Settings button was the only
    // apparent way in — a dead end. The description is now the only
    // remaining pointer, so it has to actually say where to go.
    const cases: Record<string, RegExp> = {
      'catalog-importer':  /Setup & Utilities.*Catalog Importer/,
      'api-keys':          /Setup & Utilities.*API Keys/,
      'db-backup':         /Setup & Utilities.*DB Backup/,
      'forms':             /Content.*Forms/,
      'slideshows':        /Content.*Slideshows/,
      'wishlist':          /Customers.*Wishlists/,
      'reviews':           /Catalog.*Reviews/,
      'customer-exclusive': /Products and Customers edit screens/,
    };
    for (const [code, pattern] of Object.entries(cases)) {
      const row = page.locator(`#plugin-tbody tr[data-code="${code}"]`);
      await expect(row.locator('.plugin-settings-btn')).toHaveCount(0);
      // .plugin-author is used for two different things in this row: a
      // <div> holding the plugin's description text, and a <td> holding the
      // author name — disambiguate by tag, not just class.
      await expect(row.locator('div.plugin-author')).toHaveText(pattern);
    }
  });

  test('enabling a theme auto-disables the old one visibly, and manually toggling the old one off no longer errors', async ({ page }) => {
    // admin/ctl/plugins/ajax.php's enable action silently disables every
    // other active theme server-side (only one theme may be active at a
    // time) — the Plugins list previously never reflected that until a full
    // reload, and manually flipping the now-already-disabled theme's toggle
    // off failed with a confusing "Plugin not found." (admin/ctl/plugins/
    // ajax.php's disable action required the enabled-path folder to exist).
    const sienna = page.locator('#plugin-tbody tr[data-code="theme-sienna"] ios-toggle input[type="checkbox"]');
    const winter = page.locator('#plugin-tbody tr[data-code="theme-winter"] ios-toggle input[type="checkbox"]');

    await expect(sienna).toBeChecked();
    await expect(winter).not.toBeChecked();

    try {
      // Enable theme-winter — theme-sienna must visibly flip off in the
      // SAME response cycle, without a manual page reload.
      await page.locator('#plugin-tbody tr[data-code="theme-winter"] ios-toggle').click();
      await expect(winter).toBeChecked();
      await expect(sienna).not.toBeChecked({ timeout: 10_000 });

      // Manually toggling the now-already-disabled theme-sienna off (its
      // toggle correctly shows off, but the user might still click it,
      // e.g. muscle memory, or it was already unchecked when the page
      // loaded) must not surface an error notification.
      await page.locator('#plugin-tbody tr[data-code="theme-sienna"] ios-toggle').click();
      await page.waitForTimeout(500);
      await expect(page.locator('.simple-notification.error', { hasText: /not found/i })).toHaveCount(0);
    } finally {
      // Restore: re-enable theme-sienna (auto-disables theme-winter back),
      // leaving the install in its original state.
      await page.goto(`/${ADMIN_PATH}/?route=plugins`);
      await page.waitForTimeout(1000);
      const siennaAfter = page.locator('#plugin-tbody tr[data-code="theme-sienna"] ios-toggle input[type="checkbox"]');
      if (!(await siennaAfter.isChecked())) {
        await page.locator('#plugin-tbody tr[data-code="theme-sienna"] ios-toggle').click();
        await page.waitForTimeout(1000);
      }
    }
  });
});
