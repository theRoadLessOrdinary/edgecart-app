<?php
/**
 * new-cart admin - orders ajax handler
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
	foreach ($items as &$it) {
		$pid = (int)$it['product_id'];
		$it['option_defs'] = []; $it['selected'] = (object)[];
		if (!$pid) continue;
		$sel = orders_match_selections($p, $it);
		$it['option_defs'] = orders_option_defs($p, $pid);
		$it['selected']    = (object)$sel;
		$it['unmatched']   = trim((string)$it['options_summary']) !== '' && !$sel;
		if (($it['weight'] ?? null) === null) {
			$res = orders_resolve($p, $pid, $sel);
			$it['weight'] = $res ? $res['unit_weight'] : 0;
		}
	}
	unset($it);
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
// Unlike set_status, this fires catalog.order.payment_complete - the hook
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
	ajax_out(true, 'Payment marked received - fulfillment triggered.');
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

// ── Order editing / manual order creation ─────────────────────────────────────

// order_items had no weight column; add it (per-unit, NULL = use the product's weight).
function orders_ensure_weight_col(string $p): void {
	$has = DB::val(
		"SELECT COUNT(*) FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'weight'",
		["{$p}order_items"]
	);
	if (!$has) DB::exec("ALTER TABLE `{$p}order_items` ADD COLUMN `weight` DECIMAL(8,3) NULL DEFAULT NULL");
}

// Options grouped for the UI: [{po_id, name, values:[{pov_id, text}]}]
function orders_option_defs(string $p, int $product_id): array {
	$out = [];
	foreach (orders_option_rows($p, $product_id) as $r) {
		if (!isset($out[$r['po_id']])) $out[$r['po_id']] = ['po_id' => (int)$r['po_id'], 'name' => $r['option_name'], 'values' => []];
		$out[$r['po_id']]['values'][] = ['pov_id' => (int)$r['pov_id'], 'text' => $r['value_text'], 'enabled' => (int)$r['enabled'], 'is_default' => (int)$r['is_default']];
	}
	return array_values($out);
}

// Option rows for a product, same joins as Cart::get() (lib/cart.php).
function orders_option_rows(string $p, int $product_id): array {
	return DB::rows(
		"SELECT po.id AS po_id, o.name AS option_name, pov.id AS pov_id, pov.label,
		        ov.text AS value_text, pov.price_modifier, pov.price_prefix,
		        ov.weight_modifier, pov.enabled, pov.is_default
		 FROM `{$p}product_options` po
		 JOIN `{$p}options` o ON o.id = po.option_id
		 JOIN `{$p}product_option_values` pov ON pov.product_option_id = po.id
		 JOIN `{$p}option_values` ov ON ov.id = pov.option_value_id
		 WHERE po.product_id = ?
		 ORDER BY po.display_order, po.id, pov.id",
		[$product_id]
	);
}

// Unit price/weight/summary for a product + option selections ({po_id: pov_id}).
// Mirrors Cart::get() exactly, including its use of the price prefix for weight.
function orders_resolve(string $p, int $product_id, array $selections): ?array {
	$product = DB::row("SELECT price, weight FROM `{$p}products` WHERE id = ?", [$product_id]);
	if (!$product) return null;
	$rows = [];
	foreach (orders_option_rows($p, $product_id) as $r) $rows[$r['po_id'] . ':' . $r['pov_id']] = $r;

	$price_override = null; $price_adj = 0.0;
	$weight_base = (float)$product['weight']; $weight_adj = 0.0;
	$labels = [];
	foreach ($selections as $po_id => $pov_id) {
		$opt = $rows[(int)$po_id . ':' . (int)$pov_id] ?? null;
		if (!$opt) continue;
		$labels[] = $opt['option_name'] . ': ' . $opt['value_text'];
		$mod = (float)$opt['price_modifier'];
		$wmod = (float)$opt['weight_modifier'];
		// '=' with no price set (NULL/0) means "no override", not "free" -
		// same rule as Cart::get() (lib/cart.php).
		if ($opt['price_prefix'] === '=' && $mod <= 0) { /* no change */ }
		elseif ($opt['price_prefix'] === '=')  { $price_override = $mod; $price_adj = 0.0; $weight_base = $wmod; $weight_adj = 0.0; }
		elseif ($opt['price_prefix'] === '-')  { $price_adj -= $mod; $weight_adj -= $wmod; }
		else                                   { $price_adj += $mod; $weight_adj += $wmod; }
	}
	return [
		'unit_price'  => round(($price_override ?? (float)$product['price']) + $price_adj, 2),
		'unit_weight' => max(0.0, round($weight_base + $weight_adj, 3)),
		'summary'     => implode(', ', $labels),
	];
}

