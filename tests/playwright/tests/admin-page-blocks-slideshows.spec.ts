import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * page-blocks + slideshows, combined because slideshow blocks depend on
 * page-blocks to place them. Both plugins' real save endpoints
 * (route=page-blocks/ajax, route=slideshows, route=slideshows/slides) are
 * called directly via page.request.post() rather than driving the drag/drop
 * palette UI or the shared admin file-manager modal (openFilePicker) — that
 * modal is a separate, shared component already exercised by other admin
 * screens, not something specific to these two plugins. An existing product
 * image filename is reused for the slide instead of performing a real upload.
 *
 * Target page: the "product" system page (nc_pages id=11, page_type=product).
 * Column-2 ("main") blocks always render on the storefront product page
 * regardless of sidebar/related-product state (ctl/product.php $below_blocks),
 * so this avoids the sidebar-content dependency documented in
 * admin-related-products.spec.ts.
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   PRODUCT_SLUG - slug of a purchasable product (any type; used only to load
 *                  the storefront product page template these blocks render on)
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const PRODUCT_SLUG = process.env.PRODUCT_SLUG;
if (!PRODUCT_SLUG) throw new Error('Set PRODUCT_SLUG env var (slug of a purchasable product)');

const PRODUCT_PAGE_ID = 11;
const EXISTING_IMAGE = '/img/products/mens-baseball-shirt-front.webp';

function dbExec(sql: string): string {
  return execSync(
    `mysql -u toffee_cart -p'Buyer+Hunger%Ratio&Money^0' toffee_cart -N -e "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }
  ).trim();
}

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

async function getCsrfToken(page: Page): Promise<string> {
  await page.goto(`/${ADMIN_PATH}/?route=page-edit&id=${PRODUCT_PAGE_ID}`);
  const token = await page.locator('meta[name="csrf-token"]').getAttribute('content');
  if (!token) throw new Error('Could not find csrf-token meta tag');
  return token;
}

test.describe.serial('page-blocks + slideshows plugins', () => {
  let createdBlockIds: number[] = [];
  let createdSlideshowId: number | null = null;

  test.beforeAll(() => {
    // Clean up any debris from a prior failed run before starting.
    dbExec(
      `DELETE FROM nc_page_blocks WHERE page_id=${PRODUCT_PAGE_ID} AND settings LIKE '%__pw_test__%'`
    );
  });

  test('adding a rich_text block via page-blocks/ajax renders on the storefront product page', async ({ page }) => {
    await loginAdmin(page);
    const csrfToken = await getCsrfToken(page);

    const marker = `Playwright rich text block __pw_test__ ${Date.now()}`;
    const res = await page.request.post(`/${ADMIN_PATH}/?route=page-blocks/ajax`, {
      form: {
        action: 'save_block',
        id: '0',
        page_id: String(PRODUCT_PAGE_ID),
        block_type: 'rich_text',
        settings: JSON.stringify({ content: `<p>${marker}</p>` }),
        enabled: '1',
        col_start: '2',
        csrf_token: csrfToken,
      },
    });
    const data = await res.json();
    expect(data.ok, `save_block should succeed: ${data.message || ''}`).toBe(true);
    createdBlockIds.push(data.block.id);

    await page.goto(`/product/${PRODUCT_SLUG}`);
    await expect(page.locator('.block-rich-text', { hasText: marker })).toBeVisible();
  });

  test('creating a slideshow with a slide and embedding it as a page block renders on the storefront', async ({ page }) => {
    await loginAdmin(page);
    const csrfToken = await getCsrfToken(page);

    const ssName = `Playwright __pw_test__ Slideshow ${Date.now()}`;
    const ssRes = await page.request.post(`/${ADMIN_PATH}/?route=slideshows`, {
      form: {
        action: 'save',
        id: '0',
        name: ssName,
        transition: 'fade',
        interval: '5000',
        height: '300',
        status: '1',
        csrf_token: csrfToken,
      },
    });
    const ssData = await ssRes.json();
    expect(ssData.ok, `slideshow save should succeed: ${ssData.message || ''}`).toBe(true);
    createdSlideshowId = ssData.id;

    const slideRes = await page.request.post(`/${ADMIN_PATH}/?route=slideshows/slides`, {
      form: {
        action: 'save',
        id: '0',
        slideshow_id: String(createdSlideshowId),
        image: EXISTING_IMAGE,
        heading: 'Playwright test slide',
        display_order: '0',
        enabled: '1',
        csrf_token: csrfToken,
      },
    });
    const slideData = await slideRes.json();
    expect(slideData.ok, `slide save should succeed: ${slideData.message || ''}`).toBe(true);

    const blockRes = await page.request.post(`/${ADMIN_PATH}/?route=page-blocks/ajax`, {
      form: {
        action: 'save_block',
        id: '0',
        page_id: String(PRODUCT_PAGE_ID),
        block_type: 'slideshow',
        settings: JSON.stringify({ slideshow_id: createdSlideshowId, __pw_test__: true }),
        enabled: '1',
        col_start: '2',
        csrf_token: csrfToken,
      },
    });
    const blockData = await blockRes.json();
    expect(blockData.ok, `save_block should succeed: ${blockData.message || ''}`).toBe(true);
    createdBlockIds.push(blockData.block.id);

    await page.goto(`/product/${PRODUCT_SLUG}`);
    const slideshow = page.locator('.block-slideshow');
    await expect(slideshow).toBeVisible();
    await expect(slideshow.locator('.slideshow-slide.active img[src*="mens-baseball-shirt-front"]')).toBeVisible();
  });

  test.afterAll(() => {
    if (createdBlockIds.length) {
      dbExec(`DELETE FROM nc_page_blocks WHERE id IN (${createdBlockIds.join(',')})`);
    }
    if (createdSlideshowId) {
      dbExec(`DELETE FROM nc_slideshow_slides WHERE slideshow_id=${createdSlideshowId}`);
      dbExec(`DELETE FROM nc_slideshows WHERE id=${createdSlideshowId}`);
    }
  });
});
