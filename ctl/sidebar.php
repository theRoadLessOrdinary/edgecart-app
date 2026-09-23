<?php
/**
 * Storefront sidebar position persistence
 */
header('Content-Type: application/json');

$p = DB_PREFIX;

// POST: Save sidebar position
if ($_SERVER['REQUEST_METHOD'] === 'POST' && post('action') === 'set_position') {
	if (!verify_csrf_token(post('csrf_token'))) {
		echo json_encode(['ok' => false, 'message' => 'Security token expired.']);
		exit;
	}

	// Determine which page we're on (product, regular page, etc.)
	$page_slug = post('page_slug');
	$position = in_array(post('position'), ['left', 'right']) ? post('position') : 'left';

	if (!$page_slug) {
		echo json_encode(['ok' => false, 'message' => 'Page slug required.']);
		exit;
	}

	// Find the page and update its sidebar position
	$page = DB::row("SELECT id FROM `{$p}pages` WHERE slug=?", [$page_slug]);
	if (!$page) {
		echo json_encode(['ok' => false, 'message' => 'Page not found.']);
		exit;
	}

	DB::exec("UPDATE `{$p}pages` SET sidebar_position=? WHERE id=?", [$position, $page['id']]);

	echo json_encode(['ok' => true, 'sidebar_position' => $position]);
	exit;
}

// Unknown action
echo json_encode(['ok' => false, 'message' => 'Unknown action.']);
exit;
