<?php
/**
 * Digital Downloads: hooks
 */

// ── Schema ────────────────────────────────────────────────────────────────────
Hook::on('app.boot', function() {
    $p = DB_PREFIX;
    DB::exec("CREATE TABLE IF NOT EXISTS `{$p}digital_files` (
        `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `product_id` INT UNSIGNED NOT NULL,
        `label`      VARCHAR(255) NOT NULL DEFAULT '',
        `filename`   VARCHAR(255) NOT NULL,
        `filepath`   VARCHAR(512) NOT NULL,
        `filesize`   INT UNSIGNED NOT NULL DEFAULT 0,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`),
        KEY `product_id` (`product_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    DB::exec("CREATE TABLE IF NOT EXISTS `{$p}download_tokens` (
        `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `order_id`       INT UNSIGNED NOT NULL,
        `product_id`     INT UNSIGNED NOT NULL,
        `file_id`        INT UNSIGNED NOT NULL,
        `customer_email` VARCHAR(254) NOT NULL,
        `token`          CHAR(64) NOT NULL,
        `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `expires_at`     DATETIME NOT NULL,
        `download_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        `max_downloads`  SMALLINT UNSIGNED NOT NULL DEFAULT 5,
        PRIMARY KEY (`id`),
        UNIQUE KEY `token` (`token`),
        KEY `order_id` (`order_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // download_count on the token itself is just a running total, this
    // records each individual download as its own event (when, from where),
    // since "was this ever downloaded" and "prove/investigate a specific
    // download" are different questions the counter alone can't answer.
    DB::exec("CREATE TABLE IF NOT EXISTS `{$p}download_log` (
        `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `token_id`       INT UNSIGNED NOT NULL,
        `downloaded_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `ip_address`     VARCHAR(45) NOT NULL DEFAULT '',
        PRIMARY KEY (`id`),
        KEY `token_id` (`token_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
});

// ── Generate tokens on payment confirmation ───────────────────────────────────
Hook::on('catalog.order.payment_complete', function(&$order) {
    $p           = DB_PREFIX;
    $expiry_days = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='dd_expiry_days'") ?: 30);
    $max_dl      = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='dd_max_downloads'") ?: 5);

    $items = DB::rows(
        "SELECT oi.product_id, oi.name
         FROM `{$p}order_items` oi
         WHERE oi.order_id = ?",
        [$order['id']]
    );

    $links = [];
    foreach ($items as $item) {
        $files = DB::rows(
            "SELECT * FROM `{$p}digital_files` WHERE product_id = ?",
            [$item['product_id']]
        );
        foreach ($files as $file) {
            $exists = DB::val(
                "SELECT id FROM `{$p}download_tokens` WHERE order_id=? AND file_id=?",
                [$order['id'], $file['id']]
            );
            if ($exists) continue;

            $token = bin2hex(random_bytes(32));
            DB::exec(
                "INSERT INTO `{$p}download_tokens`
                 (order_id, product_id, file_id, customer_email, token, expires_at, max_downloads)
                 VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)",
                [$order['id'], $item['product_id'], $file['id'],
                 $order['ship_email'], $token, $expiry_days, $max_dl]
            );

            $links[] = ['label' => $file['label'] ?: $item['name'], 'token' => $token];
        }
    }

    if (empty($links)) return;

    $url_root  = defined('URL_ROOT') ? URL_ROOT : '/';
    $site_name = defined('SITE_NAME') ? SITE_NAME : 'Our Store';
    $lines     = [];
    foreach ($links as $l) {
        // Emails need a full link. URL_ROOT is only a path ('/'), so
        // absolute_url() adds the scheme and host of the current request
        // (Stripe's webhook call to this site, or the order-complete page).
        $url     = absolute_url(rtrim($url_root, '/') . '/?route=digital-download/download&token=' . $l['token']);
        $lines[] = $l['label'] . "\n" . $url;
    }
    $link_word = count($links) > 1 ? 'links are' : 'link is';
    $body = "Hi {$order['ship_firstname']},\n\n"
          . "Thank you for your order #{$order['id']}! Your secure download {$link_word} below.\n\n"
          . implode("\n\n", $lines) . "\n\n"
          . str_repeat('-', 50) . "\n"
          . "IMPORTANT:\n"
          . "• Each link expires in {$expiry_days} days from today.\n"
          . "• Each link can be used up to {$max_dl} times.\n"
          . "• Save your files as soon as possible. Expired links cannot be reactivated.\n"
          . "• If you have trouble downloading, reply to this email for assistance.\n"
          . str_repeat('-', 50) . "\n\n"
          . "{$site_name}\n"
          . $url_root;

    nc_mail($order['ship_email'], "Your download" . (count($links) > 1 ? 's' : '') . " from {$site_name}, Order #{$order['id']}", $body);
});

// ── Product drawer: Downloads tab ─────────────────────────────────────────────
Hook::on('admin.product.drawer.tabs', function() {
    return '<button class="drawer-tab" data-panel="downloads" role="tab" '
         . 'aria-selected="false" aria-controls="panel-downloads" '
         . 'disabled title="Save the product first">Downloads</button>';
});

Hook::on('admin.product.drawer.panels', function() {
    return <<<'HTML'
<div class="drawer-tab-panel" id="panel-downloads" role="tabpanel">
    <div id="dd-file-list" style="margin-bottom:1.25rem"></div>
    <div id="dd-drop-zone" class="dd-drop-zone" style="margin-bottom:.75rem">
        <div id="dd-drop-label">Drop a file here, or <label for="dd-file-input" style="color:var(--nc-primary);cursor:pointer;text-decoration:underline">browse</label></div>
        <input type="file" id="dd-file-input" accept=".zip,.pdf,.epub,.mp3,.mp4,.txt,.csv" style="display:none">
        <div id="dd-drop-active" style="display:none;font-weight:600">Drop to upload</div>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center">
        <input type="text" id="dd-file-label" placeholder="Label (optional)"
               style="flex:1;padding:.4rem .6rem;border:1px solid var(--nc-border);border-radius:var(--nc-radius);font-size:.9rem">
        <button type="button" id="dd-upload-btn" class="btn btn-secondary btn-sm" disabled>Upload</button>
    </div>
    <div class="hint" style="margin-top:.5rem">Files are served via secure token after purchase, not directly accessible. Product photos go on the Images tab, not here.</div>
</div>
HTML;
});

// ── Inject drawer JS ──────────────────────────────────────────────────────────
Hook::on('admin.page.scripts', function($ctx) {
    $url = defined('URL_ADMIN_REAL') ? URL_ADMIN_REAL : '/admin/';
    return '<script src="' . $url . '../plugins/digital-download/admin/js/digital-download.js"></script>';
});

