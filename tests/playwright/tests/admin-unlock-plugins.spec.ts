import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * "Unlock" plugins: categories-products and discounts. Both are pure
 * behavior-modifiers with no admin UI of their own (plugin.xml declares no
 * <settings>, has_settings/has_admin both false on the Plugins page) — they
 * just register Hook::on('admin.limit.X.instead', fn() => PHP_INT_MAX) in
 * their own hooks.php, read back by the shared lib/license-limits.php
 * functions (check_category_limit, check_discount_limit, etc.) built
 * earlier this session.
 *
 * Both were found ALREADY ENABLED on this install as a side effect of the
 * earlier bulk plugin install (admin-bulk-plugin-install.spec.ts) — verified
 * directly via PHP CLI (`license_limit('categories', 3)` returns
 * PHP_INT_MAX, not 3). That means the existing admin-catalog-importer.spec.ts
 * "license limit" test currently could not tell the difference between "the
 * cap is enforced" and "the cap is unlocked" if run in the wrong order —
 * this test explicitly disables both, tests the default-cap and unlocked
 * behavior itself, and leaves both plugins disabled afterward so every
 * other spec in this suite keeps seeing the intended default caps (3
 * categories, 3 discount codes).
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

// Discount codes must be 6-20 uppercase alphanumeric characters (admin/ctl/
// discounts/ajax.php: /^[A-Z0-9]{6,20}$/) — no lowercase, no hyphens. Base36
// timestamp + a short random suffix keeps every call unique within 20 chars.
function validCode(): string {
  return ('UL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}

async function setPluginEnabled(page: Page, code: string, enabled: boolean) {
  await page.goto(`/${ADMIN_PATH}/?route=plugins`);
  const row = page.locator(`#plugin-tbody tr[data-code="${code}"]`);
  const toggle = row.locator('ios-toggle');
  const checkbox = toggle.locator('input[type="checkbox"]');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== enabled) {
    await toggle.click();
    await page.waitForTimeout(500); // fetch('action=enable'/'disable') round trip
  }
}

test.describe('Unlock plugins: categories-products, discounts', () => {
  test.afterEach(async ({ page }) => {
    // However a test ends (pass or fail), leave both plugins disabled so
    // the rest of this suite sees the intended default caps.
    await loginAdmin(page);
    await setPluginEnabled(page, 'categories-products', false);
    await setPluginEnabled(page, 'discounts', false);
  });

  test('discounts plugin unlocks the 3-code discount cap', async ({ page }) => {
    await loginAdmin(page);

    // Confirm the default cap is actually enforced first — otherwise this
    // test would prove nothing (it'd pass identically whether the plugin
    // works or is silently broken).
    await setPluginEnabled(page, 'discounts', false);
    await page.goto(`/${ADMIN_PATH}/?route=discounts`);
    const existingCount = await page.locator('#discounts-tbody tr[data-id]').count();
    const roomLeft = Math.max(0, 3 - existingCount);
    for (let i = 0; i < roomLeft; i++) {
      await page.click('#btn-add-code');
      await page.fill('#c_code', validCode());
      await page.fill('#c_amount', '10');
      await page.click('#btn-drawer-save');
      await expect(page.locator('#btn-drawer-save')).toBeVisible();
      await page.waitForTimeout(300);
    }
    // Now at the cap — admin/js/discounts.js hides #btn-add-code entirely
    // once count >= limit (same pattern already found for categories
    // earlier this session), replacing it with an upgrade hint. The
    // disappearing button IS the enforcement here — there's no click-then-
    // rejected flow to exercise, the UI never lets you reach the form.
    await expect(page.locator('#btn-add-code')).toBeHidden();
    await expect(page.locator('.ec-limit-hint')).toBeVisible();

    // Enable the unlock plugin — the button should reappear and a 4th+
    // code should now succeed.
    await setPluginEnabled(page, 'discounts', true);
    await page.goto(`/${ADMIN_PATH}/?route=discounts`);
    const unlockedCode = validCode();
    await expect(page.locator('#btn-add-code')).toBeVisible();
    await page.click('#btn-add-code');
    await page.fill('#c_code', unlockedCode);
    await page.fill('#c_amount', '10');
    await page.click('#btn-drawer-save');
    await expect(page.locator('text=/limit reached/i')).not.toBeVisible();
    await expect(page.locator('#discounts-tbody')).toContainText(unlockedCode);
  });

  test('categories-products plugin unlocks the category cap', async ({ page }) => {
    await loginAdmin(page);

    await setPluginEnabled(page, 'categories-products', false);
    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    const existingCount = await page.locator('#cat-tbody tr[data-id]').count();
    const roomLeft = Math.max(0, 3 - existingCount);
    for (let i = 0; i < roomLeft; i++) {
      await page.click('#btn-add-category');
      await page.fill('#cat-name', `Unlock Test Category ${Date.now()}-${i}`);
      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);
    }
    // At the cap — admin/js/categories.js hides #btn-add-category entirely
    // once count >= limit, replacing it with an upgrade hint (confirmed
    // earlier this session for this exact button). The disappearing button
    // IS the enforcement — there's no click-then-rejected flow here.
    await expect(page.locator('#btn-add-category')).toBeHidden();
    await expect(page.locator('.ec-limit-hint')).toBeVisible();

    // Enable the unlock plugin — the button should reappear and creating
    // past the old cap should now work.
    await setPluginEnabled(page, 'categories-products', true);
    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    const unlockedName = `Unlock Test Unlocked ${Date.now()}`;
    await expect(page.locator('#btn-add-category')).toBeVisible();
    await page.click('#btn-add-category');
    await page.fill('#cat-name', unlockedName);
    await page.click('button:has-text("Save")');
    await expect(page.locator('#cat-tbody')).toContainText(unlockedName);
  });

  test('at the category cap, Add is blocked but an existing (inactive) category can still be deleted', async ({ page }) => {
    // admin/js/categories.js's buildRow() gates the delete control purely on
    // a category's own active/inactive status (see admin-catalog.spec.ts's
    // delete-state test) and never references the cap at all — same for the
    // admin/ctl/categories/ajax.php delete/bulk_delete actions, which have no
    // limit check. This test exercises the literal reported scenario end to
    // end: reach the real (unlock-plugin-disabled) 3-category cap, then
    // confirm Add is blocked while an existing category can still be
    // deactivated and deleted.
    const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
    const user = process.env.DB_MYSQL_USER || 'root';
    const pass = process.env.DB_MYSQL_PASS;
    const db = process.env.DB_NAME || 'toffee_cart';
    const dbExec = (sql: string) =>
      execSync(`mysql -h ${host} -u ${user} -N -B -e "${sql}" ${db}`, {
        env: { ...process.env, MYSQL_PWD: pass || '' },
      }).toString().trim();

    await loginAdmin(page);
    await setPluginEnabled(page, 'categories-products', false);

    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    const existingCount = await page.locator('#cat-tbody tr[data-id]').count();
    const roomLeft = Math.max(0, 3 - existingCount);
    const catName = `Cap Delete Test ${Date.now()}`;
    for (let i = 0; i < roomLeft; i++) {
      await page.click('#btn-add-category');
      await page.fill('#cat-name', i === roomLeft - 1 ? catName : `Cap Filler ${Date.now()}-${i}`);
      await page.click('button:has-text("Save")');
      await page.waitForTimeout(300);
    }

    // At the cap: Add must be hidden.
    await expect(page.locator('#btn-add-category')).toBeHidden();
    await expect(page.locator('.ec-limit-hint')).toBeVisible();

    const catId = dbExec(`SELECT id FROM nc_categories WHERE name='${catName}'`);
    expect(catId).toMatch(/^\d+$/);

    // Deactivate directly (bypasses the roller-select custom element's own
    // interaction quirks, which aren't what this test is about) then delete
    // — while still AT the cap.
    dbExec(`UPDATE nc_categories SET status=0 WHERE id=${catId}`);
    await page.goto(`/${ADMIN_PATH}/?route=categories`);

    const deleteEl = page.locator(`#cat-del-${catId} delete-in-place`);
    await expect(deleteEl).toBeVisible();
    await deleteEl.locator('.dip-delete').click();
    await deleteEl.locator('.dip-confirm').click();
    await expect(page.locator('text=' + catName)).not.toBeVisible({ timeout: 5_000 });

    const remaining = dbExec(`SELECT COUNT(*) FROM nc_categories WHERE id=${catId}`);
    expect(remaining).toBe('0');

    // Now below the cap again — Add must reappear.
    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    await expect(page.locator('#btn-add-category')).toBeVisible();
  });
});
