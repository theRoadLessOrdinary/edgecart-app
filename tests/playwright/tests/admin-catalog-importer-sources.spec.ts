import { test, expect, Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Admin: Catalog Importer's three source-specific paths — Shopify CSV, Etsy
 * CSV, and OpenCart (live DB connection) — as opposed to admin-catalog-
 * importer.spec.ts, which only exercises the source-agnostic staging-JSON
 * form. These three were never tested before this suite.
 *
 * Fixture provenance (checked against public/official sources, not just
 * reverse-engineered from the adapter code, since the adapter's own comments
 * admit real-world export formats have drifted before):
 *
 *  - fixtures/shopify-products.csv / shopify-customers.csv: column names
 *    (Handle, Title, Body (HTML), Published, Option1 Name/Value, Variant
 *    SKU/Price/Grams/Inventory Qty, Image Src, Province Code, Country Code)
 *    match Shopify's long-standing, still-current "Products > Export" CSV
 *    format — corroborated by multiple independent sources (Shopify Help
 *    Center, matrixify.app, wisepim.com) during research for this fixture.
 *
 *  - fixtures/etsy-listings.csv: column names (TITLE, VARIATION 1 NAME,
 *    VARIATION 1 VALUES, IMAGE1..10, SECTION) match Etsy's own native
 *    Shop Manager bulk-listing CSV tool. Note: a different, lowercase,
 *    one-row-per-variation format (option_1_name, parent_sku) also turned up
 *    during research, but that belongs to a third-party bulk-upload tool's
 *    own proprietary schema, not Etsy's native export — Etsy's own docs
 *    (help.etsy.com) returned 403 to automated fetching, so this couldn't be
 *    fully confirmed first-party; worth a manual spot-check against a real
 *    Etsy export if one becomes available.
 *
 *  - fixtures/opencart-sample.sql: table/column names (oc_category,
 *    oc_product, oc_product_option_value, etc.) are real OpenCart 3.x/4.x
 *    schema (OpenCart is open-source; this mirrors its own install/
 *    opencart.sql), trimmed to only what
 *    plugins/catalog-importer/lib/adapters/opencart.php actually queries.
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
 *   ADMIN_PATH   - the obscured admin URL segment
 *   ADMIN_USER   - admin username
 *   ADMIN_PASS   - admin password
 *
 * REQUIRED FOR THE OPENCART TEST ONLY (skipped if unset):
 *   OC_MYSQL_HOST - MySQL host reachable from wherever PHP runs (e.g. 127.0.0.1)
 *   OC_MYSQL_USER - a MySQL user with CREATE privileges, to build the
 *                   throwaway sample database fresh each run
 *   OC_MYSQL_PASS - that user's password
 *   OC_SAMPLE_DB  - throwaway database name (default: ci_opencart_sample)
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

async function login(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

/**
 * Store-wide category cap is only 3 (admin.limit.categories, staging.php).
 * This install seeds 2 categories on install ("Men's Basics", "Women's
 * Basics") — left in place, Shopify(1 new)+Etsy(1 new)+OpenCart(1 new)=3
 * would already exceed the cap (2+3=5). These are disposable install-time
 * sample rows on a test install, not real merchant data, so this suite
 * clears them first to make room for exactly 3 source-specific imports
 * landing at, not over, the cap. Requires the same MySQL access already
 * used elsewhere in this suite for direct cleanup between runs.
 */
async function clearSeedCategoriesForRoom() {
  const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
  const user = process.env.DB_MYSQL_USER || 'root';
  const pass = process.env.DB_MYSQL_PASS;
  const db   = process.env.DB_NAME || 'toffee_cart';
  // Password passed via MYSQL_PWD env var, not interpolated into the shell
  // command string — a literal "$" in the password (as in this suite's own
  // local test credentials) would otherwise be misparsed as a shell/positional
  // parameter by /bin/bash.
  execSync(
    `mysql -h ${host} -u ${user} ${db} -e "DELETE FROM nc_categories WHERE name IN ('Men\\'s Basics','Women\\'s Basics')"`,
    { stdio: 'inherit', shell: '/bin/bash', env: { ...process.env, MYSQL_PWD: pass || '' } }
  );
}

test.describe('Admin Catalog Importer — Shopify & Etsy CSV', () => {
  test.beforeEach(async ({ page }) => {
    // clearSeedCategoriesForRoom() needs direct MySQL access to the actual
    // target host's database — previously ran unconditionally from a single
    // beforeAll with DB_MYSQL_HOST defaulting to 127.0.0.1 (this dev box's
    // OWN local MySQL, not necessarily the site under test's database), so
    // running this suite against a remote host without DB_MYSQL_HOST set
    // failed with a confusing "Access denied for user 'root'@'localhost'"
    // instead of a clear skip. Require it explicitly, same pattern as the
    // OpenCart sub-test below.
    test.skip(
      !process.env.DB_MYSQL_HOST,
      'Set DB_MYSQL_HOST (and DB_MYSQL_USER/DB_MYSQL_PASS/DB_NAME as needed) to run this suite — direct DB access to the target host is required to clear seed categories and make room under the 3-category cap.'
    );
    await clearSeedCategoriesForRoom();
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=catalog-importer`);
  });

  test('import from Shopify products + customers CSV', async ({ page }) => {
    await page.setInputFiles('#shopify_products_csv', path.join(FIXTURES_DIR, 'shopify-products.csv'));
    await page.setInputFiles('#shopify_customers_csv', path.join(FIXTURES_DIR, 'shopify-customers.csv'));
    await page.click('button:has-text("Import from Shopify")');

    const success = page.locator('.success-msg');
    await expect(success).toBeVisible();
    // 2 products (classic-tee-shopify, tank-top-shopify), each collapsing
    // multiple variant rows into one product — confirms the Handle-based
    // row-flattening in ci_shopify_extract_products_csv worked, not just
    // that the request didn't error.
    await expect(success).toContainText('2 products created');
    await expect(success).toContainText('2 customers created');

    await page.goto(`/${ADMIN_PATH}/?route=products`);
    await expect(page.locator('.prod-name-link', { hasText: 'Classic Tee (Shopify Import)' })).toBeVisible();
    await expect(page.locator('.prod-name-link', { hasText: 'Tank Top (Shopify Import)' })).toBeVisible();
  });

  test('import from Etsy listings CSV', async ({ page }) => {
    await page.setInputFiles('#etsy_listings_csv', path.join(FIXTURES_DIR, 'etsy-listings.csv'));
    await page.click('button:has-text("Import from Etsy")');

    const success = page.locator('.success-msg');
    await expect(success).toBeVisible();
    await expect(success).toContainText('2 products created');

    await page.goto(`/${ADMIN_PATH}/?route=products`);
    await expect(page.locator('.prod-name-link', { hasText: 'Handwoven Market Tote (Etsy Import)' })).toBeVisible();
    await expect(page.locator('.prod-name-link', { hasText: 'Embroidered Zip Pouch (Etsy Import)' })).toBeVisible();
  });
});

test.describe('Admin Catalog Importer — OpenCart', () => {
  const OC_HOST = process.env.OC_MYSQL_HOST;
  const OC_USER = process.env.OC_MYSQL_USER;
  const OC_PASS = process.env.OC_MYSQL_PASS;
  const OC_DB   = process.env.OC_SAMPLE_DB || 'ci_opencart_sample';

  test.skip(!OC_HOST || !OC_USER, 'Set OC_MYSQL_HOST/OC_MYSQL_USER/OC_MYSQL_PASS to run the OpenCart import test');

  test.beforeAll(() => {
    // Password via MYSQL_PWD, not interpolated into the command string — see
    // clearSeedCategoriesForRoom's comment above for why.
    const env = { ...process.env, MYSQL_PWD: OC_PASS || '' };
    const auth = `-h ${OC_HOST} -u ${OC_USER}`;
    execSync(`mysql ${auth} -e "CREATE DATABASE IF NOT EXISTS \\\`${OC_DB}\\\`"`, { stdio: 'inherit', shell: '/bin/bash', env });
    execSync(`mysql ${auth} ${OC_DB} < ${path.join(FIXTURES_DIR, 'opencart-sample.sql')}`, { stdio: 'inherit', shell: '/bin/bash', env });
  });

  test('import from a live OpenCart database', async ({ page }) => {
    await login(page);
    await page.goto(`/${ADMIN_PATH}/?route=catalog-importer`);

    await page.fill('#oc_host', OC_HOST!);
    await page.fill('#oc_name', OC_DB);
    await page.fill('#oc_user', OC_USER!);
    await page.fill('#oc_pass', OC_PASS || '');
    await page.fill('#oc_prefix', 'oc_');
    await page.click('button:has-text("Import from OpenCart")');

    const success = page.locator('.success-msg');
    await expect(success).toBeVisible();
    await expect(success).toContainText('1 categories');
    await expect(success).toContainText('2 products created');
    await expect(success).toContainText('2 customers created');

    await page.goto(`/${ADMIN_PATH}/?route=products`);
    await expect(page.locator('.prod-name-link', { hasText: 'Canvas Field Jacket (OpenCart Import)' })).toBeVisible();
    await expect(page.locator('.prod-name-link', { hasText: 'Woven Shoulder Bag (OpenCart Import)' })).toBeVisible();

    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    await expect(page.locator('#cat-tbody')).toContainText('OpenCart Import');
  });
});
