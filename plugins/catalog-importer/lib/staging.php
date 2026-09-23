<?php
/**
 * Catalog Importer — common staging format and loader.
 *
 * This is the source-agnostic half of the import pipeline. A source-specific
 * adapter (OpenCart DB reader, Shopify CSV parser, Etsy CSV parser, etc.) is
 * responsible for producing an array in the shape documented below; this file
 * is responsible for getting that array into EdgeCart's own tables safely and
 * idempotently (re-running the same staged data updates existing rows instead
 * of duplicating them).
 *
 * ── Staging shape ───────────────────────────────────────────────────────────
 *
 * [
 *   'categories' => [
 *     [
 *       'external_id'         => 'src-123',   // adapter's own id, for the result map only
 *       'name'                => 'T-Shirts',
 *       'slug'                => 'tshirts',   // optional — derived from name if omitted
 *       'description'         => '...',       // optional
 *       'image'               => 'tshirts.webp', // optional — filename/path only, not fetched here
 *       'parent_external_id'  => 'src-100',   // optional — must match another category's external_id
 *       'display_order'       => 0,           // optional
 *     ],
 *     ...
 *   ],
 *   'products' => [
 *     [
 *       'external_id'           => 'src-456',
 *       'name'                  => 'Classic Tee',
 *       'slug'                  => 'classic-tee',    // optional — derived from name if omitted
 *       'sku'                   => 'CT-001',          // optional
 *       'description'           => '...',             // optional, short description
 *       'description_long'      => '...',             // optional
 *       'price'                 => 24.00,
 *       'list_price'            => 0.00,               // optional, 0 = no compare-at price
 *       'stock'                 => 50,                 // optional, default 0
 *       'weight'                => 0.5,                // optional
 *       'status'                => 1,                  // optional, default 1 (active)
 *       'featured'              => false,              // optional
 *       'images'                => ['classic-tee-1.webp', 'classic-tee-2.webp'], // optional
 *       'category_external_ids' => ['src-123'],        // optional — matches categories[].external_id
 *       'options' => [                                 // optional — variants
 *         [
 *           'name'   => 'Size',
 *           'values' => [
 *             ['value' => 'Small', 'price_modifier' => 0,    'stock' => 20],
 *             ['value' => 'Large', 'price_modifier' => 2.00, 'stock' => 30],
 *           ],
 *         ],
 *       ],
 *     ],
 *     ...
 *   ],
 *   'customers' => [
 *     [
 *       'external_id' => 'src-789',   // optional
 *       'email'       => 'jane@example.com',
 *       'first_name'  => 'Jane',
 *       'last_name'   => 'Doe',
 *       'address1'    => '...',       // optional
 *       'address2'    => '...',       // optional
 *       'city'        => '...',       // optional
 *       'state'       => '...',       // optional
 *       'zip'         => '...',       // optional
 *       'country'     => 'US',        // optional, default 'US'
 *       'notes'       => '...',       // optional
 *     ],
 *     ...
 *   ],
 * ]
 *
 * Imported customers get a random, unusable password hash rather than a
 * fabricated one — they're expected to use "Forgot your password?" on first
 * login, same as any other account that needs a fresh credential.
 *
 * Images: this loader stores whatever string the adapter provides directly in
 * `product_images.filename` / `categories.image`. Downloading remote images
 * and placing them under img/products/ or img/categories/ is the adapter's
 * job, done before staging data is handed to this loader — this file assumes
 * the filename is already correct and in place.
 */

function ci_slugify(string $text): string {
	$slug = strtolower(trim($text));
	$slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
	return trim($slug, '-') ?: 'item-' . substr(md5($text . microtime()), 0, 8);
}

// ── Categories ───────────────────────────────────────────────────────────────

