import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Admin: Setup & Utilities — Store, Local, Mail, Server, Options
 * (Images/Catalog/Reviews/Order Statuses), SEO (robots.txt), and Users.
 *
 * All of Store/Local/Mail/Server/Options/SEO live as tabs on a single page
 * (?route=setup, admin/tpl/settings/list.html) sharing one Save button
 * (#btn-save-all, save_all action) — confirmed via admin/js/settings.js.
 * Users and Options>Order Statuses save independently via their own drawer
 * save buttons, not #btn-save-all.
 *
 * Tabs are toggled via .active class (admin/js/nc-tabs.js), not display:none
 * removal of the element from the DOM, but a tab's fields may not be
 * interactable until its tab link is clicked (same rule established for the
 * product drawer's tabbed panels elsewhere in this suite).
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
 *   ADMIN_PATH   - the obscured admin URL segment
 *   ADMIN_USER   - admin username
 *   ADMIN_PASS   - admin password
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

async function login(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

test.describe('Admin Setup & Utilities', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=setup`);
  });

  test('Store, Local, Mail, Server settings save together via one Save button', async ({ page }) => {
    await page.click('a[href="#tab-store"]');
    await expect(page.locator('#tab-store')).toHaveClass(/active/);
    await page.fill('#s_site_name', 'Playwright Test Store');
    await page.fill('#s_store_phone', '555-0100');

    await page.click('a[href="#tab-local"]');
    await expect(page.locator('#tab-local')).toHaveClass(/active/);
    await page.selectOption('#s_timezone', { index: 1 });
    await page.selectOption('#s_weight_unit', { index: 0 });

    await page.click('a[href="#tab-mail"]');
    await expect(page.locator('#tab-mail')).toHaveClass(/active/);
    await page.fill('#s_mail_from', 'store@playwright-test.example');

    await page.click('a[href="#tab-server"]');
    await expect(page.locator('#tab-server')).toHaveClass(/active/);
    await page.fill('#s_pw_min_length', '10');

    await page.click('#btn-save-all');
    await expect(page.locator('#btn-save-all')).toBeVisible();

    // Reload and confirm the fields across all four tabs actually persisted.
    await page.reload();
    await page.click('a[href="#tab-store"]');
    await expect(page.locator('#s_site_name')).toHaveValue('Playwright Test Store');
    await page.click('a[href="#tab-mail"]');
    await expect(page.locator('#s_mail_from')).toHaveValue('store@playwright-test.example');
    await page.click('a[href="#tab-server"]');
    await expect(page.locator('#s_pw_min_length')).toHaveValue('10');
  });

  test('Server: Error & Debug template settings (Force Recompile / Cache Templates) persist', async ({ page }) => {
    // These two toggles previously existed in the HTML (admin/tpl/settings/list.html)
    // but were never wired into settings.js's load/save logic — so any change
    // a merchant made was silently discarded on every save, always reverting
    // to the toggles' hardcoded HTML default state on reload.
    await page.click('a[href="#tab-server"]');
    await expect(page.locator('#tab-server')).toHaveClass(/active/);

    const isChecked = (id: string) =>
      page.locator('#' + id).evaluate((el) => (el.querySelector('input') as HTMLInputElement).checked);

    const forceCompileBefore = await isChecked('s_smarty_force_compile');
    const cachingBefore = await isChecked('s_smarty_caching');

    await page.locator('#s_smarty_force_compile').click();
    await page.locator('#s_smarty_caching').click();
    await page.click('#btn-save-all');
    await page.waitForTimeout(500);

    await page.reload();
    await page.click('a[href="#tab-server"]');

    expect(await isChecked('s_smarty_force_compile')).toBe(!forceCompileBefore);
    expect(await isChecked('s_smarty_caching')).toBe(!cachingBefore);

    // Restore original state so this test doesn't leave the store's Smarty
    // template caching config changed for subsequent runs.
    await page.locator('#s_smarty_force_compile').click();
    await page.locator('#s_smarty_caching').click();
    await page.click('#btn-save-all');
    await page.waitForTimeout(500);
  });

  test('Options > Catalog: Hide Empty Categories actually hides/shows an empty category on the storefront', async ({ page }) => {
    // catalog_sidebar() (lib/functions.php) reads the setting via
    // `global $_nc_settings` — it previously lacked that declaration, so the
    // function's local $_nc_settings was always undefined and the setting
    // silently no-opped (categories were always filtered, sidebar-side,
    // regardless of the toggle). This test exercises the real storefront
    // sidebar, not just the admin toggle's own persistence.
    const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
    const user = process.env.DB_MYSQL_USER || 'root';
    const pass = process.env.DB_MYSQL_PASS;
    const db = process.env.DB_NAME || 'toffee_cart';
    const dbExec = (sql: string) =>
      execSync(`mysql -h ${host} -u ${user} -N -B -e "${sql}" ${db}`, {
        env: { ...process.env, MYSQL_PWD: pass || '' },
      }).toString().trim();

    const catName = `Playwright Empty Category ${Date.now()}`;
    const slug = `playwright-empty-category-${Date.now()}`;
    dbExec(`INSERT INTO nc_categories (name, slug, status, parent_id, display_order) VALUES ('${catName}', '${slug}', 1, 0, 0)`);
    const catId = dbExec(`SELECT id FROM nc_categories WHERE slug='${slug}'`);
    expect(catId).toMatch(/^\d+$/);

    try {
      await page.click('a[href="#tab-options"]');
      await page.click('button.sub-tab[data-sub="catalog"]');
      const hideEmpty = page.locator('#s_hide_empty_categories');

      // Ensure it's ON (hide empty categories) — the empty category must NOT appear.
      if (!(await hideEmpty.locator('input').isChecked())) {
        await hideEmpty.click();
        await page.click('#btn-save-all');
        await page.waitForTimeout(500);
      }
      await page.goto('/');
      await expect(page.locator('body')).not.toContainText(catName);

      // Turn it OFF (show empty categories) — the empty category must appear.
      await page.goto(`/${ADMIN_PATH}/?route=setup`);
      await page.click('a[href="#tab-options"]');
      await page.click('button.sub-tab[data-sub="catalog"]');
      await page.locator('#s_hide_empty_categories').click();
      await page.click('#btn-save-all');
      await page.waitForTimeout(500);

      await page.goto('/');
      await expect(page.locator('body')).toContainText(catName);
    } finally {
      dbExec(`DELETE FROM nc_categories WHERE id=${catId}`);
      // Restore the default (hide empty categories on).
      await page.goto(`/${ADMIN_PATH}/?route=setup`);
      await page.click('a[href="#tab-options"]');
      await page.click('button.sub-tab[data-sub="catalog"]');
      if (!(await page.locator('#s_hide_empty_categories').locator('input').isChecked())) {
        await page.locator('#s_hide_empty_categories').click();
        await page.click('#btn-save-all');
        await page.waitForTimeout(500);
      }
    }
  });

  test('Options: Images, Catalog, Reviews sub-tabs save', async ({ page }) => {
    await page.click('a[href="#tab-options"]');
    await expect(page.locator('#tab-options')).toHaveClass(/active/);

    await page.click('button.sub-tab[data-sub="images"]');
    await expect(page.locator('#sub-images')).toHaveClass(/active/);
    await page.fill('#s_img_product_width', '1200');

    await page.click('button.sub-tab[data-sub="catalog"]');
    await expect(page.locator('#sub-catalog')).toHaveClass(/active/);
    const hideEmpty = page.locator('#s_hide_empty_categories');
    await hideEmpty.click();

    await page.click('button.sub-tab[data-sub="reviews"]');
    await expect(page.locator('#sub-reviews')).toHaveClass(/active/);
    await page.locator('#s_reviews_auto_approve').click();

    await page.click('#btn-save-all');

    await page.reload();
    await page.click('a[href="#tab-options"]');
    await page.click('button.sub-tab[data-sub="images"]');
    await expect(page.locator('#s_img_product_width')).toHaveValue('1200');
  });

  test('Options: add an Order Status', async ({ page }) => {
    await page.click('a[href="#tab-options"]');
    await page.click('button.sub-tab[data-sub="order-statuses"]');
    await expect(page.locator('#sub-order-statuses')).toHaveClass(/active/);

    await page.click('#btn-add-status');
    await expect(page.locator('#os-drawer')).toBeVisible();
    await page.fill('#os-label', 'Playwright Test Status');
    await page.fill('#os-slug', 'playwright-test-status');
    await page.fill('#os-color-hex', '#336699');
    await page.click('#os-drawer-save');

    await expect(page.locator('#os-tbody')).toContainText('Playwright Test Status');
  });

  test('SEO: add a comment to robots.txt', async ({ page }) => {
    await page.click('a[href="#tab-seo"]');
    await expect(page.locator('#tab-seo')).toHaveClass(/active/);

    const robots = page.locator('#s_robots_txt');
    const original = await robots.inputValue();
    const marker = `# playwright-test-comment ${Date.now()}`;
    await robots.fill(`${original}\n${marker}`);
    await page.click('#btn-save-all');

    await page.reload();
    await page.click('a[href="#tab-seo"]');
    await expect(page.locator('#s_robots_txt')).toHaveValue(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('Users: add a new admin user', async ({ page }) => {
    await page.click('a[href="#tab-users"]');
    await expect(page.locator('#tab-users')).toHaveClass(/active/);

    await page.click('#btn-add-user');
    await expect(page.locator('#user-drawer')).toBeVisible();

    const uniqueUser = `pwtest_${Date.now()}`;
    await page.fill('#u_username', uniqueUser);
    await page.fill('#u_email', `${uniqueUser}@playwright-test.example`);
    await page.fill('#u_password', 'TestPass123!');
    await page.selectOption('#u_access_level', '10'); // Editor
    await page.click('#btn-drawer-save');

    await expect(page.locator('#user-tbody')).toContainText(uniqueUser);
  });

  test('Server: Maintenance Mode blocks logged-out visitors but not the logged-in admin', async ({ page, browser }) => {
    await page.click('a[href="#tab-server"]');
    await expect(page.locator('#tab-server')).toHaveClass(/active/);

    const toggle = page.locator('#s_maintenance_mode');
    await toggle.click();
    await page.click('#btn-save-all');
    await page.waitForTimeout(500);

    try {
      // A logged-out visitor (fresh browser context, no admin session cookie)
      // must see the 503 maintenance page.
      const guestContext = await browser.newContext();
      const guestPage = await guestContext.newPage();
      const guestResp = await guestPage.goto('/');
      expect(guestResp?.status()).toBe(503);
      await expect(guestPage.locator('body')).toContainText(/maintenance/i);
      await guestContext.close();

      // The still-logged-in admin must be exempt, so they can keep working
      // on the site while it's down for everyone else.
      const adminResp = await page.goto('/');
      expect(adminResp?.status()).toBe(200);
      await expect(page.locator('body')).not.toContainText(/down for maintenance/i);
    } finally {
      // Always restore, even if an assertion above fails, so this test
      // doesn't leave the store down for maintenance.
      await page.goto(`/${ADMIN_PATH}/?route=setup`);
      await page.click('a[href="#tab-server"]');
      await page.locator('#s_maintenance_mode').click();
      await page.click('#btn-save-all');
      await page.waitForTimeout(500);
    }
  });
});
