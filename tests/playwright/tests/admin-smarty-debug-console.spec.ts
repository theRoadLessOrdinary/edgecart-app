import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Smarty Debug Console — deprecation-warning regression.
 *
 * The vendor-bundled lib/vendor/smarty/smarty/libs/debug.tpl renders
 * {Smarty::SMARTY_VERSION} directly in a template, which PHP 8 logs as an
 * "Using unregistered static method ... in a template is deprecated"
 * warning on every debug-console render — even though $smarty->registerClass
 * ('Smarty', 'Smarty') is already called in both index.php and admin/
 * index.php (that call only covers static *method* calls, not constant
 * access, so it doesn't suppress this). This spams the production error log
 * every time a merchant turns on Server → Error & Debug → Smarty Debug
 * Console. Fixed by pointing $smarty->debug_tpl at a local override
 * (lib/smarty-overrides/debug.tpl) that hardcodes the version string
 * instead of reading the constant from within the template.
 *
 * REQUIRED ENV VARS (do not hardcode — see README.md):
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   ERROR_LOG_PATH - absolute path to the store's logs/error.log, so this
 *                    test can confirm no new deprecation line appears.
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const ERROR_LOG_PATH = process.env.ERROR_LOG_PATH;
if (!ERROR_LOG_PATH) throw new Error('Set ERROR_LOG_PATH env var (absolute path to logs/error.log)');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

test('enabling Smarty Debug Console does not spam the error log with a SMARTY_VERSION deprecation warning', async ({ page }) => {
  await loginAdmin(page);
  await page.goto(`/${ADMIN_PATH}/?route=setup`);
  await page.click('a[href="#tab-server"]');
  await page.waitForTimeout(500);

  const toggle = page.locator('#s_smarty_debug');
  const wasChecked = await toggle.locator('input').isChecked();
  if (!wasChecked) {
    await toggle.click();
    await page.click('#btn-save-all');
    await page.waitForTimeout(500);
  }

  try {
    const logSizeBefore = Number(
      execSync(`wc -c < "${ERROR_LOG_PATH}"`).toString().trim()
    );

    // Render a real storefront page with debug console active.
    const resp = await page.goto('/');
    expect(resp?.status()).toBe(200);
    // The debug console isn't inline in the page body — Smarty's own
    // debug.tpl opens it in a popup via window.open()+document.write(), which
    // headless Chrome doesn't actually display. The captured HTML (including
    // the version string) is still embedded verbatim as a JS string literal
    // inside a <script> tag on the main page, so check the raw page source
    // instead of the rendered body — confirms the fix didn't just silence the
    // warning by breaking the console output entirely.
    const html = await page.content();
    expect(html).toContain('Smarty 4.5.4 Debug Console');

    const newLogContent = execSync(
      `tail -c +${logSizeBefore + 1} "${ERROR_LOG_PATH}"`
    ).toString();
    expect(newLogContent).not.toContain('SMARTY_VERSION');
    expect(newLogContent).not.toContain('unregistered static method');
  } finally {
    await page.goto(`/${ADMIN_PATH}/?route=setup`);
    await page.click('a[href="#tab-server"]');
    await page.waitForTimeout(500);
    if (!wasChecked) {
      await page.locator('#s_smarty_debug').click();
      await page.click('#btn-save-all');
      await page.waitForTimeout(500);
    }
  }
});
