<?php
/**
 * Google OAuth Initiation
 *
 * Route: /google-oauth
 * Redirects user to Google login page
 */

require_once DIR_LIB . 'oauth-google.php';

// Store the referrer page so we can redirect back after login
if (isset($_GET['next'])) {
  $_SESSION['login_redirect'] = URL_ROOT . get('next', 'account');
} elseif (!isset($_SESSION['login_redirect'])) {
  $referer = $_SERVER['HTTP_REFERER'] ?? '';
  // Only use referer if it's an internal URL — prevents open-redirect via spoofed header
  $_SESSION['login_redirect'] = (strpos($referer, URL_ROOT) === 0) ? $referer : URL_ROOT . 'account';
}

try {
  $google = new GoogleOAuth(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  $authUrl = $google->getAuthUrl();
  error_log("Google OAuth redirect to: " . $authUrl);
  redirect($authUrl);
} catch (Exception $e) {
  error_log("Google OAuth error: " . $e->getMessage());
  redirect(URL_ROOT . 'checkout');
}
