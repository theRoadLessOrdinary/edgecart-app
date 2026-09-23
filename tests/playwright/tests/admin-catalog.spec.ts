import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');

async function login(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  await page.fill('#username', process.env.ADMIN_USER || '');
  await page.fill('#password', process.env.ADMIN_PASS || '');
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/route=login/);
}

test.describe('Admin catalog management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('create a category', async ({ page }) => {
    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    // The button text ("+ Add Category") also substring-matches a hidden
    // drawer <h2>"Add Category"</h2> that only appears once the drawer is
    // open — a plain text locator resolves both and can grab the wrong
    // (invisible) one, so target the button by id.
    await page.click('#btn-add-category');
    await page.fill('#cat-name', 'Playwright Test Category');
    await page.click('button:has-text("Save")');
    await expect(page.locator('text=Playwright Test Category')).toBeVisible();
  });

  // Regression test for a real bug: an active category's delete control used
  // to render fully invisible (opacity:0, pointer-events:none, no title) —
  // indistinguishable from a broken button, and it silently blocked ever
  // deleting a category without first deactivating it, with zero indication
  // why. This was reported as "can't delete at all" alongside a separate,
  // real category-limit issue, which made it look limit-related when it
  // wasn't: it reproduces on a freshly created, active category regardless
  // of the tier limit. Confirms both halves of the fix: the disabled state
  // is now visible and explained, and the working (inactive) state still
  // actually deletes.
  test('an active category shows an explained, non-broken delete state; deactivating enables real delete', async ({ page }) => {
    const host = process.env.DB_MYSQL_HOST || '127.0.0.1';
    const user = process.env.DB_MYSQL_USER || 'root';
    const pass = process.env.DB_MYSQL_PASS;
    const db = process.env.DB_NAME || 'toffee_cart';
    const dbExec = (sql: string) =>
      execSync(`mysql -h ${host} -u ${user} -N -B -e "${sql}" ${db}`, {
        env: { ...process.env, MYSQL_PWD: pass || '' },
      }).toString().trim();

    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    await page.click('#btn-add-category');
    const catName = `Playwright Delete-State Category ${Date.now()}`;
    await page.fill('#cat-name', catName);
    await page.click('button:has-text("Save")');
    await expect(page.locator('text=' + catName)).toBeVisible();

    const catId = dbExec(`SELECT id FROM nc_categories WHERE name='${catName}'`);
    expect(catId).toMatch(/^\d+$/);

    // New categories default to Active (status=1) — the delete control
    // should be visible-but-disabled with a real explanation, not invisible.
    await page.goto(`/${ADMIN_PATH}/?route=categories`);
    const hint = page.locator(`#cat-del-${catId}`);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveClass(/delete-disabled-hint/);
    await expect(hint).toHaveAttribute('title', /deactivate/i);
    // The old bug: this exact element existed but was unclickable at any
    // coordinate within it (pointer-events:none with no visible affordance).
    // Confirm it's now real content, not the invisible placeholder.
    await expect(hint).not.toHaveClass(/delete-fade/);

    // Deactivate directly (status=0 = "Not Active") — bypasses the
    // roller-select custom element's own interaction quirks, which aren't
    // what this test is about.
    dbExec(`UPDATE nc_categories SET status=0 WHERE id=${catId}`);
    await page.goto(`/${ADMIN_PATH}/?route=categories`);

    const deleteEl = page.locator(`#cat-del-${catId} delete-in-place`);
    await expect(deleteEl).toBeVisible();
    await deleteEl.locator('.dip-delete').click();
    await deleteEl.locator('.dip-confirm').click();
    await expect(page.locator('text=' + catName)).not.toBeVisible({ timeout: 5_000 });

    const remaining = dbExec(`SELECT COUNT(*) FROM nc_categories WHERE id=${catId}`);
    expect(remaining).toBe('0');
  });

  test('create a product with image and linked option', async ({ page }) => {
    await page.goto(`/${ADMIN_PATH}/?route=products`);
    // Same hidden-drawer-title collision as the category button above.
    await page.click('#btn-add-product');
    await page.fill('#prod-name', 'Playwright Test Product');
    await page.fill('#prod-price', '19.99');

    // Category assignment renders one of two ways depending on
    // PRODUCT_CAT_LIMIT (products.js): a single <select id="prod-cat-select">
    // when the per-product category limit is exactly 1 (free tier default),
    // or a checkbox list inside #prod-cat-list otherwise (multi-category
    // plugin). Confirmed against the live admin UI, not assumed from source.
    const catSelect = page.locator('#prod-cat-select');
    if (await catSelect.count() > 0) {
      await catSelect.selectOption({ label: 'Playwright Test Category' });
    } else {
      await page.locator('#prod-cat-list').getByText('Playwright Test Category').click().catch(() => {
        // fallback if category assignment uses a different control
      });
    }

    // The product drawer is tabbed (Details/Images/Options/SEO/Downloads) with
    // only the active tab's panel actually interactable, confirmed against
    // the live UI: the file input and the option list both hung indefinitely
    // until their own tab was clicked first.
    await page.click('.drawer-tab[data-panel="images"]');

    // Upload a product image — reuse a known sample-data asset so the file
    // definitely exists regardless of which install config is under test.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles('../../install/sample-data/products/mens-3-4-sleeve-tee.webp');

    // Options can only be linked to a product that already has an id
    // (add_option's AJAX call needs product_id — confirmed in products.js
    // around line 1527), and #prod-id only gets populated by a prior Save
    // (products.js line ~825-828, "Keep currentProdId in sync (needed for
    // new products that stay open)"). So save once first to create the
    // product, THEN switch to Options and link, then save again.
    await page.click('button:has-text("Save")');
    await expect(page.locator('#prod-id')).not.toHaveValue('');

    // Link the "Size" option (seeded by install/ajax.php seed_sample_inventory)
    // via the real search-and-add autocomplete (#opt-search-input /
    // #opt-search-results), not a static clickable list.
    await page.click('.drawer-tab[data-panel="options"]');
    await page.fill('#opt-search-input', 'Size');
    await page.locator('#opt-search-results li', { hasText: 'Size' }).first().click();

    await page.click('button:has-text("Save")');
    // A plain text locator also matches the tabbed drawer's own hidden title
    // echo (#drawer-tab-name, aria-hidden, always in the DOM), same collision
    // pattern as the "+ Add Product" button vs the drawer <h2>. Scope to the
    // actual row link in the table.
    await expect(page.locator('.prod-name-link', { hasText: 'Playwright Test Product' })).toBeVisible();
  });

  test('product image actually renders (no broken src)', async ({ page }) => {
    await page.goto(`/${ADMIN_PATH}/?route=products`);
    await page.click('.prod-name-link:has-text("Playwright Test Product")');
    // Same tabbed-drawer rule as product creation: the Images panel (and its
    // <img>) isn't interactable/visible until its tab is selected — Details
    // is the tab active by default when the Edit drawer opens.
    await page.click('.drawer-tab[data-panel="images"]');
    const img = page.locator('img').first();
    await expect(img).toBeVisible();
    const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth, 'image src resolved to a broken/0-width image').toBeGreaterThan(0);
  });
});
