<?php
/**
 * Stripe webhook endpoint
 * route=stripe/webhook
 * Verifies signature, handles payment_intent.succeeded
 */

$payload    = file_get_contents('php://input');
$sig_header = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
// Test and Live mode each get their own webhook endpoint in Stripe, signed
// with a different secret — mirror the same mode branching intent.php and
// order-complete.php already use for the publishable/secret keys.
$_p         = DB_PREFIX;
$_mode      = DB::val("SELECT `value` FROM `{$_p}settings` WHERE `key`='stripe_mode'") ?: 'test';
$secret_key = $_mode === 'live' ? 'stripe_webhook_secret' : 'stripe_test_webhook_secret';
$secret     = DB::val("SELECT `value` FROM `{$_p}settings` WHERE `key` = ?", [$secret_key]) ?: '';

if (!$secret) {
	http_response_code(500);
	exit('Webhook secret not configured.');
}

if ($secret) {
	// Verify Stripe signature
	$parts     = [];
	foreach (explode(',', $sig_header) as $part) {
		[$k, $v]    = explode('=', $part, 2);
		$parts[$k][] = $v;
	}
	$timestamp  = $parts['t'][0] ?? 0;
	$signatures = $parts['v1'] ?? [];
	$signed     = $timestamp . '.' . $payload;
	$expected   = hash_hmac('sha256', $signed, $secret);

	$valid = false;
	foreach ($signatures as $sig) {
		if (hash_equals($expected, $sig)) { $valid = true; break; }
	}

	if (!$valid || (time() - (int)$timestamp) > 300) {
		http_response_code(400);
		exit('Invalid signature.');
	}
}

$event = json_decode($payload, true);
if (!$event) { http_response_code(400); exit('Bad payload.'); }

if ($event['type'] === 'payment_intent.succeeded') {
	$intent = $event['data']['object'];

	// If this Stripe account is shared with another site, this endpoint
	// receives that site's events too — a bare order_id isn't unique across
	// two separate databases. Silently ignore anything not tagged for this
	// site; its own webhook (if registered) will pick it up instead. Same
	// site-tag lookup as intent.php: a configured stripe_site_tag setting
	// wins, otherwise fall back to the domain.
	$this_site  = DB::val("SELECT `value` FROM `{$_p}settings` WHERE `key`='stripe_site_tag'") ?: ($_SERVER['HTTP_HOST'] ?? '');
	$event_site = $intent['metadata']['site'] ?? '';
	if ($event_site !== '' && $event_site !== $this_site) {
		http_response_code(200);
		exit('ok (different site)');
	}

	$order_id = (int)($intent['metadata']['order_id'] ?? 0);

	if ($order_id) {
		$p     = DB_PREFIX;
		$order = DB::row("SELECT * FROM `{$p}orders` WHERE id=?", [$order_id]);

		// Last line of defense: never mark an order paid without confirming
		// the amount Stripe actually collected matches this order's real
		// total. intent.php computes the amount server-side now, but a
		// signed webhook event alone proves *a* payment succeeded, not that
		// it was for the right amount — don't skip this even though it's
		// normally redundant with intent.php's own check.
		$expected_cents = $order ? (int)round(((float)$order['total']) * 100) : null;
		$paid_cents     = (int)($intent['amount_received'] ?? $intent['amount'] ?? 0);

		if ($order && $expected_cents !== null && $paid_cents === $expected_cents) {
			DB::exec(
				"UPDATE `{$p}orders` SET status='paid', payment_ref=? WHERE id=?",
				[$intent['id'], $order_id]
			);
			$order['status']      = 'paid';
			$order['payment_ref'] = $intent['id'];
			Hook::fire('catalog.order.payment_complete', $order);
		}
	}
}

http_response_code(200);
echo 'ok';
