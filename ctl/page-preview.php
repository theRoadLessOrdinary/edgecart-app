<?php
$p     = DB_PREFIX;
$token = preg_replace('/[^a-f0-9]/', '', get('token', ''));
if (!$token) { require DIR_CTL . '404.php'; exit; }

$key  = 'preview_' . $token;
$val  = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`=?", [$key]);
if (!$val) { require DIR_CTL . '404.php'; exit; }

$data = json_decode($val, true);
if (!$data || ($data['expires'] ?? 0) < time()) {
	DB::exec("DELETE FROM `{$p}settings` WHERE `key`=?", [$key]);
	require DIR_CTL . '404.php';
	exit;
}

// Render the page regardless of status
$_GET['slug'] = DB::val("SELECT slug FROM `{$p}pages` WHERE id=?", [$data['page_id']]);
if (!$_GET['slug']) { require DIR_CTL . '404.php'; exit; }

// Bypass status check for preview
define('NC_PREVIEW_MODE', true);
require DIR_CTL . 'page.php';
