<?php
require_once DIR_LIB . 'rate-limit.php';

if (is_logged_in()) {
	redirect(URL_ROOT . 'account');
}

$error = '';
$is_ajax = !empty($_SERVER['HTTP_X_REQUESTED_WITH']) && $_SERVER['HTTP_X_REQUESTED_WITH'] === 'XMLHttpRequest';

if (is_post()) {
	// Verify CSRF token
	if (!verify_csrf_token(post('csrf_token'))) {
		$error = 'Security token invalid. Please try again.';
	} else {
		$ip = RateLimit::getClientIp();
		$rate_key = 'customer_login:' . $ip;

		// Rate limit: max 5 attempts per 15 minutes per IP
		if (!RateLimit::check($rate_key, 5, 900)) {
			$error = 'Too many login attempts. Please try again in 15 minutes.';
		} else {
			$email = strtolower(trim(post('email')));
			$password = post('password');

			$customer = DB::row(
				"SELECT id, email, first_name, last_name, password FROM `" . DB_PREFIX . "customers` WHERE email = ?",
				[$email]
			);

			if ($customer && password_verify($password, $customer['password'] ?? '')) {
				RateLimit::reset($rate_key);

				$cart_backup     = $_SESSION['cart'] ?? null;
				$redirect_backup = session_get('login_redirect', URL_ROOT . 'account');

				session_regenerate_id(true);

				session_set('customer_id', $customer['id']);
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

			$error = 'Invalid email or password.';
		}
	}

	// Return JSON error for AJAX requests
	if ($is_ajax) {
		header('Content-Type: application/json');
		http_response_code(401);
		echo json_encode(['ok' => false, 'message' => $error]);
		exit;
	}
}

$smarty->assign('error',           $error);
$smarty->assign('login_providers', Hook::collect('account.login.providers'));
$smarty->assign('page',            'login');
$smarty->display('login.html');