function ci_import_categories(PDO $pdo, string $p, array $categories): array {
	$id_map      = [];  // external_id => real id
	$slug_to_id  = [];  // slug => real id, so parent lookups work even without external_id
	$parent_link = [];  // real id => parent external_id, resolved in a second pass
	$skipped     = 0;

	// Shared with the manual "Add Category" flow (lib/license-limits.php) —
	// a bulk import must not be able to create more categories than the
	// store's license allows just because it bypasses that form.
	$limitCheck = check_category_limit($p);
	$limit = $limitCheck['limit'];
	$count = $limitCheck['count'];

	foreach ($categories as $cat) {
		$name = trim((string)($cat['name'] ?? ''));
		if ($name === '') continue;

		$slug = trim((string)($cat['slug'] ?? '')) ?: ci_slugify($name);

		$existing = DB::row("SELECT id FROM `{$p}categories` WHERE slug = ?", [$slug]);

		if ($existing) {
			$id = (int)$existing['id'];
			DB::exec(
				"UPDATE `{$p}categories` SET name=?, description=?, image=?, display_order=? WHERE id=?",
				[$name, $cat['description'] ?? '', $cat['image'] ?? '', (int)($cat['display_order'] ?? 0), $id]
			);
		} else {
			if ($count >= $limit) { $skipped++; continue; }
			$id = DB::insert(
				"INSERT INTO `{$p}categories` (name, slug, description, image, display_order, status) VALUES (?,?,?,?,?,1)",
				[$name, $slug, $cat['description'] ?? '', $cat['image'] ?? '', (int)($cat['display_order'] ?? 0)]
			);
			$count++;
		}

		if (isset($cat['external_id'])) $id_map[(string)$cat['external_id']] = $id;
		$slug_to_id[$slug] = $id;
		if (!empty($cat['parent_external_id'])) $parent_link[$id] = (string)$cat['parent_external_id'];
	}

	// Second pass: parents may appear after their children in the input array,
	// so resolve parent_id only once every category has a real id.
	foreach ($parent_link as $child_id => $parent_external_id) {
		if (isset($id_map[$parent_external_id])) {
			DB::exec("UPDATE `{$p}categories` SET parent_id=? WHERE id=?", [$id_map[$parent_external_id], $child_id]);
		}
	}

	return ['id_map' => $id_map, 'skipped' => $skipped];
}

// ── Options (global, shared across products — deduped by name/text) ─────────

function ci_get_or_create_option(PDO $pdo, string $p, string $name): int {
	$row = DB::row("SELECT id FROM `{$p}options` WHERE name = ?", [$name]);
	if ($row) return (int)$row['id'];
	return DB::insert("INSERT INTO `{$p}options` (name, type) VALUES (?, 'select')", [$name]);
}

function ci_get_or_create_option_value(PDO $pdo, string $p, int $option_id, string $text): int {
	$row = DB::row("SELECT id FROM `{$p}option_values` WHERE option_id = ? AND text = ?", [$option_id, $text]);
	if ($row) return (int)$row['id'];
	return DB::insert("INSERT INTO `{$p}option_values` (option_id, text) VALUES (?, ?)", [$option_id, $text]);
}

// ── Products ─────────────────────────────────────────────────────────────────

