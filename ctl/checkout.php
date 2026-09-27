<?php
require_once DIR_LIB . 'rate-limit.php';

$p = DB_PREFIX;

// Redirect if cart empty
$items = Cart::get();
if (empty($items)) {
	header('Location: ' . URL_ROOT . 'cart');
	exit;
}

// Shipping is only needed if at least one cart item is a physical product
$cart_requires_shipping = false;
foreach ($items as $_item) {
	if (!empty($_item['product']['requires_shipping'])) { $cart_requires_shipping = true; break; }
}
unset($_item);

// Fetch logged-in customer data for auto-fill
$customer = null;
if (is_logged_in()) {
	$customer_id = (int)$_SESSION['customer_id'];
	$customer = DB::row(
		"SELECT id, email, first_name, last_name FROM `{$p}customers` WHERE id = ?",
		[$customer_id]
	);
}

// ── POST: place order ─────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && post('action') === 'place_order') {
	header('Content-Type: application/json');

	if (!verify_csrf_token(post('csrf_token'))) {
		echo json_encode(['ok' => false, 'message' => 'Security token expired. Please try again.']);
		exit;
	}

	// Rate limiting: max 10 orders per IP per hour
	$clientIp = RateLimit::getClientIp();
	$rateLimitKey = "order:{$clientIp}";
	if (!RateLimit::check($rateLimitKey, 10, 3600)) {
		http_response_code(429);
		echo json_encode(['ok' => false, 'message' => 'Too many order submissions. Please try again later.']);
		exit;
	}

	$email       = trim(post('email'));
	$phone       = trim(post('phone', ''));
	$first_name  = trim(post('first_name'));
	$last_name   = trim(post('last_name'));
	$address1    = trim(post('address1'));
	$address2    = trim(post('address2'));
	$city        = trim(post('city'));
	$state       = trim(post('state'));
	$zip         = trim(post('zip'));
	$country     = trim(post('country', 'US'));
	$ship_rate   = trim(post('ship_rate_id', ''));
	$ship_price  = (float)post('ship_price', 0);
	$ship_label  = trim(post('ship_label', 'Standard'));
	$ship_token  = trim(post('shippo_token', ''));
	$disc_code   = strtoupper(trim(post('discount_code', '')));
	$tax_amount  = (float)post('tax', 0);
	$payment_method = trim(post('payment_method', ''));

	if (!$email || !$first_name || !$last_name || !$address1 || !$city || !$zip) {
		echo json_encode(['ok' => false, 'message' => 'Please fill in all required fields.']);
		exit;
	}
	// The email ends up in the order, the customer record and the admin, so
	// it must be a real address (this is also what blocks HTML being saved as one).
	if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
		echo json_encode(['ok' => false, 'message' => 'Please enter a valid email address.']);
		exit;
	}

	// Plugin validation — listeners append to $ctx['errors']; post data in $ctx['post']
	$_validate = ['errors' => [], 'post' => $_POST];
	Hook::fire('checkout.place_order.validate', $_validate);
	if (!empty($_validate['errors'])) {
		echo json_encode(['ok' => false, 'message' => implode(' ', $_validate['errors'])]);
		exit;
	}

	// Never accept an order line priced at $0 or less - that's a catalog/option
	// pricing mistake, and a $0 total is auto-marked paid below.
	foreach ($items as $item) {
		if ($item['unit_price'] <= 0) {
			error_log('checkout: blocked $0 line, product_id=' . $item['product_id']);
			echo json_encode(['ok' => false, 'message' => 'Sorry, "' . $item['product']['name'] . '" can\'t be purchased right now. Please contact us.']);
			exit;
		}
	}

	$subtotal = Cart::subtotal();
	// Validate discount code — core logic; plugin can override via checkout.discount.apply.instead
	if ($disc_code) {
		$_disc = Hook::instead('checkout.discount.apply',
			checkout_validate_discount($disc_code, $subtotal),
			['code' => $disc_code, 'subtotal' => $subtotal]
		);
		if ($_disc['error']) {
			echo json_encode(['ok' => false, 'message' => $_disc['error']]);
			exit;
		}
	} else {
		$_disc = ['amount' => 0, 'error' => null];
	}
	$discount_amount = (float)$_disc['amount'];

	// Validate tax is reasonable (sanity check: between 0 and subtotal*0.20)
	$tax_amount = max(0, min($tax_amount, $subtotal * 0.20));

	$total    = max(0, $subtotal + $ship_price + $tax_amount - $discount_amount);

	// Create or find customer if logged in
	$customer_id = is_logged_in() ? ($_SESSION['customer_id'] ?? null) : null;

	// A $0 order (e.g. a 100%-off discount code) never goes through a payment
	// gateway — checkout.html skips the payment step entirely when there's
	// nothing to charge — so nothing would ever move it out of 'pending'.
	// Mark it paid immediately rather than leaving it stuck awaiting a
	// payment that will never happen.
	$initial_status = $total <= 0 ? 'paid' : 'pending';

	// Insert order
	$order_id = DB::insert(
		"INSERT INTO `{$p}orders`
		 (customer_id, ship_email, ship_phone, ship_firstname, ship_lastname,
		  ship_address1, ship_address2, ship_city, ship_state, ship_zip, ship_country,
		  subtotal, shipping, tax, discount_code, discount_amount, total, status, ship_method, shippo_rate_token, payment_method, created_at)
		 VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?, ?,?,?,?,?,?, NOW())",
		[
			$customer_id, $email, $phone, $first_name, $last_name,
			$address1, $address2, $city, $state, $zip, $country,
			$subtotal, $ship_price, $tax_amount, $disc_code ?: null, $discount_amount,
			$total, $initial_status, $ship_label, $ship_token, $payment_method,
		]
	);

	if ($disc_code) {
		checkout_mark_discount_used($disc_code);
	}

	// Insert order items
	foreach ($items as $item) {
		DB::exec(
			"INSERT INTO `{$p}order_items`
			 (order_id, product_id, name, price, qty, options_summary)
			 VALUES (?,?,?,?,?,?)",
			[
				$order_id,
				$item['product_id'],
				$item['product']['name'],
				$item['unit_price'],
				$item['qty'],
				implode(', ', array_map(
					fn($o) => $o['option_name'] . ': ' . $o['value_text'],
					$item['options']
				)),
			]
		);

		// Decrement stock. -1 is this app's "unlimited, don't track" sentinel
		// (see admin/tpl/products/list.html: "-1 disables stock check") — never
		// touch it. GREATEST(...,0) keeps stock from going negative if two
		// orders race past the last unit; it does not reserve stock ahead of
		// time, so a true oversell under concurrency still lands at 0, not a
		// blocked checkout.
		DB::exec(
			"UPDATE `{$p}products` SET stock = GREATEST(stock - ?, 0) WHERE id = ? AND stock > -1",
			[$item['qty'], $item['product_id']]
		);
	}

	// Notify plugins that an order has been created (e.g. save domain for fulfillment)
	$_oc = ['order_id' => $order_id, 'post' => $_POST];
	Hook::fire('checkout.order.created', $_oc);

	// Fetch full order and send confirmation email
	$full_order = DB::row("SELECT * FROM `{$p}orders` WHERE id = ?", [$order_id]);
	if ($full_order) {
		send_order_confirmation_email($full_order);
	}

	$_SESSION['pending_order_id'] = $order_id;

	// Optionally create account
	$password = trim(post('password', ''));
	if (!$customer_id && $password && strlen($password) >= 8) {
		$existing = DB::val("SELECT id FROM `{$p}customers` WHERE email = ?", [$email]);
		if (!$existing) {
			$new_cid = DB::insert(
				"INSERT INTO `{$p}customers`
				 (email, first_name, last_name, password,
				  address1, city, state, zip, country, created_at)
				 VALUES (?,?,?,?,?,?,?,?,?,NOW())",
				[$email, $first_name, $last_name, password_hash($password, PASSWORD_DEFAULT),
				 $address1, $city, $state, $zip, $country]
			);
			DB::exec("UPDATE `{$p}orders` SET customer_id=? WHERE id=?", [$new_cid, $order_id]);
			$_SESSION['customer_id'] = $new_cid;
		}
	}

	echo json_encode([
		'ok'          => true,
		'order_id'    => $order_id,
		'total_cents' => (int)round($total * 100),
		'currency'    => strtolower(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_currency_code'") ?: 'usd'),
		'thankyou_url' => URL_ROOT . 'order-complete',
	]);
	exit;
}

