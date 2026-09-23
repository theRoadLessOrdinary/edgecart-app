<?php
require_access(ACCESS_EDIT);
$p = DB_PREFIX;

// AJAX handler
if (post('action')) {
	header('Content-Type: application/json');
	require_csrf_token_json();
	$action = post('action');

	// ── Tax Zones ──────────────────────────────────────────────────────────────
	if ($action === 'zones_list') {
		$zones = DB::rows("SELECT * FROM `{$p}tax_zones` ORDER BY priority DESC, zone_name ASC");
		echo json_encode(['ok' => true, 'zones' => $zones]);
		exit;
	}

	if ($action === 'opensalestax_import') {
		try {
			$result = opensalestax_import_rates();
			$last_import = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='opensalestax_last_import'");
			echo json_encode([
				'ok'          => true,
				'imported'    => $result['imported'],
				'skipped'     => $result['skipped'],
				'last_import' => $last_import,
			]);
		} catch (Throwable $e) {
			// Throwable, not just Exception: a restricted host without
			// ext-curl makes curl_init() a fatal "call to undefined
			// function" Error, not a catchable Exception — that previously
			// escaped this handler entirely and returned an HTML fatal-error
			// page instead of JSON, breaking the fetch() caller with a
			// "Unexpected token '<'" parse error instead of a real message.
			echo json_encode(['ok' => false, 'message' => $e->getMessage()]);
		}
		exit;
	}

	if ($action === 'zone_get') {
		$id = (int)post('id');
		$zone = DB::row("SELECT * FROM `{$p}tax_zones` WHERE zone_id = ?", [$id]);
		if (!$zone) {
			echo json_encode(['ok' => false, 'message' => 'Zone not found']);
			exit;
		}
		echo json_encode(['ok' => true, 'zone' => $zone]);
		exit;
	}

	if ($action === 'zone_save') {
		$id = (int)post('id', 0);
		$name = trim(post('zone_name', ''));
		$country = trim(post('country_code', 'US'));
		$state = trim(post('state_code', ''));
		$zip_from = trim(post('zip_from', ''));
		$zip_to = trim(post('zip_to', ''));
		$priority = (int)post('priority', 0);

		if (!$name) {
			echo json_encode(['ok' => false, 'message' => 'Zone name required']);
			exit;
		}

		if ($id) {
			DB::exec(
				"UPDATE `{$p}tax_zones` SET zone_name=?, country_code=?, state_code=?, zip_from=?, zip_to=?, priority=? WHERE zone_id=?",
				[$name, $country, $state, $zip_from ?: null, $zip_to ?: null, $priority, $id]
			);
		} else {
			DB::exec(
				"INSERT INTO `{$p}tax_zones` (zone_name, country_code, state_code, zip_from, zip_to, priority, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, NOW())",
				[$name, $country, $state, $zip_from ?: null, $zip_to ?: null, $priority]
			);
		}

		echo json_encode(['ok' => true, 'message' => 'Zone saved']);
		exit;
	}

	if ($action === 'zone_delete') {
		$id = (int)post('id');
		DB::exec("DELETE FROM `{$p}tax_zones` WHERE zone_id = ?", [$id]);
		echo json_encode(['ok' => true, 'message' => 'Zone deleted']);
		exit;
	}

	// ── Tax Rates ──────────────────────────────────────────────────────────────
	if ($action === 'rates_list') {
		$rates = DB::rows(
			"SELECT tr.*, tz.zone_name, tz.country_code, tz.state_code
			 FROM `{$p}tax_rates` tr
			 JOIN `{$p}tax_zones` tz ON tr.zone_id = tz.zone_id
			 ORDER BY tz.country_code, tz.state_code, tr.rate_name ASC"
		);
		// Cast active and applies_to_shipping to int for proper JSON encoding
		$rates = array_map(function($r) {
			$r['active'] = (int)$r['active'];
			$r['applies_to_shipping'] = (int)$r['applies_to_shipping'];
			return $r;
		}, $rates);
		echo json_encode(['ok' => true, 'rates' => $rates]);
		exit;
	}

	if ($action === 'rate_get') {
		$id = (int)post('id');
		$rate = DB::row(
			"SELECT tr.*, tz.zone_name FROM `{$p}tax_rates` tr
			 JOIN `{$p}tax_zones` tz ON tr.zone_id = tz.zone_id
			 WHERE tr.rate_id = ?",
			[$id]
		);
		if (!$rate) {
			echo json_encode(['ok' => false, 'message' => 'Rate not found']);
			exit;
		}
		echo json_encode(['ok' => true, 'rate' => $rate]);
		exit;
	}

	if ($action === 'rate_save') {
		$id = (int)post('id', 0);
		$zone_id = (int)post('zone_id');
		$name = trim(post('rate_name', ''));
		$rate = (float)post('rate', 0);
		$applies_shipping = (int)post('applies_to_shipping', 0);
		$active = (int)post('active', 1);

		if (!$name || $rate < 0) {
			echo json_encode(['ok' => false, 'message' => 'Rate name and percentage required']);
			exit;
		}

		// Verify zone exists
		if (!DB::row("SELECT zone_id FROM `{$p}tax_zones` WHERE zone_id = ?", [$zone_id])) {
			echo json_encode(['ok' => false, 'message' => 'Zone not found']);
			exit;
		}

		// Convert percentage to decimal (8% -> 0.08)
		$rate_decimal = $rate / 100;

		if ($id) {
			DB::exec(
				"UPDATE `{$p}tax_rates` SET zone_id=?, rate_name=?, rate=?, applies_to_shipping=?, active=? WHERE rate_id=?",
				[$zone_id, $name, $rate_decimal, $applies_shipping, $active, $id]
			);
		} else {
			DB::exec(
				"INSERT INTO `{$p}tax_rates` (zone_id, rate_name, rate, applies_to_shipping, active, created_at)
				 VALUES (?, ?, ?, ?, ?, NOW())",
				[$zone_id, $name, $rate_decimal, $applies_shipping, $active]
			);
		}

		echo json_encode(['ok' => true, 'message' => 'Rate saved']);
		exit;
	}

	if ($action === 'rate_delete') {
		$id = (int)post('id');
		DB::exec("DELETE FROM `{$p}tax_rates` WHERE rate_id = ?", [$id]);
		echo json_encode(['ok' => true, 'message' => 'Rate deleted']);
		exit;
	}

	if ($action === 'rate_toggle_active') {
		$id = (int)post('id');
		DB::exec(
			"UPDATE `{$p}tax_rates` SET active = IF(active=1, 0, 1) WHERE rate_id = ?",
			[$id]
		);
		$active = DB::row("SELECT active FROM `{$p}tax_rates` WHERE rate_id = ?", [$id])['active'];
		echo json_encode(['ok' => true, 'active' => (int)$active]);
		exit;
	}

	if ($action === 'rates_bulk_toggle') {
		$ids = json_decode(post('ids', '[]'), true);
		$active = (int)post('active', 0);

		if (empty($ids)) {
			echo json_encode(['ok' => false, 'message' => 'No rates specified']);
			exit;
		}

		// Build placeholders for IN clause
		$placeholders = implode(',', array_fill(0, count($ids), '?'));
		DB::exec(
			"UPDATE `{$p}tax_rates` SET active = ? WHERE rate_id IN ({$placeholders})",
			array_merge([$active], $ids)
		);
		echo json_encode(['ok' => true, 'message' => 'Rates updated']);
		exit;
	}

	echo json_encode(['ok' => false, 'message' => 'Unknown action']);
	exit;
}

