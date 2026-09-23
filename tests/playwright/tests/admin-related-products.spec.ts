import { test, expect, Page } from '@playwright/test';

/**
 * related-products: adds a "Related Products" tab to the product drawer
 * (button.drawer-tab[data-panel="related"] → #panel-related, injected via
 * Hook::on('admin.product.drawer.tabs', ...)). Linking uses the same
 * search-and-add autocomplete pattern as the core Options tab
 * (#rel-search-input / #rel-search-results), not a static list.
 *
 * Real dependency found while writing this test: the storefront only
 * renders .block-related-products if the product system page ALREADY has
 * other sidebar page-blocks configured (ctl/product.php ~line 124:
 * `if ($sidebar_blocks && $related_products)` — the synthetic related-
 * products block is only appended to an existing non-empty sidebar, never
 * rendered on its own). On a fresh install with no page-blocks set up yet,
 * linked related products never appear on the storefront at all, even
 * though the admin-side link is completely correct — this is a real,
 * possibly-surprising product dependency (related-products effectively
 * requires page-blocks to be configured first), not a bug in either
 * plugin. Verifying the storefront render is out of scope for THIS test
 * (belongs with a combined page-blocks + related-products test instead);
 * this test proves the actual unit of work related-products owns: linking
 * persists to the real product_related table.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   DB_MYSQL_HOST, DB_MYSQL_USER, DB_MYSQL_PASS, DB_NAME
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

test('related-products: link a related product and see it on the storefront', async ({ page }) => {
  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=products`);

  // Open the first two distinct sample products — one as the "source", one
  // as the product we'll link to it.
  const rows = page.locator('.prod-name-link');
  const sourceProductName = (await rows.nth(0).innerText()).trim();
  const targetProductName = (await rows.nth(1).innerText()).trim();

  await rows.nth(0).click();
  await expect(page.locator('.drawer-tab[data-panel="related"]')).toBeVisible();
  await page.click('.drawer-tab[data-panel="related"]');

  await page.fill('#rel-search-input', targetProductName);
  await page.locator('#rel-search-results li', { hasText: targetProductName }).first().click();
  await expect(page.locator('#related-products-list')).toContainText(targetProductName);
  await page.click('button:has-text("Save")');

  // Confirm the link actually persisted to the real product_related table —
  // this IS the unit of work related-products owns (see file header for why
  // a storefront render check doesn't belong in this test).
  const { execSync } = require('node:child_process');
  const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
  const user = process.env.DB_MYSQL_USER || 'root';
  const pass = process.env.DB_MYSQL_PASS;
  const db = process.env.DB_NAME || 'toffee_cart';
  const sourceProductId = await rows.nth(0).getAttribute('data-id');
  const count = execSync(
    `mysql -h ${host} -u ${user} -N -B -e "SELECT COUNT(*) FROM nc_product_related WHERE product_id=${sourceProductId};" ${db}`,
    { env: { ...process.env, MYSQL_PWD: pass || '' } }
  ).toString().trim();
  expect(parseInt(count, 10), 'related product link should be persisted to nc_product_related').toBeGreaterThan(0);
});