// Work out which option values an existing order line used: the saved selections
// if present, else match "Option: Value" text from the old summary.
function orders_match_selections(string $p, array $item): array {
	$saved = json_decode((string)($item['options'] ?? ''), true);
	if (is_array($saved) && $saved) return $saved;
	$summary = (string)($item['options_summary'] ?? '');
	if ($summary === '') return [];
	$sel = [];
	foreach (orders_option_rows($p, (int)$item['product_id']) as $r) {
		if (isset($sel[$r['po_id']])) continue;
		if (strpos($summary, $r['option_name'] . ': ' . $r['value_text']) !== false) $sel[$r['po_id']] = $r['pov_id'];
	}
	return $sel;
}

// Decode + validate the posted line items. Weight falls back to the product's own.
function orders_clean_items(string $p, string $json): array {
	$in = json_decode($json, true);
	if (!is_array($in) || !$in) ajax_out(false, 'Add at least one item.');
	$out = [];
	foreach ($in as $it) {
		$name = trim((string)($it['name'] ?? ''));
		$qty  = (int)($it['qty'] ?? 0);
		$pid  = (int)($it['product_id'] ?? 0);
		if ($name === '')  ajax_out(false, 'Every item needs a name.');
		if ($qty < 1)      ajax_out(false, 'Quantity must be at least 1 for "' . $name . '".');
		$price = round((float)($it['price'] ?? 0), 2);
		if ($price < 0)    ajax_out(false, 'Price cannot be negative for "' . $name . '".');
		$weight  = ($it['weight'] ?? '') === '' ? null : max(0.0, (float)$it['weight']);
		$summary = trim((string)($it['options_summary'] ?? ''));
		$sel     = (is_array($it['selections'] ?? null)) ? $it['selections'] : [];
		if ($pid) {
			$res = orders_resolve($p, $pid, $sel);
			if ($res) {
				if ($weight === null) $weight = $res['unit_weight'];
				if ($sel && $res['summary'] !== '') $summary = $res['summary'];
			}
		}
		$out[] = [
			'product_id' => $pid, 'name' => mb_substr($name, 0, 255), 'price' => $price, 'qty' => $qty,
			'options_summary' => $summary, 'weight' => $weight,
			'options' => $sel ? json_encode($sel) : null,
		];
	}
	return $out;
}

function orders_hook_items(string $p, array $items): array {
	$out = [];
	foreach ($items as $it) {
		$taxable = $it['product_id']
			? (bool)DB::val("SELECT taxable FROM `{$p}products` WHERE id = ?", [$it['product_id']])
			: true;
		$out[] = [
			'product_id'   => $it['product_id'],
			'qty'          => $it['qty'],
			'unit_weight'  => (float)$it['weight'],
			'total_weight' => (float)$it['weight'] * $it['qty'],
			'line_total'   => $it['price'] * $it['qty'],
			'taxable'      => $taxable,
		];
	}
	return $out;
}

// Suggested package for the items as edited: flat-pack stacking of per-product sizes.
if ($action === 'package') {
	ensure_product_pkg_cols();
	$in = json_decode(post('items'), true);
	$lines = [];
	foreach ((array)$in as $it) {
		$pid = (int)($it['product_id'] ?? 0);
		if (!$pid) continue;
		$d = DB::row("SELECT pkg_length, pkg_width, pkg_height FROM `{$p}products` WHERE id = ?", [$pid]);
		if ($d) $lines[] = ['l' => $d['pkg_length'], 'w' => $d['pkg_width'], 'h' => $d['pkg_height'], 'qty' => (int)($it['qty'] ?? 1)];
	}
	ajax_out(true, '', ['package' => package_stack($lines)]);
}

