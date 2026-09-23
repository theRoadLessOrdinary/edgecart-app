<?php
require_once DIR_LIB . 'rate-limit.php';

$token = get('token', '');
$valid_token = false;
$customer = null;
$error = '';
$success = false;

// Rate limit: 5 password reset attempts per hour per IP
$ip = RateLimit::getClientIp();
$rate_key = 'reset_password:' . $ip;
if (is_post() && !RateLimit::check($rate_key, 5, 3600)) {
	$error = 'Too many password reset attempts. Please try again in 1 hour.';
}

// Validate token on GET
if (!is_post()) {
	// Clean up expired tokens (older than 24 hours)
	$p = DB_PREFIX;
	DB::exec("DELETE FROM `{$p}password_reset_tokens` WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)");

	if (!$token) {
		$error = 'No reset token provided.';
	} else {
		$reset = DB::row(
			"SELECT rt.customer_id, rt.created_at, c.email, c.first_name
			 FROM `{$p}password_reset_tokens` rt
			 JOIN `{$p}customers` c ON rt.customer_id = c.id
			 WHERE rt.token = ? AND rt.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
			[$token]
		);

		if ($reset) {
			$valid_token = true;
			$customer = $reset;
		} else {
			$error = 'Invalid or expired reset link. <a href="' . URL_ROOT . '?route=forgot-password" style="color: #2563eb;">Request a new one</a>.';
		}
	}
}

// Handle password reset POST
if (is_post() && !$error) {
	require_csrf_token();

	$token = post('token', '');
	$password = post('password', '');
	$password_confirm = post('password_confirm', '');

	// Validate token
	$p = DB_PREFIX;
	$reset = DB::row(
		"SELECT customer_id FROM `{$p}password_reset_tokens`
		 WHERE token = ? AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
		[$token]
	);

	if (!$reset) {
		$error = 'Invalid or expired reset link.';
	} elseif (strlen($password) < 8) {
		$error = 'Password must be at least 8 characters.';
	} elseif ($password !== $password_confirm) {
		$error = 'Passwords do not match.';
	} else {
		// Update password
		$hashed = password_hash($password, PASSWORD_DEFAULT);
		DB::exec(
			"UPDATE `{$p}customers` SET password = ? WHERE id = ?",
			[$hashed, $reset['customer_id']]
		);

		// Delete the used token
		DB::exec(
			"DELETE FROM `{$p}password_reset_tokens` WHERE token = ?",
			[$token]
		);

		$success = true;
		flash_set('success', 'Password reset successfully. You can now log in with your new password.');
		redirect(URL_ROOT . '?route=login');
	}
}

$smarty->assign('token',       $token);
$smarty->assign('valid_token', $valid_token);
$smarty->assign('error',       $error);
$smarty->assign('page',        'reset-password');
$smarty->display('reset-password.html');
