<?php
/**
 * new-cart admin — categories ajax handler
 * route=categories/ajax
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
		SELECT c.*, p.name AS parent_name
		FROM `{$p}categories` c
		LEFT JOIN `{$p}categories` p ON p.id = c.parent_id
		ORDER BY c.display_order ASC, c.name ASC
	");
	$limitCheck = check_category_limit($p);
	ajax_out(true, '', ['rows' => $rows, 'limit' => $limitCheck['limit'], 'count' => count($rows)]);
}

// ── Save (insert or update) ────────────────────────────────────────────────────
if ($action === 'save') {
	require_access(ACCESS_EDIT);

	$id              = (int)post('id');
	$name            = trim(post('name'));
	$parent_id       = (int)post('parent_id');
	$seo_title       = trim(post('seo_title'));
	$seo_keywords    = trim(post('seo_keywords'));
	$seo_description = trim(post('seo_description'));
	$html_long       = post('html_long');
	$image            = trim(post('image'));
	$banner           = trim(post('banner'));
	$featured         = (int)(bool)post('featured');
	$homepage_default = (int)(bool)post('homepage_default');
	$status           = (int)post('status'); // 0=Not Active, 1=Active, 2=Browse Only

	if (!in_array($status, [0, 1, 2])) $status = 1;
	if (!$name) ajax_out(false, 'Category name is required.');

	$slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $name), '-'));
	$existing = DB::row(
		"SELECT id FROM `{$p}categories` WHERE slug = ? AND id != ?",
		[$slug, $id]
	);
	if ($existing) $slug .= '-' . ($id ?: time());

	if ($homepage_default) {
		DB::exec("UPDATE `{$p}categories` SET homepage_default = 0");
	}

	if ($id) {
		DB::exec("UPDATE `{$p}categories` SET
			name             = ?,
			parent_id        = ?,
			slug             = ?,
			seo_title        = ?,
			seo_keywords     = ?,
			seo_description  = ?,
			html_long        = ?,
			image            = ?,
			banner           = ?,
			featured         = ?,
			homepage_default = ?,
			status           = ?
			WHERE id = ?",
			[$name, $parent_id, $slug, $seo_title, $seo_keywords, $seo_description, $html_long, $image, $banner, $featured, $homepage_default, $status, $id]
		);
	} else {
		$limitCheck = check_category_limit($p);
		if (!$limitCheck['ok']) ajax_out(false, $limitCheck['message']);
		$max = (int)DB::val("SELECT MAX(display_order) FROM `{$p}categories`");
		$id  = DB::insert("INSERT INTO `{$p}categories`
			(name, parent_id, slug, seo_title, seo_keywords, seo_description, html_long, image, banner, featured, homepage_default, status, display_order)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[$name, $parent_id, $slug, $seo_title, $seo_keywords, $seo_description, $html_long, $image, $banner, $featured, $homepage_default, $status, $max + 1]
		);
	}

	$row = DB::row("
		SELECT c.*, p.name AS parent_name
		FROM `{$p}categories` c
		LEFT JOIN `{$p}categories` p ON p.id = c.parent_id
		WHERE c.id = ?
	", [$id]);

	// Clear any incomplete reminder for this category
	reminder_clear('category', $id);

	ajax_out(true, 'Category saved.', ['row' => $row, 'cleared_reminder' => $id]);
}

// ── Toggle field (status, featured, homepage_default) ─────────────────────────
if ($action === 'toggle') {
	require_access(ACCESS_EDIT);

	$id    = (int)post('id');
	$field = post('field');
	$value = (int)post('value');

	$allowed = ['status', 'featured', 'homepage_default'];
	if (!in_array($field, $allowed)) ajax_out(false, 'Invalid field.');

	if ($field === 'homepage_default' && $value) {
		DB::exec("UPDATE `{$p}categories` SET homepage_default = 0");
	}
	DB::exec("UPDATE `{$p}categories` SET `{$field}` = ? WHERE id = ?", [$value, $id]);
	ajax_out(true, '');
}

// ── Reorder (drag-drop) ────────────────────────────────────────────────────────
if ($action === 'reorder') {
	require_access(ACCESS_EDIT);

	$ids = json_decode(post('ids'), true);
	if (!is_array($ids)) ajax_out(false, 'Invalid order data.');

	foreach ($ids as $order => $id) {
		DB::exec("UPDATE `{$p}categories` SET display_order = ? WHERE id = ?", [$order, (int)$id]);
	}
	ajax_out(true, '');
}

// ── Save image only (auto-save after drop/pick) ───────────────────────────────
if ($action === 'save_image') {
	require_access(ACCESS_EDIT);

	$id    = (int)post('id');
	$image = trim(post('image'));
	if (!$id) ajax_out(false, 'No category selected.');
	DB::exec("UPDATE `{$p}categories` SET image = ? WHERE id = ?", [$image, $id]);
	$row = DB::row("
		SELECT c.*, p.name AS parent_name
		FROM `{$p}categories` c
		LEFT JOIN `{$p}categories` p ON p.id = c.parent_id
		WHERE c.id = ?
	", [$id]);
	ajax_out(true, '', ['row' => $row]);
}

// ── Save banner only (auto-save after drop/pick) ──────────────────────────────
if ($action === 'save_banner') {
	require_access(ACCESS_EDIT);

	$id     = (int)post('id');
	$banner = trim(post('banner'));
	if (!$id) ajax_out(false, 'No category selected.');
	DB::exec("UPDATE `{$p}categories` SET banner = ? WHERE id = ?", [$banner, $id]);
	ajax_out(true, '', ['banner' => $banner]);
}

// ── Delete single ──────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);

	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}categories` WHERE id = ?", [$id]);
	DB::exec("DELETE FROM `{$p}categories_products` WHERE category_id = ?", [$id]);
	// Orphan child categories — set parent_id to 0
	DB::exec("UPDATE `{$p}categories` SET parent_id = 0 WHERE parent_id = ?", [$id]);
	ajax_out(true, 'Category deleted.');
}

// ── Bulk delete ────────────────────────────────────────────────────────────────
if ($action === 'bulk_delete') {
	require_access(ACCESS_DELETE);

	$ids = json_decode(post('ids'), true);
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'No categories selected.');
	$ids = array_map('intval', $ids);
	$placeholders = implode(',', array_fill(0, count($ids), '?'));
	DB::exec("DELETE FROM `{$p}categories` WHERE id IN ({$placeholders})", $ids);
	DB::exec("DELETE FROM `{$p}categories_products` WHERE category_id IN ({$placeholders})", $ids);
	DB::exec("UPDATE `{$p}categories` SET parent_id = 0 WHERE parent_id IN ({$placeholders})", $ids);
	ajax_out(true, count($ids) . ' categor' . (count($ids) === 1 ? 'y' : 'ies') . ' deleted.');
}

// ── Get single (for drawer) ────────────────────────────────────────────────────
if ($action === 'get') {
	$id  = (int)post('id');
	$row = DB::row("SELECT * FROM `{$p}categories` WHERE id = ?", [$id]);
	if (!$row) ajax_out(false, 'Category not found.');

	// Parent options for select
	$parents = DB::rows("SELECT id, name FROM `{$p}categories` WHERE id != ? ORDER BY name ASC", [$id]);
	ajax_out(true, '', ['row' => $row, 'parents' => $parents]);
}

// ── Parent options (for new category drawer) ───────────────────────────────────
if ($action === 'parents') {
	$parents  = DB::rows("SELECT id, name FROM `{$p}categories` ORDER BY name ASC");
	$top_four = DB::rows(
		"SELECT name FROM `{$p}categories`
		 WHERE parent_id = 0 AND status > 0
		 ORDER BY display_order ASC, name ASC
		 LIMIT 4"
	);
	ajax_out(true, '', [
		'parents'   => $parents,
		'top_four'  => array_column($top_four, 'name'),
	]);
}

ajax_out(false, 'Unknown action.');