if ($action === 'parcel_defaults') {
	$get = fn($k, $d) => DB::val("SELECT `value` FROM `{$p}settings` WHERE `key` = ?", [$k]) ?: $d;
	ajax_out(true, '', [
		'length' => $get('shippo_parcel_length', '10'), 'width' => $get('shippo_parcel_width', '8'),
		'height' => $get('shippo_parcel_height', '4'), 'dist' => $get('shippo_parcel_distance_unit', 'in'),
		'mass'   => $get('shippo_parcel_mass_unit', 'lb'),
	]);
}

if ($action === 'product_options') {
	$pid = (int)post('product_id');
	$res = orders_resolve($p, $pid, []);
	if (!$res) ajax_out(false, 'Product not found.');
	ajax_out(true, '', ['defs' => orders_option_defs($p, $pid), 'unit_price' => $res['unit_price'], 'unit_weight' => $res['unit_weight']]);
}

if ($action === 'resolve_item') {
	$sel = json_decode(post('selections'), true);
	$res = orders_resolve($p, (int)post('product_id'), is_array($sel) ? $sel : []);
	if (!$res) ajax_out(false, 'Product not found.');
	ajax_out(true, '', $res);
}

if ($action === 'product_search') {
	$q    = trim(post('q'));
	$like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $q) . '%';
	$rows = DB::rows(
		"SELECT id, name, price, weight, stock FROM `{$p}products`
		 WHERE name LIKE ? ORDER BY name LIMIT 15",
		[$like]
	);
	ajax_out(true, '', ['rows' => $rows]);
}

// Shipping rates for the order as currently edited (unsaved form state).
if ($action === 'rates') {
	require_access(ACCESS_EDIT);
	orders_ensure_weight_col($p);
	$items = orders_clean_items($p, post('items'));
	$hook_items = orders_hook_items($p, $items);
	$subtotal = 0.0; $weight = 0.0;
	foreach ($hook_items as $h) { $subtotal += $h['line_total']; $weight += $h['total_weight']; }
	$address = [
		'first_name' => trim(post('first_name')), 'last_name' => trim(post('last_name')),
		'address1' => trim(post('address1')), 'address2' => trim(post('address2')),
		'city' => trim(post('city')), 'state' => trim(post('state')),
		'zip' => trim(post('zip')), 'country' => trim(post('country', 'US')) ?: 'US',
	];
	$parcel = [
		'length' => (float)post('pkg_length'), 'width' => (float)post('pkg_width'), 'height' => (float)post('pkg_height'),
	];
	$rates = Hook::filter('catalog.checkout.shipping_rates', [], [
		'items' => $hook_items, 'address' => $address, 'subtotal' => $subtotal, 'parcel' => $parcel,
	]);
	ajax_out(true, '', ['rates' => $rates, 'weight' => round($weight, 3), 'subtotal' => round($subtotal, 2)]);
}

if ($action === 'tax') {
	require_access(ACCESS_EDIT);
	$items = orders_clean_items($p, post('items'));
	$hook_items = orders_hook_items($p, $items);
	$state = trim(post('state')); $country = trim(post('country', 'US')) ?: 'US';
	$shipping = max(0.0, (float)post('shipping'));
	if (Hook::hasInstead('checkout.tax.calculate')) {
		$tax = Hook::instead('checkout.tax.calculate', 0.0, [
			'state' => $state, 'country' => $country, 'items' => $hook_items, 'shipping' => $shipping,
		]);
	} else {
		$tax = checkout_calculate_tax($state, $country, $hook_items, $shipping);
	}
	ajax_out(true, '', ['tax' => round((float)$tax, 2)]);
}

