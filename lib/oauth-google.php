<?php
/**
 * Google OAuth 2.0 Handler
 *
 * Manages login flow with Google
 */

class GoogleOAuth {
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo';

  private $clientId;
  private $clientSecret;
  private $redirectUri;

  public function __construct($clientId, $clientSecret, $redirectUri) {
    $this->clientId = $clientId;
    $this->clientSecret = $clientSecret;
    $this->redirectUri = $redirectUri;
  }

  /**
   * Generate authorization URL (redirect user here)
   */
  public function getAuthUrl($state = null) {
    // Reuse an existing pending state so that double-clicks or browser
    // prefetches don't overwrite it, causing a mismatch on the callback.
    $state = $state ?? $_SESSION['google_oauth_state'] ?? bin2hex(random_bytes(16));
    $_SESSION['google_oauth_state'] = $state;

    $params = [
      'client_id' => $this->clientId,
      'redirect_uri' => $this->redirectUri,
      'response_type' => 'code',
      'scope' => 'openid profile email',
      'state' => $state,
    ];

    return self::AUTH_URL . '?' . http_build_query($params);
  }

  /**
   * Exchange authorization code for access token
   */
  public function getAccessToken($code) {
    $params = [
      'client_id' => $this->clientId,
      'client_secret' => $this->clientSecret,
      'code' => $code,
      'grant_type' => 'authorization_code',
      'redirect_uri' => $this->redirectUri,
    ];

    $ch = curl_init(self::TOKEN_URL);
    curl_setopt_array($ch, [
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => http_build_query($params),
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
      throw new Exception('Failed to get access token. HTTP ' . $httpCode);
    }

    return json_decode($response, true);
  }

  /**
   * Get user info from Google
   */
  public function getUserInfo($accessToken) {
    $ch = curl_init(self::USERINFO_URL);
    curl_setopt_array($ch, [
      CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $accessToken],
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
      throw new Exception('Failed to get user info. HTTP ' . $httpCode);
    }

    return json_decode($response, true);
  }

  /**
   * Verify state matches (CSRF protection)
   */
  public function verifyState($state) {
    return isset($_SESSION['google_oauth_state']) && $_SESSION['google_oauth_state'] === $state;
  }
}
