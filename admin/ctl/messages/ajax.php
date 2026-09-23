<?php
/**
 * new-cart admin — messages ajax handler
 * route=messages/ajax
 */

require_admin();
require DIR_LIB . 'mailer.php';
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();

$p      = DB_PREFIX;
$action = post('action');

// ── List ───────────────────────────────────────────────────────────────────────
if ($action === 'list') {
	$rows = DB::rows(
		"SELECT m.id, m.form_id, m.data, m.ip, m.read_at, m.created_at, f.name AS form_name
		 FROM `{$p}messages` m
		 LEFT JOIN `{$p}contact_forms` f ON f.id=m.form_id
		 ORDER BY m.created_at DESC LIMIT 200"
	);
	foreach ($rows as &$r) {
		$data = $r['data'] ? json_decode($r['data'], true) : [];
		// Create summary from first 2 fields
		$summary = '';
		$count = 0;
		foreach ($data as $label => $value) {
			if ($count < 2) {
				$summary .= ($summary ? ' • ' : '') . substr($value, 0, 30);
				$count++;
			}
		}
		$r['summary'] = $summary ?: '(empty message)';
		unset($r['data']);
	}
	unset($r);
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Get single ────────────────────────────────────────────────────────────────
if ($action === 'get') {
	$id = (int)post('id');
	$msg = DB::row(
		"SELECT m.*, f.name AS form_name, f.email_to
		 FROM `{$p}messages` m
		 LEFT JOIN `{$p}contact_forms` f ON f.id=m.form_id
		 WHERE m.id=?",
		[$id]
	);
	if (!$msg) ajax_out(false, 'Message not found.');

	$msg['data'] = $msg['data'] ? json_decode($msg['data'], true) : [];
	ajax_out(true, '', ['message' => $msg]);
}

// ── Mark as read ──────────────────────────────────────────────────────────────
if ($action === 'mark_read') {
	require_access(ACCESS_EDIT);

	$id = (int)post('id');
	DB::exec("UPDATE `{$p}messages` SET read_at=NOW() WHERE id=?", [$id]);
	ajax_out(true, '');
}

// ── Delete single ─────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);
	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}messages` WHERE id=?", [$id]);
	ajax_out(true, 'Message deleted.');
}

// ── Bulk delete ───────────────────────────────────────────────────────────────
if ($action === 'bulk_delete') {
	require_access(ACCESS_DELETE);
	$ids = json_decode(post('ids') ?: '[]', true);
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'No messages selected.');
	$ids          = array_map('intval', $ids);
	$placeholders = implode(',', array_fill(0, count($ids), '?'));
	DB::exec("DELETE FROM `{$p}messages` WHERE id IN ({$placeholders})", $ids);
	ajax_out(true, count($ids) . ' message' . (count($ids) === 1 ? '' : 's') . ' deleted.');
}

// ── Reply to message ──────────────────────────────────────────────────────────
if ($action === 'reply') {
	require_access(ACCESS_EDIT);

	$id         = (int)post('id');
	$reply_text = trim(post('reply_text'));

	if (!$reply_text) ajax_out(false, 'Reply cannot be empty.');

	$msg = DB::row(
		"SELECT m.id, m.data, f.email_to
		 FROM `{$p}messages` m
		 LEFT JOIN `{$p}contact_forms` f ON f.id=m.form_id
		 WHERE m.id=?",
		[$id]
	);

	if (!$msg) ajax_out(false, 'Message not found.');

	// Extract sender email from message data
	$data = $msg['data'] ? json_decode($msg['data'], true) : [];
	$sender_email = '';

	// Look for email field
	foreach ($data as $label => $value) {
		if (stripos($label, 'email') !== false) {
			$sender_email = $value;
			break;
		}
	}

	if (!$sender_email || !filter_var($sender_email, FILTER_VALIDATE_EMAIL)) {
		ajax_out(false, 'Could not determine sender email address.');
	}

	// Send reply email
	$to      = $sender_email;
	$site    = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_name'") ?: 'Store';
	$subject = 'Reply: Your message to ' . $site;

	$body = "Thank you for your message.\n\n";
	$body .= "Your reply:\n";
	$body .= "---\n";
	$body .= $reply_text . "\n";
	$body .= "---\n\n";
	$body .= "Best regards,\n";
	$body .= $site . "\n";

	$mail_result = nc_mail($to, $subject, $body);

	if (!$mail_result) {
		ajax_out(false, 'Failed to send reply. Please check mail settings.');
	}

	ajax_out(true, 'Reply sent to ' . h($sender_email) . '.');
}

ajax_out(false, 'Unknown action.');
