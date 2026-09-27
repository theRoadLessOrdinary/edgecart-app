<?php
require_once DIR_LIB . 'rate-limit.php';

$p        = DB_PREFIX;
// Never trust a GET/POST order id here — this page previously fell back to
// ?order=<id>, letting anyone view any customer's name/address/order
// contents by guessing a sequential id. checkout.php sets pending_order_id
// in session at order creation, which survives the Stripe/PayPal redirect
// back to this same browser session, so the GET fallback was never actually
// needed for the legitimate flow.
$order_id = (int)($_SESSION['pending_order_id'] ?? 0);

$order = $order_id
	? DB::row("SELECT * FROM `{$p}orders` WHERE id = ?", [$order_id])
	: null;

// ── Capture Stripe payment reference on redirect back ─────────────────────────
$pi_id     = preg_replace('/[^a-zA-Z0-9_]/', '', $_GET['payment_intent'] ?? '');
$pi_status = $_GET['redirect_status'] ?? '';

if ($pi_id && $order && empty($order['payment_ref'])) {
	// Verify with Stripe API before trusting the URL param
	$stripe_mode   = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='stripe_mode'") ?: 'test';
	$stripe_secret = $stripe_mode === 'live'
		? (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='stripe_secret_key'") ?: '')
		: (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='stripe_test_secret_key'") ?: '');

	if ($stripe_secret) {
		$ch = curl_init('https://api.stripe.com/v1/payment_intents/' . $pi_id);
		curl_setopt_array($ch, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_USERPWD        => $stripe_secret . ':',
		]);
		$raw = curl_exec($ch);
		curl_close($ch);

		$pi = $raw ? json_decode($raw, true) : null;
		if ($pi && empty($pi['error']) && $pi['id'] === $pi_id) {
			$verified_status = $pi['status']; // e.g. 'succeeded', 'requires_payment_method'
			// Never mark an order paid on status alone — a legitimate Stripe
			// PaymentIntent could exist for an amount that doesn't match this
			// order's real total (see plugins/stripe/catalog/intent.php,
			// which now always computes amount server-side, but this is the
			// last line of defense if that's ever bypassed or misconfigured).
			$expected_cents = (int)round(((float)$order['total']) * 100);
			$paid_cents     = (int)($pi['amount_received'] ?? $pi['amount'] ?? 0);
			$amount_ok      = $paid_cents === $expected_cents;
			$new_status     = ($verified_status === 'succeeded' && $amount_ok) ? 'paid' : $order['status'];
			DB::exec(
				"UPDATE `{$p}orders` SET payment_ref = ?, status = ? WHERE id = ? AND payment_ref = ''",
				[$pi_id, $new_status, $order['id']]
			);
			$order['payment_ref'] = $pi_id;
			$order['status']      = $new_status;
		}
	}
}

// ── Fire fulfillment directly on a verified paid order ─────────────────────────
// This is the primary path, not just a fallback: it doesn't depend on a Stripe/
// PayPal webhook being configured in the provider's dashboard (which requires
// manual setup outside this codebase and is easy to leave unset). The hook
// itself is idempotent, so this is also safe to run on every page refresh and
// safe alongside a webhook that does fire later.
if ($order && $order['status'] === 'paid') {
	Hook::fire('catalog.order.payment_complete', $order);
}

// Clear cart on every visit
Cart::clear();

// ── POST: create account ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && post('action') === 'create_account') {
	header('Content-Type: application/json');

	if (!verify_csrf_token(post('csrf_token'))) {
		echo json_encode(['ok' => false, 'message' => 'Security token expired. Please try again.']);
		exit;
	}

	// Rate limit: 5 account creation attempts per hour per IP
	$ip = RateLimit::getClientIp();
	$rate_key = 'create_account:' . $ip;
	if (!RateLimit::check($rate_key, 5, 3600)) {
		http_response_code(429);
		echo json_encode(['ok' => false, 'message' => 'Too many account creation attempts. Please try again later.']);
		exit;
	}

	unset($_SESSION['pending_order_id']); // consume after use

	if (!$order) { echo json_encode(['ok' => false, 'message' => 'Order not found.']); exit; }

	$password = trim(post('password'));
	if (strlen($password) < 8) {
		echo json_encode(['ok' => false, 'message' => 'Password must be at least 8 characters.']);
		exit;
	}

	// Orders placed before checkout validated the email could hold anything.
	if (!filter_var($order['ship_email'], FILTER_VALIDATE_EMAIL)) {
		echo json_encode(['ok' => false, 'message' => 'This order does not have a valid email address.']);
		exit;
	}

	$existing = DB::row("SELECT id FROM `{$p}customers` WHERE email = ?", [$order['ship_email']]);
	if ($existing) {
		echo json_encode(['ok' => false, 'message' => 'An account already exists for this email.']);
		exit;
	}

	$customer_id = DB::insert(
		"INSERT INTO `{$p}customers`
		 (email, first_name, last_name, password,
		  address1, city, state, zip, country, created_at)
		 VALUES (?,?,?,?, ?,?,?,?,?, NOW())",
		[
			$order['ship_email'],
			$order['ship_firstname'],
			$order['ship_lastname'],
			password_hash($password, PASSWORD_DEFAULT),
			$order['ship_address1'],
			$order['ship_city'],
			$order['ship_state'],
			$order['ship_zip'],
			$order['ship_country'],
		]
	);

	// Link order to new customer
	DB::exec("UPDATE `{$p}orders` SET customer_id = ? WHERE id = ?", [$customer_id, $order['id']]);

	$_SESSION['customer_id'] = $customer_id;
	echo json_encode(['ok' => true, 'message' => 'Account created! You are now signed in.']);
	exit;
}

catalog_sidebar($smarty);
$smarty->assign('order',        $order);
$smarty->assign('store_address', DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='address'") ?: '');
$smarty->assign('page_type',    'order-complete');
$smarty->display('order-complete.html');
