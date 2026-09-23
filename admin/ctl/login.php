<?php
require_once DIR_LIB . 'rate-limit.php';

if (is_admin()) {
	$dest = in_array('dashboard', PluginLoader::loaded()) ? 'dashboard' : 'orders';
	redirect(URL_ADMIN . '?route=' . $dest);
}

$error = '';

if (is_post()) {
	require_csrf_token();
	$ip = RateLimit::getClientIp();
	$rate_key = 'login:' . $ip;

	// Rate limit: max 5 attempts per 15 minutes per IP
	if (!RateLimit::check($rate_key, 5, 900)) {
		$error = 'Too many login attempts. Please try again in 15 minutes.';
	} else {
		$username = trim(post('username'));
		$password = post('password');

		$admin = DB::row(
			"SELECT * FROM `" . DB_PREFIX . "admin` WHERE username = ? AND status = 1",
			[$username]
		);

		if ($admin && password_verify($password, $admin['password'])) {
			RateLimit::reset($rate_key);
			session_regenerate_id(true);
			session_set('admin_id',       $admin['id']);
			session_set('admin_username', $admin['username']);
			session_set('admin_access',   (int)($admin['access_level'] ?? ACCESS_ADMIN));
			session_set('admin_avatar',   $admin['avatar'] ?? '');
			session_set('admin_login_at',    time());
			session_set('admin_last_active', time());
			$dest = in_array('dashboard', PluginLoader::loaded()) ? 'dashboard' : 'orders';
			redirect(URL_ADMIN . '?route=' . $dest);
		}

		$error = 'Invalid username or password.';
	}
}

$smarty->assign('error',    $error);
$smarty->assign('page',     'login');
$smarty->display('login.html');
