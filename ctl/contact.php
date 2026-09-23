<?php
require_once DIR_LIB . 'rate-limit.php';

header('Content-Type: application/json');

function out(bool $ok, string $msg='', array $extra=[]): never {
	echo json_encode(['ok'=>$ok,'message'=>$msg]+$extra); exit;
}

$p       = DB_PREFIX;
$action  = post('action','');
$form_id = (int)post('form_id');

if ($action !== 'submit') out(false, 'Invalid request.');
if (!$form_id) out(false, 'Form not specified.');

// Rate limit: max 3 submissions per hour per IP
$ip = RateLimit::getClientIp();
if (!RateLimit::check('contact:' . $ip, 3, 3600)) {
	out(false, 'Too many submissions. Please try again later.');
}

$form = DB::row("SELECT * FROM `{$p}contact_forms` WHERE id=?", [$form_id]);
if (!$form) out(false, 'Form not found.');

$fields = $form['fields'] ? json_decode($form['fields'], true) : [];

// Validate and collect
$data   = [];
$errors = [];
foreach ($fields as $field) {
	$name  = $field['name'] ?? '';
	$label = $field['label'] ?? $name;
	$req   = !empty($field['required']);
	$val   = trim(post($name, ''));
	if ($req && $val === '') {
		$errors[] = $label . ' is required.';
		continue;
	}
	if ($name === 'email' && $val && !filter_var($val, FILTER_VALIDATE_EMAIL)) {
		$errors[] = 'Please enter a valid email address.';
		continue;
	}
	if ($val !== '') $data[$label] = $val;
}

if ($errors) out(false, implode(' ', $errors));
if (empty($data)) out(false, 'Please fill in the form.');

// Save to DB
DB::exec(
	"INSERT INTO `{$p}messages` (form_id, data, ip, created_at)
	 VALUES (?, ?, ?, NOW())",
	[$form_id, json_encode($data), $_SERVER['REMOTE_ADDR'] ?? '']
);

// Email notification
$to       = $form['email_to'] ?: DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_email'");
$site     = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_name'") ?: 'new-cart';
$subject  = 'New message from ' . $site;
$body     = "You have received a new message via your website contact form.\n\n";
foreach ($data as $k => $v) {
	$body .= $k . ":\n" . $v . "\n\n";
}
if ($to) {
	nc_mail($to, $subject, $body);
}

out(true, 'Thank you — your message has been sent.');
