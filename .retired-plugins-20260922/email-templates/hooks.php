<?php
/**
 * Email Templates plugin - hooks.php
 * Tables, token rendering, and automatic sends on order events.
 */

// ── Schema + one-time seed of the default templates ───────────────────────────
Hook::on('app.boot', function () {
	$p = DB_PREFIX;
	$exists = DB::val("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", ["{$p}email_templates"]);
	if ($exists) return;

	DB::exec("CREATE TABLE IF NOT EXISTS `{$p}email_templates` (
		`id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
		`name`       VARCHAR(128) NOT NULL,
		`subject`    VARCHAR(255) NOT NULL DEFAULT '',
		`body`       MEDIUMTEXT,
		`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (`id`)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	DB::exec("CREATE TABLE IF NOT EXISTS `{$p}email_signatures` (
		`id`    INT UNSIGNED NOT NULL AUTO_INCREMENT,
		`token` VARCHAR(64)  NOT NULL,
		`label` VARCHAR(128) NOT NULL DEFAULT '',
		`body`  MEDIUMTEXT,
		PRIMARY KEY (`id`),
		UNIQUE KEY `token` (`token`)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	DB::exec("CREATE TABLE IF NOT EXISTS `{$p}email_events` (
		`id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
		`event`       VARCHAR(32)  NOT NULL,
		`status_slug` VARCHAR(32)  NOT NULL DEFAULT '',
		`template_id` INT UNSIGNED NOT NULL,
		`active`      TINYINT(1)   NOT NULL DEFAULT 1,
		PRIMARY KEY (`id`),
		KEY `event` (`event`)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	DB::exec("CREATE TABLE IF NOT EXISTS `{$p}email_log` (
		`id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
		`event_id`    INT UNSIGNED NOT NULL,
		`order_id`    INT UNSIGNED NOT NULL,
		`template_id` INT UNSIGNED NOT NULL,
		`to_email`    VARCHAR(255) NOT NULL DEFAULT '',
		`result`      VARCHAR(16)  NOT NULL,
		`note`        VARCHAR(255) NOT NULL DEFAULT '',
		`created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (`id`),
		KEY `event_order` (`event_id`, `order_id`)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

	$sig = "Bill Morris\nSeamlyne.com\n\n"
		. "Remember: if you like what you received, tell your friends. If not, tell us, and we'll make it right!\n"
		. "Keep up with our latest sales and news. Go to http://eepurl.com/C0rB1 and sign up for our mailing list.\n"
		. "Visit our other website at http://theroadlessordinary.com for greeting cards, journals, post-its, and other ephemera featuring original artwork and characters.";
	DB::exec("INSERT INTO `{$p}email_signatures` (token, label, body) VALUES ('signature1', 'Bill', ?)", [$sig]);

	$t = [
		['Order Shipped', 'Your order has shipped',
"Dear [fname],\n\nWe wanted to drop you a note and let you know that your order has shipped. This completes your order.\n\nYour order was shipped via [shipping method]. You can track your order in transit at this link:\n\nhttps://tools.usps.com/tracking/[tracking number],\n\nIf you have any additional questions, reach out to us at this email, or at our phone number, [store phone number].\n\nThank you for your business!\n\n[signature1]"],
		['Order Delayed', 'An update on your order',
"Dear [fname],\n\nWe wanted to drop you a note with a status update. Because of [type something here] your order has been delayed.\n\nWe expect it to ship [type something here].\n\nThank you for your business!\n\n[signature1]"],
		['Order Unpaid', 'Your order is awaiting payment',
"Dear [fname],\n\nYour order is placed, but appears to be unpaid. To prevent a delay in processing, please remit payment as soon as you can. We will be happy to send a PayPal request to your email, or to pay by CC a Stripe invoice.\n\nPlease let us know how you'd like to proceed.\n\nThank you for your business!\n\n[signature1]"],
	];
	$first = 0;
	foreach ($t as $row) {
		$id = DB::insert("INSERT INTO `{$p}email_templates` (name, subject, body) VALUES (?,?,?)", $row);
		if (!$first) $first = $id;
	}
	// Ships inactive: nothing is emailed until it is switched on in Email Templates -> Events.
	DB::exec("INSERT INTO `{$p}email_events` (event, status_slug, template_id, active) VALUES ('status_changed', 'shipped', ?, 0)", [$first]);
});

// ── Tokens ────────────────────────────────────────────────────────────────────
function et_token_help(): array {
	$p = DB_PREFIX;
	$out = [
		'fname'              => "Customer's first name",
		'lname'              => "Customer's last name",
		'customer name'      => "Customer's full name",
		'email'              => "Order email address",
		'order number'       => 'Order number',
		'order total'        => 'Order total, e.g. $24.50',
		'shipping method'    => 'Shipping method chosen on the order',
		'tracking number'    => 'Tracking number saved on the order',
		'tracking url'       => "Carrier's tracking link, if one was saved",
		'store name'         => 'Store name',
		'store phone number' => 'Store phone number (Settings)',
		'store email'        => 'Store email address',
	];
	foreach (DB::rows("SELECT token, label FROM `{$p}email_signatures` ORDER BY token") as $s) {
		$out[$s['token']] = 'Signature' . ($s['label'] !== '' ? ': ' . $s['label'] : '');
	}
	return $out;
}

function et_order_values(int $order_id): ?array {
	$p = DB_PREFIX;
	$o = DB::row(
		"SELECT o.*, c.first_name AS c_first, c.last_name AS c_last, c.email AS c_email
		 FROM `{$p}orders` o LEFT JOIN `{$p}customers` c ON c.id = o.customer_id WHERE o.id = ?",
		[$order_id]
	);
	if (!$o) return null;
	$s = [];
	foreach (DB::rows("SELECT `key`, `value` FROM `{$p}settings` WHERE `key` IN ('site_name','store_phone','mail_from')") as $r) $s[$r['key']] = $r['value'];
	$first = trim($o['ship_firstname'] ?: ($o['c_first'] ?? ''));
	$last  = trim($o['ship_lastname']  ?: ($o['c_last']  ?? ''));
	$email = trim($o['ship_email'] ?: ($o['c_email'] ?? ''));
	return [
		'_email' => $email,
		'fname' => $first !== '' ? $first : 'Customer',
		'lname' => $last,
		'customer name' => trim($first . ' ' . $last),
		'email' => $email,
		'order number' => (string)$o['id'],
		'order total' => '$' . number_format((float)$o['total'], 2),
		'shipping method' => trim($o['ship_method']),
		'tracking number' => trim($o['tracking_number']),
		'tracking url' => trim($o['tracking_url']),
		'store name' => $s['site_name'] ?? (defined('SITE_NAME') ? SITE_NAME : ''),
		'store phone number' => trim($s['store_phone'] ?? ''),
		'store email' => $s['mail_from'] ?? (defined('SITE_EMAIL') ? SITE_EMAIL : ''),
	];
}

/**
 * Replace [tokens] in $text. Returns ['text', 'unknown' => [...], 'empty' => [...]].
 * Unknown and empty tokens are left as written so they stay visible.
 */
function et_render(string $text, array $vals): array {
	$p = DB_PREFIX;
	$sigs = [];
	foreach (DB::rows("SELECT token, body FROM `{$p}email_signatures`") as $s) $sigs[strtolower($s['token'])] = (string)$s['body'];

	$unknown = []; $empty = [];
	$sub = function (string $t, bool $allow_sig) use (&$sub, $vals, $sigs, &$unknown, &$empty) {
		return preg_replace_callback('/\[([A-Za-z0-9 _\-]+)\]/', function ($m) use (&$sub, $vals, $sigs, $allow_sig, &$unknown, &$empty) {
			$key = strtolower(trim($m[1]));
			if ($allow_sig && isset($sigs[$key])) return $sub($sigs[$key], false);
			if (array_key_exists($key, $vals) && $key[0] !== '_') {
				if ($vals[$key] === '') { $empty[$key] = true; return $m[0]; }
				return $vals[$key];
			}
			$unknown[$m[1]] = true;
			return $m[0];
		}, $t);
	};
	return ['text' => $sub($text, true), 'unknown' => array_keys($unknown), 'empty' => array_keys($empty)];
}

function et_html(string $body): string {
	$h = htmlspecialchars($body, ENT_QUOTES, 'UTF-8');
	$h = preg_replace('~(https?://[^\s<>"]+?)([.,;:!?)]*)(?=\s|$)~', '<a href="$1">$1</a>$2', $h);
	return '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:640px;margin:0 auto;padding:20px">'
		. nl2br($h) . '</body></html>';
}

// ── Automatic sends ───────────────────────────────────────────────────────────
function et_log(int $event_id, int $order_id, int $tpl, string $to, string $result, string $note = ''): void {
	DB::exec("INSERT INTO `" . DB_PREFIX . "email_log` (event_id, order_id, template_id, to_email, result, note) VALUES (?,?,?,?,?,?)",
		[$event_id, $order_id, $tpl, $to, $result, mb_substr($note, 0, 255)]);
}

function et_run_events(string $event, string $status_slug, int $order_id): void {
	if (!$order_id) return;
	$p = DB_PREFIX;
	$events = DB::rows(
		"SELECT * FROM `{$p}email_events` WHERE active = 1 AND event = ? AND (status_slug = '' OR status_slug = ?)",
		[$event, $status_slug]
	);
	foreach ($events as $ev) {
		$eid = (int)$ev['id']; $tid = (int)$ev['template_id'];
		if (DB::val("SELECT id FROM `{$p}email_log` WHERE event_id = ? AND order_id = ? AND result = 'sent' LIMIT 1", [$eid, $order_id])) continue;
		$tpl = DB::row("SELECT * FROM `{$p}email_templates` WHERE id = ?", [$tid]);
		$vals = et_order_values($order_id);
		if (!$tpl || !$vals) { et_log($eid, $order_id, $tid, '', 'skipped', 'template or order missing'); continue; }
		$to = $vals['_email'];
		if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) { et_log($eid, $order_id, $tid, $to, 'skipped', 'no valid email on order'); continue; }

		$subj = et_render($tpl['subject'], $vals);
		$body = et_render((string)$tpl['body'], $vals);
		$bad  = array_merge($subj['unknown'], $body['unknown'], $subj['empty'], $body['empty']);
		if ($bad) {
			et_log($eid, $order_id, $tid, $to, 'skipped', 'unfilled: [' . implode('], [', array_unique($bad)) . ']');
			continue;
		}
		global $_nc_settings;
		$from = $vals['store name'] . ' <' . ($_nc_settings['mail_from'] ?? SITE_EMAIL) . '>';
		$ok = nc_mail($to, $subj['text'], et_html($body['text']), $from, true);
		et_log($eid, $order_id, $tid, $to, $ok ? 'sent' : 'failed', $ok ? '' : 'mail server could not send');
	}
}

Hook::on('admin.order.status.changed', function ($ctx) {
	et_run_events('status_changed', (string)($ctx['new_status'] ?? ''), (int)($ctx['order_id'] ?? 0));
});

Hook::on('catalog.order.payment_complete', function ($order) {
	et_run_events('payment_received', '', (int)($order['id'] ?? 0));
});

// ── Order drawer: template picker on the Message tab ──────────────────────────
Hook::on('admin.page.scripts', function ($ctx) {
	if (($ctx['route'] ?? '') !== 'orders') return null;
	$dir = DIR_ROOT . 'plugins/email-templates/admin/';
	return '<link rel="stylesheet" href="' . URL_ROOT . 'plugins/email-templates/admin/css/email-templates.css?v=' . filemtime($dir . 'css/email-templates.css') . '">'
	     . '<script src="' . URL_ROOT . 'plugins/email-templates/admin/js/order-message.js?v=' . filemtime($dir . 'js/order-message.js') . '"></script>';
});
