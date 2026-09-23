import { test, expect, Page } from '@playwright/test';

/**
 * Admin: Catalog Importer plugin (?route=catalog-importer).
 *
 * Never tested before this suite. The importer has no JS/AJAX of its own —
 * it's a plain server-rendered form POST per source (OpenCart/Shopify/Etsy/
 * staging JSON), confirmed in plugins/catalog-importer/admin/tpl/
 * catalog-importer/list.html. The "staging JSON" form is used here rather
 * than Shopify/Etsy CSVs because its exact schema is fully documented in
 * plugins/catalog-importer/lib/staging.php's header comment, whereas the
 * CSV column formats would have to be reverse-engineered from the adapters
 * with no sample fixture anywhere in the repo. (The CSV/OpenCart source
 * paths themselves are covered separately in
 * admin-catalog-importer-sources.spec.ts.)
 *
 * A real bug was found and fixed alongside writing this test: the importer
 * enforced NO tier/license limits at all (unlike every manual admin form,
 * which all correctly cap categories/products-per-category/options/images).
 * A bulk import could silently blow past the free-tier caps. Fixed in
 * plugins/catalog-importer/lib/staging.php (ci_import_categories/
 * ci_import_products) to mirror the same Hook::instead('admin.limit.*', ...)
 * checks used in admin/ctl/categories/ajax.php and admin/ctl/products/ajax.php.
 * The second test below asserts that fix holds.
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

test.describe('Admin Catalog Importer', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=catalog-importer`);
  });

  test('full run: import categories, products (with options/images), and customers', async ({ page }) => {
    const suffix = Date.now();
    const staged = {
      categories: [
        { external_id: 'c1', name: `CI Test Category ${suffix}`, slug: `ci-test-category-${suffix}` },
      ],
      products: [
        {
          external_id: 'p1',
          name: `CI Test Product ${suffix}`,
          slug: `ci-test-product-${suffix}`,
          price: 29.99,
          stock: 10,
          weight: 0.4,
          category_external_ids: ['c1'],
          images: ['mens-3-4-sleeve-tee.webp'],
          options: [
            { name: 'Size', values: [{ value: 'Small', price_modifier: 0, stock: 5 }, { value: 'Large', price_modifier: 2, stock: 5 }] },
          ],
        },
      ],
      customers: [
        { external_id: 'cu1', email: `ci-test-${suffix}@playwright-test.example`, first_name: 'CI', last_name: 'Test' },
      ],
    };

    await page.fill('#staging_json', JSON.stringify(staged));
    await page.click('button:has-text("Run Import")');

    const success = page.locator('.success-msg');
    await expect(success).toBeVisible();
    await expect(success).toContainText('1 categories');
    await expect(success).toContainText('1 products created');
    await expect(success).toContainText('1 customers created');

    // Confirm the product actually landed in the real catalog, not just a
    // success message — same "don't trust the toast" rule established
    // elsewhere in this suite (admin-catalog.spec.ts's image-render check).
    await page.goto(`/${ADMIN_PATH}/?route=products`);
    await expect(page.locator('.prod-name-link', { hasText: `CI Test Product ${suffix}` })).toBeVisible();
  });

  test('license limit: bulk import cannot exceed the category tier cap', async ({ page }) => {
    // The free-tier category cap is 3 (Hook::instead('admin.limit.categories', 3),
    // confirmed in admin/ctl/categories/ajax.php and mirrored in staging.php).
    // Import a payload asking for far more than that in one shot; the fix
    // above must skip the overflow rather than insert all of them, exactly
    // as the manual "+ Add Category" form already blocks the 4th.
    const suffix = Date.now();
    const categories = Array.from({ length: 10 }, (_, i) => ({
      external_id: `lim${i}`,
      name: `CI Limit Category ${suffix}-${i}`,
      slug: `ci-limit-category-${suffix}-${i}`,
    }));

    await page.fill('#staging_json', JSON.stringify({ categories }));
    await page.click('button:has-text("Run Import")');

    const success = page.locator('.success-msg');
    await expect(success).toBeVisible();
    await expect(success).toContainText('skipped');

    // Count categories actually present in the DB-backed list afterward —
    // must never exceed the store-wide cap regardless of how many rows the
    // import payload requested.
    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    // #cat-tbody always contains two hidden template rows (#cat-loading-row,
    // #cat-empty-row) regardless of data — only real rows carry data-id.
    const count = await page.locator('#cat-tbody tr[data-id]').count();
    expect(count, 'category count must never exceed the license limit, even via bulk import').toBeLessThanOrEqual(3);
  });
});