// Get countries list and state options
$countries = [
	['code' => 'US', 'name' => 'United States'],
	['code' => 'CA', 'name' => 'Canada'],
	['code' => 'GB', 'name' => 'United Kingdom'],
	['code' => 'AU', 'name' => 'Australia'],
];

$us_states = [
	'AL' => 'Alabama', 'AK' => 'Alaska', 'AZ' => 'Arizona', 'AR' => 'Arkansas',
	'CA' => 'California', 'CO' => 'Colorado', 'CT' => 'Connecticut', 'DE' => 'Delaware',
	'FL' => 'Florida', 'GA' => 'Georgia', 'HI' => 'Hawaii', 'ID' => 'Idaho',
	'IL' => 'Illinois', 'IN' => 'Indiana', 'IA' => 'Iowa', 'KS' => 'Kansas',
	'KY' => 'Kentucky', 'LA' => 'Louisiana', 'ME' => 'Maine', 'MD' => 'Maryland',
	'MA' => 'Massachusetts', 'MI' => 'Michigan', 'MN' => 'Minnesota', 'MS' => 'Mississippi',
	'MO' => 'Missouri', 'MT' => 'Montana', 'NE' => 'Nebraska', 'NV' => 'Nevada',
	'NH' => 'New Hampshire', 'NJ' => 'New Jersey', 'NM' => 'New Mexico', 'NY' => 'New York',
	'NC' => 'North Carolina', 'ND' => 'North Dakota', 'OH' => 'Ohio', 'OK' => 'Oklahoma',
	'OR' => 'Oregon', 'PA' => 'Pennsylvania', 'RI' => 'Rhode Island', 'SC' => 'South Carolina',
	'SD' => 'South Dakota', 'TN' => 'Tennessee', 'TX' => 'Texas', 'UT' => 'Utah',
	'VT' => 'Vermont', 'VA' => 'Virginia', 'WA' => 'Washington', 'WV' => 'West Virginia',
	'WI' => 'Wisconsin', 'WY' => 'Wyoming',
];

$smarty->assign('countries', $countries);
$smarty->assign('us_states', $us_states);
$smarty->assign('opensalestax_last_import', DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='opensalestax_last_import'"));
$smarty->display('locations.html');
