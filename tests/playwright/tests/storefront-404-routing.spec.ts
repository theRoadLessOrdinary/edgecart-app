import { test, expect } from '@playwright/test';

/**
 * Storefront router (index.php) — unrecognized-path fallback.
 *
 * get('route', 'home') previously defaulted to 'home' for ANY request that
 * didn't match one of the SEO-friendly URI patterns (category/, product/,
 * page/, etc.) AND had no explicit ?route= query param — including a
 * totally unrecognized path with no route at all. That silently served the
 * homepage with HTTP 200 at infinite URLs instead of a real 404: found via
 * a SeoLoupe SEO audit on TRLO, which reported /sitemap-index.xml (never a
 * real file) as present, because it 200'd with homepage HTML instead of
 * 404ing. Any bot-probed or stale/typo'd URL under the domain had the same
 * problem — a real technical-SEO issue (duplicate content at infinite
 * URLs, wasted crawl budget).
 *
 * REQUIRED ENV VARS: none — pure storefront routing, no login needed.
 */

test.describe('Storefront 404 routing', () => {
  test('a totally unrecognized path returns a real 404, not the homepage', async ({ page }) => {
    const resp = await page.goto('/this-definitely-does-not-exist-xyz-12345');
    expect(resp?.status()).toBe(404);
    // Must actually be the 404 page's content, not the homepage silently
    // reused — the bug specifically served real homepage HTML with a
    // wrong status implied (200), so checking status alone isn't enough.
    await expect(page.locator('body')).toContainText(/not.*found/i);
  });

  test('a fake, never-generated file path 404s correctly (e.g. sitemap-index.xml)', async ({ page }) => {
    // This exact path was what the original SeoLoupe audit flagged as
    // "present" — it isn't a real file this app ever generates (the real
    // one is /sitemap.xml, singular, no "-index").
    const resp = await page.goto('/sitemap-index.xml');
    expect(resp?.status()).toBe(404);
  });

  test('the real homepage still loads normally at the true root', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status()).toBe(200);
    await expect(page.locator('#masthead')).toBeVisible();
  });

  test('the real sitemap.xml still loads normally', async ({ page }) => {
    const resp = await page.goto('/sitemap.xml');
    expect(resp?.status()).toBe(200);
    const body = await resp?.text();
    expect(body).toContain('<urlset');
  });

  test('explicit ?route= query links still work (e.g. login)', async ({ page }) => {
    const resp = await page.goto('/?route=login');
    expect(resp?.status()).toBe(200);
    await expect(page.locator('#login-form')).toBeVisible();
  });
});
