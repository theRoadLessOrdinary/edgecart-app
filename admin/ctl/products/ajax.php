<?php
/**
 * new-cart admin — products ajax handler
 * route=products/ajax
 */

require_admin();
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();

$p      = DB_PREFIX;
$action = post('action');

// ── List ───────────────────────────────────────────────────────────────────────
if ($action === 'list') {
	$rows = DB::rows("
		SELECT p.id, p.name, p.slug, p.sku, p.price, p.list_price, p.weight,
		       p.stock, p.status, p.featured, p.free_shipping, p.requires_shipping, p.display_order, p.featured_order,
		       GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ') AS categories,
		       COALESCE(GROUP_CONCAT(DISTINCT c.id ORDER BY c.name SEPARATOR ','), '') AS category_ids
		FROM `{$p}products` p
		LEFT JOIN `{$p}categories_products` cp ON cp.product_id = p.id
		LEFT JOIN `{$p}categories` c ON c.id = cp.category_id
		GROUP BY p.id
		ORDER BY p.display_order ASC, p.name ASC
	");
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Get single ────────────────────────────────────────────────────────────────
if ($action === 'get') {
	$id  = (int)post('id');
	$row = DB::row("SELECT * FROM `{$p}products` WHERE id = ?", [$id]);
	if (!$row) ajax_out(false, 'Product not found.');

	// Category ids
	$cat_ids = DB::rows(
		"SELECT category_id FROM `{$p}categories_products` WHERE product_id = ?",
		[$id]
	);
	$row['category_ids'] = array_column($cat_ids, 'category_id');

	// Images
	$images = DB::rows(
		"SELECT * FROM `{$p}product_images` WHERE product_id = ? ORDER BY display_order ASC",
		[$id]
	);
	$row['images'] = $images;

	ajax_out(true, '', ['row' => $row]);
}

// ── Save (insert or update) ────────────────────────────────────────────────────
if ($action === 'save') {
	require_access(ACCESS_EDIT);

	$id              = (int)post('id');
	$name            = trim(post('name'));
	$sku             = trim(post('sku'));
	$price           = (float)post('price');
	$list_price      = (float)post('list_price');
	$weight          = post('weight') !== '' ? (float)post('weight') : 0;
	$stock           = (int)post('stock');
	$status          = (int)post('status');
	$featured        = (int)(bool)post('featured');
	$free_ship       = (int)(bool)post('free_shipping');
	$requires_ship   = (int)(bool)post('requires_shipping', true);
	$desc_short      = trim(post('description'));
	$desc_long       = post('description_long');
	if ($desc_long === 'false') $desc_long = '';
	$seo_title       = trim(post('seo_title'));
	$seo_keywords    = trim(post('seo_keywords'));
	$seo_description = trim(post('seo_description'));
	$cat_ids         = json_decode(post('category_ids') ?: '[]', true);
	$cat_ids         = array_map('intval', (array)$cat_ids);

	// Enforce per-product category limit
	$cat_ids = clamp_product_categories($cat_ids)['ids'];

	if (!$name) ajax_out(false, 'Product name is required.');
	if ($price < 0) ajax_out(false, 'Price cannot be negative.');

	// Slug
	$slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $name), '-'));
	$existing = DB::row(
		"SELECT id FROM `{$p}products` WHERE slug = ? AND id != ?",
		[$slug, $id]
	);
	if ($existing) $slug .= '-' . ($id ?: time());

	$taxable         = (int)(bool)post('taxable', true);

	if ($id) {
		require_access(ACCESS_EDIT);
		$params = [$name, $slug, $sku, $price, $list_price, $weight, $stock,
		           $status, $featured, $free_ship, $requires_ship, $taxable, $desc_short, $desc_long,
		           $seo_title, $seo_keywords, $seo_description, $id];
		DB::exec("UPDATE `{$p}products` SET
			name=?, slug=?, sku=?, price=?, list_price=?, weight=?, stock=?,
			status=?, featured=?, free_shipping=?, requires_shipping=?, taxable=?, description=?, description_long=?,
			seo_title=?, seo_keywords=?, seo_description=?
			WHERE id=?", $params);
	} else {
		require_access(ACCESS_ADD);
		// Check per-category product limit
		foreach ($cat_ids as $cid) {
			if ($cid <= 0) continue;
			$limitCheck = check_products_per_cat_limit($p, $cid);
			if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);
		}
		$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}products`");
		$id  = DB::insert("INSERT INTO `{$p}products`
			(name, slug, sku, price, list_price, weight, stock, status, featured,
			 free_shipping, requires_shipping, taxable, description, description_long,
			 seo_title, seo_keywords, seo_description, display_order)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[$name, $slug, $sku, $price, $list_price, $weight, $stock, $status, $featured,
			 $free_ship, $requires_ship, $taxable, $desc_short, $desc_long,
			 $seo_title, $seo_keywords, $seo_description, $max + 1]
		);
	}

	// Update categories
	DB::exec("DELETE FROM `{$p}categories_products` WHERE product_id = ?", [$id]);
	foreach ($cat_ids as $cid) {
		if ($cid > 0) {
			DB::exec(
				"INSERT IGNORE INTO `{$p}categories_products` (category_id, product_id) VALUES (?, ?)",
				[$cid, $id]
			);
		}
	}

	$row = DB::row("
		SELECT p.*, GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ') AS categories
		FROM `{$p}products` p
		LEFT JOIN `{$p}categories_products` cp ON cp.product_id = p.id
		LEFT JOIN `{$p}categories` c ON c.id = cp.category_id
		WHERE p.id = ?
		GROUP BY p.id
	", [$id]);

	ajax_out(true, 'Product saved.', ['row' => $row]);
}

// ── Toggle field ──────────────────────────────────────────────────────────────
if ($action === 'toggle') {
	require_access(ACCESS_EDIT);
	$id    = (int)post('id');
	$field = post('field');
	$value = (int)post('value');

	$allowed = ['status', 'featured', 'free_shipping', 'requires_shipping', 'taxable'];
	if (!in_array($field, $allowed, true)) ajax_out(false, 'Invalid field.');

	DB::exec("UPDATE `{$p}products` SET `{$field}` = ? WHERE id = ?", [$value, $id]);
	ajax_out(true, '');
}

// ── Reorder ───────────────────────────────────────────────────────────────────
if ($action === 'reorder') {
	require_access(ACCESS_EDIT);

	$field = post('field') ?: 'display_order';
	if (!in_array($field, ['display_order', 'featured_order'], true)) ajax_out(false, 'Invalid field.');

	$ids = json_decode(post('ids'), true);
	if (!is_array($ids)) ajax_out(false, 'Invalid order data.');
	foreach ($ids as $order => $id) {
		DB::exec("UPDATE `{$p}products` SET `{$field}` = ? WHERE id = ?", [$order, (int)$id]);
	}
	ajax_out(true, '');
}

// ── Delete ────────────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}products` WHERE id = ?", [$id]);
	DB::exec("DELETE FROM `{$p}categories_products` WHERE product_id = ?", [$id]);
	DB::exec("DELETE FROM `{$p}product_images` WHERE product_id = ?", [$id]);
	DB::exec("DELETE FROM `{$p}product_related` WHERE product_id = ? OR related_product_id = ?", [$id, $id]);
	ajax_out(true, 'Product deleted.');
}

