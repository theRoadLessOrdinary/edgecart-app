<?php
require_once DIR_LIB . 'rate-limit.php';

$token = get('token', '');
$valid_token = false;
$error = '';
$success = false;

// Rate limit: 5 password reset attempts per hour per IP
$ip = RateLimit::getClientIp();
$rate_key = 'admin_reset_password:' . $ip;
if (is_post() && !RateLimit::check($rate_key, 5, 3600)) {
	$error = 'Too many password reset attempts. Please try again in 1 hour.';
}

// Validate token on GET
if (!is_post()) {
	// Clean up expired tokens (older than 24 hours)
	$p = DB_PREFIX;
	DB::exec("DELETE FROM `{$p}admin_password_reset_tokens` WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)");

	if (!$token) {
		$error = 'No reset token provided.';
	} else {
		$reset = DB::row(
			"SELECT rt.admin_id, rt.created_at, a.email, a.username
			 FROM `{$p}admin_password_reset_tokens` rt
			 JOIN `{$p}admin` a ON a.id = rt.admin_id
			 WHERE rt.token = ? AND rt.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
			[$token]
		);

		if ($reset) {
			$valid_token = true;
		} else {
			$error = 'Invalid or expired reset link. <a href="' . URL_ADMIN . '?route=forgot-password" style="color: var(--nc-primary);">Request a new one</a>.';
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
		"SELECT admin_id FROM `{$p}admin_password_reset_tokens`
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
			"UPDATE `{$p}admin` SET password = ? WHERE id = ?",
			[$hashed, $reset['admin_id']]
		);

		// Delete the used token
		DB::exec(
			"DELETE FROM `{$p}admin_password_reset_tokens` WHERE token = ?",
			[$token]
		);

		flash_set('success', 'Password reset successfully. You can now log in with your new password.');
		redirect(URL_ADMIN . '?route=login');
	}
}

$smarty->assign('token',       $token);
$smarty->assign('valid_token', $valid_token);
$smarty->assign('error',       $error);
$smarty->assign('page',        'reset-password');
$smarty->display('reset-password.html');
