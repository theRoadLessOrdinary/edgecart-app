<?php
require_once DIR_LIB . 'rate-limit.php';

$message = '';
$sent = false;

if (is_post()) {
	require_csrf_token();

	// Rate limit: 5 password reset requests per hour per IP
	$ip = RateLimit::getClientIp();
	$rate_key = 'forgot_password:' . $ip;
	if (!RateLimit::check($rate_key, 5, 3600)) {
		$message = 'Too many password reset requests. Please try again in 1 hour.';
		$sent = true; // Show message but don't reveal rate limit
	} else {
		$email = strtolower(trim(post('email')));

		// Look up customer by email
		$customer = DB::row(
			"SELECT id, first_name FROM `" . DB_PREFIX . "customers` WHERE email = ?",
			[$email]
		);

		if ($customer) {
			// Generate reset token
			$token = bin2hex(random_bytes(32));

			// Store token in database (set to expire in 24 hours)
			DB::exec(
				"INSERT INTO `" . DB_PREFIX . "password_reset_tokens` (customer_id, token, created_at) VALUES (?, ?, NOW())",
				[$customer['id'], $token]
			);

			// Send reset email — name the site up front (subject + opening line),
			// not just the sign-off, since someone running more than one store
			// with the same email could otherwise mix up which link goes where.
			$reset_url = absolute_url(URL_ROOT) . '?route=reset-password&token=' . urlencode($token);
			$email_body = "Hello " . ($customer['first_name'] ?: 'Valued Customer') . ",\n\n";
			$email_body .= "We received a request to reset your " . SITE_NAME . " account password. Click the link below to set a new password:\n\n";
			$email_body .= $reset_url . "\n\n";
			$email_body .= "This link will expire in 24 hours.\n\n";
			$email_body .= "If you didn't request a password reset, you can ignore this email.\n\n";
			$email_body .= "Best regards,\n" . SITE_NAME;

			$mail_sent = nc_mail(
				$email,
				'Reset Your Password — ' . SITE_NAME,
				$email_body,
				'',
				false
			);
		}

		// Always show "check your email" message (don't reveal if email exists)
		$sent = true;
		$message = 'If that email exists in our system, you\'ll receive a password reset link shortly.';
	}
}

$smarty->assign('sent',    $sent);
$smarty->assign('message', $message);
$smarty->assign('page',    'forgot-password');
$smarty->display('forgot-password.html');