function ci_import_products(PDO $pdo, string $p, array $products, array $category_id_map): array {
	$id_map = [];
	$stats  = ['created' => 0, 'updated' => 0, 'skipped' => 0];

	// Shared with manual product editing (lib/license-limits.php) — a bulk
	// import must not be able to exceed the store's license limits just
	// because it bypasses that form.
	$opt_limit = license_limit('options_per_product', 2);
	$img_limit = license_limit('images_per_product', 2);

	foreach ($products as $prod) {
		$name = trim((string)($prod['name'] ?? ''));
		if ($name === '') { $stats['skipped']++; continue; }

		$slug = trim((string)($prod['slug'] ?? '')) ?: ci_slugify($name);
		$price = (float)($prod['price'] ?? 0);

		$cat_ext_ids = clamp_product_categories(array_values($prod['category_external_ids'] ?? []))['ids'];
		$prod['category_external_ids'] = $cat_ext_ids;
		$prod['options'] = array_slice($prod['options'] ?? [], 0, $opt_limit);
		$prod['images']  = array_slice($prod['images'] ?? [], 0, $img_limit);

		$fields = [
			'name'              => $name,
			'slug'              => $slug,
			'sku'               => (string)($prod['sku'] ?? ''),
			'description'       => (string)($prod['description'] ?? ''),
			'description_long'  => (string)($prod['description_long'] ?? ''),
			'price'             => $price,
			'list_price'        => (float)($prod['list_price'] ?? 0),
			'stock'             => (int)($prod['stock'] ?? 0),
			'weight'            => (float)($prod['weight'] ?? 0),
			'status'            => isset($prod['status']) ? (int)!!$prod['status'] : 1,
			'featured'          => (int)!!($prod['featured'] ?? false),
		];

		$existing = DB::row("SELECT id FROM `{$p}products` WHERE slug = ?", [$slug]);

		// Mirrors admin/ctl/products/ajax.php's per-category product cap: a
		// brand-new product bound for an already-full category is rejected
		// outright there, so a bulk import must reject (skip) it here too
		// rather than silently overflowing the category past its limit.
		if (!$existing) {
			foreach ($cat_ext_ids as $cat_ext_id) {
				$cat_id = $category_id_map[(string)$cat_ext_id] ?? null;
				if (!$cat_id) continue;
				if (!check_products_per_cat_limit($p, $cat_id)['ok']) {
					$stats['skipped']++;
					continue 2;
				}
			}
		}

		if ($existing) {
			$id = (int)$existing['id'];
			DB::exec(
				"UPDATE `{$p}products` SET name=?, sku=?, description=?, description_long=?, price=?, list_price=?, stock=?, weight=?, status=?, featured=? WHERE id=?",
				[$fields['name'], $fields['sku'], $fields['description'], $fields['description_long'],
				 $fields['price'], $fields['list_price'], $fields['stock'], $fields['weight'],
				 $fields['status'], $fields['featured'], $id]
			);
			$stats['updated']++;
		} else {
			$id = DB::insert(
				"INSERT INTO `{$p}products` (name, slug, sku, description, description_long, price, list_price, stock, weight, status, featured) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
				[$fields['name'], $fields['slug'], $fields['sku'], $fields['description'], $fields['description_long'],
				 $fields['price'], $fields['list_price'], $fields['stock'], $fields['weight'],
				 $fields['status'], $fields['featured']]
			);
			$stats['created']++;
		}

		if (isset($prod['external_id'])) $id_map[(string)$prod['external_id']] = $id;

		// Images — replace wholesale on re-import, simplest way to stay idempotent
		DB::exec("DELETE FROM `{$p}product_images` WHERE product_id = ?", [$id]);
		foreach (array_values($prod['images'] ?? []) as $i => $filename) {
			DB::exec(
				"INSERT INTO `{$p}product_images` (product_id, filename, is_primary, display_order) VALUES (?,?,?,?)",
				[$id, $filename, $i === 0 ? 1 : 0, $i]
			);
		}

		// Category links — replace wholesale on re-import
		DB::exec("DELETE FROM `{$p}categories_products` WHERE product_id = ?", [$id]);
		foreach ($prod['category_external_ids'] ?? [] as $cat_ext_id) {
			if (isset($category_id_map[(string)$cat_ext_id])) {
				DB::exec(
					"INSERT IGNORE INTO `{$p}categories_products` (category_id, product_id) VALUES (?,?)",
					[$category_id_map[(string)$cat_ext_id], $id]
				);
			}
		}

		// Options/variants — replace wholesale on re-import; global options/values
		// themselves are deduped and left alone (other products may share them)
		$existing_option_ids = DB::rows("SELECT id FROM `{$p}product_options` WHERE product_id = ?", [$id]);
		foreach ($existing_option_ids as $row) {
			DB::exec("DELETE FROM `{$p}product_option_values` WHERE product_option_id = ?", [$row['id']]);
		}
		DB::exec("DELETE FROM `{$p}product_options` WHERE product_id = ?", [$id]);

		foreach ($prod['options'] ?? [] as $i => $option) {
			$option_name = trim((string)($option['name'] ?? ''));
			if ($option_name === '') continue;

			$option_id = ci_get_or_create_option($pdo, $p, $option_name);
			$product_option_id = DB::insert(
				"INSERT INTO `{$p}product_options` (product_id, option_id, label, required, display_order) VALUES (?,?,?,1,?)",
				[$id, $option_id, $option_name, $i]
			);

			foreach ($option['values'] ?? [] as $j => $val) {
				$value_text = trim((string)($val['value'] ?? ''));
				if ($value_text === '') continue;

				$option_value_id = ci_get_or_create_option_value($pdo, $p, $option_id, $value_text);
				$modifier = (float)($val['price_modifier'] ?? 0);
				DB::exec(
					"INSERT INTO `{$p}product_option_values` (product_option_id, option_value_id, label, price_modifier, price_prefix, stock) VALUES (?,?,?,?,?,?)",
					[$product_option_id, $option_value_id, $value_text, abs($modifier), $modifier < 0 ? '-' : '+', (int)($val['stock'] ?? 0)]
				);
			}
		}
	}

	return ['id_map' => $id_map, 'stats' => $stats];
}

