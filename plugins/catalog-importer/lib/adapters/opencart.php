<?php
/**
 * OpenCart adapter — reads an OpenCart 3.x/4.x database directly (same
 * LAMP-style stack as EdgeCart, so no export/API step is needed) and produces
 * the common staging array documented in lib/staging.php.
 *
 * OpenCart splits translatable fields (name/description) into separate
 * `*_description` tables keyed by language_id — this adapter takes the single
 * language_id the merchant's store actually uses (default 1, OpenCart's
 * "English" row) rather than importing every language variant.
 *
 * Requires a PDO connection to the OpenCart database — a *separate* connection
 * from EdgeCart's own, since this is a different database (possibly a
 * different host entirely, for a merchant migrating off separate hosting).
 */

function ci_opencart_connect(string $host, string $name, string $user, string $pass, int $port = 3306): PDO {
	$dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
	return new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}

function ci_opencart_extract(PDO $oc, string $prefix = 'oc_', int $language_id = 1): array {
	$categories = ci_opencart_extract_categories($oc, $prefix, $language_id);
	$products   = ci_opencart_extract_products($oc, $prefix, $language_id);
	$customers  = ci_opencart_extract_customers($oc, $prefix);

	return ['categories' => $categories, 'products' => $products, 'customers' => $customers];
}

function ci_opencart_extract_categories(PDO $oc, string $prefix, int $language_id): array {
	$stmt = $oc->prepare(
		"SELECT c.category_id, c.parent_id, c.sort_order, c.image, cd.name, cd.description
		 FROM `{$prefix}category` c
		 JOIN `{$prefix}category_description` cd ON cd.category_id = c.category_id AND cd.language_id = ?
		 WHERE c.status = 1"
	);
	$stmt->execute([$language_id]);

	$out = [];
	foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
		$out[] = [
			'external_id'        => (string)$row['category_id'],
			'name'               => $row['name'],
			'description'        => $row['description'] ?? '',
			'image'              => $row['image'] ?? '',
			'parent_external_id' => ((int)$row['parent_id'] > 0) ? (string)$row['parent_id'] : null,
			'display_order'      => (int)$row['sort_order'],
		];
	}
	return $out;
}

function ci_opencart_extract_products(PDO $oc, string $prefix, int $language_id): array {
	$stmt = $oc->prepare(
		"SELECT p.product_id, p.sku, p.price, p.quantity, p.weight, p.status, p.image, pd.name, pd.description
		 FROM `{$prefix}product` p
		 JOIN `{$prefix}product_description` pd ON pd.product_id = p.product_id AND pd.language_id = ?"
	);
	$stmt->execute([$language_id]);
	$products_raw = $stmt->fetchAll(PDO::FETCH_ASSOC);

	$img_stmt = $oc->prepare("SELECT image FROM `{$prefix}product_image` WHERE product_id = ? ORDER BY sort_order");
	$cat_stmt = $oc->prepare("SELECT category_id FROM `{$prefix}product_to_category` WHERE product_id = ?");
	$opt_stmt = $oc->prepare(
		"SELECT po.product_option_id, po.option_id, po.required, od.name AS option_name
		 FROM `{$prefix}product_option` po
		 JOIN `{$prefix}option_description` od ON od.option_id = po.option_id AND od.language_id = ?
		 WHERE po.product_id = ?"
	);
	$optval_stmt = $oc->prepare(
		"SELECT pov.price, pov.price_prefix, pov.quantity, ovd.name AS value_name
		 FROM `{$prefix}product_option_value` pov
		 JOIN `{$prefix}option_value_description` ovd ON ovd.option_value_id = pov.option_value_id AND ovd.language_id = ?
		 WHERE pov.product_option_id = ?"
	);

	$out = [];
	foreach ($products_raw as $row) {
		$product_id = $row['product_id'];

		// OpenCart keeps one "main" image on the product row plus any number of
		// extras in product_image — staging just wants a flat ordered list.
		$images = [];
		if (!empty($row['image'])) $images[] = $row['image'];
		$img_stmt->execute([$product_id]);
		foreach ($img_stmt->fetchAll(PDO::FETCH_COLUMN) as $img) $images[] = $img;

		$cat_stmt->execute([$product_id]);
		$category_external_ids = array_map('strval', $cat_stmt->fetchAll(PDO::FETCH_COLUMN));

		$opt_stmt->execute([$language_id, $product_id]);
		$options = [];
		foreach ($opt_stmt->fetchAll(PDO::FETCH_ASSOC) as $opt) {
			$optval_stmt->execute([$language_id, $opt['product_option_id']]);
			$values = [];
			foreach ($optval_stmt->fetchAll(PDO::FETCH_ASSOC) as $val) {
				$modifier = (float)$val['price'];
				if (($val['price_prefix'] ?? '+') === '-') $modifier = -$modifier;
				$values[] = [
					'value'          => $val['value_name'],
					'price_modifier' => $modifier,
					'stock'          => (int)$val['quantity'],
				];
			}
			if ($values) {
				$options[] = ['name' => $opt['option_name'], 'values' => $values];
			}
		}

		$out[] = [
			'external_id'           => (string)$product_id,
			'name'                  => $row['name'],
			'sku'                   => $row['sku'] ?? '',
			'description'           => $row['description'] ?? '',
			'price'                 => (float)$row['price'],
			'stock'                 => (int)$row['quantity'],
			'weight'                => (float)$row['weight'],
			'status'                => (int)$row['status'],
			'images'                => $images,
			'category_external_ids' => $category_external_ids,
			'options'               => $options,
		];
	}
	return $out;
}

function ci_opencart_extract_customers(PDO $oc, string $prefix): array {
	$stmt = $oc->query(
		"SELECT customer_id, firstname, lastname, email FROM `{$prefix}customer` WHERE status = 1"
	);
	$customers_raw = $stmt->fetchAll(PDO::FETCH_ASSOC);

	// Prefer the address flagged default; fall back to any address on file so a
	// customer isn't dropped just because they never set one as default.
	$addr_stmt = $oc->prepare(
		"SELECT a.address_1, a.address_2, a.city, a.postcode, co.iso_code_2, z.code AS zone_code
		 FROM `{$prefix}address` a
		 LEFT JOIN `{$prefix}country` co ON co.country_id = a.country_id
		 LEFT JOIN `{$prefix}zone` z ON z.zone_id = a.zone_id
		 WHERE a.customer_id = ?
		 ORDER BY a.`default` DESC
		 LIMIT 1"
	);

	$out = [];
	foreach ($customers_raw as $row) {
		$addr_stmt->execute([$row['customer_id']]);
		$addr = $addr_stmt->fetch(PDO::FETCH_ASSOC) ?: [];

		$out[] = [
			'external_id' => (string)$row['customer_id'],
			'email'       => $row['email'],
			'first_name'  => $row['firstname'] ?? '',
			'last_name'   => $row['lastname'] ?? '',
			'address1'    => $addr['address_1'] ?? '',
			'address2'    => $addr['address_2'] ?? '',
			'city'        => $addr['city'] ?? '',
			'state'       => $addr['zone_code'] ?? '',
			'zip'         => $addr['postcode'] ?? '',
			'country'     => $addr['iso_code_2'] ?? 'US',
		];
	}
	return $out;
}
