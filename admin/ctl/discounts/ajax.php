<?php
/**
 * admin — discount codes ajax handler
 * route=discounts/ajax
 */

require_admin();
require_once DIR_LIB . 'validation.php';
header('Content-Type: application/json');

require_csrf_token_json();

function generate_discount_code(): string {
	// Format: YMD + 9-char random (0-9, B-Z, no vowels A,E,I,O,U, no F,K,Q)
	$allowed = '0123456789BCDFGHJLMNPRSTVWXYZ'; // 28 chars
	$code = date('Ymd');
	for ($i = 0; $i < 9; $i++) {
		$code .= $allowed[random_int(0, strlen($allowed) - 1)];
	}
	return $code;
}

$p      = DB_PREFIX;
$action = post('action');

// ── List ───────────────────────────────────────────────────────────────────────
if ($action === 'list') {
	$rows  = DB::rows("
		SELECT id, code, type, amount, min_order_amount,
		       single_use, usage_limit, used_count,
		       active_from, active_until, status, created_at
		FROM `{$p}discount_codes`
		ORDER BY created_at DESC
	");
	$limitCheck = check_discount_limit($p);
	ajax_out(true, '', ['rows' => $rows, 'limit' => $limitCheck['limit'], 'count' => count($rows)]);
}

// ── Get single ────────────────────────────────────────────────────────────────
if ($action === 'get') {
	$id  = (int)post('id');
	$row = DB::row("SELECT * FROM `{$p}discount_codes` WHERE id = ?", [$id]);
	if (!$row) ajax_out(false, 'Discount code not found.');
	ajax_out(true, '', ['row' => $row]);
}

// ── Save (insert or update) ────────────────────────────────────────────────────
if ($action === 'save') {
	require_access(ACCESS_EDIT);

	$id               = (int)post('id');
	$code             = strtoupper(trim(post('code')));
	$type             = post('type');
	$amount           = (float)post('amount');
	$min_order_amount = post('min_order_amount') !== '' ? (float)post('min_order_amount') : null;
	$single_use       = (int)(bool)post('single_use');
	$usage_limit      = post('usage_limit') !== '' ? (int)post('usage_limit') : null;
	$active_from      = trim(post('active_from'));
	$active_until     = post('active_until') !== '' ? trim(post('active_until')) : null;
	$status           = (int)(bool)post('status');

	if (!$code) ajax_out(false, 'Code is required.');
	if (!preg_match('/^[A-Z0-9]{6,20}$/', $code)) {
		ajax_out(false, 'Code must be 6-20 uppercase alphanumeric characters.');
	}
	if (!in_array($type, ['percent', 'fixed'], true)) {
		ajax_out(false, 'Invalid discount type.');
	}
	if ($amount <= 0) ajax_out(false, 'Amount must be greater than 0.');
	if ($type === 'percent' && $amount > 100) {
		ajax_out(false, 'Percent discount cannot exceed 100.');
	}
	if (!Validation::date($active_from)) {
		ajax_out(false, 'Active from date is invalid.');
	}
	if ($active_until && !Validation::date($active_until)) {
		ajax_out(false, 'Active until date is invalid.');
	}
	if ($active_until && $active_until < $active_from) {
		ajax_out(false, 'Active until must be after active from.');
	}
	if ($min_order_amount !== null && $min_order_amount < 0) {
		ajax_out(false, 'Minimum order amount cannot be negative.');
	}
	if ($usage_limit !== null && $usage_limit < 1) {
		ajax_out(false, 'Usage limit must be at least 1.');
	}

	if ($id) {
		DB::exec(
			"UPDATE `{$p}discount_codes` SET
			 type=?, amount=?, min_order_amount=?,
			 single_use=?, usage_limit=?,
			 active_from=?, active_until=?, status=?
			 WHERE id=?",
			[$type, $amount, $min_order_amount,
			 $single_use, $usage_limit,
			 $active_from, $active_until, $status, $id]
		);
	} else {
		require_access(ACCESS_ADD);

		// Enforce limit
		$limitCheck = check_discount_limit($p);
		if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);

		$existing = DB::val("SELECT id FROM `{$p}discount_codes` WHERE code = ?", [$code]);
		if ($existing) ajax_out(false, 'A discount code with this code already exists.');

		DB::insert(
			"INSERT INTO `{$p}discount_codes`
			 (code, type, amount, min_order_amount,
			  single_use, usage_limit,
			  active_from, active_until, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[$code, $type, $amount, $min_order_amount,
			 $single_use, $usage_limit,
			 $active_from, $active_until, $status]
		);
	}

	$row = DB::row(
		"SELECT id, code, type, amount, min_order_amount,
		        single_use, usage_limit, used_count,
		        active_from, active_until, status, created_at
		 FROM `{$p}discount_codes` WHERE code = ?",
		[$code]
	);

	ajax_out(true, $id ? 'Discount code updated.' : 'Discount code created.', ['row' => $row]);
}

// ── Generate code ─────────────────────────────────────────────────────────────
if ($action === 'generate_code') {
	$code  = generate_discount_code();
	$tries = 0;
	while (DB::val("SELECT id FROM `{$p}discount_codes` WHERE code = ?", [$code]) && $tries < 10) {
		$code = generate_discount_code();
		$tries++;
	}
	ajax_out(true, '', ['code' => $code]);
}

// ── Toggle status ─────────────────────────────────────────────────────────────
if ($action === 'toggle') {
	require_access(ACCESS_EDIT);
	$id    = (int)post('id');
	$value = (int)post('value');
	DB::exec("UPDATE `{$p}discount_codes` SET status = ? WHERE id = ?", [$value, $id]);
	ajax_out(true, '');
}

// ── Delete ────────────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}discount_codes` WHERE id = ?", [$id]);
	ajax_out(true, 'Discount code deleted.');
}

// ── Bulk delete ───────────────────────────────────────────────────────────────
if ($action === 'bulk_delete') {
	require_access(ACCESS_DELETE);
	$ids = json_decode(post('ids') ?: '[]', true);
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'No codes selected.');
	$ids          = array_map('intval', $ids);
	$placeholders = implode(',', array_fill(0, count($ids), '?'));
	DB::exec("DELETE FROM `{$p}discount_codes` WHERE id IN ({$placeholders})", $ids);
	ajax_out(true, count($ids) . ' discount code' . (count($ids) === 1 ? '' : 's') . ' deleted.');
}

ajax_out(false, 'Unknown action.');
