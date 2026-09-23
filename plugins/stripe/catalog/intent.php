<?php
/**
 * Stripe — create PaymentIntent
 * route=stripe/intent
 * POST: amount (int cents), currency (str), order_id (int)
 */

header('Content-Type: application/json');

function stripe_setting(string $key): string {
	static $cache = [];
	if (!isset($cache[$key])) {
		$cache[$key] = DB::val("SELECT `value` FROM `" . DB_PREFIX . "settings` WHERE `key` = ?", [$key]) ?: '';
	}
	return $cache[$key];
}

$mode   = stripe_setting('stripe_mode') ?: 'test';
$secret = $mode === 'live'
	? stripe_setting('stripe_secret_key')
	: stripe_setting('stripe_test_secret_key');
if (!$secret) {
	echo json_encode(['ok' => false, 'message' => 'Stripe is not configured.']);
	exit;
}

$order_id = (int)($_POST['order_id'] ?? 0);
$currency = preg_replace('/[^a-z]/', '', strtolower($_POST['currency'] ?? 'usd'));

// Never trust a client-supplied amount — that's the entire checkout total,
// payable to whatever figure the request happens to send. Only allow this
// for the order this session actually just checked out with (mirrors
// order-complete.php's session-ownership check), and compute the amount
// ourselves from the order's real total in the database.
if (!$order_id || $order_id !== (int)($_SESSION['pending_order_id'] ?? 0)) {
	echo json_encode(['ok' => false, 'message' => 'Invalid order.']);
	exit;
}

$order = DB::row("SELECT * FROM `" . DB_PREFIX . "orders` WHERE id = ?", [$order_id]);
if (!$order || $order['status'] === 'paid') {
	echo json_encode(['ok' => false, 'message' => 'Invalid order.']);
	exit;
}

$amount = (int)round(((float)$order['total']) * 100);

if ($amount < 50) {
	echo json_encode(['ok' => false, 'message' => 'Invalid amount.']);
	exit;
}

// Call Stripe API
$ch = curl_init('https://api.stripe.com/v1/payment_intents');
curl_setopt_array($ch, [
	CURLOPT_RETURNTRANSFER => true,
	CURLOPT_POST           => true,
	CURLOPT_USERPWD        => $secret . ':',
	CURLOPT_POSTFIELDS     => http_build_query([
		'amount'               => $amount,
		'currency'             => $currency,
		'metadata[order_id]'   => $order_id,
		// If this Stripe account is shared with another site (same secret
		// key), Stripe delivers every event to every registered webhook
		// regardless of which site created the payment — a bare order_id
		// isn't unique across two separate databases. Tag the site so the
		// webhook can ignore events that aren't its own. Defaults to the
		// domain, but a merchant running one site under several domains can
		// override it with a stable value in the plugin's settings.
		'metadata[site]'       => stripe_setting('stripe_site_tag') ?: ($_SERVER['HTTP_HOST'] ?? ''),
		'automatic_payment_methods[enabled]' => 'true',
	]),
]);
$response = curl_exec($ch);
$err      = curl_error($ch);
curl_close($ch);

if ($err) {
	echo json_encode(['ok' => false, 'message' => 'Payment service unavailable.']);
	exit;
}

$data = json_decode($response, true);
if (!empty($data['error'])) {
	echo json_encode(['ok' => false, 'message' => $data['error']['message'] ?? 'Stripe error.']);
	exit;
}

echo json_encode([
	'ok'            => true,
	'client_secret' => $data['client_secret'],
	'intent_id'     => $data['id'],
]);