// ── Bulk delete ───────────────────────────────────────────────────────────────
if ($action === 'bulk_delete') {
	require_access(ACCESS_DELETE);
	$ids = json_decode(post('ids'), true);
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'No products selected.');
	$ids          = array_map('intval', $ids);
	$placeholders = implode(',', array_fill(0, count($ids), '?'));
	DB::exec("DELETE FROM `{$p}products` WHERE id IN ({$placeholders})", $ids);
	DB::exec("DELETE FROM `{$p}categories_products` WHERE product_id IN ({$placeholders})", $ids);
	DB::exec("DELETE FROM `{$p}product_images` WHERE product_id IN ({$placeholders})", $ids);
	DB::exec("DELETE FROM `{$p}product_related` WHERE product_id IN ({$placeholders}) OR related_product_id IN ({$placeholders})", array_merge($ids, $ids));
	ajax_out(true, count($ids) . ' product' . (count($ids) === 1 ? '' : 's') . ' deleted.');
}

// ── Clone ─────────────────────────────────────────────────────────────────────
if ($action === 'clone') {
	require_access(ACCESS_ADD);
	$id  = (int)post('id');
	$src = DB::row("SELECT * FROM `{$p}products` WHERE id=?", [$id]);
	if (!$src) ajax_out(false, 'Product not found.');

	// Unique slug
	$slug = $src['slug'] . '-copy';
	$n = 1;
	while (DB::val("SELECT id FROM `{$p}products` WHERE slug=?", [$slug])) {
		$slug = $src['slug'] . '-copy-' . (++$n);
	}

	$max    = (int)DB::val("SELECT MAX(display_order) FROM `{$p}products`");
	$new_id = DB::insert(
		"INSERT INTO `{$p}products`
			(name, slug, sku, description, description_long, price, list_price,
			 stock, status, featured, free_shipping, requires_shipping, display_order)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
		[
			$src['name'] . ' (Copy)', $slug, $src['sku'],
			$src['description'], $src['description_long'],
			$src['price'], $src['list_price'], $src['stock'],
			1, // cloned product starts active
			$src['featured'], $src['free_shipping'], $src['requires_shipping'] ?? 1, $max + 1,
		]
	);

	// Copy categories
	$cats = DB::rows("SELECT category_id FROM `{$p}categories_products` WHERE product_id=?", [$id]);
	foreach ($cats as $cat) {
		DB::exec(
			"INSERT IGNORE INTO `{$p}categories_products` (category_id, product_id) VALUES (?,?)",
			[$cat['category_id'], $new_id]
		);
	}

	// Copy options and their values
	$src_opts = DB::rows("SELECT * FROM `{$p}product_options` WHERE product_id=? ORDER BY display_order ASC", [$id]);
	foreach ($src_opts as $opt) {
		$new_po_id = DB::insert(
			"INSERT INTO `{$p}product_options` (product_id, option_id, label, required, use_as_images, display_order)
			 VALUES (?,?,?,?,?,?)",
			[$new_id, $opt['option_id'], $opt['label'], $opt['required'], $opt['use_as_images'] ?? 0, $opt['display_order']]
		);
		$vals = DB::rows("SELECT * FROM `{$p}product_option_values` WHERE product_option_id=?", [$opt['id']]);
		foreach ($vals as $v) {
			DB::exec(
				"INSERT INTO `{$p}product_option_values`
				 (product_option_id, option_value_id, label, price_modifier, price_prefix,
				  weight_modifier, weight_prefix, stock, subtract_stock, enabled)
				 VALUES (?,?,?,?,?,?,?,?,?,?)",
				[$new_po_id, $v['option_value_id'], $v['label'], $v['price_modifier'],
				 $v['price_prefix'], $v['weight_modifier'], $v['weight_prefix'],
				 $v['stock'], $v['subtract_stock'], $v['enabled']]
			);
		}
	}

	$row = DB::row("
		SELECT p.*, GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ') AS categories,
		       COALESCE(GROUP_CONCAT(DISTINCT c.id ORDER BY c.name SEPARATOR ','), '') AS category_ids
		FROM `{$p}products` p
		LEFT JOIN `{$p}categories_products` cp ON cp.product_id = p.id
		LEFT JOIN `{$p}categories` c ON c.id = cp.category_id
		WHERE p.id = ?
		GROUP BY p.id
	", [$new_id]);

	ajax_out(true, 'Product cloned.', ['row' => $row]);
}

// ── Upload image ──────────────────────────────────────────────────────────────
if ($action === 'upload_image') {
	require_access(ACCESS_EDIT);
	$product_id = (int)post('product_id');
	$is_primary  = (int)(bool)post('is_primary');
	if (!$product_id) ajax_out(false, 'Product ID required.');

	// Check per-product image limit
	$limitCheck = check_images_per_product_limit($p, $product_id);
	if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);

	if (empty($_FILES['image']['name'])) {
		ajax_out(false, 'No file received by server (product_id=' . $product_id . ').');
	}
	if ($_FILES['image']['error'] !== UPLOAD_ERR_OK) {
		$_err_labels = [1=>'File exceeds upload_max_filesize',2=>'File exceeds MAX_FILE_SIZE',3=>'Partial upload',4=>'No file sent',6=>'Missing temp folder',7=>'Failed to write to disk'];
		ajax_out(false, $_err_labels[$_FILES['image']['error']] ?? 'Upload error code ' . $_FILES['image']['error']);
	}

	$allowed = ['image/jpeg', 'image/png', 'image/webp'];
	$mime    = mime_content_type($_FILES['image']['tmp_name']);
	if (!in_array($mime, $allowed, true)) ajax_out(false, 'Only JPG, PNG and WebP are allowed.');

	$ext      = match($mime) { 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp' };
	$dest_dir = rtrim(DIR_ROOT, '/') . '/img/products/';
	if (!is_dir($dest_dir)) @mkdir($dest_dir, 0755, true);

	// Check if we should retain original image names
	$retain_names = (bool)(int)DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='img_retain_names'", []);
	if ($retain_names) {
		// Use original filename (sanitized)
		$orig_name = pathinfo($_FILES['image']['name'], PATHINFO_FILENAME);
		$orig_name = preg_replace('/[^a-z0-9\-_]/i', '_', $orig_name);
		$orig_name = substr($orig_name, 0, 100); // Limit length
		$filename = $orig_name . '.' . $ext;
		// If file exists, add product ID to avoid collisions
		if (file_exists($dest_dir . $filename)) {
			$filename = 'prod_' . $product_id . '_' . $orig_name . '.' . $ext;
		}
	} else {
		// Generate unique filename
		$filename = 'prod_' . $product_id . '_' . uniqid() . '.' . $ext;
	}
	$dest = $dest_dir . $filename;

	$src = match($mime) {
		'image/jpeg' => @imagecreatefromjpeg($_FILES['image']['tmp_name']),
		'image/png'  => @imagecreatefrompng($_FILES['image']['tmp_name']),
		'image/webp' => @imagecreatefromwebp($_FILES['image']['tmp_name']),
	};
	if (!$src) ajax_out(false, 'Could not read image.');

	// EXIF rotation fix
	if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
		$exif        = @exif_read_data($_FILES['image']['tmp_name']);
		$orientation = $exif['Orientation'] ?? 1;
		$src         = match($orientation) {
			3 => imagerotate($src, 180, 0),
			6 => imagerotate($src,  -90, 0),
			8 => imagerotate($src,   90, 0),
			default => $src,
		};
	}

	// Resize using saved settings (img_resize_on_upload, img_orig_max, img_product_quality)
	$_img_rows = DB::rows("SELECT `key`,`value` FROM `{$p}settings` WHERE `key` IN ('img_resize_on_upload','img_orig_max','img_product_quality')");
	$_img_cfg  = [];
	foreach ($_img_rows as $_r) $_img_cfg[$_r['key']] = $_r['value'];
	$do_resize   = (bool)(int)($_img_cfg['img_resize_on_upload'] ?? 1);
	$max_px      = max(200, (int)($_img_cfg['img_orig_max']        ?? 1200));
	$quality     = max(1, min(100, (int)($_img_cfg['img_product_quality'] ?? 85)));
	$png_quality = (int)round((100 - $quality) / 10); // 0–9 (inverted)

	$srcW = imagesx($src); $srcH = imagesy($src);
	if ($do_resize && $srcW > $max_px) {
		$newH    = (int)($srcH * $max_px / $srcW);
		$resized = imagecreatetruecolor($max_px, $newH);
		imagealphablending($resized, false);
		imagesavealpha($resized, true);
		$trans = imagecolorallocatealpha($resized, 255, 255, 255, 127);
		imagefilledrectangle($resized, 0, 0, $max_px, $newH, $trans);
		imagecopyresampled($resized, $src, 0, 0, 0, 0, $max_px, $newH, $srcW, $srcH);
		imagedestroy($src); $src = $resized;
	}

	$saved = match($mime) {
		'image/jpeg' => imagejpeg($src, $dest, $quality),
		'image/png'  => imagepng($src, $dest, $png_quality),
		'image/webp' => imagewebp($src, $dest, $quality),
	};
	imagedestroy($src);
	if (!$saved) ajax_out(false, 'Could not save image.');

	// If primary, clear other primaries
	if ($is_primary) {
		DB::exec("UPDATE `{$p}product_images` SET is_primary=0 WHERE product_id=?", [$product_id]);
	}

	$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}product_images` WHERE product_id=?", [$product_id]);
	$img_id = DB::insert(
		"INSERT INTO `{$p}product_images` (product_id, filename, is_primary, display_order) VALUES (?,?,?,?)",
		[$product_id, '/img/products/' . $filename, $is_primary, $max + 1]
	);

	ajax_out(true, 'Image uploaded.', ['image' => [
		'id'        => $img_id,
		'filename'  => '/img/products/' . $filename,
		'is_primary'=> $is_primary,
	]]);
}

// ── Reorder images ────────────────────────────────────────────────────────────
if ($action === 'reorder_images') {
	require_access(ACCESS_EDIT);
	$product_id = (int)post('product_id');
	$ids        = json_decode(post('ids'), true);
	$primary_id = (int)post('primary_id');
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'Invalid data.');
	foreach ($ids as $order => $id) {
		$id = (int)$id;
		DB::exec(
			"UPDATE `{$p}product_images` SET display_order = ?, is_primary = ? WHERE id = ? AND product_id = ?",
			[$order, ($id === $primary_id ? 1 : 0), $id, $product_id]
		);
	}
	ajax_out(true, '');
}

// ── Delete single image ────────────────────────────────────────────────────────
if ($action === 'delete_image') {
	require_access(ACCESS_EDIT);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}product_images` WHERE id = ?", [$id]);
	ajax_out(true, '');
}

