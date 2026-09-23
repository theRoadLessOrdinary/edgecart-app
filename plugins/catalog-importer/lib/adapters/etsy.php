<?php
/**
 * Etsy adapter — reads Etsy's shop listings CSV export (Shop Manager > Settings
 * > Options > Download Data, or the same-shaped bulk listing template) and
 * produces the common staging array documented in lib/staging.php.
 *
 * Etsy's listing CSV is one row per listing (not one row per variant like
 * Shopify) — variations are packed into a single "VARIATION n VALUES" field as
 * a comma-separated list, and the basic export doesn't carry a reliable
 * per-value price override, so imported variation values always get a
 * price_modifier of 0. Same honesty principle as the Shopify multi-dimension
 * case: don't guess at a number that isn't actually in the data.
 *
 * Column names below are Etsy's documented listings-CSV headers as of when
 * this was written. Etsy has changed this format before — if a real export
 * doesn't match, the header lookup in ci_etsy_col() is the one place to adjust.
 *
 * No customer adapter here: Etsy is a marketplace and does not expose buyer
 * email addresses to sellers in shop exports (by design, for buyer privacy).
 * Without an email there's nothing usable to import as an EdgeCart customer.
 */

function ci_etsy_read_csv(string $path): array {
	$fh = fopen($path, 'r');
	if ($fh === false) throw new RuntimeException("Could not open CSV: {$path}");

	$header = fgetcsv($fh);
	if ($header === false) { fclose($fh); return []; }
	$header = array_map(fn($h) => strtoupper(trim($h)), $header);

	$rows = [];
	while (($line = fgetcsv($fh)) !== false) {
		if (count($line) === 1 && $line[0] === null) continue;
		$row = [];
		foreach ($header as $i => $col) $row[$col] = $line[$i] ?? '';
		$rows[] = $row;
	}
	fclose($fh);
	return $rows;
}

// Tries a column, then its documented alternates, case-insensitively. Etsy's
// exact header wording has drifted across format revisions.
function ci_etsy_col(array $row, array $candidates): string {
	foreach ($candidates as $name) {
		$name = strtoupper($name);
		if (isset($row[$name]) && trim($row[$name]) !== '') return trim($row[$name]);
	}
	return '';
}

function ci_etsy_extract_products_csv(string $path): array {
	$rows = ci_etsy_read_csv($path);

	$products = [];
	$category_names = [];

	foreach ($rows as $i => $row) {
		$title = ci_etsy_col($row, ['TITLE']);
		if ($title === '') continue;

		$listing_id = ci_etsy_col($row, ['LISTING_ID', 'LISTING ID']);
		$external_id = $listing_id !== '' ? $listing_id : 'row-' . $i;

		$section = ci_etsy_col($row, ['SECTION']);
		$category_external_ids = [];
		if ($section !== '') {
			$category_external_ids = [$section];
			$category_names[$section] = true;
		}

		$images = [];
		for ($n = 1; $n <= 10; $n++) {
			$img = ci_etsy_col($row, ["IMAGE{$n}", "IMAGE {$n}"]);
			if ($img !== '') $images[] = $img;
		}

		$options = [];
		for ($n = 1; $n <= 2; $n++) {
			$var_name = ci_etsy_col($row, ["VARIATION {$n} NAME", "VARIATION{$n} NAME"]);
			$var_values = ci_etsy_col($row, ["VARIATION {$n} VALUES", "VARIATION{$n} VALUES"]);
			if ($var_name === '' || $var_values === '') continue;

			$values = [];
			foreach (explode(',', $var_values) as $v) {
				$v = trim($v);
				if ($v === '') continue;
				$values[] = ['value' => $v, 'price_modifier' => 0.0];
			}
			if ($values) $options[] = ['name' => $var_name, 'values' => $values];
		}

		$products[] = [
			'external_id'           => $external_id,
			'name'                  => $title,
			'sku'                   => ci_etsy_col($row, ['SKU']),
			'description'           => ci_etsy_col($row, ['DESCRIPTION']),
			'price'                 => (float)ci_etsy_col($row, ['PRICE']),
			'stock'                 => (int)ci_etsy_col($row, ['QUANTITY']),
			'status'                => 1,
			'images'                => $images,
			'category_external_ids' => $category_external_ids,
			'options'               => $options,
		];
	}

	$categories = [];
	foreach (array_keys($category_names) as $name) {
		$categories[] = ['external_id' => $name, 'name' => $name];
	}

	return ['categories' => $categories, 'products' => $products];
}
