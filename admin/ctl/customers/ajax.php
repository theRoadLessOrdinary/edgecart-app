<?php
/**
 * new-cart admin — customers ajax handler
 * route=customers/ajax
 */

require_admin();
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();

$p      = DB_PREFIX;
$action = post('action');

// ── List ───────────────────────────────────────────────────────────────────────
if ($action === 'list') {
	$rows = DB::rows("
		SELECT id, email, first_name, last_name, status,
		       DATE_FORMAT(created_at, '%b %e, %Y') AS registered,
		       created_at AS registered_iso
		FROM `{$p}customers`
		ORDER BY created_at DESC
	");
	ajax_out(true, '', ['rows' => $rows]);
}

// ── Get single (for drawer) ────────────────────────────────────────────────────
if ($action === 'get') {
	$id  = (int)post('id');
	$row = DB::row("
		SELECT id, email, first_name, last_name, status,
		       address1, address2, city, state, zip, country, notes,
		       DATE_FORMAT(created_at, '%b %e, %Y') AS registered
		FROM `{$p}customers`
		WHERE id = ?
	", [$id]);
	if (!$row) ajax_out(false, 'Customer not found.');
	ajax_out(true, '', ['row' => $row]);
}

// ── Save (insert or update) ────────────────────────────────────────────────────
if ($action === 'save') {
	require_access(ACCESS_EDIT);

	$id         = (int)post('id');
	$email      = trim(post('email'));
	$first_name = trim(post('first_name'));
	$last_name  = trim(post('last_name'));
	$password   = post('password');
	$status     = (int)(bool)post('status');
	$address1   = trim(post('address1'));
	$address2   = trim(post('address2'));
	$city       = trim(post('city'));
	$state      = trim(post('state'));
	$zip        = trim(post('zip'));
	$country    = trim(post('country'));
	$notes      = trim(post('notes'));

	if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
		ajax_out(false, 'A valid email address is required.');
	}

	$dupe = DB::row(
		"SELECT id FROM `{$p}customers` WHERE email = ? AND id != ?",
		[$email, $id]
	);
	if ($dupe) ajax_out(false, 'That email address is already registered to another account.');

	if ($id) {
		if ($password !== '') {
			$hash = password_hash($password, PASSWORD_DEFAULT);
			DB::exec(
				"UPDATE `{$p}customers`
				 SET email=?, first_name=?, last_name=?, password=?, status=?,
				     address1=?, address2=?, city=?, state=?, zip=?, country=?, notes=?
				 WHERE id=?",
				[$email, $first_name, $last_name, $hash, $status,
				 $address1, $address2, $city, $state, $zip, $country, $notes, $id]
			);
		} else {
			DB::exec(
				"UPDATE `{$p}customers`
				 SET email=?, first_name=?, last_name=?, status=?,
				     address1=?, address2=?, city=?, state=?, zip=?, country=?, notes=?
				 WHERE id=?",
				[$email, $first_name, $last_name, $status,
				 $address1, $address2, $city, $state, $zip, $country, $notes, $id]
			);
		}
	} else {
		if (!$password) ajax_out(false, 'A password is required for new customers.');
		$hash = password_hash($password, PASSWORD_DEFAULT);
		$id   = DB::insert(
			"INSERT INTO `{$p}customers`
			 (email, password, first_name, last_name, status,
			  address1, address2, city, state, zip, country, notes)
			 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
			[$email, $hash, $first_name, $last_name, $status,
			 $address1, $address2, $city, $state, $zip, $country, $notes]
		);
	}

	$row = DB::row("
		SELECT id, email, first_name, last_name, status,
		       address1, address2, city, state, zip, country, notes,
		       DATE_FORMAT(created_at, '%b %e, %Y') AS registered
		FROM `{$p}customers`
		WHERE id = ?
	", [$id]);

	ajax_out(true, 'Customer saved.', ['row' => $row]);
}

// ── Toggle field ───────────────────────────────────────────────────────────────
if ($action === 'toggle') {
	require_access(ACCESS_EDIT);

	$id    = (int)post('id');
	$field = post('field');
	$value = (int)post('value');

	if (!in_array($field, ['status'])) ajax_out(false, 'Invalid field.');

	DB::exec("UPDATE `{$p}customers` SET `{$field}` = ? WHERE id = ?", [$value, $id]);
	ajax_out(true, '');
}

// ── Orders (for order history tab) ────────────────────────────────────────────
if ($action === 'orders') {
	$customer_id = (int)post('customer_id');
	$rows = DB::rows("
		SELECT id, status, total, shipping, tax, created_at,
		       DATE_FORMAT(created_at, '%b %e, %Y') AS date_fmt
		FROM `{$p}orders`
		WHERE customer_id = ?
		ORDER BY created_at DESC
	", [$customer_id]);
	ajax_out(true, '', ['orders' => $rows]);
}

// ── Send message (email to customer) ──────────────────────────────────────────
if ($action === 'send_message') {
	require_access(ACCESS_EDIT);

	$customer_id = (int)post('customer_id');
	$subject     = trim(post('subject'));
	$body        = post('body');

	if (!$customer_id) ajax_out(false, 'No customer selected.');
	if (!$subject)     ajax_out(false, 'Subject is required.');
	if (!trim(strip_tags($body))) ajax_out(false, 'Message body is required.');

	$customer = DB::row(
		"SELECT email, first_name, last_name FROM `{$p}customers` WHERE id = ?",
		[$customer_id]
	);
	if (!$customer) ajax_out(false, 'Customer not found.');

	$to      = $customer['email'];
	$name    = trim($customer['first_name'] . ' ' . $customer['last_name']) ?: $to;
	$html = '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:640px;margin:0 auto;padding:20px">'
	      . '<p>Hello ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . ',</p>'
	      . $body
	      . '<hr style="margin:2rem 0;border:none;border-top:1px solid #e5e7eb">'
	      . '<p style="font-size:.83rem;color:#6b7280;margin-top:1.5rem">' . htmlspecialchars($_nc_site_name, ENT_QUOTES, 'UTF-8') . '</p>'
	      . '</body></html>';

	$from = $_nc_site_name . ' <' . ($_nc_settings['mail_from'] ?? SITE_EMAIL) . '>';
	$sent = nc_mail($to, $subject, $html, $from, true);
	if (!$sent) ajax_out(false, 'Mail server could not send the message. Check your server\'s mail configuration.');

	ajax_out(true, 'Message sent to ' . $to . '.');
}

// ── Delete single ──────────────────────────────────────────────────────────────
if ($action === 'delete') {
	require_access(ACCESS_DELETE);

	$id = (int)post('id');
	DB::exec("DELETE FROM `{$p}customers` WHERE id = ?", [$id]);
	ajax_out(true, 'Customer deleted.');
}

// ── Bulk delete ────────────────────────────────────────────────────────────────
if ($action === 'bulk_delete') {
	require_access(ACCESS_DELETE);

	$ids = json_decode(post('ids'), true);
	if (!is_array($ids) || empty($ids)) ajax_out(false, 'No customers selected.');
	$ids          = array_map('intval', $ids);
	$placeholders = implode(',', array_fill(0, count($ids), '?'));
	DB::exec("DELETE FROM `{$p}customers` WHERE id IN ({$placeholders})", $ids);
	$n = count($ids);
	ajax_out(true, $n . ' customer' . ($n === 1 ? '' : 's') . ' deleted.');
}

ajax_out(false, 'Unknown action.');
