<?php
/**
 * Shopify adapter — reads Shopify's own CSV exports (Products > Export, and
 * Customers > Export) and produces the common staging array documented in
 * lib/staging.php. CSV rather than the Admin API: avoids the OAuth app-review
 * process and rate limits entirely, and it's what a merchant doing a one-time
 * migration would reach for anyway.
 *
 * Shopify's product CSV is "flattened": one row per product/variant/extra-image
 * combination, all sharing the same Handle. Only the first row for a given
 * Handle carries Title/Body/Type — later rows for the same product leave those
 * blank and exist only to add another variant and/or another image.
 *
 * Shopify's variant model is a full price-per-combination matrix (e.g. every
 * Size × Color pair can have its own price), which doesn't map cleanly onto
 * EdgeCart's model of one additive price_modifier per option *value*. For a
 * single-option product (just "Size", the common case) this maps perfectly —
 * each value's modifier is that variant's price minus the product's base
 * price. For a genuinely multi-dimensional product (Size *and* Color), the
 * option/value structure is preserved but modifiers are left at 0, since
 * attributing a combined price difference to one specific dimension would be
 * arbitrary and misleading. Flag this to the merchant rather than guess.
 */

function ci_shopify_read_csv(string $path): array {
	$fh = fopen($path, 'r');
	if ($fh === false) throw new RuntimeException("Could not open CSV: {$path}");

	$header = fgetcsv($fh);
	if ($header === false) { fclose($fh); return []; }
	$header = array_map('trim', $header);

	$rows = [];
	while (($line = fgetcsv($fh)) !== false) {
		if (count($line) === 1 && $line[0] === null) continue; // blank line
		$row = [];
		foreach ($header as $i => $col) $row[$col] = $line[$i] ?? '';
		$rows[] = $row;
	}
	fclose($fh);
	return $rows;
}

function ci_shopify_extract_products_csv(string $path): array {
	$rows = ci_shopify_read_csv($path);

	$products_by_handle = [];
	$category_names = [];

	foreach ($rows as $row) {
		$handle = trim($row['Handle'] ?? '');
		if ($handle === '') continue;

		if (!isset($products_by_handle[$handle])) {
			$products_by_handle[$handle] = [
				'external_id' => $handle,
				'name'        => '',
				'slug'        => $handle,
				'description' => '',
				'price'       => 0.0,
				'status'      => 1,
				'images'      => [],
				'category_external_ids' => [],
				'options'     => [], // keyed by option name while building
			];
		}
		$p = &$products_by_handle[$handle];

		// Only the "header" row for this product carries these fields.
		if (trim($row['Title'] ?? '') !== '') {
			$p['name']        = $row['Title'];
			$p['description'] = $row['Body (HTML)'] ?? '';
			$p['status']      = (strtoupper(trim($row['Published'] ?? '')) === 'TRUE') ? 1 : 0;

			$type = trim($row['Type'] ?? '');
			if ($type !== '') {
				$p['category_external_ids'] = [$type];
				$category_names[$type] = true;
			}
		}

		// Every row can add one more image.
		$image_src = trim($row['Image Src'] ?? '');
		if ($image_src !== '' && !in_array($image_src, $p['images'], true)) {
			$p['images'][] = $image_src;
		}

		// Every row can add/extend one variant. Shopify uses the literal
		// option name "Title" with value "Default Title" for products that
		// have no real variants — skip that case, it's not a real option.
		$variant_price = $row['Variant Price'] ?? '';
		if ($variant_price !== '') {
			if (!isset($p['base_price_set'])) {
				$p['price'] = (float)$variant_price;
				$p['base_price_set'] = true;
				if (!empty($row['Variant SKU'])) $p['sku'] = $row['Variant SKU'];
				if (!empty($row['Variant Grams'])) $p['weight'] = (float)$row['Variant Grams'] / 1000;
				if (($row['Variant Inventory Qty'] ?? '') !== '') $p['stock'] = (int)$row['Variant Inventory Qty'];
			}

			for ($n = 1; $n <= 3; $n++) {
				$opt_name  = trim($row["Option{$n} Name"] ?? '');
				$opt_value = trim($row["Option{$n} Value"] ?? '');
				if ($opt_name === '' || $opt_value === '' || $opt_name === 'Title') continue;

				if (!isset($p['options'][$opt_name])) $p['options'][$opt_name] = [];
				if (!isset($p['options'][$opt_name][$opt_value])) {
					$p['options'][$opt_name][$opt_value] = ['value' => $opt_value, 'price_modifier' => 0.0];
				}
			}
		}

		unset($p);
	}

	$products = [];
	foreach ($products_by_handle as $p) {
		$option_names = array_keys($p['options']);
		$single_dimension = count($option_names) === 1;

		$options = [];
		foreach ($p['options'] as $opt_name => $values) {
			$options[] = ['name' => $opt_name, 'values' => array_values($values)];
		}

		// Re-pass for single-dimension products only: compute each value's
		// real price modifier from its own variant row (skipped above to
		// avoid depending on row order relative to the base-price row).
		if ($single_dimension) {
			foreach ($rows as $row) {
				if (trim($row['Handle'] ?? '') !== $p['external_id']) continue;
				$opt_value = trim($row['Option1 Value'] ?? '');
				$variant_price = $row['Variant Price'] ?? '';
				if ($opt_value === '' || $variant_price === '') continue;
				foreach ($options as &$opt) {
					if (isset($opt['values'])) {
						foreach ($opt['values'] as &$v) {
							if ($v['value'] === $opt_value) $v['price_modifier'] = (float)$variant_price - $p['price'];
						}
						unset($v);
					}
				}
				unset($opt);
			}
		}

		$products[] = [
			'external_id'           => $p['external_id'],
			'name'                  => $p['name'],
			'slug'                  => $p['slug'],
			'sku'                   => $p['sku'] ?? '',
			'description'           => $p['description'],
			'price'                 => $p['price'],
			'stock'                 => $p['stock'] ?? 0,
			'weight'                => $p['weight'] ?? 0,
			'status'                => $p['status'],
			'images'                => $p['images'],
			'category_external_ids' => $p['category_external_ids'],
			'options'               => $options,
		];
	}

	$categories = [];
	foreach (array_keys($category_names) as $name) {
		$categories[] = ['external_id' => $name, 'name' => $name];
	}

	return ['categories' => $categories, 'products' => $products];
}

function ci_shopify_extract_customers_csv(string $path): array {
	$rows = ci_shopify_read_csv($path);

	$out = [];
	foreach ($rows as $row) {
		$email = trim($row['Email'] ?? '');
		if ($email === '') continue;

		$out[] = [
			'email'      => $email,
			'first_name' => $row['First Name'] ?? '',
			'last_name'  => $row['Last Name'] ?? '',
			'address1'   => $row['Address1'] ?? '',
			'address2'   => $row['Address2'] ?? '',
			'city'       => $row['City'] ?? '',
			'state'      => $row['Province Code'] ?? ($row['Province'] ?? ''),
			'zip'        => $row['Zip'] ?? '',
			'country'    => $row['Country Code'] ?? 'US',
		];
	}
	return $out;
}
