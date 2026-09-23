import { test, expect, Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * db-backup: one-click SQL dump download (plugins/db-backup/admin/
 * download.php generates a real PHP-written SQL dump, not a mysqldump
 * binary — DROP TABLE/CREATE TABLE/batched INSERTs per table, streamed with
 * a real Content-Disposition: attachment header). Always-visible static
 * anchor, no hidden-button gotcha like reports-core had.
 *
 * dashboard: the default post-login admin route. Its stat cards are real
 * aggregate queries (admin/ajax.php action=stats), not decoration —
 * customers_total is a literal SELECT COUNT(*) FROM {prefix}customers, so
 * it's checked directly against the same DB rather than just "the page
 * loads."
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   DB_MYSQL_HOST, DB_MYSQL_USER, DB_MYSQL_PASS, DB_NAME - to cross-check
 *   the dashboard's customer count against the real table (same convention
 *   used in admin-catalog-importer-sources.spec.ts)
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

test.describe('db-backup plugin', () => {
  test('downloads a real SQL dump', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=db-backup`);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toMatch(/backup-.*\.sql$/);
    const path = await download.path();
    expect(path, 'download should have actually saved to disk').toBeTruthy();
    const fs = require('node:fs');
    const content = fs.readFileSync(path!, 'utf-8');
    expect(content).toContain('DROP TABLE');
    expect(content).toContain('INSERT INTO');
    // Confirm it's not just a stub — a real store's dump should reference
    // actual seeded tables.
    expect(content).toMatch(/`?\w*products`?/);
  });
});

test.describe('dashboard plugin', () => {
  test('is the default post-login route', async ({ page }) => {
    await page.goto(`/${ADMIN_PATH}/?route=login`);
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/route=dashboard/);
  });

  test('customer count stat matches the real table', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=dashboard`);

    const statText = await page.locator('#stat-customers-total').innerText();
    const shownCount = parseInt(statText.replace(/[^\d]/g, ''), 10);

    const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
    const user = process.env.DB_MYSQL_USER || 'root';
    const pass = process.env.DB_MYSQL_PASS;
    const db = process.env.DB_NAME || 'toffee_cart';
    const realCount = parseInt(
      execSync(`mysql -h ${host} -u ${user} -N -B -e "SELECT COUNT(*) FROM nc_customers;" ${db}`, {
        env: { ...process.env, MYSQL_PWD: pass || '' },
      }).toString().trim(),
      10
    );

    expect(shownCount, 'dashboard customer count must match a real SELECT COUNT(*)').toBe(realCount);
  });

  test('recent orders table renders real rows', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=dashboard`);
    const hasRows = await page.locator('#dash-orders-tbody tr').count();
    const isEmpty = await page.locator('#dash-orders-empty').isVisible().catch(() => false);
    expect(hasRows > 0 || isEmpty, 'expected either real order rows or an explicit empty state').toBeTruthy();
  });
});
