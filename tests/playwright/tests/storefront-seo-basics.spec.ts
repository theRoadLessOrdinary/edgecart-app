import { test, expect } from '@playwright/test';

/**
 * Storefront basic on-page SEO — found missing/wrong via a real SEO audit
 * (SeoLoupe, run against TRLO 2026-07-11):
 *
 *  - Every page had two H1 tags: the site-wide branding/logo (tpl/
 *    layout.html, rendered on every page) and the page's own real content
 *    heading. Multiple H1s send a confused "what is this page about" signal
 *    to search engines. The branding element is now a <div>, not an <h1> —
 *    it's site-wide chrome, not page content, so it was never a real H1's
 *    job in the first place.
 *  - No canonical tag existed anywhere. Added a self-referencing one
 *    (absolute URL, per Google's own guidance) on every page via index.php
 *    assigning $canonical_url + layout.html rendering it.
 *
 * REQUIRED ENV VARS: none — pure storefront rendering, no login needed.
 * PRODUCT_SLUG - slug of a purchasable product, to check a non-homepage
 *                 page too.
 */

const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

test.describe('Storefront basic on-page SEO', () => {
  test('homepage has exactly one H1, and it is not the site branding', async ({ page }) => {
    await page.goto('/');
    const h1s = page.locator('h1');
    await expect(h1s).toHaveCount(1);
    // The branding element must not itself be (or contain) an H1.
    await expect(page.locator('#store-logo')).not.toHaveJSProperty('tagName', 'H1');
    await expect(page.locator('#store-logo h1')).toHaveCount(0);
  });

  test('homepage has a self-referencing absolute canonical tag', async ({ page, baseURL }) => {
    await page.goto('/');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    const href = await canonical.getAttribute('href');
    expect(href).toMatch(/^https?:\/\//); // absolute, not root-relative
    expect(href).toBe((baseURL || '').replace(/\/$/, '') + '/');
  });

  test('a product page has exactly one H1 and its own canonical tag', async ({ page, baseURL }) => {
    await page.goto(`/product/${PRODUCT_SLUG}`);
    await expect(page.locator('h1')).toHaveCount(1);
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    const href = await canonical.getAttribute('href');
    expect(href).toBe(`${(baseURL || '').replace(/\/$/, '')}/product/${PRODUCT_SLUG}`);
  });

  test('homepage renders meta description and keywords when configured (fallback product-grid homepage)', async ({ page }) => {
    // ctl/home.php's own product-grid fallback (used when no home_page_id
    // CMS page is configured) already read homepage_seo_description into
    // meta_description, but never read a homepage_seo_keywords setting at
    // all — tpl/layout.html's meta_keywords block existed and worked (CMS
    // pages via ctl/page.php already wire it up correctly) but this
    // fallback path silently never populated it. Requires
    // homepage_seo_description/homepage_seo_keywords settings to be set on
    // the target install (test data, not real content — see README).
    await page.goto('/');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    const keywords = await page.locator('meta[name="keywords"]').getAttribute('content');
    expect(description).toBeTruthy();
    expect(keywords).toBeTruthy();
  });

  test('homepage has exactly one valid Organization JSON-LD block', async ({ page, baseURL }) => {
    // An SEO audit found zero JSON-LD blocks anywhere on the site (it only
    // scanned the homepage). index.php now injects Organization schema
    // site-wide, gated to the true homepage only via is_homepage.
    await page.goto('/');
    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(1);
    const raw = await scripts.first().textContent();
    const data = JSON.parse(raw || '{}');
    expect(data['@type']).toBe('Organization');
    expect(data.url).toBe((baseURL || '').replace(/\/$/, '') + '/');
    expect(data.name).toBeTruthy();
  });

  test('a product page has exactly one valid Product JSON-LD block with correct data', async ({ page, baseURL }) => {
    // The old hand-written JSON-LD template markup applied Smarty's HTML
    // |escape to values going straight into a JSON string — a product name
    // with a quote or apostrophe rendered as literal "&quot;" text instead
    // of a real quote character once parsed. Also fixed: priceCurrency was
    // the "$" display symbol (schema.org requires an ISO 4217 code like
    // "USD"); offers.url was root-relative and non-SEO-friendly; and
    // availability read stock=-1 (this app's "unlimited, don't track"
    // sentinel, admin/tpl/products/list.html: "-1 disables stock check")
    // as OutOfStock.
    await page.goto(`/product/${PRODUCT_SLUG}`);
    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(1);
    const raw = await scripts.first().textContent();
    const data = JSON.parse(raw || '{}'); // throws if not valid JSON

    expect(data['@type']).toBe('Product');
    expect(data.name).not.toContain('&quot;'); // real quote chars, not HTML entities
    expect(data.name).not.toContain('&amp;');
    expect(data.offers.priceCurrency).toMatch(/^[A-Z]{3}$/); // ISO 4217, not "$"
    expect(data.offers.url).toBe(`${(baseURL || '').replace(/\/$/, '')}/product/${PRODUCT_SLUG}`);
    expect(data.offers.availability).toBe('https://schema.org/InStock');
  });
});
