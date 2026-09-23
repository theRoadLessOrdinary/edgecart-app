<?php
/**
 * Digital Downloads — admin AJAX
 * Actions: dd_list, dd_upload, dd_delete, dd_token_list
 */

require_admin();
header('Content-Type: application/json');
require_csrf_token_json();

$action = post('action');
$p      = DB_PREFIX;

// ── List files for a product ──────────────────────────────────────────────────
if ($action === 'dd_list') {
    $product_id = (int)post('product_id');
    if (!$product_id) ajax_out(false, 'Missing product_id.');

    $files = DB::rows(
        "SELECT id, label, filename, filesize, created_at FROM `{$p}digital_files`
         WHERE product_id = ? ORDER BY created_at ASC",
        [$product_id]
    );
    ajax_out(true, '', ['files' => $files]);
}

// ── Upload file for a product ─────────────────────────────────────────────────
if ($action === 'dd_upload') {
    require_access(ACCESS_EDIT);

    $product_id = (int)post('product_id');
    if (!$product_id) ajax_out(false, 'Missing product_id.');
    if (empty($_FILES['file'])) ajax_out(false, 'No file received.');

    $f        = $_FILES['file'];
    $orig     = basename($f['name']);
    $ext      = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    // Deliberately excludes image formats (png/jpg/svg/webp/gif) — those
    // belong exclusively on the product's Images tab. Allowing them here let
    // a product photo get dropped into the downloads list by mistake, where
    // it then sits looking like a missing/broken deliverable rather than the
    // product image it actually is.
    $allowed  = ['zip', 'pdf', 'epub', 'mp3', 'mp4', 'txt', 'csv'];
    if (!in_array($ext, $allowed, true)) ajax_out(false, "File type .{$ext} not allowed. Product photos belong on the Images tab, not here.");
    if ($f['size'] > 100 * 1024 * 1024) ajax_out(false, 'File exceeds 100 MB limit.');
    if ($f['error'] !== UPLOAD_ERR_OK)  ajax_out(false, 'Upload error: ' . $f['error']);

    $dir = DIR_DOWNLOADS_PRIVATE;
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    $stored = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($f['tmp_name'], $dir . $stored)) {
        ajax_out(false, 'Could not save file.');
    }

    $label = trim(post('label', ''));
    $id = DB::insert(
        "INSERT INTO `{$p}digital_files` (product_id, label, filename, filepath, filesize)
         VALUES (?,?,?,?,?)",
        [$product_id, $label, $orig, $stored, $f['size']]
    );

    ajax_out(true, 'File uploaded.', ['id' => $id, 'filename' => $orig, 'filesize' => $f['size']]);
}

// ── Delete a file ─────────────────────────────────────────────────────────────
if ($action === 'dd_delete') {
    require_access(ACCESS_DELETE);

    $id = (int)post('id');
    if (!$id) ajax_out(false, 'Missing id.');

    $file = DB::row("SELECT * FROM `{$p}digital_files` WHERE id=?", [$id]);
    if (!$file) ajax_out(false, 'File not found.');

    $path = DIR_DOWNLOADS_PRIVATE . $file['filepath'];
    if (file_exists($path)) @unlink($path);

    DB::exec("DELETE FROM `{$p}download_tokens` WHERE file_id=?", [$id]);
    DB::exec("DELETE FROM `{$p}digital_files` WHERE id=?", [$id]);

    ajax_out(true, 'File deleted.');
}

// ── List download tokens (admin downloads log) ────────────────────────────────
if ($action === 'dd_token_list') {
    $rows = DB::rows(
        "SELECT dt.*, df.filename, p.name AS product_name
         FROM `{$p}download_tokens` dt
         JOIN `{$p}digital_files` df ON df.id = dt.file_id
         JOIN `{$p}products` p ON p.id = dt.product_id
         ORDER BY dt.created_at DESC
         LIMIT 200"
    );
    ajax_out(true, '', ['rows' => $rows]);
}

ajax_out(false, 'Unknown action.');