// ── Link file-manager image to product ────────────────────────────────────────
if ($action === 'link_fm_image') {
	require_access(ACCESS_EDIT);
	$product_id = (int)post('product_id');
	$db_path    = trim(post('db_path'));

	if (!$product_id || !$db_path) ajax_out(false, 'Invalid data.');
	if (!preg_match('#^/img/#i', $db_path)) ajax_out(false, 'Invalid image path.');

	// Check per-product image limit (existing record reuse doesn't count)
	$already_linked = (bool)DB::val(
		"SELECT id FROM `{$p}product_images` WHERE product_id=? AND filename=?",
		[$product_id, $db_path]
	);
	if (!$already_linked) {
		$limitCheck = check_images_per_product_limit($p, $product_id);
		if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);
	}

	$full_path = rtrim(DIR_ROOT, '/') . $db_path;
	if (!file_exists($full_path)) ajax_out(false, 'Image file not found.');

	// Return existing record without inserting a duplicate
	$exists_id = (int)DB::val(
		"SELECT id FROM `{$p}product_images` WHERE product_id=? AND filename=?",
		[$product_id, $db_path]
	);
	if ($exists_id) {
		ajax_out(true, '', ['image' => ['id' => $exists_id, 'filename' => $db_path, 'is_primary' => 0]]);
	}

	$max    = (int)DB::val("SELECT MAX(display_order) FROM `{$p}product_images` WHERE product_id=?", [$product_id]);
	$img_id = DB::insert(
		"INSERT INTO `{$p}product_images` (product_id, filename, is_primary, display_order) VALUES (?,?,0,?)",
		[$product_id, $db_path, $max + 1]
	);

	ajax_out(true, '', ['image' => [
		'id'         => $img_id,
		'filename'   => $db_path,
		'is_primary' => 0,
	]]);
}