// ── Calculate tax ─────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && post('action') === 'tax_calculation') {
	header('Content-Type: application/json');

	if (!verify_csrf_token(post('csrf_token'))) {
		echo json_encode(['ok' => false, 'message' => 'Security token expired.']);
		exit;
	}

	$state = trim(post('state', ''));
	$country = trim(post('country', 'US'));
	$cart_items = Cart::get();

	$items_for_tax = [];
	foreach ($cart_items as $item) {
		$items_for_tax[] = [
			'taxable'    => $item['product']['taxable'] ?? true,
			'line_total' => $item['line_total'],
		];
	}

	$shipping = (float)post('shipping', 0);
	// A tax-provider plugin (e.g. taxjar) may override this entirely; otherwise
	// fall back to the merchant's own zones/rates from the core Locations & Tax
	// admin screen — tax calculation no longer requires an external plugin.
	if (Hook::hasInstead('checkout.tax.calculate')) {
		$tax = Hook::instead('checkout.tax.calculate', 0.0, [
			'state'    => $state,
			'country'  => $country,
			'items'    => $items_for_tax,
			'shipping' => $shipping,
		]);
	} else {
		$tax = checkout_calculate_tax($state, $country, $items_for_tax, $shipping);
	}

	echo json_encode([
		'ok'         => true,
		'tax'        => round($tax, 2),
		'tax_active' => true,
	]);
	exit;
}