// ── Customers ────────────────────────────────────────────────────────────────

function ci_import_customers(PDO $pdo, string $p, array $customers): array {
	$id_map = [];
	$stats  = ['created' => 0, 'updated' => 0, 'skipped' => 0];

	foreach ($customers as $cust) {
		$email = strtolower(trim((string)($cust['email'] ?? '')));
		if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $stats['skipped']++; continue; }

		$fields = [
			'first_name' => (string)($cust['first_name'] ?? ''),
			'last_name'  => (string)($cust['last_name'] ?? ''),
			'address1'   => (string)($cust['address1'] ?? ''),
			'address2'   => (string)($cust['address2'] ?? ''),
			'city'       => (string)($cust['city'] ?? ''),
			'state'      => (string)($cust['state'] ?? ''),
			'zip'        => (string)($cust['zip'] ?? ''),
			'country'    => (string)($cust['country'] ?? 'US'),
			'notes'      => (string)($cust['notes'] ?? ''),
		];

		$existing = DB::row("SELECT id FROM `{$p}customers` WHERE email = ?", [$email]);

		if ($existing) {
			$id = (int)$existing['id'];
			DB::exec(
				"UPDATE `{$p}customers` SET first_name=?, last_name=?, address1=?, address2=?, city=?, state=?, zip=?, country=?, notes=? WHERE id=?",
				[$fields['first_name'], $fields['last_name'], $fields['address1'], $fields['address2'],
				 $fields['city'], $fields['state'], $fields['zip'], $fields['country'], $fields['notes'], $id]
			);
			$stats['updated']++;
		} else {
			// No usable password is set for an imported account — the customer
			// resets it via "Forgot your password?" on first login, same as any
			// other account that needs a fresh credential.
			$unusable_password = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT);
			$id = DB::insert(
				"INSERT INTO `{$p}customers` (email, password, first_name, last_name, address1, address2, city, state, zip, country, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
				[$email, $unusable_password, $fields['first_name'], $fields['last_name'], $fields['address1'],
				 $fields['address2'], $fields['city'], $fields['state'], $fields['zip'], $fields['country'], $fields['notes']]
			);
			$stats['created']++;
		}

		if (isset($cust['external_id'])) $id_map[(string)$cust['external_id']] = $id;
	}

	return ['id_map' => $id_map, 'stats' => $stats];
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

function ci_run_import(array $staged): array {
	$pdo = DB::pdo();
	$p   = DB_PREFIX;

	$category_result = ci_import_categories($pdo, $p, $staged['categories'] ?? []);
	$product_result   = ci_import_products($pdo, $p, $staged['products'] ?? [], $category_result['id_map']);
	$customer_result  = ci_import_customers($pdo, $p, $staged['customers'] ?? []);

	return [
		'categories' => ['imported' => count($category_result['id_map']), 'skipped' => $category_result['skipped']],
		'products'   => $product_result['stats'],
		'customers'  => $customer_result['stats'],
	];
}