// ── Save stock (inline edit) ──────────────────────────────────────────────────
if ($action === 'save_stock') {
	require_access(ACCESS_EDIT);
	$id    = (int)post('id');
	$stock = max(-1, (int)post('stock'));
	DB::exec("UPDATE `{$p}products` SET stock=? WHERE id=?", [$stock, $id]);
	ajax_out(true, '');
}

// ── Save prices (inline edit) ─────────────────────────────────────────────────
if ($action === 'save_prices') {
	require_access(ACCESS_PRICING);
	$id         = (int)post('id');
	$price      = (float)post('price');
	$list_price = (float)post('list_price');
	if ($price < 0) ajax_out(false, 'Price cannot be negative.');
	DB::exec(
		"UPDATE `{$p}products` SET price=?, list_price=? WHERE id=?",
		[$price, $list_price, $id]
	);
	ajax_out(true, '');
}

// ── Quick-add category ────────────────────────────────────────────────────────
if ($action === 'quick_add_category') {
	require_access(ACCESS_ADD);

	$name = trim(post('name'));
	if (!$name) ajax_out(false, 'Category name is required.');

	$limitCheck = check_category_limit($p);
	if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);

	$slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $name), '-'));
	$existing = DB::row("SELECT id FROM `{$p}categories` WHERE slug=?", [$slug]);
	if ($existing) $slug .= '-' . time();

	$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}categories`");
	$id  = DB::insert(
		"INSERT INTO `{$p}categories` (name, slug, status, display_order) VALUES (?, ?, 1, ?)",
		[$name, $slug, $max + 1]
	);

	// Mark as incomplete — needs full details
	reminder_add(
		'category', $id, $name,
		'Category "' . $name . '" was quick-added and needs its full details set.'
	);

	ajax_out(true, 'Category added.', ['category' => ['id' => $id, 'name' => $name]]);
}

// ── Category options ──────────────────────────────────────────────────────────
if ($action === 'categories') {
	$cats = DB::rows(
		"SELECT id, name, parent_id FROM `{$p}categories`
		 WHERE status > 0 ORDER BY display_order ASC, name ASC"
	);
	ajax_out(true, '', ['categories' => $cats]);
}

// ── List product options ───────────────────────────────────────────────────────
if ($action === 'list_options') {
	$product_id = (int)post('product_id');
	$pos = DB::rows(
		"SELECT po.*, o.name AS option_name, o.type, o.placeholder
		 FROM `{$p}product_options` po
		 JOIN `{$p}options` o ON o.id = po.option_id
		 WHERE po.product_id = ?
		 ORDER BY po.display_order ASC",
		[$product_id]
	);
	foreach ($pos as &$po) {
		$po['values'] = DB::rows(
			"SELECT pov.*, ov.text AS value_text, ov.image
			 FROM `{$p}product_option_values` pov
			 JOIN `{$p}option_values` ov ON ov.id = pov.option_value_id
			 WHERE pov.product_option_id = ?
			 ORDER BY ov.display_order ASC",
			[$po['id']]
		);
	}
	unset($po);
	ajax_out(true, '', ['product_options' => $pos]);
}

// ── Add option to product ──────────────────────────────────────────────────────
if ($action === 'add_option') {
	require_access(ACCESS_EDIT);
	$product_id = (int)post('product_id');
	$option_id  = (int)post('option_id');

	// Prevent duplicates
	$exists = DB::val(
		"SELECT id FROM `{$p}product_options` WHERE product_id=? AND option_id=?",
		[$product_id, $option_id]
	);
	if ($exists) ajax_out(false, 'This option is already attached to the product.');

	// Check per-product option limit
	$limitCheck = check_options_per_product_limit($p, $product_id);
	if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);

	$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}product_options` WHERE product_id=?", [$product_id]);
	$po_id = DB::insert(
		"INSERT INTO `{$p}product_options` (product_id, option_id, label, required, display_order)
		 VALUES (?,?,'',1,?)",
		[$product_id, $option_id, $max + 1]
	);

	// Populate product_option_values from option_values
	$values = DB::rows(
		"SELECT * FROM `{$p}option_values` WHERE option_id=? ORDER BY display_order ASC",
		[$option_id]
	);
	foreach ($values as $v) {
		// Inherit the option item's own price/weight defaults rather than
		// zeroing them out -- those defaults are the whole point of setting
		// them on the option item; a product that doesn't override them
		// should start from them, not from a flat 0/none.
		DB::exec(
			"INSERT INTO `{$p}product_option_values`
			 (product_option_id, option_value_id, label, price_modifier, price_prefix,
			  weight_modifier, weight_prefix, stock, subtract_stock, enabled)
			 VALUES (?,?,'',?,?,?,'+',0,0,1)",
			[$po_id, $v['id'], $v['price_modifier'] ?? 0.00, $v['price_prefix'] ?? '=', $v['weight_modifier'] ?? 0.0000]
		);
	}

	// Return full option with values
	$po = DB::row(
		"SELECT po.*, o.name AS option_name, o.type, o.placeholder
		 FROM `{$p}product_options` po
		 JOIN `{$p}options` o ON o.id = po.option_id
		 WHERE po.id = ?",
		[$po_id]
	);
	$po['values'] = DB::rows(
		"SELECT pov.*, ov.text AS value_text, ov.image
		 FROM `{$p}product_option_values` pov
		 JOIN `{$p}option_values` ov ON ov.id = pov.option_value_id
		 WHERE pov.product_option_id = ?
		 ORDER BY ov.display_order ASC",
		[$po_id]
	);
	ajax_out(true, '', ['product_option' => $po]);
}

