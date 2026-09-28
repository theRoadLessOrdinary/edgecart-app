import { test, expect, Page } from '@playwright/test';

/**
 * Order message history: a message sent from the order drawer's Message tab
 * is recorded (nc_order_messages, via order_message_log() in lib/functions.php)
 * and listed under "Message History" on that same tab, right after sending
 * and the next time the order is opened. Works whether or not the host can
 * actually deliver mail (a failed send is still logged, marked "Not sent").
 *
 * REQUIRED ENV VARS:
 *   ADMIN_PATH, ADMIN_USER, ADMIN_PASS
 *   ORDER_ID - an existing order to message
 *   MSG_TO   - address the test message is actually sent to
 */

const ADMIN_PATH = process.env.ADMIN_PATH;
if (!ADMIN_PATH) throw new Error('Set ADMIN_PATH env var (the obscured admin URL segment)');
const ORDER_ID = process.env.ORDER_ID;
if (!ORDER_ID) throw new Error('Set ORDER_ID env var (an existing order id)');
const MSG_TO = process.env.MSG_TO;
if (!MSG_TO) throw new Error('Set MSG_TO env var (address the test message is sent to)');

async function loginAdmin(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=login`);
  if (page.url().includes('route=login')) {
    await page.fill('#username', process.env.ADMIN_USER || '');
    await page.fill('#password', process.env.ADMIN_PASS || '');
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL(/route=login/);
  }
}

async function openOrder(page: Page) {
  await page.goto(`/${ADMIN_PATH}/?route=orders`);
  await page.fill('#ord-search', String(ORDER_ID));
  await page.locator('#ord-table td.ord-id-cell', { hasText: new RegExp(`^\\s*#?${ORDER_ID}\\s*$`) }).first().click();
  await expect(page.locator('#ord-detail-body')).toBeVisible();
  await page.click('#ord-drawer .drawer-tab[data-ord-tab="message"]');
}

test('order drawer lists messages sent from its Message tab', async ({ page }) => {
  const subject = `Message history test ${Date.now()}`;
  const body = 'First line of the test message.\nSecond line, <b>not</b> HTML.';

  await loginAdmin(page);
  await openOrder(page);
  await expect(page.locator('.ord-msg-history-head')).toHaveText('Message History');

  await page.fill('#ord-msg-to', MSG_TO!);
  await page.fill('#ord-msg-subject', subject);
  await page.fill('#ord-msg-body', body);
  const sent = page.waitForResponse(r => r.url().includes('orders/ajax') && r.request().postData()?.includes('send_message') === true);
  await page.click('#ord-msg-send');
  const res = await (await sent).json();
  // Logged whether or not the mail server accepted it; a failed send shows "Not sent"
  if (!res.ok) {
    await expect(page.locator('#ord-msg-history .ord-msg-item', { hasText: subject }).locator('.ord-msg-failed')).toHaveText('Not sent');
  }

  await openOrder(page);
  const item = page.locator('#ord-msg-history .ord-msg-item', { hasText: subject });
  await expect(item).toHaveCount(1);
  await expect(item.locator('.ord-msg-meta')).toContainText(`to ${MSG_TO}`);
  await expect(item.locator('.ord-msg-meta')).toContainText('Message tab');
  await item.locator('summary').click();
  // Stored as plain text: line break kept, markup stripped (never rendered in admin)
  await expect(item.locator('.ord-msg-text')).toHaveText('First line of the test message.\nSecond line, not HTML.');
  await expect(item.locator('.ord-msg-text b')).toHaveCount(0);
});
