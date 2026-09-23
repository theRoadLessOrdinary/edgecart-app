import { test, expect, Page } from '@playwright/test';

/**
 * theme-scheduler: schedule a theme to apply during a month/day range
 * (year is discarded — only MM/DD is stored, plugins/theme-scheduler/
 * admin/settings.php's parseMmDd()). The switching logic (hooks.php
 * ~line 21-60) reads date('n')/date('j') directly off the real server
 * clock inside the theme.head hook — there is no debug/preview/force-apply
 * endpoint that accepts an arbitrary test date, confirmed by reading the
 * plugin's full source. That means "does it switch on a date that ISN'T
 * today" cannot be tested without manipulating the server clock, which is
 * out of scope (same category of limitation as the PayPal sandbox-login
 * blocker found earlier this session) — NOT attempted here.
 *
 * What IS honestly testable with the real current date: a schedule whose
 * range brackets today, and the tie-break rule (most recent start date
 * wins) between two schedules that both cover today.
 *
 * me-date is a real <input type="date"> under the hood (js/vendor/
 * maps-edge-date.js) wrapped in a custom element with a hidden input
 * carrying the actual form value — fillable directly as a native date
 * input (YYYY-MM-DD), no custom JS API needed from Playwright's side.
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

function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

async function setPluginEnabled(page: Page, code: string, enabled: boolean) {
  await page.goto(`/${ADMIN_PATH}/?route=plugins`);
  const row = page.locator(`#plugin-tbody tr[data-code="${code}"]`);
  const toggle = row.locator('ios-toggle');
  const checkbox = toggle.locator('input[type="checkbox"]');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== enabled) {
    await toggle.click();
    await page.waitForTimeout(500);
  }
}

async function createSchedule(page: Page, label: string, themeCode: string, startOffset: number, endOffset: number) {
  await page.goto(`/${ADMIN_PATH}/?route=plugins`);
  await page.click('button.plugin-settings-btn[data-code="theme-scheduler"]');
  await expect(page.locator('#plugin-drawer')).toBeVisible();

  await page.fill('#ts-label', label);
  await page.selectOption('#ts-theme', themeCode);
  // me-date's connectedCallback replaces itself with <span><input
  // type="date"><input type="hidden" id="ts-start"></span> — the id moves
  // to the hidden input, and the visible date input (a preceding sibling,
  // no id/name of its own) is what actually needs filling.
  await page.locator('#ts-start').locator('xpath=preceding-sibling::input[@type="date"]').fill(isoDate(startOffset));
  await page.locator('#ts-end').locator('xpath=preceding-sibling::input[@type="date"]').fill(isoDate(endOffset));
  await page.click('#plugin-drawer-save');
  await expect(page.locator('.simple-notification.error, [class*="notification"][class*="error"]')).toHaveCount(0);
  await page.click('#plugin-drawer-close');
}

test.describe('theme-scheduler plugin', () => {
  test('a schedule bracketing today actually applies its theme', async ({ page }) => {
    await loginAdmin(page);
    await createSchedule(page, `Playwright Test ${Date.now()}`, 'theme-sienna', -1, 1);

    // theme.head only renders on a fresh page load.
    await page.goto('/');
    const linkCount = await page
      .locator('link[rel="stylesheet"][href*="plugins/theme-sienna/css/theme.css"]')
      .count();
    expect(linkCount, 'scheduled theme covering today should be injected').toBeGreaterThan(0);
  });

  test('two overlapping schedules covering today: most recent start wins', async ({ page }) => {
    await loginAdmin(page);
    // Seasonal theme plugins are disabled by default (fixed 2026-07-11 — they
    // previously shipped enabled). A schedule can still reference a disabled
    // theme (the dropdown lists it as "(disabled)", not gone entirely) but it
    // will never actually apply — the plugin's own CSS is never loaded —
    // until the plugin is enabled. Enable it for this test's duration only.
    await setPluginEnabled(page, 'theme-winter', true);

    try {
      await loginAdmin(page);
      const suffix = Date.now();
      // Earlier-starting schedule, wider range, theme-sienna.
      await createSchedule(page, `Playwright Tie-Break Earlier ${suffix}`, 'theme-sienna', -5, 5);
      // Later-starting schedule, narrower range, theme-winter — should win per
      // the "most recent start wins" rule (hooks.php ~line 32-48).
      await createSchedule(page, `Playwright Tie-Break Later ${suffix}`, 'theme-winter', -1, 1);

      await page.goto('/');
      const bluesLinkCount = await page
        .locator('link[rel="stylesheet"][href*="plugins/theme-winter/css/theme.css"]')
        .count();
      expect(bluesLinkCount, 'the later-starting schedule should win the tie-break').toBeGreaterThan(0);
    } finally {
      await setPluginEnabled(page, 'theme-winter', false);
    }
  });
});