// ── Save product option (label, required, use_as_images) ─────────────────────
if ($action === 'save_option') {
	require_access(ACCESS_EDIT);
	$po_id    = (int)post('po_id');
	$label    = trim(post('label'));
	$required = (int)post('required');
	if (isset($_POST['use_as_images'])) {
		$use_as_images = (int)(bool)post('use_as_images');
		DB::exec(
			"UPDATE `{$p}product_options` SET label=?, required=?, use_as_images=? WHERE id=?",
			[$label, $required, $use_as_images, $po_id]
		);
	} else {
		DB::exec(
			"UPDATE `{$p}product_options` SET label=?, required=? WHERE id=?",
			[$label, $required, $po_id]
		);
	}
	ajax_out(true, '');
}

// ── Remove option from product ────────────────────────────────────────────────
if ($action === 'remove_option') {
	require_access(ACCESS_DELETE);
	$po_id = (int)post('po_id');
	DB::exec("DELETE FROM `{$p}product_option_values` WHERE product_option_id=?", [$po_id]);
	DB::exec("DELETE FROM `{$p}product_options` WHERE id=?", [$po_id]);
	ajax_out(true, '');
}

// ── Clone product option ──────────────────────────────────────────────────────
if ($action === 'clone_option') {
	require_access(ACCESS_ADD);
	$po_id = (int)post('po_id');
	$src   = DB::row("SELECT * FROM `{$p}product_options` WHERE id=?", [$po_id]);
	if (!$src) ajax_out(false, 'Option not found.');

	$max    = (int)DB::val("SELECT MAX(display_order) FROM `{$p}product_options` WHERE product_id=?", [$src['product_id']]);
	$new_id = DB::insert(
		"INSERT INTO `{$p}product_options` (product_id, option_id, label, required, use_as_images, display_order)
		 VALUES (?,?,?,?,?,?)",
		[$src['product_id'], $src['option_id'], $src['label'], $src['required'],
		 $src['use_as_images'] ?? 0, $max + 1]
	);

	$vals = DB::rows("SELECT * FROM `{$p}product_option_values` WHERE product_option_id=?", [$po_id]);
	foreach ($vals as $v) {
		DB::exec(
			"INSERT INTO `{$p}product_option_values`
			 (product_option_id, option_value_id, label, price_modifier, price_prefix,
			  weight_modifier, weight_prefix, stock, subtract_stock, enabled)
			 VALUES (?,?,?,?,?,?,?,?,?,?)",
			[$new_id, $v['option_value_id'], $v['label'], $v['price_modifier'],
			 $v['price_prefix'], $v['weight_modifier'], $v['weight_prefix'],
			 $v['stock'], $v['subtract_stock'], $v['enabled']]
		);
	}

	$po = DB::row(
		"SELECT po.*, o.name AS option_name, o.type, o.placeholder
		 FROM `{$p}product_options` po
		 JOIN `{$p}options` o ON o.id = po.option_id
		 WHERE po.id = ?",
		[$new_id]
	);
	$po['values'] = DB::rows(
		"SELECT pov.*, ov.text AS value_text, ov.image
		 FROM `{$p}product_option_values` pov
		 JOIN `{$p}option_values` ov ON ov.id = pov.option_value_id
		 WHERE pov.product_option_id = ?
		 ORDER BY ov.display_order ASC",
		[$new_id]
	);
	ajax_out(true, 'Option cloned.', ['product_option' => $po]);
}

