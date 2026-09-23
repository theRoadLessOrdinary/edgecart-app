<?php
/**
 * Guest order verification and account creation
 * GET: Show form (pre-filled with order# if provided)
 * POST: Verify order + email, create account, log in
 */

require_once DIR_LIB . 'rate-limit.php';

$p = DB_PREFIX;

// GET: Show form
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
	$order_id = (int)get('order', 0);
	catalog_sidebar($smarty);
	$smarty->assign('page_type', 'account-verify');
	$smarty->assign('order_id', $order_id);
	$smarty->display('account-verify.html');
	exit;
}

// POST: Process verification and account creation
header('Content-Type: application/json');

// Rate limit: 5 attempts per 15 minutes per IP
$ip = RateLimit::getClientIp();
if (!RateLimit::check('account_verify:' . $ip, 5, 900)) {
	http_response_code(429);
	ajax_out(false, 'Too many attempts. Please try again in a few minutes.');
}

// Validate CSRF token
if (!verify_csrf_token(post('csrf_token'))) {
	ajax_out(false, 'Security token expired. Please refresh and try again.');
}

$order_id = (int)post('order_id');
$email    = trim(post('email', ''));
$password = trim(post('password', ''));

// Validate input
if (!$order_id || $order_id < 1) {
	ajax_out(false, 'Please enter a valid order number.');
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
	ajax_out(false, 'Please enter a valid email address.');
}
if (strlen($password) < 8) {
	ajax_out(false, 'Password must be at least 8 characters.');
}

// Find order by ID and email
$order = DB::row(
	"SELECT * FROM `{$p}orders` WHERE id = ? AND ship_email = ?",
	[$order_id, $email]
);

if (!$order) {
	ajax_out(false, 'Order not found. Please check your order number and email address.');
}

// Check if account already exists for this email
$existing = DB::row("SELECT id FROM `{$p}customers` WHERE email = ?", [$email]);
if ($existing) {
	ajax_out(false, 'An account already exists for this email address. Please log in with your password.');
}

// Create account
$customer_id = DB::insert(
	"INSERT INTO `{$p}customers`
	 (email, first_name, last_name, password,
	  address1, city, state, zip, country, created_at)
	 VALUES (?,?,?,?, ?,?,?,?,?, NOW())",
	[
		$email,
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

if (!$customer_id) {
	ajax_out(false, 'Error creating account. Please try again.');
}

// Link order to new customer
DB::exec("UPDATE `{$p}orders` SET customer_id = ? WHERE id = ?", [$customer_id, $order_id]);

// Log them in
$_SESSION['customer_id'] = $customer_id;
$_SESSION['customer_email'] = $email;

ajax_out(true, 'Account created! Redirecting to your order...', [
	'redirect' => URL_ROOT . '?route=order-details&id=' . $order_id
]);
