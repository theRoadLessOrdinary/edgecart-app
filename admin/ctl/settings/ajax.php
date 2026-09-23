<?php
/**
 * new-cart admin — settings ajax handler
 * route=settings/ajax
 */

header('Content-Type: application/json');

require_admin_json();

// Verify CSRF token
require_csrf_token_json();

// Site settings expose admin accounts (incl. access_level — save_user can grant
// full admin), SMTP/server credentials, and the raw error log — restrict the
// entire surface to full admins, not just any logged-in staff account.
require_access_json(ACCESS_ADMIN);

$p      = DB_PREFIX;
$action = post('action');

// ── Load all settings ──────────────────────────────────────────────────────────
if ($action === 'load') {
	$rows     = DB::rows("SELECT `key`, `value` FROM `{$p}settings`");
	$settings = array_column($rows, 'value', 'key');

	// Read robots.txt
	$robots_path = DIR_ROOT . 'robots.txt';
	$robots_txt  = file_exists($robots_path) ? file_get_contents($robots_path) : '';

	// Read llms.txt
	$llms_path = DIR_ROOT . 'llms.txt';
	$llms_txt  = file_exists($llms_path) ? file_get_contents($llms_path) : '';

	$users = DB::rows(
		"SELECT id, username, email, access_level, status, avatar
		 FROM `{$p}admin`
		 ORDER BY username ASC"
	);

	// Read error log
	$log_path = defined('ERROR_LOG') ? ERROR_LOG : rtrim(DIR_ROOT, '/') . '/logs/error.log';
	$log_content = file_exists($log_path) ? file_get_contents($log_path) : '';

	ajax_out(true, '', [
		'settings'    => $settings,
		'robots_txt'  => $robots_txt,
		'llms_txt'    => $llms_txt,
		'users'       => $users,
		'log_content' => $log_content,
	]);
}

// ── Save all settings (single call) ───────────────────────────────────────────
if ($action === 'save_all') {
	$all_fields = [
		// Store
		'site_name', 'site_email', 'site_currency', 'store_phone', 'store_logo_url', 'store_logo_link', 'site_favicon', 'favicon_svg_url',
		'img_retain_names', 'img_resize_on_upload', 'img_orig_max',
		'img_admin_size', 'img_admin_quality', 'img_fm_size', 'img_fm_quality',
		'img_product_width', 'img_product_quality',
		'img_cart_size', 'img_related_size', 'img_second_level_size', 'img_sidebar_size', 'related_max_items',
		'seo_title_default', 'seo_description_default', 'seo_keywords_default',
		// Local
		'address', 'phone', 'timezone', 'date_format', 'currency_position', 'weight_unit',
		// Mail
		'smtp_host', 'smtp_user', 'smtp_pass', 'smtp_port', 'mail_from', 'mail_alert', 'mail_api_key', 'mail_api_endpoint',
		// Server
		'maintenance_mode', 'use_seo_urls', 'enable_check_payment',
		'pw_min_length', 'pw_require_upper', 'pw_require_number', 'pw_require_symbol',
		'display_errors', 'log_errors', 'smarty_debug', 'smarty_force_compile', 'smarty_caching',
		// Options — Images (additional; core image keys already listed above)
		'img_orig_max', 'img_admin_size', 'img_admin_quality', 'img_fm_size', 'img_fm_quality',
		// Options — Catalog
		'hide_empty_categories',
		// Options — Reviews
		'reviews_auto_approve', 'reviews_verified_only',
		// Options — AI
		'deepai_key',
		// Analytics
		'ga4_measurement_id',
	];

	foreach ($all_fields as $key) {
		DB::exec(
			"INSERT INTO `{$p}settings` (`key`, `value`) VALUES (?, ?)
			 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
			[$key, trim(post($key))]
		);
	}

	// Handle logo upload
	if (!empty($_FILES['logo']['name']) && $_FILES['logo']['error'] === UPLOAD_ERR_OK) {
		$result = saveImage($_FILES['logo'], 'logo', 300, 100);
		if (!$result['ok']) ajax_out(false, $result['message']);
		DB::exec(
			"INSERT INTO `{$p}settings` (`key`, `value`) VALUES ('site_logo', ?)
			 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
			[$result['path']]
		);
	}

	// Handle favicon upload
	if (!empty($_FILES['favicon']['name']) && $_FILES['favicon']['error'] === UPLOAD_ERR_OK) {
		$result = saveImage($_FILES['favicon'], 'favicon', 32, 32);
		if (!$result['ok']) ajax_out(false, $result['message']);
		DB::exec(
			"INSERT INTO `{$p}settings` (`key`, `value`) VALUES ('site_favicon', ?)
			 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
			[$result['path']]
		);
	}

	// Handle admin path change
	$new_path = preg_replace('/[^a-z0-9_\-]/i', '', trim(post('admin_path')));
	if ($new_path) {
		$current = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='admin_path'");
		if ($new_path !== $current) {
			DB::exec(
				"INSERT INTO `{$p}settings` (`key`, `value`) VALUES ('admin_path', ?)
				 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
				[$new_path]
			);
			rewriteHtaccess($new_path);
		}
	}

	// Write robots.txt
	$robots_content = post('robots_txt', '');
	if ($robots_content !== '') {
		@file_put_contents(DIR_ROOT . 'robots.txt', $robots_content);
	}

	// Write llms.txt
	$llms_content = post('llms_txt', '');
	if ($llms_content !== '') {
		@file_put_contents(DIR_ROOT . 'llms.txt', $llms_content);
	}

	$name = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_name'");
	ajax_out(true, 'Settings saved.', ['site_name' => $name]);
}

