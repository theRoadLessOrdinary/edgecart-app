<?php
/**
 * Core flat-rate shipping hook.
 * Adds admin-configured methods to the checkout rate list.
 * Runs after plugins, so live-rate plugins (GoShippo) coexist:
 * their rates appear first; these fill in if none are returned.
 */
Hook::on('catalog.checkout.shipping_rates', function(array $rates, array $context): array {
    $p        = DB_PREFIX;
    $subtotal = isset($context['subtotal']) ? (float)$context['subtotal'] : Cart::subtotal();
    $country  = strtoupper(trim($context['address']['country'] ?? ''));

    $methods = DB::rows(
        "SELECT * FROM `{$p}shipping_methods` WHERE active=1 ORDER BY sort_order ASC, name ASC"
    );

    foreach ($methods as $m) {
        // Country filter (empty = all countries)
        if ($m['countries'] !== '') {
            $allowed = array_map('strtoupper', array_map('trim', explode(',', $m['countries'])));
            if ($country && !in_array($country, $allowed, true)) continue;
        }

        // Minimum order amount
        if ($subtotal < (float)$m['min_order']) continue;

        // Free-above threshold
        $rate = (float)$m['rate'];
        if ($m['free_above'] !== null && $subtotal >= (float)$m['free_above']) {
            $rate = 0.0;
        }

        $rates[] = [
            'id'      => 'flat:' . $m['id'],
            'carrier' => '',
            'service' => $m['name'],
            'rate'    => $rate,
            'days'    => $m['description'] !== '' ? $m['description'] : null,
        ];
    }

    return $rates;
});


/**
 * Per-product package size (flat-pack: units stack, so only height grows with qty).
 * Columns are added on first use.
 */
function ensure_product_pkg_cols(): void {
    static $done = false;
    if ($done) return;
    $p = DB_PREFIX;
    $have = DB::val(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'pkg_length'",
        ["{$p}products"]
    );
    if (!$have) {
        DB::exec("ALTER TABLE `{$p}products`
            ADD COLUMN `pkg_length` DECIMAL(8,2) NOT NULL DEFAULT 0,
            ADD COLUMN `pkg_width`  DECIMAL(8,2) NOT NULL DEFAULT 0,
            ADD COLUMN `pkg_height` DECIMAL(8,2) NOT NULL DEFAULT 0");
    }
    $done = true;
}

/**
 * Combine lines into one package. Each line: ['l','w','h' (one unit), 'qty'].
 * Long side is L, short side W; L and W are the largest across lines, and
 * height is the sum of (unit height x qty). Lines without dimensions are skipped.
 * Returns ['length','width','height'] or null if no line had dimensions.
 */
function package_stack(array $lines): ?array {
    $L = $W = $H = 0.0; $any = false;
    foreach ($lines as $ln) {
        $a = (float)$ln['l']; $b = (float)$ln['w']; $h = (float)$ln['h'];
        if ($a <= 0 || $b <= 0 || $h <= 0) continue;
        $any = true;
        $L = max($L, max($a, $b));
        $W = max($W, min($a, $b));
        $H += $h * max(1, (int)$ln['qty']);
    }
    return $any ? ['length' => round($L, 2), 'width' => round($W, 2), 'height' => round($H, 2)] : null;
}
