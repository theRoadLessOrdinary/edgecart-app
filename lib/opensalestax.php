<?php
/**
 * OpenSalesTax import — pulls per-state combined tax rates from the free,
 * keyless, open-source api.opensalestax.org and seeds the core Locations &
 * Tax tables (tax_zones/tax_rates). This app's zone model is whole-state
 * only (no per-zip granularity yet), so each state is represented by a
 * single rate looked up at one representative (usually capital-city) zip —
 * an approximation for states with significant local rate variance.
 * Re-running updates the same imported rows in place rather than
 * duplicating them; a merchant's own manually-created zones are left alone.
 */

// One representative zip per state/DC, used to fetch a single combined rate
// to stand in for the whole state.
const OPENSALESTAX_REP_ZIPS = [
    'AL' => '36104', 'AK' => '99801', 'AZ' => '85003', 'AR' => '72201',
    'CA' => '95814', 'CO' => '80202', 'CT' => '06103', 'DE' => '19901',
    'FL' => '32301', 'GA' => '30303', 'HI' => '96813', 'ID' => '83702',
    'IL' => '62701', 'IN' => '46204', 'IA' => '50309', 'KS' => '66603',
    'KY' => '40601', 'LA' => '70802', 'ME' => '04330', 'MD' => '21401',
    'MA' => '02108', 'MI' => '48933', 'MN' => '55101', 'MS' => '39201',
    'MO' => '65101', 'MT' => '59601', 'NE' => '68508', 'NV' => '89701',
    'NH' => '03301', 'NJ' => '08608', 'NM' => '87501', 'NY' => '12207',
    'NC' => '27601', 'ND' => '58501', 'OH' => '43215', 'OK' => '73102',
    'OR' => '97301', 'PA' => '17101', 'RI' => '02903', 'SC' => '29201',
    'SD' => '57501', 'TN' => '37201', 'TX' => '78701', 'UT' => '84101',
    'VT' => '05602', 'VA' => '23219', 'WA' => '98501', 'WV' => '25301',
    'WI' => '53703', 'WY' => '82001', 'DC' => '20001',
];

function opensalestax_fetch_states(): array {
    // Some restricted shared hosts ship PHP without ext-curl. Calling
    // curl_init() there is a fatal "call to undefined function" Error, not a
    // catchable Exception — check first so the caller (admin/ctl/
    // locations.php's opensalestax_import action) gets a real, catchable
    // message instead of a fatal crashing straight through its try/catch.
    if (!function_exists('curl_init')) {
        throw new Exception('The PHP cURL extension is not available on this server, which OpenSalesTax import requires to reach api.opensalestax.org.');
    }
    $ch = curl_init('https://api.opensalestax.org/v1/states');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $response = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        throw new Exception("cURL error: {$err}");
    }

    $data = json_decode($response, true);
    if (!isset($data['states'])) {
        throw new Exception('Unexpected OpenSalesTax /v1/states response');
    }

    return $data['states'];
}

function opensalestax_fetch_rate(string $zip5): ?float {
    $ch = curl_init('https://api.opensalestax.org/v1/rates?zip5=' . urlencode($zip5));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $response = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err) {
        return null;
    }

    $data = json_decode($response, true);
    if (!isset($data['combined_rate_pct'])) {
        return null;
    }

    return floatval($data['combined_rate_pct']);
}

/**
 * Imports/refreshes one zone+rate per US state with sales tax.
 * Returns ['imported' => int, 'skipped' => ['<state code>' => '<reason>']].
 */
function opensalestax_import_rates(): array {
    $p = DB_PREFIX;
    $states = opensalestax_fetch_states();
    $imported = 0;
    $skipped = [];

    foreach ($states as $state) {
        $code = $state['abbrev'] ?? '';
        if (!$code || empty($state['has_sales_tax'])) {
            continue;
        }

        $zip = OPENSALESTAX_REP_ZIPS[$code] ?? null;
        if (!$zip) {
            $skipped[$code] = 'no representative zip on file';
            continue;
        }

        $rate_pct = opensalestax_fetch_rate($zip);
        if ($rate_pct === null) {
            $skipped[$code] = 'rate lookup failed';
            continue;
        }

        // A 0% result is only trustworthy for the handful of states with no
        // sales tax at all — otherwise it almost always means the chosen zip
        // has no jurisdiction data in OpenSalesTax rather than a genuine 0%
        // rate (caught in testing: AZ's original rep zip silently imported
        // as 0% instead of its real ~9%). Flag anything else instead of
        // writing a rate that's probably just a bad zip.
        $no_tax_states = ['AK', 'DE', 'MT', 'NH', 'OR'];
        if ($rate_pct == 0.0 && !in_array($code, $no_tax_states, true)) {
            $skipped[$code] = "zip {$zip} returned 0% with no jurisdiction data — likely a bad representative zip, not a real rate";
            continue;
        }

        $zone_name = 'OpenSalesTax Import — ' . ($state['name'] ?? $code);

        $zone_id = DB::val("SELECT zone_id FROM `{$p}tax_zones` WHERE zone_name = ?", [$zone_name]);
        if (!$zone_id) {
            // priority -1: this import is a fallback only. Any zone a merchant
            // already has for this state (manual entry, or a prior sync from a
            // plugin like taxjar) sits at priority 0 or higher and always wins
            // ties in checkout_calculate_tax()'s "ORDER BY priority DESC LIMIT 1"
            // — this import only fills states with no existing coverage at all,
            // it never silently changes an already-configured rate.
            DB::exec(
                "INSERT INTO `{$p}tax_zones` (zone_name, country_code, state_code, priority, created_at)
                 VALUES (?, 'US', ?, -1, NOW())",
                [$zone_name, $code]
            );
            $zone_id = DB::pdo()->lastInsertId();
        }

        $rate_decimal = $rate_pct / 100;
        $rate_name = 'OpenSalesTax Import';
        $existing = DB::row(
            "SELECT rate_id FROM `{$p}tax_rates` WHERE zone_id = ? AND rate_name = ?",
            [$zone_id, $rate_name]
        );
        if ($existing) {
            DB::exec("UPDATE `{$p}tax_rates` SET rate = ?, active = 1 WHERE rate_id = ?", [$rate_decimal, $existing['rate_id']]);
        } else {
            DB::exec(
                "INSERT INTO `{$p}tax_rates` (zone_id, rate_name, rate, applies_to_shipping, active, created_at)
                 VALUES (?, ?, ?, 0, 1, NOW())",
                [$zone_id, $rate_name, $rate_decimal]
            );
        }

        $imported++;
    }

    DB::exec(
        "INSERT INTO `{$p}settings` (`key`, `value`, `origin`) VALUES ('opensalestax_last_import', ?, 'core')
         ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
        [date('Y-m-d H:i:s')]
    );

    return ['imported' => $imported, 'skipped' => $skipped];
}
