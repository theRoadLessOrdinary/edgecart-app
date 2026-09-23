<?php
/**
 * Core flat-rate shipping hook.
 * Adds admin-configured methods to the checkout rate list.
 * Runs after plugins, so live-rate plugins (GoShippo) coexist:
 * their rates appear first; these fill in if none are returned.
 */
Hook::on('catalog.checkout.shipping_rates', function(array $rates, array $context): array {
    $p        = DB_PREFIX;
    $subtotal = Cart::subtotal();
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
