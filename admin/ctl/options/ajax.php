<?php
/**
 * new-cart admin — options ajax
 * route=options/ajax
 */

require_admin();
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();

$p      = DB_PREFIX;
$action = post('action');

// ── List ──────────────────────────────────────────────────────────────────────
if ($action === 'list') {
	$rows = DB::rows("
		SELECT o.*,
		       COUNT(v.id) AS value_count
		FROM `{$p}options` o
		LEFT JOIN `{$p}option_values` v ON v.option_id = o.id
		GROUP BY o.id
		ORDER BY o.display_order ASC, o.name ASC
	");
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Get single (with values) ──────────────────────────────────────────────────
if ($action === 'get') {
	$id  = (int)post('id');
	$row = DB::row("SELECT * FROM `{$p}options` WHERE id = ?", [$id]);
	if (!$row) ajax_out(false, 'Option not found.');
	$values = DB::rows(
		"SELECT ov.*, COALESCE(MAX(pov.price_modifier), ov.price_modifier) AS price_modifier,
		        COALESCE(MAX(pov.price_prefix), ov.price_prefix) AS price_prefix,
		        COALESCE(MAX(pov.weight_modifier), ov.weight_modifier) AS weight_modifier
		 FROM `{$p}option_values` ov
		 LEFT JOIN `{$p}product_option_values` pov ON pov.option_value_id = ov.id
		 WHERE ov.option_id = ?
		 GROUP BY ov.id
		 ORDER BY ov.display_order ASC, ov.id ASC",
		[$id]
	);
	ajax_out(true, '', ['row' => $row, 'values' => $values]);
}

// ── Save option ───────────────────────────────────────────────────────────────
if ($action === 'save') {
	require_access(ACCESS_EDIT);
	$id          = (int)post('id');
	$name        = trim(post('name'));
	$type        = trim(post('type'));
	$placeholder = trim(post('placeholder'));

	$allowed_types = ['select','radio','checkbox','toggle','text','textarea','file','date','time','datetime'];
	if (!in_array($type, $allowed_types)) $type = 'select';
	if (!$name) ajax_out(false, 'Option name is required.');

	if ($id) {
		DB::exec(
			"UPDATE `{$p}options` SET name=?, type=?, placeholder=? WHERE id=?",
			[$name, $type, $placeholder, $id]
		);
	} else {
		require_access(ACCESS_ADD);
		$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}options`");
		$id  = DB::insert(
			"INSERT INTO `{$p}options` (name, type, placeholder, display_order) VALUES (?,?,?,?)",
			[$name, $type, $placeholder, $max + 1]
		);
	}
	$row = DB::row("SELECT * FROM `{$p}options` WHERE id = ?", [$id]);
	ajax_out(true, 'Option saved.', ['row' => $row]);
}

// ── Delete option ─────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}option_values` WHERE option_id = ?",          [$id]);
	DB::exec("DELETE FROM `{$p}options` WHERE id = ?",                        [$id]);
	// Cascade: remove product option associations
	$po_ids = array_column(
		DB::rows("SELECT id FROM `{$p}product_options` WHERE option_id = ?", [$id]),
		'id'
	);
	if ($po_ids) {
		$ph = implode(',', array_fill(0, count($po_ids), '?'));
		DB::exec("DELETE FROM `{$p}product_option_values` WHERE product_option_id IN ({$ph})", $po_ids);
	}
	DB::exec("DELETE FROM `{$p}product_options` WHERE option_id = ?", [$id]);
	ajax_out(true, 'Option deleted.');
}

// ── Clone option ──────────────────────────────────────────────────────────────
if ($action === 'clone') {
	require_access(ACCESS_ADD);
	$id  = (int)post('id');
	$row = DB::row("SELECT * FROM `{$p}options` WHERE id = ?", [$id]);
	if (!$row) ajax_out(false, 'Option not found.');
	$max    = (int)DB::val("SELECT MAX(display_order) FROM `{$p}options`");
	$new_id = DB::insert(
		"INSERT INTO `{$p}options` (name, type, placeholder, display_order) VALUES (?,?,?,?)",
		[$row['name'] . ' (copy)', $row['type'], $row['placeholder'], $max + 1]
	);
	$values = DB::rows(
		"SELECT * FROM `{$p}option_values` WHERE option_id = ? ORDER BY display_order ASC",
		[$id]
	);
	foreach ($values as $v) {
		DB::insert(
			"INSERT INTO `{$p}option_values` (option_id, text, image, price_prefix, price_modifier, weight_modifier, display_order) VALUES (?,?,?,?,?,?,?)",
			[$new_id, $v['text'], $v['image'], $v['price_prefix'] ?? '+', $v['price_modifier'] ?? null, $v['weight_modifier'] ?? null, $v['display_order']]
		);
	}
	$new_row = DB::row("SELECT * FROM `{$p}options` WHERE id = ?", [$new_id]);
	ajax_out(true, 'Option cloned.', ['row' => $new_row]);
}

// ── Reorder options ───────────────────────────────────────────────────────────
if ($action === 'reorder') {
	require_access(ACCESS_EDIT);

	$ids = json_decode(post('ids'), true);
	if (!is_array($ids)) ajax_out(false, 'Invalid order data.');
	foreach ($ids as $order => $oid) {
		DB::exec("UPDATE `{$p}options` SET display_order=? WHERE id=?", [$order, (int)$oid]);
	}
	ajax_out(true, '');
}

// ── Save option value ─────────────────────────────────────────────────────────
if ($action === 'save_value') {
	require_access(ACCESS_EDIT);
	$id             = (int)post('id');
	$option_id      = (int)post('option_id');
	$text           = trim(post('text'));
	$image          = trim(post('image'));
	$price_prefix   = trim(post('price_prefix', '+'));
	$price_modifier = post('price_modifier') !== '' ? (float)post('price_modifier') : null;
	$weight_modifier = post('weight_modifier') !== '' ? (float)post('weight_modifier') : null;

	if (!$text) ajax_out(false, 'Value text is required.');
	if (!in_array($price_prefix, ['+', '-', '='])) $price_prefix = '+';

	if ($id) {
		DB::exec(
			"UPDATE `{$p}option_values` SET text=?, image=?, price_prefix=?, price_modifier=?, weight_modifier=? WHERE id=?",
			[$text, $image, $price_prefix, $price_modifier, $weight_modifier, $id]
		);
		DB::exec(
			"UPDATE `{$p}product_option_values` SET price_prefix=?, price_modifier=?, weight_modifier=? WHERE option_value_id=?",
			[$price_prefix, $price_modifier, $weight_modifier, $id]
		);
	} else {
		require_access(ACCESS_ADD);
		$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}option_values` WHERE option_id=?", [$option_id]);
		$id  = DB::insert(
			"INSERT INTO `{$p}option_values` (option_id, text, image, price_prefix, price_modifier, weight_modifier, display_order) VALUES (?,?,?,?,?,?,?)",
			[$option_id, $text, $image, $price_prefix, $price_modifier, $weight_modifier, $max + 1]
		);
	}
	$row = DB::row("SELECT * FROM `{$p}option_values` WHERE id = ?", [$id]);
	ajax_out(true, '', ['row' => $row]);
}

// ── Delete option value ───────────────────────────────────────────────────────
if ($action === 'delete_value') {
	require_access(ACCESS_DELETE);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}product_option_values` WHERE option_value_id = ?", [$id]);
	DB::exec("DELETE FROM `{$p}option_values` WHERE id = ?",                       [$id]);
	ajax_out(true, '');
}

// ── Reorder option values ─────────────────────────────────────────────────────
if ($action === 'reorder_values') {
	require_access(ACCESS_EDIT);

	$ids = json_decode(post('ids'), true);
	if (!is_array($ids)) ajax_out(false, 'Invalid order data.');
	foreach ($ids as $order => $vid) {
		DB::exec("UPDATE `{$p}option_values` SET display_order=? WHERE id=?", [$order, (int)$vid]);
	}
	ajax_out(true, '');
}

// ── Upload value image ────────────────────────────────────────────────────────
if ($action === 'upload_value_image') {
	require_access(ACCESS_ADD);
	if (empty($_FILES['image']['tmp_name'])) ajax_out(false, 'No file received.');

	$allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	$mime    = mime_content_type($_FILES['image']['tmp_name']);
	if (!in_array($mime, $allowed, true)) ajax_out(false, 'File type not allowed.');

	$dir = DIR_IMG . 'options/';
	if (!is_dir($dir)) @mkdir($dir, 0775, true);

	$name = bin2hex(random_bytes(8)) . '.webp';
	$dest = $dir . $name;

	// Resize to max 600px
	$src = match($mime) {
		'image/jpeg' => @imagecreatefromjpeg($_FILES['image']['tmp_name']),
		'image/png'  => @imagecreatefrompng($_FILES['image']['tmp_name']),
		'image/gif'  => @imagecreatefromgif($_FILES['image']['tmp_name']),
		'image/webp' => @imagecreatefromwebp($_FILES['image']['tmp_name']),
	};
	if (!$src) ajax_out(false, 'Could not read image.');

	$info = @getimagesize($_FILES['image']['tmp_name']);
	if (!$info) ajax_out(false, 'Could not read image.');
	[$w, $h] = [$info[0], $info[1]];

	$ratio = min(600 / $w, 600 / $h, 1.0);
	$dw = (int)round($w * $ratio);
	$dh = (int)round($h * $ratio);
	$dst = imagecreatetruecolor($dw, $dh);
	imagecopyresampled($dst, $src, 0, 0, 0, 0, $dw, $dh, $w, $h);
	$ok = imagewebp($dst, $dest, 85);
	imagedestroy($src);
	imagedestroy($dst);
	if (!$ok) {
		ajax_out(false, 'Could not save image. Make sure the img/options folder is writeable.');
	}

	ajax_out(true, '', ['url' => '/img/options/' . $name, 'path' => '/img/options/' . $name]);
}

// ── Options list for product autocomplete ─────────────────────────────────────
if ($action === 'search') {
	$q    = '%' . trim(post('q')) . '%';
	$rows = DB::rows(
		"SELECT id, name, type FROM `{$p}options` WHERE name LIKE ? ORDER BY name ASC LIMIT 20",
		[$q]
	);
	ajax_out(true, '', ['rows' => $rows]);
}

ajax_out(false, 'Unknown action.');
