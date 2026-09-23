<?php
/**
 * PayPal — create PayPal order from a pending EdgeCart order.
 * Called by paypal-checkout.js after place_order succeeds.
 *
 * POST: order_id (int), csrf_token
 * Returns: { ok, paypal_order_id }
 */
header('Content-Type: application/json');

if (!verify_csrf_token(post('csrf_token'))) {
	echo json_encode(['ok' => false, 'message' => 'Security token expired.']);
	exit;
}

$p        = DB_PREFIX;
$order_id = (int)post('order_id');

// Only allow creating a PayPal order for the order this session actually
// just checked out with — mirrors the same session-ownership check
// stripe/catalog/intent.php uses.
if (!$order_id || $order_id !== (int)($_SESSION['pending_order_id'] ?? 0)) {
	echo json_encode(['ok' => false, 'message' => 'Invalid order.']);
	exit;
}

$order = DB::row("SELECT * FROM `{$p}orders` WHERE id=?", [$order_id]);
if (!$order || $order['status'] === 'paid') {
	echo json_encode(['ok' => false, 'message' => 'Invalid order.']);
	exit;
}

// ── Load credentials ──────────────────────────────────────────────────────────
$mode      = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_mode'") ?: 'sandbox';
$client_id = $mode === 'live'
	? (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_live_client_id'") ?: '')
	: (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_sandbox_client_id'") ?: '');
$secret    = $mode === 'live'
	? (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_live_secret_key'") ?: '')
	: (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_sandbox_secret_key'") ?: '');

if (!$client_id || !$secret) {
	echo json_encode(['ok' => false, 'message' => 'PayPal is not configured.']);
	exit;
}

$base = $mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

// ── Get access token ──────────────────────────────────────────────────────────
$token_ctx = stream_context_create([
	'http' => [
		'method'  => 'POST',
		'header'  => "Authorization: Basic " . base64_encode("{$client_id}:{$secret}") . "\r\n"
		           . "Content-Type: application/x-www-form-urlencoded\r\n",
		'content' => 'grant_type=client_credentials',
		'ignore_errors' => true,
	],
]);
$token_raw = @file_get_contents("{$base}/v1/oauth2/token", false, $token_ctx);
$token_data = $token_raw ? json_decode($token_raw, true) : null;
$access_token = $token_data['access_token'] ?? null;

if (!$access_token) {
	echo json_encode(['ok' => false, 'message' => 'PayPal authentication failed.']);
	exit;
}

// ── Create PayPal order ───────────────────────────────────────────────────────
$currency = strtoupper(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_currency_code'") ?: 'USD');
$total    = number_format((float)$order['total'], 2, '.', '');

$body = json_encode([
	'intent' => 'CAPTURE',
	'purchase_units' => [[
		'reference_id' => (string)$order_id,
		'amount'       => [
			'currency_code' => $currency,
			'value'         => $total,
		],
	]],
	'application_context' => [
		'shipping_preference' => 'NO_SHIPPING',
		'user_action'         => 'PAY_NOW',
	],
]);

$order_ctx = stream_context_create([
	'http' => [
		'method'  => 'POST',
		'header'  => "Authorization: Bearer {$access_token}\r\n"
		           . "Content-Type: application/json\r\n"
		           . "PayPal-Request-Id: ec-order-{$order_id}-" . time() . "\r\n",
		'content' => $body,
		'ignore_errors' => true,
	],
]);
$order_raw  = @file_get_contents("{$base}/v2/checkout/orders", false, $order_ctx);
$order_resp = $order_raw ? json_decode($order_raw, true) : null;

if (empty($order_resp['id'])) {
	$msg = $order_resp['message'] ?? 'Failed to create PayPal order.';
	echo json_encode(['ok' => false, 'message' => $msg]);
	exit;
}

echo json_encode(['ok' => true, 'paypal_order_id' => $order_resp['id']]);