// Save an existing order (id > 0) or create one from scratch (id = 0).
if ($action === 'save') {
	require_access(ACCESS_EDIT);
	orders_ensure_weight_col($p);   // ALTER implicitly commits, so do it before the transaction
	$id    = (int)post('id');
	$items = orders_clean_items($p, post('items'));

	$email = trim(post('email'));
	if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) ajax_out(false, 'Email address is not valid.');

	$subtotal = 0.0;
	foreach ($items as $it) $subtotal += $it['price'] * $it['qty'];
	$subtotal = round($subtotal, 2);
	$shipping = round(max(0.0, (float)post('shipping')), 2);
	$tax      = round(max(0.0, (float)post('tax')), 2);
	$discount = round(max(0.0, (float)post('discount_amount')), 2);
	$total    = round(max(0.0, $subtotal + $shipping + $tax - $discount), 2);

	$f = [
		'ship_email' => $email, 'ship_phone' => trim(post('phone')),
		'ship_firstname' => trim(post('first_name')), 'ship_lastname' => trim(post('last_name')),
		'ship_address1' => trim(post('address1')), 'ship_address2' => trim(post('address2')),
		'ship_city' => trim(post('city')), 'ship_state' => trim(post('state')),
		'ship_zip' => trim(post('zip')), 'ship_country' => trim(post('country')),
		'ship_method' => trim(post('ship_method')), 'tracking_number' => trim(post('tracking_number')), 'shippo_rate_token' => trim(post('shippo_rate_token')),
		'subtotal' => $subtotal, 'shipping' => $shipping, 'tax' => $tax,
		'discount_amount' => $discount, 'total' => $total,
	];

	$old_items = [];
	try {
		DB::begin();
		if ($id) {
			if (!DB::val("SELECT id FROM `{$p}orders` WHERE id = ?", [$id])) { DB::rollback(); ajax_out(false, 'Order not found.'); }
			$old_items = DB::rows("SELECT product_id, qty FROM `{$p}order_items` WHERE order_id = ?", [$id]);
			$set = implode(', ', array_map(fn($k) => "`$k` = ?", array_keys($f)));
			DB::exec("UPDATE `{$p}orders` SET $set WHERE id = ?", array_merge(array_values($f), [$id]));
			DB::exec("DELETE FROM `{$p}order_items` WHERE order_id = ?", [$id]);
		} else {
			$cust = $email !== '' ? DB::val("SELECT id FROM `{$p}customers` WHERE email = ?", [$email]) : null;
			$cols = array_merge(['customer_id', 'status', 'payment_method'], array_keys($f));
			$vals = array_merge([$cust ?: null, 'pending', 'check'], array_values($f));
			$id = DB::insert(
				"INSERT INTO `{$p}orders` (" . implode(',', array_map(fn($c) => "`$c`", $cols)) . ", created_at)
				 VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ", NOW())",
				$vals
			);
		}
		foreach ($items as $it) {
			DB::exec(
				"INSERT INTO `{$p}order_items` (order_id, product_id, name, price, qty, options_summary, options, weight)
				 VALUES (?,?,?,?,?,?,?,?)",
				[$id, $it['product_id'], $it['name'], $it['price'], $it['qty'], $it['options_summary'], $it['options'], $it['weight']]
			);
		}
		// Keep stock in step with the qty change (-1 = untracked, never touched).
		$delta = [];
		foreach ($old_items as $o) $delta[(int)$o['product_id']] = ($delta[(int)$o['product_id']] ?? 0) - (int)$o['qty'];
		foreach ($items as $it)    $delta[$it['product_id']]      = ($delta[$it['product_id']] ?? 0) + $it['qty'];
		foreach ($delta as $pid => $d) {
			if (!$pid || !$d) continue;
			DB::exec("UPDATE `{$p}products` SET stock = GREATEST(stock - ?, 0) WHERE id = ? AND stock > -1", [$d, $pid]);
		}
		DB::commit();
	} catch (Throwable $e) {
		try { DB::rollback(); } catch (Throwable $e2) {}
		ajax_out(false, 'Could not save the order.');
	}
	$_hook_data = ['order_id' => $id];
	Hook::fire('admin.order.saved', $_hook_data);
	ajax_out(true, 'Order saved.', ['id' => $id]);
}

ajax_out(false, 'Unknown action.');
