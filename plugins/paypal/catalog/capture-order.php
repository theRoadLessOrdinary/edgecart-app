<?php
/**
 * PayPal — capture an approved PayPal order and mark the EdgeCart order paid.
 *
 * POST: paypal_order_id (string), order_id (int), csrf_token
 * Returns: { ok, redirect_url }
 */
header('Content-Type: application/json');

if (!verify_csrf_token(post('csrf_token'))) {
	echo json_encode(['ok' => false, 'message' => 'Security token expired.']);
	exit;
}

$p              = DB_PREFIX;
$paypal_oid     = trim(post('paypal_order_id'));
$order_id       = (int)post('order_id');

if (!$paypal_oid || !$order_id) {
	echo json_encode(['ok' => false, 'message' => 'Missing parameters.']);
	exit;
}

// Only allow capturing against the order this session actually just
// checked out with — mirrors the same session-ownership check
// stripe/catalog/intent.php uses.
if ($order_id !== (int)($_SESSION['pending_order_id'] ?? 0)) {
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
$token_raw  = @file_get_contents("{$base}/v1/oauth2/token", false, $token_ctx);
$token_data = $token_raw ? json_decode($token_raw, true) : null;
$access_token = $token_data['access_token'] ?? null;

if (!$access_token) {
	echo json_encode(['ok' => false, 'message' => 'PayPal authentication failed.']);
	exit;
}

// ── Capture the PayPal order ──────────────────────────────────────────────────
$cap_ctx = stream_context_create([
	'http' => [
		'method'  => 'POST',
		'header'  => "Authorization: Bearer {$access_token}\r\n"
		           . "Content-Type: application/json\r\n"
		           . "PayPal-Request-Id: ec-capture-{$order_id}-" . time() . "\r\n",
		'content' => '{}',
		'ignore_errors' => true,
	],
]);
$url      = "{$base}/v2/checkout/orders/{$paypal_oid}/capture";
$cap_raw  = @file_get_contents($url, false, $cap_ctx);
$cap_resp = $cap_raw ? json_decode($cap_raw, true) : null;

if (($cap_resp['status'] ?? '') !== 'COMPLETED') {
	$msg = $cap_resp['message'] ?? 'PayPal capture failed.';
	echo json_encode(['ok' => false, 'message' => $msg]);
	exit;
}

// ── Verify the actually-captured amount/reference before trusting COMPLETED ───
// A COMPLETED status alone doesn't prove this capture was for the right
// order or the right amount — create-order.php sets reference_id and amount
// from the order's real total, but re-check what PayPal actually captured
// rather than trusting that nothing tampered with the approval in between.
$captured_ref    = $cap_resp['purchase_units'][0]['reference_id'] ?? null;
$captured_amount = $cap_resp['purchase_units'][0]['payments']['captures'][0]['amount']['value'] ?? null;
$expected_amount = number_format((float)$order['total'], 2, '.', '');

if ($captured_ref !== (string)$order_id || $captured_amount !== $expected_amount) {
	echo json_encode(['ok' => false, 'message' => 'Payment verification failed.']);
	exit;
}

// ── Mark order paid and fire hook ─────────────────────────────────────────────
DB::exec("UPDATE `{$p}orders` SET status='paid', updated_at=NOW() WHERE id=?", [$order_id]);

$capture_id = $cap_resp['purchase_units'][0]['payments']['captures'][0]['id'] ?? '';
$_hook_data = ['order_id' => $order_id, 'gateway' => 'paypal', 'capture_id' => $capture_id];
Hook::fire('catalog.order.payment_complete', $_hook_data);

Cart::clear();

echo json_encode([
	'ok'           => true,
	'redirect_url' => URL_ROOT . 'order-complete',
]);
