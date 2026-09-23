<?php
/**
 * Digital Downloads — serve file via token
 * route=digital-download/download&token=<hex>
 */

$p     = DB_PREFIX;
$token = preg_replace('/[^a-f0-9]/', '', strtolower(get('token', '')));

// A dead/expired/used-up link is a dead end for the customer otherwise —
// render the normal themed layout with a cross-sell instead of a bare
// text response, same $smarty instance ctl/404.php uses (this file is
// require()'d into index.php's scope, same as any other route).
function dd_render_landing(int $status, string $message, string $detail): void
{
    global $smarty, $p;

    http_response_code($status);

    $products = DB::rows(
        "SELECT id, name, slug, price, list_price,
                (SELECT filename FROM `{$p}product_images` pi
                 WHERE pi.product_id = prod.id
                 ORDER BY pi.display_order ASC LIMIT 1) AS image
         FROM `{$p}products` prod
         WHERE status > 0 AND featured = 1
         ORDER BY display_order ASC, name ASC
         LIMIT 6"
    );

    $smarty->assign('dd_message', $message);
    $smarty->assign('dd_detail',  $detail);
    $smarty->assign('products',   $products);
    $smarty->assign('page_type',  'digital-download-landing');
    $smarty->display('invalid-link.html');
    exit;
}

if (!$token) {
    dd_render_landing(400, 'Invalid Download Link',
        "That link isn't valid. Double check the link from your order email, or explore more from our shop below.");
}

$row = DB::row(
    "SELECT dt.*, df.filename, df.filepath
     FROM `{$p}download_tokens` dt
     JOIN `{$p}digital_files` df ON df.id = dt.file_id
     WHERE dt.token = ?",
    [$token]
);

if (!$row) {
    dd_render_landing(404, 'Download Link Not Found',
        "We couldn't find that download. It may have been mistyped or already removed.");
}

if (strtotime($row['expires_at']) < time()) {
    dd_render_landing(410, 'Download Link Expired',
        "This download link has expired. Reply to your order confirmation email and we'll help you out.");
}

if ($row['download_count'] >= $row['max_downloads']) {
    dd_render_landing(410, 'Download Limit Reached',
        "This link has already been used the maximum number of times. Reply to your order confirmation email if you need it again.");
}

$path = DIR_DOWNLOADS_PRIVATE . $row['filepath'];
if (!file_exists($path)) {
    dd_render_landing(404, 'File Not Found',
        "Something went wrong locating your file. Reply to your order confirmation email and we'll sort it out.");
}

DB::exec(
    "UPDATE `{$p}download_tokens` SET download_count = download_count + 1 WHERE id = ?",
    [$row['id']]
);

require_once DIR_LIB . 'rate-limit.php';
DB::exec(
    "INSERT INTO `{$p}download_log` (token_id, ip_address) VALUES (?, ?)",
    [$row['id'], RateLimit::getClientIp()]
);

$mime = mime_content_type($path) ?: 'application/octet-stream';
header('Content-Type: ' . $mime);
header('Content-Disposition: attachment; filename="' . addslashes($row['filename']) . '"');
header('Content-Length: ' . filesize($path));
header('Cache-Control: private, no-store');
readfile($path);
exit;
