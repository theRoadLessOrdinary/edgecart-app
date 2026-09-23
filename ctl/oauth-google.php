<?php
/**
 * Google OAuth Callback Handler
 *
 * Route: /oauth-google
 * Handles the callback from Google after user authenticates
 */

require_once DIR_LIB . 'oauth-google.php';
require_once DIR_LIB . 'rate-limit.php';

$google = new GoogleOAuth(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);

// Check for errors from Google
if (isset($_GET['error'])) {
  $error = $_GET['error'] . (isset($_GET['error_description']) ? ': ' . $_GET['error_description'] : '');
  error_log('Google OAuth error: ' . $error);
  redirect(URL_ROOT . '?route=login&google_error=' . urlencode($error));
}

// Verify state (CSRF protection)
$state = get('state', '');
error_log('Google OAuth State Debug: received=' . $state . ', stored=' . ($_SESSION['google_oauth_state'] ?? 'NOT SET'));
if (!$state || !$google->verifyState($state)) {
  error_log('Google OAuth: State mismatch');
  redirect(URL_ROOT . '?route=login&google_error=Security check failed');
}

// Get authorization code
$code = get('code', '');
if (!$code) {
  error_log('Google OAuth: No authorization code received');
  redirect(URL_ROOT . '?route=login&google_error=No authorization code');
}

try {
  // Exchange code for token
  $tokens = $google->getAccessToken($code);
  $accessToken = $tokens['access_token'] ?? null;

  if (!$accessToken) {
    throw new Exception('No access token in response');
  }

  // Get user info
  $userInfo = $google->getUserInfo($accessToken);
  $googleId = $userInfo['id'] ?? null;
  $email = strtolower(trim($userInfo['email'] ?? ''));
  $firstName = $userInfo['given_name'] ?? 'Google';
  $lastName = $userInfo['family_name'] ?? 'User';

  if (!$googleId || !$email) {
    throw new Exception('Missing Google ID or email');
  }

  $p = DB_PREFIX;

  // Rate limit: 10 logins per hour per IP
  $ip = RateLimit::getClientIp();
  $rateKey = 'oauth_google_login:' . $ip;
  if (!RateLimit::check($rateKey, 10, 3600)) {
    throw new Exception('Too many login attempts. Please try again later.');
  }

  // Try to find existing customer by google_id
  $customer = DB::row(
    "SELECT * FROM `{$p}customers` WHERE google_id = ?",
    [$googleId]
  );

  // If not found, try by email (account linking)
  if (!$customer) {
    $customer = DB::row(
      "SELECT * FROM `{$p}customers` WHERE email = ?",
      [$email]
    );

    if ($customer) {
      // Link Google ID to existing account
      DB::exec(
        "UPDATE `{$p}customers` SET google_id = ? WHERE id = ?",
        [$googleId, $customer['id']]
      );
    }
  }

  // If still no customer, create new account
  if (!$customer) {
    $passwordHash = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);

    DB::exec(
      "INSERT INTO `{$p}customers` (email, first_name, last_name, password, google_id, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())",
      [$email, $firstName, $lastName, $passwordHash, $googleId]
    );

    $customer = DB::row(
      "SELECT id FROM `{$p}customers` WHERE email = ?",
      [$email]
    );
  }

  // Log in the customer
  if ($customer) {
    RateLimit::reset($rateKey);

    // Snapshot data that must survive session regeneration.
    // session_regenerate_id(true) can silently clear $_SESSION in some PHP builds.
    $cart_backup     = $_SESSION['cart'] ?? null;
    $redirect_backup = session_get('login_redirect', URL_ROOT . 'account');

    session_regenerate_id(true);

    session_set('customer_id', $customer['id']);
    if ($cart_backup !== null) session_set('cart', $cart_backup);
    session_del('login_redirect');

    redirect($redirect_backup);
  } else {
    throw new Exception('Failed to create or retrieve customer');
  }

} catch (Exception $e) {
  error_log('Google OAuth Exception: ' . $e->getMessage());
  redirect(URL_ROOT . '?route=login&google_error=' . urlencode($e->getMessage()));
}
