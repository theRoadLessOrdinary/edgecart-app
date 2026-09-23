<?php
/**
 * Email Templates admin - route=email-templates/ajax
 */
require_admin();
header('Content-Type: application/json');
require_csrf_token_json();

$p      = DB_PREFIX;
$action = post('action');

const ET_EVENTS = ['status_changed' => 'Order status changes to...', 'payment_received' => 'Payment received'];

if ($action === 'load') {
	ajax_out(true, '', [
		'templates'  => DB::rows("SELECT id, name, subject, body FROM `{$p}email_templates` ORDER BY name"),
		'signatures' => DB::rows("SELECT id, token, label, body FROM `{$p}email_signatures` ORDER BY token"),
		'events'     => DB::rows("SELECT id, event, status_slug, template_id, active FROM `{$p}email_events` ORDER BY id"),
		'statuses'   => DB::rows("SELECT slug, label FROM `{$p}order_statuses` ORDER BY sort_order, id"),
		'log'        => DB::rows("SELECT l.order_id, l.to_email, l.result, l.note, l.created_at, t.name AS template_name
		                          FROM `{$p}email_log` l LEFT JOIN `{$p}email_templates` t ON t.id = l.template_id
		                          ORDER BY l.id DESC LIMIT 30"),
		'tokens'     => et_token_help(),
		'event_types' => ET_EVENTS,
	]);
}

// Used by the order Message tab
if ($action === 'picker') {
	ajax_out(true, '', ['templates' => DB::rows("SELECT id, name FROM `{$p}email_templates` ORDER BY name"), 'tokens' => et_token_help()]);
}

if ($action === 'render') {
	$tpl  = DB::row("SELECT subject, body FROM `{$p}email_templates` WHERE id = ?", [(int)post('template_id')]);
	$vals = et_order_values((int)post('order_id'));
	if (!$tpl)  ajax_out(false, 'Template not found.');
	if (!$vals) ajax_out(false, 'Order not found.');
	$s = et_render($tpl['subject'], $vals);
	$b = et_render((string)$tpl['body'], $vals);
	ajax_out(true, '', ['subject' => $s['text'], 'body' => $b['text']]);
}

// ── Everything below changes data ─────────────────────────────────────────────
require_access(ACCESS_EDIT);

$known = fn() => array_map('strtolower', array_keys(et_token_help()));

if ($action === 'template_save') {
	$id = (int)post('id'); $name = trim(post('name')); $subject = trim(post('subject')); $body = post('body');
	if ($name === '')    ajax_out(false, 'Template name is required.');
	if ($subject === '') ajax_out(false, 'Subject is required.');
	if (trim($body) === '') ajax_out(false, 'Body is required.');
	if ($id) {
		DB::exec("UPDATE `{$p}email_templates` SET name=?, subject=?, body=? WHERE id=?", [$name, $subject, $body, $id]);
	} else {
		$id = DB::insert("INSERT INTO `{$p}email_templates` (name, subject, body) VALUES (?,?,?)", [$name, $subject, $body]);
	}
	ajax_out(true, '', ['row' => ['id' => $id, 'name' => $name, 'subject' => $subject, 'body' => $body]]);
}

if ($action === 'template_delete') {
	$id = (int)post('id');
	$n  = (int)DB::val("SELECT COUNT(*) FROM `{$p}email_events` WHERE template_id = ?", [$id]);
	if ($n) ajax_out(false, 'This template is used by ' . $n . ' event' . ($n === 1 ? '' : 's') . '. Remove that first.');
	DB::exec("DELETE FROM `{$p}email_templates` WHERE id = ?", [$id]);
	ajax_out(true);
}

if ($action === 'signature_save') {
	$id = (int)post('id'); $label = trim(post('label')); $body = post('body');
	$token = strtolower(trim(post('token')));
	if (!preg_match('/^[a-z0-9][a-z0-9 _\-]{0,63}$/', $token)) ajax_out(false, 'Token may use letters, numbers, spaces, hyphens and underscores.');
	if (in_array($token, array_map('strtolower', array_keys(et_token_help())), true) && !DB::val("SELECT id FROM `{$p}email_signatures` WHERE id = ? AND token = ?", [$id, $token]))
		ajax_out(false, 'That token name is already in use.');
	if (trim($body) === '') ajax_out(false, 'Signature text is required.');
	if ($id) {
		DB::exec("UPDATE `{$p}email_signatures` SET token=?, label=?, body=? WHERE id=?", [$token, $label, $body, $id]);
	} else {
		$id = DB::insert("INSERT INTO `{$p}email_signatures` (token, label, body) VALUES (?,?,?)", [$token, $label, $body]);
	}
	ajax_out(true, '', ['row' => ['id' => $id, 'token' => $token, 'label' => $label, 'body' => $body]]);
}

if ($action === 'signature_delete') {
	DB::exec("DELETE FROM `{$p}email_signatures` WHERE id = ?", [(int)post('id')]);
	ajax_out(true);
}

if ($action === 'event_save') {
	$id = (int)post('id'); $event = post('event'); $slug = trim(post('status_slug')); $tid = (int)post('template_id');
	$active = (int)(bool)post('active');
	if (!isset(ET_EVENTS[$event])) ajax_out(false, 'Unknown event.');
	if ($event === 'status_changed') {
		if (!DB::val("SELECT slug FROM `{$p}order_statuses` WHERE slug = ?", [$slug])) ajax_out(false, 'Pick a status.');
	} else { $slug = ''; }
	$tpl = DB::row("SELECT subject, body FROM `{$p}email_templates` WHERE id = ?", [$tid]);
	if (!$tpl) ajax_out(false, 'Pick a template.');
	// Automatic sends have nobody to fill in hand-typed placeholders.
	if ($active) {
		preg_match_all('/\[([A-Za-z0-9 _\-]+)\]/', $tpl['subject'] . "\n" . $tpl['body'], $m);
		$bad = array_values(array_unique(array_filter($m[1], fn($t) => !in_array(strtolower(trim($t)), $known(), true))));
		if ($bad) ajax_out(false, 'This template has [' . implode('], [', $bad) . '], which is not a known token, so it cannot be sent automatically. Edit the template or turn the event off.');
	}
	if ($id) {
		DB::exec("UPDATE `{$p}email_events` SET event=?, status_slug=?, template_id=?, active=? WHERE id=?", [$event, $slug, $tid, $active, $id]);
	} else {
		$id = DB::insert("INSERT INTO `{$p}email_events` (event, status_slug, template_id, active) VALUES (?,?,?,?)", [$event, $slug, $tid, $active]);
	}
	ajax_out(true, '', ['row' => ['id' => $id, 'event' => $event, 'status_slug' => $slug, 'template_id' => $tid, 'active' => $active]]);
}

if ($action === 'event_toggle') {
	$id = (int)post('id'); $active = (int)(bool)post('active');
	if ($active) {
		$ev  = DB::row("SELECT template_id FROM `{$p}email_events` WHERE id = ?", [$id]);
		if (!$ev) ajax_out(false, 'Event not found.');
		$tpl = DB::row("SELECT subject, body FROM `{$p}email_templates` WHERE id = ?", [$ev['template_id']]);
		preg_match_all('/\[([A-Za-z0-9 _\-]+)\]/', $tpl['subject'] . "
" . $tpl['body'], $m);
		$bad = array_values(array_unique(array_filter($m[1], fn($t) => !in_array(strtolower(trim($t)), $known(), true))));
		if ($bad) ajax_out(false, 'This template has [' . implode('], [', $bad) . '], which is not a known token, so it cannot be sent automatically.');
	}
	DB::exec("UPDATE `{$p}email_events` SET active = ? WHERE id = ?", [$active, $id]);
	ajax_out(true);
}

if ($action === 'event_delete') {
	DB::exec("DELETE FROM `{$p}email_events` WHERE id = ?", [(int)post('id')]);
	ajax_out(true);
}

ajax_out(false, 'Unknown action.');
