<?php
require_once DIR_LIB . 'rate-limit.php';

// My Account — requires login
if (!is_logged_in()) {
	$_SESSION['login_redirect'] = URL_ROOT . 'account';
	redirect(URL_ROOT . '?route=login');
}

$customer_id = (int)$_SESSION['customer_id'];
$message = '';
$error = '';

// Fetch customer data
$p = DB_PREFIX;
$customer = DB::row(
	"SELECT id, email, first_name, last_name, address1, city, state, zip, country, created_at, google_id, password
	 FROM `{$p}customers` WHERE id = ?",
	[$customer_id]
);

// Session pointed at a customer that no longer exists (deleted account, stale/orphaned
// session, etc.) — treat the same as not being logged in rather than rendering the page
// with a null $customer.
if (!$customer) {
	unset($_SESSION['customer_id']);
	$_SESSION['login_redirect'] = URL_ROOT . 'account';
	redirect(URL_ROOT . '?route=login');
}

// Handle email update via AJAX
if (is_post() && post('action') === 'update_email') {
	header('Content-Type: application/json');
	require_csrf_token_json();

	// Rate limit: 5 email changes per hour per IP
	$ip = RateLimit::getClientIp();
	$rate_key = 'account_email:' . $ip;
	if (!RateLimit::check($rate_key, 5, 3600)) {
		echo json_encode(['ok' => false, 'message' => 'Too many email change attempts. Please try again in 1 hour.']);
		exit;
	}

	$new_email = trim(strtolower(post('email', '')));
	if (!filter_var($new_email, FILTER_VALIDATE_EMAIL)) {
		echo json_encode(['ok' => false, 'message' => 'Please enter a valid email address.']);
		exit;
	}

	// Check if email already in use by another customer
	$existing = DB::row("SELECT id FROM `{$p}customers` WHERE email = ? AND id != ?", [$new_email, $customer_id]);
	if ($existing) {
		echo json_encode(['ok' => false, 'message' => 'This email is already in use by another account.']);
		exit;
	}

	// Update email
	DB::exec("UPDATE `{$p}customers` SET email = ? WHERE id = ?", [$new_email, $customer_id]);
	$customer['email'] = $new_email;
	echo json_encode(['ok' => true, 'message' => 'Email updated successfully.']);
	exit;
}

// Regenerate an expired/exhausted download link via AJAX
if (is_post() && post('action') === 'regenerate_download') {
	header('Content-Type: application/json');
	require_csrf_token_json();

	// Rate limit: 10 regenerations per hour per IP
	$ip = RateLimit::getClientIp();
	$rate_key = 'account_regen_download:' . $ip;
	if (!RateLimit::check($rate_key, 10, 3600)) {
		echo json_encode(['ok' => false, 'message' => 'Too many attempts. Please try again in 1 hour.']);
		exit;
	}

	$token_id = (int)post('token_id');
	$existing = DB::row(
		"SELECT dt.id FROM `{$p}download_tokens` dt
		 JOIN `{$p}orders` o ON o.id = dt.order_id
		 WHERE dt.id = ? AND o.customer_id = ?",
		[$token_id, $customer_id]
	);
	if (!$existing) {
		echo json_encode(['ok' => false, 'message' => 'Download not found.']);
		exit;
	}

	$expiry_days = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='dd_expiry_days'") ?: 30);
	$max_dl      = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='dd_max_downloads'") ?: 5);
	$new_token   = bin2hex(random_bytes(32));

	DB::exec(
		"UPDATE `{$p}download_tokens`
		 SET token = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? DAY), download_count = 0, max_downloads = ?
		 WHERE id = ?",
		[$new_token, $expiry_days, $max_dl, $token_id]
	);

	echo json_encode([
		'ok'  => true,
		'url' => URL_ROOT . '?route=digital-download/download&token=' . $new_token,
	]);
	exit;
}

// Handle password change (optional field — only if filled)
if (is_post()) {
	require_csrf_token_json();

	// Rate limit: 5 password change attempts per hour per IP
	$ip = RateLimit::getClientIp();
	$rate_key = 'account_password:' . $ip;
	if (!RateLimit::check($rate_key, 5, 3600)) {
		$error = 'Too many password change attempts. Please try again in 1 hour.';
	} else {
		$new_password = post('new_password', '');

	if ($new_password) {
		if (strlen($new_password) < 8) {
			$error = 'Password must be at least 8 characters.';
		} else {
			$new_password_confirm = post('new_password_confirm', '');
			if ($new_password !== $new_password_confirm) {
				$error = 'Passwords do not match.';
			} else {
				$hashed = password_hash($new_password, PASSWORD_DEFAULT);
				DB::query(
					"UPDATE `{$p}customers` SET password = ? WHERE id = ?",
					[$hashed, $customer_id]
				);
				$message = 'Password changed successfully.';
			}
		}
		}
	}
}

// Handle account linking/unlinking via AJAX
if (is_post() && post('action') === 'unlink_google') {
	header('Content-Type: application/json');
	require_csrf_token_json();

	// Check if they have a password set (need at least one login method)
	if (!$customer['password'] || empty($customer['password'])) {
		echo json_encode(['ok' => false, 'message' => 'You must set a password before unlinking Google.']);
		exit;
	}

	// Unlink Google
	DB::exec("UPDATE `{$p}customers` SET google_id = NULL WHERE id = ?", [$customer_id]);
	$customer['google_id'] = null;
	echo json_encode(['ok' => true, 'message' => 'Google account unlinked.']);
	exit;
}

// Fetch order history
$orders = DB::rows(
	"SELECT id, created_at, total, status
	 FROM `{$p}orders`
	 WHERE customer_id = ?
	 ORDER BY created_at DESC
	 LIMIT 20",
	[$customer_id]
);

// Digital download links per order, so the checkout copy's promise of "get your
// files later" from the account page is actually true — see project-todos.md.
$downloads_by_order = [];
$order_ids = array_column($orders, 'id');
if ($order_ids) {
	$ph = implode(',', array_fill(0, count($order_ids), '?'));
	$download_rows = DB::rows(
		"SELECT dt.id, dt.order_id, dt.token, dt.expires_at, dt.download_count, dt.max_downloads,
		        df.filename, df.label
		 FROM `{$p}download_tokens` dt
		 JOIN `{$p}digital_files` df ON df.id = dt.file_id
		 WHERE dt.order_id IN ($ph)
		 ORDER BY dt.id ASC",
		$order_ids
	);
	foreach ($download_rows as $row) {
		$row['is_valid'] = strtotime($row['expires_at']) >= time() && (int)$row['download_count'] < (int)$row['max_downloads'];
		$downloads_by_order[$row['order_id']][] = $row;
	}
}

catalog_sidebar($smarty);
$_acct_page     = DB::row("SELECT id FROM `{$p}pages` WHERE page_type='account' LIMIT 1");
$_acct_surround = $_acct_page ? sys_page_content((int)$_acct_page['id']) : ['before'=>'','after'=>''];
$smarty->assign('content_before', $_acct_surround['before']);
$smarty->assign('content_after',  $_acct_surround['after']);
$smarty->assign('customer',  $customer);
$smarty->assign('orders',    $orders);
$smarty->assign('downloads_by_order', $downloads_by_order);
$smarty->assign('message',   $message);
$smarty->assign('error',     $error);
$smarty->assign('page_type', 'account');
$smarty->assign('google_oauth_enabled', google_oauth_configured());
$smarty->display('account.html');