// ── Save product option value override ────────────────────────────────────────
if ($action === 'save_option_value') {
	require_access(ACCESS_EDIT);
	$pov_id        = (int)post('pov_id');
	$label         = trim(post('label'));
	$_pp           = post('price_prefix');
	$price_prefix  = in_array($_pp, ['+', '-', '=']) ? $_pp : '+';
	$price_mod     = (float)post('price_modifier');
	$weight_prefix = post('weight_prefix') === '-' ? '-' : '+';
	$weight_mod    = (float)post('weight_modifier');
	$stock         = (int)post('stock');
	$subtract      = (int)post('subtract_stock');
	$enabled       = (int)post('enabled');
	$is_default    = (int)(bool)post('is_default');

	// Only one option per product may set an absolute ("=") price — otherwise two
	// "=" values from different options (e.g. Size and Color) fight over the final
	// price and the later one silently wins. All other options must use +/-.
	if ($price_prefix === '=') {
		$conflict = DB::row(
			"SELECT o.name AS option_name
			 FROM `{$p}product_option_values` pov
			 JOIN `{$p}product_options` po ON po.id = pov.product_option_id
			 JOIN `{$p}options` o ON o.id = po.option_id
			 WHERE pov.price_prefix = '=' AND pov.id != ?
			   AND po.product_id = (
			       SELECT product_id FROM `{$p}product_options`
			       WHERE id = (SELECT product_option_id FROM `{$p}product_option_values` WHERE id = ?)
			   )
			   AND po.id != (SELECT product_option_id FROM `{$p}product_option_values` WHERE id = ?)",
			[$pov_id, $pov_id, $pov_id]
		);
		if ($conflict) {
			ajax_out(false, 'Only one option on a product can set an absolute ("=") price. "' . $conflict['option_name'] . '" already does — use + or - here instead.');
		}
	}

	DB::exec(
		"UPDATE `{$p}product_option_values`
		 SET label=?, price_prefix=?, price_modifier=?,
		     weight_prefix=?, weight_modifier=?,
		     stock=?, subtract_stock=?, enabled=?, is_default=?
		 WHERE id=?",
		[$label, $price_prefix, $price_mod, $weight_prefix, $weight_mod,
		 $stock, $subtract, $enabled, $is_default, $pov_id]
	);
	// Only one default value per product option — clear the others when this one is set.
	if ($is_default) {
		$product_option_id = (int)DB::val(
			"SELECT product_option_id FROM `{$p}product_option_values` WHERE id = ?",
			[$pov_id]
		);
		DB::exec(
			"UPDATE `{$p}product_option_values` SET is_default=0
			 WHERE product_option_id = ? AND id != ?",
			[$product_option_id, $pov_id]
		);
	}
	ajax_out(true, '');
}

