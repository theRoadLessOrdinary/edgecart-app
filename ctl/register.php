<?php
require_once DIR_LIB . 'rate-limit.php';

if (is_logged_in()) {
	redirect(URL_ROOT . 'account');
}

$error = '';
$is_ajax = !empty($_SERVER['HTTP_X_REQUESTED_WITH']) && $_SERVER['HTTP_X_REQUESTED_WITH'] === 'XMLHttpRequest';
$p = DB_PREFIX;

if (is_post()) {
	if (!verify_csrf_token(post('csrf_token'))) {
		$error = 'Security token invalid. Please try again.';
	} else {
		$ip = RateLimit::getClientIp();
		$rate_key = 'customer_register:' . $ip;

		if (!RateLimit::check($rate_key, 5, 900)) {
			$error = 'Too many attempts. Please try again in 15 minutes.';
		} else {
			$email      = strtolower(trim(post('email')));
			$first_name = trim(post('first_name'));
			$last_name  = trim(post('last_name'));
			$password   = post('password', '');
			$confirm    = post('password_confirm', '');

			if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
				$error = 'Please enter a valid email address.';
			} elseif ($first_name === '' || $last_name === '') {
				$error = 'Please enter your first and last name.';
			} elseif (strlen($password) < 8) {
				$error = 'Password must be at least 8 characters.';
			} elseif ($password !== $confirm) {
				$error = 'Passwords do not match.';
			} else {
				$existing = DB::val("SELECT id FROM `{$p}customers` WHERE email = ?", [$email]);
				if ($existing) {
					$error = 'An account already exists for this email address. Please log in instead.';
				} else {
					$customer_id = DB::insert(
						"INSERT INTO `{$p}customers` (email, first_name, last_name, password, created_at)
						 VALUES (?,?,?,?,NOW())",
						[$email, $first_name, $last_name, password_hash($password, PASSWORD_DEFAULT)]
					);

					$cart_backup     = $_SESSION['cart'] ?? null;
					$redirect_backup = session_get('login_redirect', URL_ROOT . 'account');

					session_regenerate_id(true);

					session_set('customer_id', $customer_id);
					if ($cart_backup !== null) session_set('cart', $cart_backup);
					session_del('login_redirect');

					if ($is_ajax) {
						header('Content-Type: application/json');
						echo json_encode(['ok' => true, 'redirect' => $redirect_backup]);
						exit;
					} else {
						redirect($redirect_backup);
					}
				}
			}
		}
	}

	if ($is_ajax) {
		header('Content-Type: application/json');
		http_response_code(400);
		echo json_encode(['ok' => false, 'message' => $error]);
		exit;
	}
}

$smarty->assign('error',           $error);
$smarty->assign('login_providers', Hook::collect('account.login.providers'));
$smarty->assign('page',            'register');
$smarty->display('register.html');
