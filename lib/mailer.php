<?php
/**
 * nc_mail() — send via Mail API (cURL) when configured, otherwise fall back to PHP mail().
 *
 * Settings keys used:
 *   mail_api_key      — API bearer token; if empty, falls back to PHP mail()
 *   mail_api_endpoint — full POST URL (e.g. https://api.resend.com/emails)
 *   store_email       — used as From address when $from is not supplied
 *
 * @param string $to
 * @param string $subject
 * @param string $body      Plain-text or HTML body
 * @param string $from      Optional sender address; falls back to store_email setting
 * @param bool   $is_html   True to send as HTML, false for plain text (default)
 * @return bool
 */
function nc_mail(string $to, string $subject, string $body, string $from = '', bool $is_html = false): bool
{
    global $_nc_settings;

    if (!$from) {
        $from = $_nc_settings['mail_from'] ?? ('noreply@' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    }

    $api_key  = $_nc_settings['mail_api_key']      ?? '';
    $endpoint = $_nc_settings['mail_api_endpoint'] ?? '';

    if ($api_key && $endpoint) {
        return _nc_mail_api($endpoint, $api_key, $from, $to, $subject, $body, $is_html);
    }

    return _nc_mail_php($to, $subject, $body, $from, $is_html);
}

function _nc_mail_api(string $endpoint, string $api_key, string $from, string $to, string $subject, string $body, bool $is_html): bool
{
    $payload = [$is_html ? 'html' : 'text' => $body];
    $payload += compact('from', 'to', 'subject');

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $api_key,
            'Content-Type: application/json',
        ],
        CURLOPT_TIMEOUT        => 10,
    ]);
    curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return $status >= 200 && $status < 300;
}

function _nc_mail_php(string $to, string $subject, string $body, string $from, bool $is_html): bool
{
    $content_type = $is_html ? 'text/html' : 'text/plain';
    $headers  = "From: {$from}\r\n";
    $headers .= "Content-Type: {$content_type}; charset=UTF-8\r\n";
    return (bool) @mail($to, $subject, $body, $headers);
}
