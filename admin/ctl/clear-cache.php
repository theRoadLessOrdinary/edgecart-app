<?php
require_admin();
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || post('action') !== 'clear_cache') {
	echo json_encode(['ok' => false, 'message' => 'Invalid request.']);
	exit;
}

if (!verify_csrf_token(post('csrf_token'))) {
	http_response_code(403);
	echo json_encode(['ok' => false, 'message' => 'Security token invalid.']);
	exit;
}

$dirs   = [
	DIR_CACHE . 'tpl/',
	DIR_CACHE . 'tpl/admin/',
	DIR_CACHE . 'smarty/',
	DIR_CACHE . 'smarty/admin/',
];
$count  = 0;
$errors = 0;

foreach ($dirs as $dir) {
	if (!is_dir($dir)) continue;
	$files = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
		RecursiveIteratorIterator::CHILD_FIRST
	);
	foreach ($files as $f) {
		$ok = $f->isDir() ? @rmdir($f->getRealPath()) : @unlink($f->getRealPath());
		$ok ? $count++ : $errors++;
	}
}

echo json_encode([
	'ok'      => $errors === 0,
	'message' => $errors ? "Cleared {$count} files with {$errors} errors." : "Cache cleared ({$count} files).",
]);