// ── GET shipping rates ────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && post('action') === 'shipping_rates') {
	header('Content-Type: application/json');

	if (!verify_csrf_token(post('csrf_token'))) {
		echo json_encode(['ok' => false, 'message' => 'Security token expired. Please refresh the page.']);
		exit;
	}

	// Rate limiting: max 20 rate requests per IP per hour (generous for checkout)
	$clientIp = RateLimit::getClientIp();
	$rateLimitKey = "shipping:{$clientIp}";
	if (!RateLimit::check($rateLimitKey, 20, 3600)) {
		http_response_code(429);
		echo json_encode(['ok' => false, 'message' => 'Too many requests. Please try again later.']);
		exit;
	}

	$address = [
		'first_name' => trim(post('first_name')),
		'last_name'  => trim(post('last_name')),
		'address1'   => trim(post('address1')),
		'address2'   => trim(post('address2')),
		'city'       => trim(post('city')),
		'state'      => trim(post('state')),
		'zip'        => trim(post('zip')),
		'country'    => trim(post('country', 'US')),
	];

	$rates = Hook::filter('catalog.checkout.shipping_rates', [], [
		'items'   => $items,
		'address' => $address,
	]);

	// If no plugin provides rates, offer a free shipping fallback
	if (empty($rates)) {
		$rates = [[
			'id'      => 'free',
			'carrier' => '',
			'service' => 'Standard Shipping',
			'rate'    => 0.0,
			'days'    => null,
		]];
	}

	// Limit to first 4 shipping options
	$rates = array_slice($rates, 0, 4);

	echo json_encode(['ok' => true, 'rates' => $rates]);
	exit;
}

// ── Render checkout page ──────────────────────────────────────────────────────

// Collect head and script HTML from all active payment plugins
$_pscripts         = Hook::collect('catalog.checkout.payment_scripts');
$payment_head_html = implode("\n", array_filter(array_column($_pscripts, 'head')));
$payment_scripts_html = implode("\n", array_filter(array_column($_pscripts, 'scripts')));

$payment_methods = Hook::filter('catalog.checkout.payment_methods', []);

// Core fallback method — accepting checks/money orders needs no external
// integration, just an admin decision to allow it. Defaults on; only off if
// explicitly disabled in Settings.
$_check_enabled = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='enable_check_payment'");
if ($_check_enabled !== '0') {
	$payment_methods[] = ['id' => 'check', 'label' => 'Check or Money Order', 'icon' => ''];
}

if (empty($payment_methods)) {
	$payment_methods = [['id' => 'cod', 'label' => 'Pay on Delivery', 'icon' => '']];
}

$checkout_extra_fields = implode('', Hook::collect('checkout.extra_fields'));
$smarty->assign('checkout_extra_fields', $checkout_extra_fields);

$checkout_page = DB::row("SELECT * FROM `{$p}pages` WHERE slug='checkout'");
$blocks        = $checkout_page ? hydrate_page_blocks($checkout_page['id'], $p, $smarty) : [];
$sys_content   = $checkout_page ? sys_page_content((int)$checkout_page['id']) : ['before'=>'','after'=>''];

catalog_sidebar($smarty);
$smarty->assign('items',           Cart::get());
$smarty->assign('subtotal',        money(Cart::subtotal()));
$smarty->assign('subtotal_raw',    Cart::subtotal());
$smarty->assign('payment_methods',      $payment_methods);
$smarty->assign('payment_head_html',    $payment_head_html);
$smarty->assign('payment_scripts_html', $payment_scripts_html);
$smarty->assign('page',            $checkout_page ?: []);
$smarty->assign('blocks',          $blocks);
$smarty->assign('customer',        $customer);
$smarty->assign('page_type',       'checkout');
$smarty->assign('content_before',  $sys_content['before']);
$smarty->assign('content_after',   $sys_content['after']);
$smarty->assign('bill_test',       str_contains($_SERVER['HTTP_USER_AGENT'] ?? '', '--bill'));
$smarty->assign('google_oauth_enabled', google_oauth_configured());
$smarty->assign('cart_requires_shipping', $cart_requires_shipping);
$smarty->display('checkout.html');
