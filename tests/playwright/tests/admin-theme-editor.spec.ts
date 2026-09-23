import { test, expect, Page } from '@playwright/test';

/**
 * theme-editor: visual editor for the active theme's CSS custom properties.
 * Unlike a DB-settings override, saves actually regex-replace the value
 * directly inside plugins/<theme-code>/css/theme.css on disk (admin/
 * ajax.php's action=save) — the active theme (theme-sienna) injects that
 * file via the same theme.head hook + cache-busting ?v=<filemtime> pattern
 * used by every other theme in this suite (theme-blues, etc.).
 *
 * theme-sienna's real baseline is --nc-primary: #a0522d (theme-sienna/css/
 * theme.css:3) — used here as the known "before" value, restored at the
 * end so this test doesn't permanently change the live site's look.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const ORIGINAL_PRIMARY = '#a0522d';
const TEST_PRIMARY = '#123456';

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

async function setPluginEnabled(page: Page, code: string, enabled: boolean) {
  await page.goto(`/${ADMIN_PATH}/?route=plugins`);
  const row = page.locator(`#plugin-tbody tr[data-code="${code}"]`);
  const checkbox = row.locator('ios-toggle input[type="checkbox"]');
  if ((await checkbox.isChecked()) !== enabled) {
    await row.locator('ios-toggle').click();
    await page.waitForTimeout(1000);
  }
}

async function setPrimaryColor(page: Page, hex: string) {
  await page.goto(`/${ADMIN_PATH}/?route=plugins`);
  await page.click('button.plugin-settings-btn[data-code="theme-editor"]');
  await expect(page.locator('#plugin-drawer')).toBeVisible();

  // This install has 8 .te-section blocks (one per installed theme) each
  // with their own .te-save-vars-btn — an unscoped click matches whichever
  // sorts first in the DOM (theme-christmas), silently saving the wrong
  // theme's CSS file while this one's own file stayed unchanged.
  const section = page.locator('.te-section[data-code="theme-sienna"]');
  await section.locator('.te-text-input[data-var="--nc-primary"]').fill(hex);
  await section.locator('.te-save-vars-btn').click();
  await expect(page.locator('.simple-notification.error, [class*="notification"][class*="error"]')).toHaveCount(0);
  await page.click('#plugin-drawer-close');
}

test('theme-editor changes a real CSS variable in the active theme', async ({ page }) => {
  await loginAdmin(page);

  try {
    await setPrimaryColor(page, TEST_PRIMARY);

    // This install has all 7 seasonal themes simultaneously enabled (bulk-
    // installed earlier this session) — every one of them injects its own
    // <link> via the theme.head hook, and whichever lands last in the DOM
    // wins the --nc-primary cascade (the same cross-theme collision found
    // earlier this session with theme-blues vs theme-sienna). Checking
    // getComputedStyle() on a live page is NOT a reliable signal of theme-
    // sienna's own value in this environment — read the actual CSS file
    // theme-editor wrote to instead.
    // theme-sienna/css/theme.css pads values with variable-width whitespace
    // for alignment (e.g. "--nc-primary:        #a0522d;") — match loosely.
    const cssRes = await page.request.get(`/plugins/theme-sienna/css/theme.css?v=${Date.now()}`);
    const css = await cssRes.text();
    expect(css).toMatch(new RegExp(`--nc-primary:\\s*${TEST_PRIMARY}`));
  } finally {
    // Restore the real site's original color regardless of pass/fail —
    // this test edits an actual file on disk, not disposable DB test data.
    await setPrimaryColor(page, ORIGINAL_PRIMARY);
    const cssRes = await page.request.get(`/plugins/theme-sienna/css/theme.css?v=${Date.now()}`);
    const css = await cssRes.text();
    expect(css).toMatch(new RegExp(`--nc-primary:\\s*${ORIGINAL_PRIMARY}`));
  }
});

test('theme-editor shows a dedicated image picker for a url()-valued CSS var, with dimension guidance', async ({ page }) => {
  // theme-fourth-of-july's --nc-masthead-bg-url previously rendered as a
  // raw text field showing the literal "url(...)" syntax — no indication
  // it controlled an image, no way to browse for a replacement, and no
  // guidance on what size to use. Confirmed reported by the user: "I can't
  // find it by inspecting."
  const ORIGINAL_MASTHEAD = '/img/seasonal/7b54f0019e7111f3.webp';
  const TEST_MASTHEAD = '/img/seasonal/pw-test-masthead.webp';

  await loginAdmin(page);
  // Seasonal themes are disabled by default — enable this one so theme-
  // editor's discovery loop (which only scans non-dot-prefixed plugin
  // dirs) picks it up. Enabling it auto-disables theme-sienna; restored in
  // the finally block by re-enabling theme-sienna, which auto-disables
  // this one back (same mechanism, exercised for real here).
  await setPluginEnabled(page, 'theme-fourth-of-july', true);

  try {
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await page.click('button.plugin-settings-btn[data-code="theme-editor"]');
    await expect(page.locator('#plugin-drawer')).toBeVisible();

    const section = page.locator('.te-section[data-code="theme-fourth-of-july"]');
    const imageRow = section.locator('.te-image-row[data-var="--nc-masthead-bg-url"]');
    await expect(imageRow).toBeVisible();
    await expect(imageRow.locator('.te-image-label')).toHaveText(/Masthead Background Image/i);
    await expect(imageRow.locator('.te-image-hint')).toContainText(/1600.*300/);
    await expect(imageRow.locator('.te-image-url-input')).toHaveValue(ORIGINAL_MASTHEAD);
    await expect(imageRow.locator('.te-image-preview')).toHaveAttribute('src', ORIGINAL_MASTHEAD);
    await expect(imageRow.locator('.te-image-browse-btn')).toBeVisible();

    // Round-trip: change the URL, save, confirm it landed in the CSS file
    // correctly re-wrapped as url(...), not the bare path.
    await imageRow.locator('.te-image-url-input').fill(TEST_MASTHEAD);
    await section.locator('.te-save-vars-btn').click();
    await expect(page.locator('.simple-notification.error, [class*="notification"][class*="error"]')).toHaveCount(0);

    const cssRes = await page.request.get(`/plugins/theme-fourth-of-july/css/theme.css?v=${Date.now()}`);
    const css = await cssRes.text();
    expect(css).toMatch(new RegExp(`--nc-masthead-bg-url:\\s*url\\(${TEST_MASTHEAD.replace(/\//g, '\\/')}\\)`));
  } finally {
    // Restore the original masthead image on disk.
    await page.goto(`/${ADMIN_PATH}/?route=plugins`);
    await page.click('button.plugin-settings-btn[data-code="theme-editor"]');
    await expect(page.locator('#plugin-drawer')).toBeVisible();
    const section = page.locator('.te-section[data-code="theme-fourth-of-july"]');
    await section.locator('.te-image-url-input[data-var="--nc-masthead-bg-url"]').fill(ORIGINAL_MASTHEAD);
    await section.locator('.te-save-vars-btn').click();
    await page.click('#plugin-drawer-close');

    const cssRes = await page.request.get(`/plugins/theme-fourth-of-july/css/theme.css?v=${Date.now()}`);
    const css = await cssRes.text();
    expect(css).toMatch(new RegExp(`--nc-masthead-bg-url:\\s*url\\(${ORIGINAL_MASTHEAD.replace(/\//g, '\\/')}\\)`));

    // Restore the plugin-enabled state (theme-sienna active again).
    await setPluginEnabled(page, 'theme-sienna', true);
  }
});
