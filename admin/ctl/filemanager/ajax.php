<?php
/**
 * new-cart admin — file manager ajax
 * route=filemanager/ajax
 *
 * Root: DIR_IMG (img/)
 * Product images live in img/products/
 * Variants stored in dot-subdirs relative to the image's folder:
 *   img/products/sub/.admin/file.webp
 *   img/products/sub/.fm/file.webp
 * nc_product_images.filename = /img/products/[sub/]file.webp
 */

require_admin();
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();

function fm_out(bool $ok, string $msg = '', array $extra = []): never {
	echo json_encode(['ok' => $ok, 'message' => $msg] + $extra);
	exit;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fm_root(): string {
	return rtrim(DIR_IMG, '/') . '/';
}

/** Resolve a user-supplied relative path safely inside fm_root(). */
function fm_resolve(string $rel): string {
	$root = fm_root();
	$root = (realpath($root) ?: rtrim($root, '/')) . '/';
	// Normalise slashes, strip leading slash
	$rel  = ltrim(str_replace('\\', '/', $rel), '/');
	$full = realpath($root . $rel);
	if ($full === false) {
		// Path may not exist yet (mkdir target); build manually
		$full = $root . $rel;
	}
	// Ensure it stays inside root
	if (strpos(rtrim($full, '/') . '/', $root) !== 0) {
		fm_out(false, 'Access denied.');
	}
	return $full;
}

/** Is a filename/dirname a dot-folder or hidden? */
function fm_is_dot(string $name): bool {
	return $name !== '.' && $name !== '..' && $name[0] === '.';
}

/** List visible subdirectories (non-dot) for tree. Returns [{name, rel, children}] */
function fm_tree(string $abs, string $rel = ''): array {
	$out = [];
	if (!is_dir($abs)) return $out;
	$items = scandir($abs);
	foreach ($items as $item) {
		if ($item === '.' || $item === '..') continue;
		if (fm_is_dot($item)) continue;
		$path = $abs . '/' . $item;
		if (!is_dir($path)) continue;
		$childRel = $rel === '' ? $item : $rel . '/' . $item;
		$out[] = [
			'name'     => $item,
			'rel'      => $childRel,
			'children' => fm_tree($path, $childRel),
		];
	}
	return $out;
}

/** List files in a directory (non-dot, image files only). */
function fm_files(string $abs, string $relDir): array {
	$out = [];
	if (!is_dir($abs)) return $out;
	$allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
	$items   = scandir($abs);
	foreach ($items as $item) {
		if ($item === '.' || $item === '..') continue;
		if (fm_is_dot($item)) continue;
		$path = $abs . '/' . $item;
		if (is_dir($path)) continue;
		$ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
		if (!in_array($ext, $allowed)) continue;
		$relFile = ($relDir !== '' ? $relDir . '/' : '') . $item;
		$stat    = stat($path);
		$origUrl = '/img/' . $relFile;
		$out[] = [
			'name'     => $item,
			'rel'      => $relFile,
			'url'      => $origUrl,
			'fm_url'   => fm_variant_url($relFile, '.fm'),
			'size'     => $stat['size'],
			'modified' => $stat['mtime'],
		];
	}
	return $out;
}

/** Build URL for a dot-variant of an image. */
function fm_variant_url(string $rel, string $dotDir): string {
	$dir  = dirname($rel);
	$base = basename($rel);
	$sub  = ($dir === '.' || $dir === '') ? $dotDir : $dir . '/' . $dotDir;
	return '/img/' . $sub . '/' . $base;
}

/** Absolute path to a dot-variant file. */
function fm_variant_path(string $rel, string $dotDir): string {
	$root = fm_root();
	$dir  = dirname($rel);
	$base = basename($rel);
	$sub  = ($dir === '.' || $dir === '') ? $dotDir : $dir . '/' . $dotDir;
	return $root . $sub . '/' . $base;
}

/** Delete a file and all its dot-folder variants. */
function fm_delete_all_variants(string $rel): void {
	$root    = fm_root();
	$dir     = dirname($rel);
	$base    = basename($rel);
	$absBase = rtrim($dir === '.' ? $root : $root . $dir, '/') . '/';

	// Delete original
	$orig = $absBase . $base;
	if (file_exists($orig)) @unlink($orig);

	// Scan for dot-subdirs and delete variant
	if (is_dir(rtrim($absBase, '/'))) {
		$items = scandir(rtrim($absBase, '/'));
		foreach ($items as $item) {
			if (!fm_is_dot($item)) continue;
			$variant = $absBase . $item . '/' . $base;
			if (file_exists($variant)) @unlink($variant);
		}
	}
}

/** Move a file and all dot-folder variants to a new directory. */
function fm_move_all_variants(string $oldRel, string $newRel): bool {
	$root    = fm_root();
	$oldDir  = dirname($oldRel);
	$base    = basename($oldRel);
	$newDir  = dirname($newRel);

	$oldBase = rtrim($oldDir === '.' ? $root : $root . $oldDir, '/') . '/';
	$newBase = rtrim($newDir === '.' ? $root : $root . $newDir, '/') . '/';

	// Move original
	$oldOrig = $oldBase . $base;
	$newOrig = $newBase . $base;
	if (!file_exists($oldOrig)) return false;
	if (!@rename($oldOrig, $newOrig)) return false;

	// Move variants from dot-subdirs
	if (is_dir(rtrim($oldBase, '/'))) {
		$items = scandir(rtrim($oldBase, '/'));
		foreach ($items as $item) {
			if (!fm_is_dot($item)) continue;
			$oldVar = $oldBase . $item . '/' . $base;
			if (!file_exists($oldVar)) continue;
			$newDotDir = $newBase . $item;
			if (!is_dir($newDotDir)) @mkdir($newDotDir, 0775, true);
			@rename($oldVar, $newDotDir . '/' . $base);
		}
	}
	return true;
}

/** Resize and save an image (GD). Returns false on failure. */
function fm_resize_image(string $srcPath, string $destPath, int $maxW, int $maxH, int $quality, bool $crop = false): bool {
	$info = @getimagesize($srcPath);
	if (!$info) return false;

	[$sw, $sh, $type] = [$info[0], $info[1], $info[2]];
	switch ($type) {
		case IMAGETYPE_JPEG: $src = imagecreatefromjpeg($srcPath); break;
		case IMAGETYPE_PNG:  $src = imagecreatefrompng($srcPath);  break;
		case IMAGETYPE_GIF:  $src = imagecreatefromgif($srcPath);  break;
		case IMAGETYPE_WEBP: $src = imagecreatefromwebp($srcPath); break;
		default: return false;
	}
	if (!$src) return false;

	if ($crop) {
		// Crop to exact square
		$size  = min($sw, $sh);
		$srcX  = (int)(($sw - $size) / 2);
		$srcY  = (int)(($sh - $size) / 2);
		$dst   = imagecreatetruecolor($maxW, $maxH);
		imagealphablending($dst, false);
		imagesavealpha($dst, true);
		$trans = imagecolorallocatealpha($dst, 255, 255, 255, 127);
		imagefilledrectangle($dst, 0, 0, $maxW, $maxH, $trans);
		imagecopyresampled($dst, $src, 0, 0, $srcX, $srcY, $maxW, $maxH, $size, $size);
	} else {
		// Proportional scale down (never up)
		$ratio = min($maxW / $sw, $maxH / $sh, 1.0);
		$dw    = (int)round($sw * $ratio);
		$dh    = (int)round($sh * $ratio);
		$dst   = imagecreatetruecolor($dw, $dh);
		// Preserve transparency
		imagealphablending($dst, false);
		imagesavealpha($dst, true);
		$trans = imagecolorallocatealpha($dst, 255, 255, 255, 127);
		imagefilledrectangle($dst, 0, 0, $dw, $dh, $trans);
		imagecopyresampled($dst, $src, 0, 0, 0, 0, $dw, $dh, $sw, $sh);
	}

	@mkdir(dirname($destPath), 0775, true);
	$ok = imagewebp($dst, $destPath, $quality);
	imagedestroy($src);
	imagedestroy($dst);
	return $ok;
}

// ── Settings helper ───────────────────────────────────────────────────────────
function fm_setting(string $key, mixed $default): mixed {
	static $cache = null;
	if ($cache === null) {
		$p     = DB_PREFIX;
		$rows  = DB::rows("SELECT `key`, `value` FROM `{$p}settings`");
		$cache = array_column($rows, 'value', 'key');
	}
	return $cache[$key] ?? $default;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

$p      = DB_PREFIX;
$action = post('action');

// ── Tree ──────────────────────────────────────────────────────────────────────
if ($action === 'tree') {
	$tree = fm_tree(rtrim(fm_root(), '/'));
	fm_out(true, '', ['tree' => $tree]);
}

// ── List files in a folder ────────────────────────────────────────────────────
if ($action === 'list') {
	$rel   = trim(post('folder'), '/');
	$abs   = fm_resolve($rel);
	$files = fm_files($abs, $rel);

	// Ensure dot-folder variants exist for every image
	$admSize = (int)fm_setting('img_admin_size',    160);
	$admQual = (int)fm_setting('img_admin_quality', 75);
	$fmQual  = (int)fm_setting('img_fm_quality',    60);
	$fmSize  = 150; // Always store at max display size; JS scales down for display

	foreach ($files as &$f) {
		$adminPath = fm_variant_path($f['rel'], '.admin');
		$fmPath    = fm_variant_path($f['rel'], '.fm');
		$origAbs   = fm_resolve($f['rel']);

		if (!file_exists($adminPath)) {
			@mkdir(dirname($adminPath), 0775, true);
			fm_resize_image($origAbs, $adminPath, $admSize, $admSize, $admQual);
		}
		if (!file_exists($fmPath)) {
			@mkdir(dirname($fmPath), 0775, true);
			fm_resize_image($origAbs, $fmPath, $fmSize, $fmSize, $fmQual, true);
		}
	}
	unset($f);

	fm_out(true, '', ['files' => $files]);
}

// ── Upload ────────────────────────────────────────────────────────────────────
if ($action === 'upload') {
	require_access(ACCESS_ADD);

	if (empty($_FILES['file']['tmp_name'])) fm_out(false, 'No file received.');

	$folder   = trim(post('folder'), '/');
	$destDir  = fm_resolve($folder);
	$origName = basename($_FILES['file']['name']);
	$ext      = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
	$allowed  = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
	if (!in_array($ext, $allowed)) fm_out(false, 'File type not allowed. Images only.');

	$retain = (bool)(int)fm_setting('img_retain_names', 0);
	if ($retain) {
		$stem = preg_replace('/[^a-z0-9\-_]/i', '_', pathinfo($origName, PATHINFO_FILENAME));
		$stem = substr($stem, 0, 100) ?: bin2hex(random_bytes(8));
	} else {
		$stem = bin2hex(random_bytes(8));
	}

	// Raster: resize and convert to WebP
	$newName = $stem . '.webp';
	$origMax = (int)fm_setting('img_orig_max', 600);
	$admSize = (int)fm_setting('img_admin_size', 160);
	$admQual = (int)fm_setting('img_admin_quality', 75);
	$fmSize  = 150;
	$fmQual  = (int)fm_setting('img_fm_quality', 60);

	// Ensure destination dirs exist
	if (!is_dir($destDir)) @mkdir($destDir, 0775, true);
	$adminDir = rtrim($destDir, '/') . '/.admin';
	$fmDir    = rtrim($destDir, '/') . '/.fm';
	if (!is_dir($adminDir)) @mkdir($adminDir, 0775, true);
	if (!is_dir($fmDir))    @mkdir($fmDir,    0775, true);

	$destOrig  = rtrim($destDir, '/') . '/' . $newName;
	$destAdmin = $adminDir . '/' . $newName;
	$destFm    = $fmDir    . '/' . $newName;

	$tmpPath = $_FILES['file']['tmp_name'];

	// Save original (max width, proportional). No raw-copy fallback: if GD can't
	// decode it as a real image, it doesn't get saved — never trust unvalidated bytes.
	if (!fm_resize_image($tmpPath, $destOrig, $origMax, 9999, 85)) {
		fm_out(false, 'File does not appear to be a valid image.');
	}

	// Save .admin variant
	fm_resize_image($destOrig, $destAdmin, $admSize, $admSize, $admQual);

	// Save .fm variant (cropped square)
	fm_resize_image($destOrig, $destFm, $fmSize, $fmSize, $fmQual, true);

	$relFile  = ($folder !== '' ? $folder . '/' : '') . $newName;
	$dbPath   = '/img/' . $relFile;
	$fmUrl    = '/img/' . ($folder !== '' ? $folder . '/' : '') . '.fm/' . $newName;
	$origUrl  = '/img/' . $relFile;
	$stat     = stat($destOrig);

	fm_out(true, 'Uploaded.', [
		'file' => [
			'name'     => $newName,
			'rel'      => $relFile,
			'url'      => $origUrl,
			'fm_url'   => $fmUrl,
			'db_path'  => $dbPath,
			'size'     => $stat['size'],
			'modified' => $stat['mtime'],
		],
	]);
}

// ── Move (drag-drop to folder) ────────────────────────────────────────────────
if ($action === 'move') {
	require_access(ACCESS_EDIT);

	$rel       = trim(post('rel'), '/');       // current relative path of file
	$targetDir = trim(post('target_dir'), '/'); // new folder rel path
	$base      = basename($rel);
	$newRel    = ($targetDir !== '' ? $targetDir . '/' : '') . $base;

	// Check for collision
	$newAbs = fm_resolve($newRel);
	if (file_exists($newAbs)) fm_out(false, 'A file with that name already exists in the destination.');

	if (!fm_move_all_variants($rel, $newRel)) fm_out(false, 'Move failed. Check folder permissions.');

	// Update nc_product_images
	$oldDb = '/img/' . $rel;
	$newDb = '/img/' . $newRel;
	DB::exec("UPDATE `{$p}product_images` SET filename = ? WHERE filename = ?", [$newDb, $oldDb]);

	$fmUrl = fm_variant_url($newRel, '.fm');
	fm_out(true, '', [
		'old_rel' => $rel,
		'new_rel' => $newRel,
		'url'     => '/img/' . $newRel,
		'fm_url'  => '/img/' . $fmUrl,
	]);
}

// ── Delete ────────────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);

	$rel   = trim(post('rel'), '/');
	$dbPath = '/img/' . $rel;

	fm_delete_all_variants($rel);

	// Remove from product_images and clean up is_primary
	DB::exec("DELETE FROM `{$p}product_images` WHERE filename = ?", [$dbPath]);

	// If a product lost its primary image, promote the first remaining image
	$orphaned = DB::rows("
		SELECT DISTINCT pi.product_id
		FROM `{$p}product_images` pi
		WHERE NOT EXISTS (
			SELECT 1 FROM `{$p}product_images` pi2
			WHERE pi2.product_id = pi.product_id AND pi2.is_primary = 1
		)
	");
	foreach ($orphaned as $row) {
		$first = DB::row(
			"SELECT id FROM `{$p}product_images` WHERE product_id = ? ORDER BY display_order ASC, id ASC LIMIT 1",
			[$row['product_id']]
		);
		if ($first) DB::exec("UPDATE `{$p}product_images` SET is_primary = 1 WHERE id = ?", [$first['id']]);
	}

	fm_out(true, 'Image deleted.');
}

// ── Create folder ─────────────────────────────────────────────────────────────
if ($action === 'mkdir') {
	require_access(ACCESS_EDIT);

	$parent  = trim(post('parent'), '/');
	$name    = trim(post('name'));
	// Sanitise: letters, numbers, hyphens, underscores only; no dots at start
	$name    = preg_replace('/[^a-zA-Z0-9_\-]/', '', $name);
	if ($name === '') fm_out(false, 'Invalid folder name. Use letters, numbers, hyphens, underscores.');

	$rel  = ($parent !== '' ? $parent . '/' : '') . $name;
	$abs  = fm_resolve($rel);
	if (is_dir($abs)) fm_out(false, 'Folder already exists.');
	if (!@mkdir($abs, 0775, true)) fm_out(false, 'Could not create folder. Check permissions.');

	// Pre-create dot subdirs
	@mkdir($abs . '/.admin',       0775, true);
	@mkdir($abs . '/.fm', 0775, true);

	fm_out(true, 'Folder created.', ['rel' => $rel, 'name' => $name]);
}

// ── Delete folder (only if empty of visible files) ───────────────────────────
if ($action === 'rmdir') {
	require_access(ACCESS_DELETE);

	$rel = trim(post('rel'), '/');
	$abs = fm_resolve($rel);
	if (!is_dir($abs)) fm_out(false, 'Folder not found.');

	// Check for visible files
	$files = fm_files($abs, $rel);
	if (!empty($files)) fm_out(false, 'Folder is not empty. Delete all images first.');

	// Remove dot subdirs and folder
	foreach (scandir($abs) as $item) {
		if ($item === '.' || $item === '..') continue;
		$sub = $abs . '/' . $item;
		if (is_dir($sub)) {
			// Remove files inside dot-dir
			foreach (scandir($sub) as $f) {
				if ($f === '.' || $f === '..') continue;
				@unlink($sub . '/' . $f);
			}
			@rmdir($sub);
		} else {
			@unlink($sub);
		}
	}
	if (!@rmdir($abs)) fm_out(false, 'Could not remove folder.');

	fm_out(true, 'Folder deleted.', ['rel' => $rel]);
}

// ── Move folder ───────────────────────────────────────────────────────────────
if ($action === 'movefolder') {
	require_access(ACCESS_EDIT);

	$rel       = trim(post('rel'), '/');       // folder being moved
	$targetDir = trim(post('target_dir'), '/'); // destination parent ('' = root)

	if ($rel === '' || $rel === $targetDir) fm_out(false, 'Invalid move.');

	// Prevent moving a folder into its own descendant
	if (strpos($targetDir . '/', $rel . '/') === 0) {
		fm_out(false, 'Cannot move a folder into its own subfolder.');
	}

	$name   = basename($rel);
	$newRel = ($targetDir !== '' ? $targetDir . '/' : '') . $name;

	$oldAbs = fm_resolve($rel);
	$newAbs = fm_resolve($newRel);

	if (is_dir($newAbs)) fm_out(false, 'A folder with that name already exists at the destination.');
	if (!@rename($oldAbs, $newAbs)) fm_out(false, 'Move failed. Check folder permissions.');

	// Update nc_product_images paths: /img/old/rel/ → /img/new/rel/
	$oldPrefix = '/img/' . $rel . '/';
	$newPrefix = '/img/' . $newRel . '/';
	DB::exec(
		"UPDATE `{$p}product_images` SET filename = REPLACE(filename, ?, ?) WHERE filename LIKE ?",
		[$oldPrefix, $newPrefix, $oldPrefix . '%']
	);

	fm_out(true, '', ['old_rel' => $rel, 'new_rel' => $newRel]);
}


// ── Rename file ───────────────────────────────────────────────────────────────
if ($action === 'rename') {
	require_access(ACCESS_EDIT);

	$rel     = trim(post('rel'));
	$newName = trim(post('new_name'));
	if (!$rel || !$newName) fm_out(false, 'Missing parameters.');

	// Sanitise: strip path separators, keep extension
	$newName = preg_replace('/[\/\\\\]/', '', $newName);
	if (!$newName) fm_out(false, 'Invalid filename.');

	// Force .webp extension
	$ext     = strtolower(pathinfo($newName, PATHINFO_EXTENSION));
	if ($ext !== 'webp') $newName = pathinfo($newName, PATHINFO_FILENAME) . '.webp';

	$dir    = dirname($rel);
	$newRel = ($dir === '.' ? '' : $dir . '/') . $newName;

	$oldAbs = fm_resolve($rel);
	$newAbs = fm_resolve($newRel);

	if (!file_exists($oldAbs)) fm_out(false, 'File not found.');
	if (file_exists($newAbs) && $newAbs !== $oldAbs) fm_out(false, 'A file with that name already exists.');

	// Rename original + all variants
	$root    = fm_root();
	$dirAbs  = rtrim(dirname($oldAbs), '/') . '/';
	if (!@rename($oldAbs, $newAbs)) fm_out(false, 'Rename failed. Check permissions.');

	// Rename in dot-subdirs
	$items = @scandir(rtrim($dirAbs, '/')) ?: [];
	foreach ($items as $item) {
		if (!fm_is_dot($item)) continue;
		$oldVar = $dirAbs . $item . '/' . basename($rel);
		if (!file_exists($oldVar)) continue;
		$newVarDir = $dirAbs . $item;
		@rename($oldVar, $newVarDir . '/' . $newName);
	}

	// Update nc_product_images filename
	$oldPath = '/img/' . ltrim($rel, '/');
	$newPath = '/img/' . ltrim($newRel, '/');
	DB::exec("UPDATE `{$p}product_images` SET filename=? WHERE filename=?", [$newPath, $oldPath]);

	fm_out(true, 'Renamed.', ['old_rel' => $rel, 'new_rel' => $newRel, 'new_url' => '/img/' . $newRel]);
}

fm_out(false, 'Unknown action.');
