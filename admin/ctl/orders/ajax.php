<?php
/**
 * new-cart admin — orders ajax handler
 * route=orders/ajax
 */

require_admin();
header('Content-Type: application/json');

// Verify CSRF token for all POST actions
require_csrf_token_json();

$p      = DB_PREFIX;
$action = post('action');

// ── List ──────────────────────────────────────────────────────────────────────
if ($action === 'list') {
	$rows = DB::rows("
		SELECT o.id, o.status, o.total, o.shipping, o.tax, o.payment_ref,
		       o.tracking_number, o.tracking_url,
		       DATE_FORMAT(o.created_at, '%b %e, %Y') AS date_fmt,
		       o.created_at,
		       TRIM(CONCAT(COALESCE(c.first_name, o.ship_firstname, ''), ' ', COALESCE(c.last_name, o.ship_lastname, ''))) AS customer_name,
		       COALESCE(c.email, o.ship_email, '') AS customer_email,
		       c.id AS customer_id
		FROM `{$p}orders` o
		LEFT JOIN `{$p}customers` c ON c.id = o.customer_id
		ORDER BY o.created_at DESC
	");
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Get single ────────────────────────────────────────────────────────────────
if ($action === 'get') {
	$id  = (int)post('id');
	$row = DB::row("
		SELECT o.*,
		       DATE_FORMAT(o.created_at, '%b %e, %Y') AS date_fmt,
		       TRIM(CONCAT(COALESCE(c.first_name, o.ship_firstname, ''), ' ', COALESCE(c.last_name, o.ship_lastname, ''))) AS customer_name,
		       COALESCE(c.email, o.ship_email, '') AS customer_email
		FROM `{$p}orders` o
		LEFT JOIN `{$p}customers` c ON c.id = o.customer_id
		WHERE o.id = ?
	", [$id]);
	if (!$row) ajax_out(false, 'Order not found.');

	$items = DB::rows(
		"SELECT * FROM `{$p}order_items` WHERE order_id = ? ORDER BY id",
		[$id]
	);
	ajax_out(true, '', ['row' => $row, 'items' => $items]);
}

// ── Set status ────────────────────────────────────────────────────────────────
if ($action === 'set_status') {
	require_access(ACCESS_EDIT);
	$id     = (int)post('id');
	$status = post('status');

	$valid = DB::val("SELECT slug FROM `{$p}order_statuses` WHERE slug = ?", [$status]);
	if (!$valid) ajax_out(false, 'Invalid status.');

	$old_status = DB::val("SELECT status FROM `{$p}orders` WHERE id=?", [$id]);
	DB::exec("UPDATE `{$p}orders` SET status = ? WHERE id = ?", [$status, $id]);
	$_hook_data = ['order_id' => $id, 'old_status' => $old_status, 'new_status' => $status];
	Hook::fire('admin.order.status.changed', $_hook_data);
	ajax_out(true, 'Status updated.');
}

// ── Mark payment received (check/money order, or any manually-confirmed method) ──
// Unlike set_status, this fires catalog.order.payment_complete — the hook
// ec-fulfillment (and Stripe/PayPal's own webhooks) use to actually build and
// deliver a digital order. set_status alone never triggers fulfillment.
if ($action === 'mark_paid') {
	require_access(ACCESS_EDIT);
	$id = (int)post('id');

	$order = DB::row("SELECT * FROM `{$p}orders` WHERE id=?", [$id]);
	if (!$order) ajax_out(false, 'Order not found.');
	if ($order['status'] === 'paid') ajax_out(false, 'Order is already marked paid.');

	DB::exec("UPDATE `{$p}orders` SET status='paid' WHERE id=?", [$id]);
	$order['status'] = 'paid';

	Hook::fire('catalog.order.payment_complete', $order);
	ajax_out(true, 'Payment marked received — fulfillment triggered.');
}

// ── Bulk delete ───────────────────────────────────────────────────────────────
// ── Send message to order email ───────────────────────────────────────────────
if ($action === 'send_message') {
	require_access(ACCESS_EDIT);
	$email   = trim(post('email'));
	$subject = trim(post('subject'));
	$body    = post('body');
	if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) ajax_out(false, 'No valid email for this order.');
	if (!$subject) ajax_out(false, 'Subject is required.');
	if (!trim(strip_tags($body))) ajax_out(false, 'Message body is required.');
	$html = '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:640px;margin:0 auto;padding:20px">'
	      . $body
	      . '<hr style="margin:2rem 0;border:none;border-top:1px solid #e5e7eb">'
	      . '<p style="font-size:.83rem;color:#6b7280;margin-top:1.5rem">' . htmlspecialchars($_nc_site_name, ENT_QUOTES, 'UTF-8') . '</p>'
	      . '</body></html>';
	$from = $_nc_site_name . ' <' . ($_nc_settings['mail_from'] ?? SITE_EMAIL) . '>';
	if (!nc_mail($email, $subject, $html, $from, true)) ajax_out(false, 'Mail server could not send the message.');
	ajax_out(true, 'Message sent to ' . $email . '.');
}

if ($action === 'bulk_delete') {
	require_access(ACCESS_DELETE);
	$ids = json_decode(post('ids'), true);
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'No orders selected.');
	$ids          = array_map('intval', $ids);
	$placeholders = implode(',', array_fill(0, count($ids), '?'));
	DB::exec("DELETE FROM `{$p}order_items` WHERE order_id IN ({$placeholders})", $ids);
	DB::exec("DELETE FROM `{$p}orders`      WHERE id       IN ({$placeholders})", $ids);
	$n = count($ids);
	ajax_out(true, $n . ' order' . ($n === 1 ? '' : 's') . ' deleted.');
}

ajax_out(false, 'Unknown action.');