// ── Keep old individual actions for compatibility ──────────────────────────────
if ($action === 'save_store' || $action === 'save_local' ||
    $action === 'save_mail'  || $action === 'save_server') {
	// Redirect to save_all
	$_POST['action'] = 'save_all';
	// Re-run — include self
	require __FILE__;
	exit;
}

// ── Clear error log ────────────────────────────────────────────────────────────
if ($action === 'clear_log') {
	$log_path = defined('ERROR_LOG') ? ERROR_LOG : rtrim(DIR_ROOT, '/') . '/logs/error.log';
	file_put_contents($log_path, '');
	ajax_out(true, 'Error log cleared.');
}

// ── Download error log ─────────────────────────────────────────────────────────
if ($action === 'download_log') {
	$log_path = defined('ERROR_LOG') ? ERROR_LOG : rtrim(DIR_ROOT, '/') . '/logs/error.log';
	header('Content-Type: text/plain');
	header('Content-Disposition: attachment; filename="error.log"');
	readfile($log_path);
	exit;
}

// ── Save user ──────────────────────────────────────────────────────────────────
if ($action === 'save_user') {
	$id           = (int)post('id');
	$username     = trim(post('username'));
	$email        = trim(post('email'));
	$access_level = (int)post('access_level');
	$status       = (int)(bool)post('status');
	$password     = post('password');

	if (!$username || strlen($username) < 3) ajax_out(false, 'Username must be at least 3 characters.');
	if (!filter_var($email, FILTER_VALIDATE_EMAIL)) ajax_out(false, 'Invalid email address.');

	if ($id) {
		// Prevent demoting last admin
		if ($access_level !== ACCESS_ADMIN) {
			$admin_count = (int)DB::val(
				"SELECT COUNT(*) FROM `{$p}admin` WHERE access_level = ? AND status = 1 AND id != ?",
				[ACCESS_ADMIN, $id]
			);
			if ($admin_count === 0) ajax_out(false, 'Cannot remove Admin access from the only active admin account.');
		}

		$sql    = "UPDATE `{$p}admin` SET username=?, email=?, access_level=?, status=?";
		$params = [$username, $email, $access_level, $status];

		if ($password) {
			if (strlen($password) < 8) ajax_out(false, 'Password must be at least 8 characters.');
			$sql    .= ', password=?';
			$params[] = password_hash($password, PASSWORD_BCRYPT);
		}
		$params[] = $id;
		DB::exec($sql . ' WHERE id=?', $params);
	} else {
		if (!$password || strlen($password) < 8) ajax_out(false, 'Password must be at least 8 characters.');
		// Check username/email uniqueness
		if (DB::val("SELECT id FROM `{$p}admin` WHERE username=?", [$username])) {
			ajax_out(false, 'Username already in use.');
		}
		if (DB::val("SELECT id FROM `{$p}admin` WHERE email=?", [$email])) {
			ajax_out(false, 'Email already in use.');
		}
		$id = DB::insert(
			"INSERT INTO `{$p}admin` (username, email, password, access_level, status)
			 VALUES (?, ?, ?, ?, ?)",
			[$username, $email, password_hash($password, PASSWORD_BCRYPT), $access_level, $status]
		);
	}

	// Handle avatar delete request
	if ((int)post('delete_avatar') && !isset($_FILES['avatar']['name'])) {
		$current = DB::val("SELECT avatar FROM `{$p}admin` WHERE id=?", [$id]);
		if ($current) {
			$file = rtrim(DIR_ROOT, '/') . '/' . ltrim($current, '/');
			if (file_exists($file)) @unlink($file);
		}
		DB::exec("UPDATE `{$p}admin` SET avatar='' WHERE id=?", [$id]);
	}

	// Handle avatar upload
	if (!empty($_FILES['avatar']['name']) && $_FILES['avatar']['error'] === UPLOAD_ERR_OK) {
		$result = saveImage($_FILES['avatar'], 'avatar_' . $id, 128, 128, true);
		if (!$result['ok']) ajax_out(false, $result['message']);
		DB::exec("UPDATE `{$p}admin` SET avatar=? WHERE id=?", [$result['path'], $id]);
	}

	$user = DB::row(
		"SELECT id, username, email, access_level, status, avatar FROM `{$p}admin` WHERE id=?",
		[$id]
	);
	ajax_out(true, 'User saved.', ['user' => $user]);
}

