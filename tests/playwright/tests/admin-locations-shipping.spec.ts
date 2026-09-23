import { test, expect, Page } from '@playwright/test';

/**
 * Admin: Locations & Tax (?route=locations) and Shipping (?route=shipping).
 *
 * Both pages use the off-canvas drawer pattern (me-drawer, transform:
 * translateX(100%), not display:none — admin/css/shared.css) so a drawer's
 * <h2> title text is always present in the DOM, same "+ Add X" vs hidden
 * "Add X" collision already found and worked around elsewhere in this suite
 * (admin-catalog.spec.ts). Scoped to each drawer's own id here to avoid it.
 *
 * Locations & Tax uses NcTabs (admin/js/nc-tabs.js) — the Rates tab's fields
 * are not interactable until its tab link is clicked (admin/tpl/
 * locations.html), same tabbed-panel rule established for the product
 * drawer.
 *
 * ios-toggle is a custom element wrapping a hidden native input; interact
 * with the element itself, not a plain input selector (confirmed in
 * admin/js/locations.js, admin/js/settings.js).
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

test.describe('Admin Locations & Tax', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=locations`);
  });

  test('add a tax zone', async ({ page }) => {
    await page.click('#btn-add-zone');
    await expect(page.locator('#zone-drawer')).toBeVisible();

    const zoneName = `Playwright Test Zone ${Date.now()}`;
    await page.fill('#zone-name', zoneName);
    await page.selectOption('#zone-country', { index: 1 });
    await page.click('#zone-drawer-save');

    await expect(page.locator('#zones-tbody')).toContainText(zoneName);
  });

  test('add a tax rate linked to a zone', async ({ page }) => {
    // Create a zone first — a rate needs one to attach to (#rate-zone is
    // populated dynamically from the zones list, loadZonesForSelect()).
    const zoneName = `Playwright Rate Zone ${Date.now()}`;
    await page.click('#btn-add-zone');
    await page.fill('#zone-name', zoneName);
    await page.selectOption('#zone-country', { index: 1 });
    await page.click('#zone-drawer-save');
    await expect(page.locator('#zones-tbody')).toContainText(zoneName);

    await page.click('a[href="#rates-tab"]');
    await expect(page.locator('#rates-tab')).toBeVisible();

    await page.click('#btn-add-rate');
    await expect(page.locator('#rate-drawer')).toBeVisible();

    const rateName = `Playwright Test Rate ${Date.now()}`;
    await page.fill('#rate-name', rateName);
    await page.selectOption('#rate-zone', { label: zoneName });
    await page.fill('#rate-percentage', '7.5');
    await page.locator('#rate-active').click();
    await page.click('#rate-drawer-save');

    await expect(page.locator('#rates-tbody')).toContainText(rateName);
    await expect(page.locator('#rates-tbody')).toContainText('7.50%');
  });
});

test.describe('Admin Shipping', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=shipping`);
  });

  test('add a shipping method/rate', async ({ page }) => {
    await page.click('#btn-add-method');
    await expect(page.locator('#method-drawer')).toBeVisible();

    const methodName = `Playwright Test Shipping ${Date.now()}`;
    await page.fill('#m-name', methodName);
    await page.fill('#m-description', '3-5 business days');
    await page.fill('#m-rate', '8.50');
    await page.fill('#m-free-above', '75');
    await page.click('#method-drawer-save');

    await expect(page.locator('#methods-tbody')).toContainText(methodName);
    await expect(page.locator('#methods-tbody')).toContainText('8.50');
  });
});
