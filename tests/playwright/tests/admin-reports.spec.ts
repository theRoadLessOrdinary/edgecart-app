import { test, expect, Page } from '@playwright/test';

/**
 * reports-core plugin: Sales by Product, Sales by Category, Sales by State,
 * and Order Status Pipeline (?route=reports). The plugin itself has no
 * admin UI of its own (plugins/reports-core/hooks.php just registers 4
 * Report objects into the core reports framework via
 * admin.reports.register) — the actual page is core admin/ctl/reports.php.
 *
 * Sales by Product/Category/State default to a date range starting at the
 * first of the current month (plugins/reports-core/hooks.php ~line 8-9,
 * 22-23, 36-37). The install's 6 seeded sample orders are backdated 5-65
 * days (install/ajax.php ~line 378-379), so most fall outside that default
 * window depending on what day it is — this test widens date_from to a
 * fixed past date rather than trusting the default range to include them.
 * Order Status Pipeline has no date filter at all and always aggregates
 * every order, so it's the one report guaranteed non-empty regardless.
 *
 * Assertions read the actual get_report AJAX JSON response
 * ({ok, columns, rows}) rather than screen-scraping table text, per the
 * research behind this file.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

async function runReport(page: Page, reportId: string, widenDates: boolean) {
  // Report links live inside collapsed accordion groups (admin/js/
  // reports.js:34-40, .nav-group-head, aria-expanded="false" by default) —
  // the group's own header intercepts pointer events until expanded, so the
  // link isn't actually clickable on page load.
  const link = page.locator(`a.report-link[data-report-id="${reportId}"]`);
  const group = link.locator('xpath=ancestor::div[contains(@class,"nav-group")]');
  const groupHead = group.locator('.nav-group-head');
  if ((await groupHead.getAttribute('aria-expanded')) !== 'true') {
    await groupHead.click();
  }

  // Reports with no parameters (e.g. Order Status Pipeline) auto-fetch the
  // moment the link is selected (admin/js/reports.js:125-128,
  // renderReportParams() calls loadReportData({}) directly and never shows
  // #report-controls/#btn-run-report at all) — reports with parameters only
  // build the params form on link click and wait for a separate
  // #btn-run-report click to actually fetch. Set the wait up before the
  // link click so it catches either case, whichever one actually fires.
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('route=reports') && res.request().method() === 'POST'
  );
  await link.click();

  if (widenDates) {
    const dateFrom = page.locator('#param-date_from');
    if (await dateFrom.count() > 0) {
      await dateFrom.fill('2020-01-01');
    }
  }
  const runBtn = page.locator('#btn-run-report');
  if (await runBtn.isVisible()) {
    await runBtn.click();
  }
  const res = await responsePromise;
  return res.json();
}

test.describe('Admin Reports (reports-core)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`/${ADMIN_PATH}/?route=reports`);
  });

  test('Sales by Product shows real order data once the date range is widened', async ({ page }) => {
    const data = await runReport(page, 'sales_by_product', true);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows.length, 'expected at least one product with sales once dates are widened to include seed orders').toBeGreaterThan(0);
    // table.report-table being visible already proves real data rendered —
    // renderReportTable() only ever builds one or the other (admin/js/
    // reports.js:202-207), never both. A separate ".report-empty" absence
    // check is unreliable here: the pre-selection placeholder div carries
    // that same class (admin/tpl/reports.html:19, just hidden via inline
    // style, not removed from the DOM), so it always matches regardless of
    // whether the report actually returned data.
    await expect(page.locator('table.report-table')).toBeVisible();
  });

  test('Sales by Category shows real order data once the date range is widened', async ({ page }) => {
    const data = await runReport(page, 'sales_by_category', true);
    expect(data.ok).toBe(true);
    const categoryNames = data.rows.map((r: any) => r.name);
    expect(categoryNames.some((n: string) => /Men's Basics|Women's Basics/.test(n))).toBe(true);
  });

  test('Sales by State shows real order data once the date range is widened', async ({ page }) => {
    const data = await runReport(page, 'sales_by_state', true);
    expect(data.ok).toBe(true);
    const states = data.rows.map((r: any) => r.ship_state ?? r.state);
    expect(states.length).toBeGreaterThan(0);
  });

  test('Order Status Pipeline aggregates every order regardless of date', async ({ page }) => {
    // No date params exist for this report (plugins/reports-core/hooks.php
    // ~line 46-50) — it always covers every order, so the seed data alone
    // (3 shipped, 3 paid, install/ajax.php ~line 366) must be visible with
    // no date-widening step at all.
    const data = await runReport(page, 'order_status_pipeline', false);
    expect(data.ok).toBe(true);
    const statusCounts: Record<string, number> = {};
    for (const row of data.rows) statusCounts[row.status] = row.count ?? row.orders;
    expect(statusCounts.shipped, 'expected the 3 seeded shipped orders to still be counted').toBeGreaterThanOrEqual(3);
    expect(statusCounts.paid, 'expected at least the 3 seeded paid orders to still be counted').toBeGreaterThanOrEqual(3);
  });

  test('CSV export downloads a real file', async ({ page }) => {
    await runReport(page, 'order_status_pipeline', false);
    const downloadPromise = page.waitForEvent('download');
    await page.click('#btn-export-csv');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/order_status_pipeline.*\.csv$/);
  });
});