// ── Search products (for related-products autocomplete) ──────────────────────
if ($action === 'search_products') {
	$q          = trim(post('q'));
	$product_id = (int)post('product_id');
	$params     = [];
	$where      = 'WHERE 1';
	if ($product_id) {
		$where   .= ' AND p.id != ?';
		$params[] = $product_id;
	}
	if ($q !== '') {
		$like     = '%' . $q . '%';
		$where   .= ' AND (p.name LIKE ? OR p.sku LIKE ?)';
		$params[] = $like;
		$params[] = $like;
	}
	$rows = DB::rows(
		"SELECT p.id, p.name, p.sku FROM `{$p}products` p $where ORDER BY p.name ASC LIMIT 30",
		$params
	);
	ajax_out(true, '', ['rows' => $rows]);
}

// ── List related products ─────────────────────────────────────────────────────
if ($action === 'list_related') {
	$product_id = (int)post('product_id');
	$rows = DB::rows(
		"SELECT p.id, p.name, p.sku
		 FROM `{$p}product_related` pr
		 JOIN `{$p}products` p ON p.id = pr.related_product_id
		 WHERE pr.product_id = ?
		 ORDER BY p.name ASC",
		[$product_id]
	);
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Add related product ───────────────────────────────────────────────────────
if ($action === 'add_related') {
	require_access(ACCESS_EDIT);
	$product_id         = (int)post('product_id');
	$related_product_id = (int)post('related_product_id');
	if (!$product_id || !$related_product_id || $product_id === $related_product_id) {
		ajax_out(false, 'Invalid products.');
	}
	DB::exec(
		"INSERT IGNORE INTO `{$p}product_related` (product_id, related_product_id) VALUES (?, ?)",
		[$product_id, $related_product_id]
	);
	DB::exec(
		"INSERT IGNORE INTO `{$p}product_related` (product_id, related_product_id) VALUES (?, ?)",
		[$related_product_id, $product_id]
	);
	$related = DB::row("SELECT id, name, sku FROM `{$p}products` WHERE id = ?", [$related_product_id]);
	ajax_out(true, '', ['row' => $related]);
}

// ── Remove related product ────────────────────────────────────────────────────
if ($action === 'remove_related') {
	require_access(ACCESS_EDIT);
	$product_id         = (int)post('product_id');
	$related_product_id = (int)post('related_product_id');
	DB::exec(
		"DELETE FROM `{$p}product_related` WHERE (product_id = ? AND related_product_id = ?) OR (product_id = ? AND related_product_id = ?)",
		[$product_id, $related_product_id, $related_product_id, $product_id]
	);
	ajax_out(true, '');
}

// ── Search options (for autocomplete) ────────────────────────────────────────
if ($action === 'search_options') {
	$q = '%' . trim(post('q')) . '%';
	$rows = DB::rows(
		"SELECT id, name, type FROM `{$p}options` WHERE name LIKE ? ORDER BY name ASC LIMIT 20",
		[$q]
	);
	ajax_out(true, '', ['rows' => $rows]);
}

ajax_out(false, 'Unknown action.');