// ── Delete user ────────────────────────────────────────────────────────────────
if ($action === 'delete_user') {
	$id = (int)post('id');

	if ($id === (int)($_SESSION['admin_id'] ?? 0)) {
		ajax_out(false, 'You cannot delete your own account.');
	}

	$user = DB::row("SELECT access_level, status, avatar FROM `{$p}admin` WHERE id=?", [$id]);
	if (!$user) ajax_out(false, 'User not found.');
	if ($user['status'] == 1) ajax_out(false, 'Deactivate the user before deleting.');

	// Prevent deleting last admin
	$admin_count = (int)DB::val(
		"SELECT COUNT(*) FROM `{$p}admin` WHERE access_level = ? AND status = 1 AND id != ?",
		[ACCESS_ADMIN, $id]
	);
	if ($admin_count === 0 && $user['access_level'] == ACCESS_ADMIN) {
		ajax_out(false, 'Cannot delete the only active admin account.');
	}

	// Remove avatar file
	if ($user['avatar']) {
		$file = DIR_ROOT . ltrim($user['avatar'], '/');
		if (file_exists($file)) @unlink($file);
	}

	DB::exec("DELETE FROM `{$p}admin` WHERE id=?", [$id]);
	ajax_out(true, 'User deleted.');
}

// ── Order Statuses — List ─────────────────────────────────────────────────────
if ($action === 'os_list') {
	$rows = DB::rows("SELECT * FROM `{$p}order_statuses` ORDER BY sort_order, id");
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Order Statuses — Save (insert or update) ──────────────────────────────────
if ($action === 'os_save') {
	$id             = (int)post('id');
	$label          = trim(post('label'));
	$slug           = trim(post('slug'));
	$color          = trim(post('color'));
	if (!preg_match('/^#[0-9a-f]{3,6}$/i', $color)) $color = '#6b7280';
	$is_cancellation = (int)(bool)post('is_cancellation');

	if (!$label) ajax_out(false, 'Label is required.');
	if (!$slug)  ajax_out(false, 'Slug is required.');
	if (!preg_match('/^[a-z0-9\-]+$/', $slug)) ajax_out(false, 'Slug may only contain lowercase letters, numbers, and hyphens.');

	$dupe = DB::row(
		"SELECT id FROM `{$p}order_statuses` WHERE slug = ? AND id != ?",
		[$slug, $id]
	);
	if ($dupe) ajax_out(false, 'That slug is already used by another status.');

	if ($id) {
		DB::exec(
			"UPDATE `{$p}order_statuses` SET label=?, slug=?, color=?, is_cancellation=? WHERE id=?",
			[$label, $slug, $color, $is_cancellation, $id]
		);
	} else {
		$max_sort = (int)DB::val("SELECT COALESCE(MAX(sort_order),0)+1 FROM `{$p}order_statuses`");
		$id = DB::insert(
			"INSERT INTO `{$p}order_statuses` (label, slug, color, is_cancellation, sort_order) VALUES (?,?,?,?,?)",
			[$label, $slug, $color, $is_cancellation, $max_sort]
		);
	}

	$row = DB::row("SELECT * FROM `{$p}order_statuses` WHERE id = ?", [$id]);
	ajax_out(true, 'Status saved.', ['row' => $row]);
}

// ── Order Statuses — Reorder ──────────────────────────────────────────────────
if ($action === 'os_reorder') {
	$ids = json_decode(post('ids'), true);
	if (!is_array($ids)) ajax_out(false, 'Invalid data.');
	$ids = array_map('intval', $ids);
	foreach ($ids as $i => $id) {
		DB::exec("UPDATE `{$p}order_statuses` SET sort_order = ? WHERE id = ?", [$i, $id]);
	}
	ajax_out(true, '');
}

// ── Order Statuses — Delete ───────────────────────────────────────────────────
if ($action === 'os_delete') {
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}order_statuses` WHERE id = ?", [$id]);
	ajax_out(true, 'Status deleted.');
}

ajax_out(false, 'Unknown action.');

// ── Image save helper ──────────────────────────────────────────────────────────
function saveImage(array $file, string $name, int $maxW, int $maxH, bool $square = false): array {
	$allowed = ['image/jpeg', 'image/png', 'image/webp'];
	$mime    = mime_content_type($file['tmp_name']);

	if (!in_array($mime, $allowed, true)) {
		return ['ok' => false, 'message' => 'Only JPG, PNG, and WebP images are allowed.'];
	}

	$ext = match($mime) {
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/webp' => 'webp',
	};

	$dest_dir = rtrim(DIR_ROOT, '/') . '/img/avatars/';
	if (!is_dir($dest_dir)) @mkdir($dest_dir, 0755, true);

	$filename = $name . '.' . $ext;
	$dest     = $dest_dir . $filename;

	// Load source
	$src = match($mime) {
		'image/jpeg' => imagecreatefromjpeg($file['tmp_name']),
		'image/png'  => imagecreatefrompng($file['tmp_name']),
		'image/webp' => imagecreatefromwebp($file['tmp_name']),
	};

	if (!$src) return ['ok' => false, 'message' => 'Could not read image file.'];

	// Fix EXIF rotation for JPEGs
	if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
		$exif = @exif_read_data($file['tmp_name']);
		$orientation = $exif['Orientation'] ?? 1;
		$src = match($orientation) {
			3 => imagerotate($src, 180, 0),
			6 => imagerotate($src, -90, 0),
			8 => imagerotate($src,  90, 0),
			default => $src,
		};
	}

	$srcW = imagesx($src);
	$srcH = imagesy($src);

	if ($square) {
		$srcMin  = min($srcW, $srcH);
		$cropX   = (int)(($srcW - $srcMin) / 2);
		$cropY   = (int)(($srcH - $srcMin) / 2);
		$out_img = imagecreatetruecolor($maxW, $maxH);
		imagecopyresampled($out_img, $src, 0, 0, $cropX, $cropY, $maxW, $maxH, $srcMin, $srcMin);
	} else {
		$ratio   = min($maxW / $srcW, $maxH / $srcH, 1.0);
		$newW    = (int)($srcW * $ratio);
		$newH    = (int)($srcH * $ratio);
		$out_img = imagecreatetruecolor($newW, $newH);
		imagealphablending($out_img, false);
		imagesavealpha($out_img, true);
		imagecopyresampled($out_img, $src, 0, 0, 0, 0, $newW, $newH, $srcW, $srcH);
	}

	$saved = match($mime) {
		'image/jpeg' => imagejpeg($out_img, $dest, 85),
		'image/png'  => imagepng($out_img, $dest, 6),
		'image/webp' => imagewebp($out_img, $dest, 85),
	};

	imagedestroy($src);
	imagedestroy($out_img);

	if (!$saved) return ['ok' => false, 'message' => 'Could not save image to ' . $dest];

	return ['ok' => true, 'path' => '/img/avatars/' . $filename];
}

// ── Rewrite .htaccess with new admin path ──────────────────────────────────────
function rewriteHtaccess(string $admin_path): void {
	$htaccess_path = DIR_ROOT . '.htaccess';
	$htaccess = <<<HTACCESS
Options -Indexes
DirectoryIndex index.php

RewriteEngine On

# Block direct browser access to admin/ — except its own static assets
# (js/css), which the admin page itself must load directly as the browser
RewriteCond %{REQUEST_URI} ^/admin(/|$) [NC]
RewriteCond %{REQUEST_URI} !\.(js|css)$ [NC]
RewriteRule ^ - [F,L]

# Map public admin path to admin/index.php — [END] (not [L]) so per-directory
# rewrite processing fully stops here instead of restarting against the new
# /admin/index.php URI, which would otherwise re-match and trip the "block
# direct browser access to admin/" rule above on its own rewrite target.
RewriteRule ^{$admin_path}/?$ /admin/index.php [END,QSA]
RewriteRule ^{$admin_path}/(.*)$ /admin/index.php [END,QSA]

# Route everything else through index.php
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ /index.php [L,QSA]
HTACCESS;

	file_put_contents($htaccess_path, $htaccess);
}
