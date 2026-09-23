<?php
require_admin();
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();
$p      = DB_PREFIX;
$action = post('action');

if ($action === 'list') {
	$items = DB::rows(
		"SELECT bl.*, pb.block_type, pb.settings
		 FROM `{$p}block_library` bl
		 JOIN `{$p}page_blocks` pb ON pb.id = bl.block_id
		 ORDER BY bl.name ASC"
	);
	foreach ($items as &$it) {
		$it['settings'] = $it['settings'] ? json_decode($it['settings'], true) : [];
	}
	unset($it);
	ajax_out(true, '', ['items' => $items]);
}

if ($action === 'save') {
	require_access(ACCESS_EDIT);
	$block_id = (int)post('block_id');
	$name     = trim(post('name'));
	if (!$block_id || !$name) ajax_out(false, 'Missing parameters.');

	// Update name on the block itself too
	DB::exec("UPDATE `{$p}page_blocks` SET name=? WHERE id=?", [$name, $block_id]);

	$existing = DB::row("SELECT id FROM `{$p}block_library` WHERE block_id=?", [$block_id]);
	if ($existing) {
		DB::exec("UPDATE `{$p}block_library` SET name=? WHERE block_id=?", [$name, $block_id]);
	} else {
		DB::insert("INSERT INTO `{$p}block_library` (block_id,name) VALUES (?,?)", [$block_id, $name]);
	}
	ajax_out(true, '');
}

if ($action === 'delete') {
	require_access(ACCESS_DELETE);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}block_library` WHERE id=?", [$id]);
	ajax_out(true, '');
}

ajax_out(false, 'Unknown action.');
