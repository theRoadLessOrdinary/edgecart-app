<?php
/**
 * CandyCart - shared utility functions
 */

// ── Output helpers ─────────────────────────────────────────────────────────────

function h(mixed $val): string {
	return htmlspecialchars((string)$val, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function money(float $amount): string {
	return SITE_CURRENCY . number_format($amount, 2);
}

function json_out(mixed $data, int $status = 200): never {
	http_response_code($status);
	header('Content-Type: application/json');
	echo json_encode($data);
	exit;
}

function ajax_out(bool $ok, string $message = '', array $extra = []): never {
	echo json_encode(['ok' => $ok, 'message' => $message] + $extra);
	exit;
}

// ── Request helpers ────────────────────────────────────────────────────────────

function get(string $key, mixed $default = ''): mixed {
	return $_GET[$key] ?? $default;
}

function post(string $key, mixed $default = ''): mixed {
	return $_POST[$key] ?? $default;
}

function is_post(): bool {
	return $_SERVER['REQUEST_METHOD'] === 'POST';
}

function is_ajax(): bool {
	return !empty($_SERVER['HTTP_X_REQUESTED_WITH'])
		&& strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest';
}

// ── Session helpers ────────────────────────────────────────────────────────────

function session_get(string $key, mixed $default = null): mixed {
	return $_SESSION[$key] ?? $default;
}

function session_set(string $key, mixed $val): void {
	$_SESSION[$key] = $val;
}

function session_del(string $key): void {
	unset($_SESSION[$key]);
}

function flash_set(string $type, string $message): void {
	$_SESSION['_flash'] = ['type' => $type, 'message' => $message];
}

function flash_get(): ?array {
	$flash = $_SESSION['_flash'] ?? null;
	unset($_SESSION['_flash']);
	return $flash;
}

// ── CSRF protection ────────────────────────────────────────────────────────────

function csrf_token(): string {
	if (empty($_SESSION['_csrf_token'])) {
		$_SESSION['_csrf_token'] = bin2hex(random_bytes(32));
	}
	return $_SESSION['_csrf_token'];
}

function verify_csrf_token(string $token = ''): bool {
	$sessionToken = $_SESSION['_csrf_token'] ?? '';
	return !empty($sessionToken) && hash_equals($sessionToken, $token ?? '');
}

function require_csrf_token(): void {
	if (!verify_csrf_token(post('csrf_token'))) {
		http_response_code(403);
		exit('Security token invalid.');
	}
}

function require_csrf_token_json(): void {
	header('Content-Type: application/json');
	if (!verify_csrf_token(post('csrf_token'))) {
		http_response_code(403);
		echo json_encode(['ok' => false, 'message' => 'Security token invalid.']);
		exit;
	}
}

// ── String helpers ─────────────────────────────────────────────────────────────

function slug(string $str): string {
	$str = strtolower(trim($str));
	$str = preg_replace('/[^a-z0-9]+/', '-', $str);
	return trim($str, '-');
}

function truncate(string $str, int $len = 100, string $suffix = '…'): string {
	return mb_strlen($str) > $len
		? mb_substr($str, 0, $len) . $suffix
		: $str;
}

// ── Redirect ───────────────────────────────────────────────────────────────────

function redirect(string $url): never {
	header('Location: ' . $url);
	exit;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

// Access level flags
const ACCESS_ADD     =   2;
const ACCESS_DELETE  =   4;
const ACCESS_EDIT    =   8;
const ACCESS_PRICING =  16;
const ACCESS_REPORTS =  32;
const ACCESS_REVIEWS =  64;
const ACCESS_PAGES   = 128;

// Named shortcut levels
const ACCESS_ADMIN        = 254; // all
const ACCESS_SUPER_EDITOR = 234; // no delete, no pricing
const ACCESS_EDITOR       =  10; // add + edit
const ACCESS_USER         =   0; // read only

function is_logged_in(): bool {
	return !empty($_SESSION['customer_id']);
}

// Admin session limits: idle timeout and absolute cap regardless of activity.
const ADMIN_IDLE_TIMEOUT     = 3600;  // 1 hour of inactivity
const ADMIN_ABSOLUTE_TIMEOUT = 43200; // 12 hours since login, no matter what

function is_admin(): bool {
	if (empty($_SESSION['admin_id'])) return false;

	$now       = time();
	$loginAt   = (int)($_SESSION['admin_login_at']    ?? 0);
	$lastActive = (int)($_SESSION['admin_last_active'] ?? 0);

	// Sessions created before this check existed won't have these set - treat as expired
	// rather than grandfathering them in with no bound.
	if (!$loginAt || !$lastActive
		|| ($now - $lastActive) > ADMIN_IDLE_TIMEOUT
		|| ($now - $loginAt)    > ADMIN_ABSOLUTE_TIMEOUT
	) {
		session_del('admin_id');
		session_del('admin_username');
		session_del('admin_login_at');
		session_del('admin_last_active');
		return false;
	}

	$_SESSION['admin_last_active'] = $now;
	return true;
}

function admin_can(int $flag): bool {
	$level = (int)($_SESSION['admin_access'] ?? 0);
	return ($level & $flag) === $flag;
}

function require_admin(): void {
	if (!is_admin()) redirect(URL_ADMIN . '?route=login');
}

function require_access(int $flag): void {
	if (!is_admin())        redirect(URL_ADMIN . '?route=login');
	if (!admin_can($flag))  redirect(URL_ADMIN . '?route=dashboard');
}

// JSON-safe counterparts for AJAX endpoints - a redirect() response breaks a
// fetch().then(r => r.json()) caller silently (it gets HTML back, not JSON),
// which is exactly how "my settings save silently does nothing" happens when
// a session has simply expired mid-use. Mirrors require_csrf_token_json().
function require_admin_json(): void {
	if (!is_admin()) {
		http_response_code(401);
		header('Content-Type: application/json');
		echo json_encode(['ok' => false, 'message' => 'Session expired. Please log in again.']);
		exit;
	}
}

function require_access_json(int $flag): void {
	require_admin_json();
	if (!admin_can($flag)) {
		http_response_code(403);
		header('Content-Type: application/json');
		echo json_encode(['ok' => false, 'message' => 'You do not have permission to do that.']);
		exit;
	}
}

// URL_ROOT/URL_ADMIN are relative-only ('/', '/admin/') - fine for links rendered
// inside a page, but anything going into an email needs a real absolute URL.
// $relative should already start with the right leading slash (e.g. URL_ADMIN).
function absolute_url(string $relative): string {
	$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://';
	$host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
	return $scheme . $host . $relative;
}

// The google-oauth plugin being installed/enabled isn't enough to show a "Sign in
// with Google" button - without a client ID and secret configured in its admin
// settings, clicking it would just fail. Check both.
function google_oauth_configured(): bool {
	if (!in_array('google-oauth', PluginLoader::loaded(), true)) return false;
	$p = DB_PREFIX;
	$id     = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='google_client_id'");
	$secret = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='google_client_secret'");
	return (bool)$id && (bool)$secret;
}

function require_login(): void {
	if (!is_logged_in()) redirect(URL_ROOT . '?route=account/login');
}

// ── Incomplete item reminders ──────────────────────────────────────────────────

function reminder_add(string $entity, int $entity_id, string $label, string $message): void {
	$p = DB_PREFIX;
	DB::exec(
		"INSERT INTO `{$p}incomplete` (entity, entity_id, label, message)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE label=VALUES(label), message=VALUES(message)",
		[$entity, $entity_id, $label, $message]
	);
}

function reminder_clear(string $entity, int $entity_id): void {
	$p = DB_PREFIX;
	DB::exec(
		"DELETE FROM `{$p}incomplete` WHERE entity=? AND entity_id=?",
		[$entity, $entity_id]
	);
}

function reminder_list(): array {
	$p = DB_PREFIX;
	try {
		return DB::rows("SELECT * FROM `{$p}incomplete` ORDER BY created_at ASC");
	} catch (Exception $e) {
		return [];
	}
}

function reminder_ids(string $entity): array {
	$p = DB_PREFIX;
	try {
		$rows = DB::rows(
			"SELECT entity_id FROM `{$p}incomplete` WHERE entity=?",
			[$entity]
		);
		return array_column($rows, 'entity_id');
	} catch (Exception $e) {
		return [];
	}
}

// ── Error handling ─────────────────────────────────────────────────────────────

function cc_error_handler(int $code, string $message, string $file, int $line): bool {
	if (!($code & error_reporting())) return false;
	$entry = date('[Y-m-d H:i:s]') . " PHP Error [{$code}]: {$message} in {$file} on line {$line}" . PHP_EOL;
	if (ini_get('log_errors')) {
		@file_put_contents(ERROR_LOG, $entry, FILE_APPEND);
	}
	if (ini_get('display_errors')) {
		echo "<pre style='color:red'>{$entry}</pre>";
	}
	return true;
}

function cc_exception_handler(Throwable $e): void {
	$entry = date('[Y-m-d H:i:s]') . " Exception: " . $e->getMessage()
		. " in " . $e->getFile() . " on line " . $e->getLine()
		. PHP_EOL . $e->getTraceAsString() . PHP_EOL;
	if (ini_get('log_errors')) {
		@file_put_contents(ERROR_LOG, $entry, FILE_APPEND);
	}
	if (ini_get('display_errors')) {
		echo "<pre style='color:red'>" . h($entry) . "</pre>";
	} else {
		if (!headers_sent()) http_response_code(500);
		echo "An error occurred.";
	}
}

// ── Catalog sidebar data ───────────────────────────────────────────────────────
/**
 * Register PHP functions that templates use as Smarty modifiers.
 * Smarty 4 deprecated auto-discovery; all PHP-function modifiers must be
 * registered explicitly. Add to this list as new ones are needed.
 *
 * A plugin that needs its own modifier or function should not be added to
 * the static list below - that would make core depend on a specific plugin
 * being installed, and a store without it would throw "unknown modifier"
 * from any template that still called it. Instead the plugin registers
 * itself, by listening on 'smarty.register_modifiers' and calling
 * $smarty->registerPlugin() there; the plugin ships its own copies of any
 * template that uses it (Smarty resolves plugin template dirs before the
 * base one, so installing the plugin folder is enough - see
 * PluginLoader::templateDirs()), so a store without the plugin never has a
 * template referencing a modifier that doesn't exist.
 */
function register_smarty_modifiers(Smarty $smarty): void {
    static $modifiers = ['trim', 'count', 'intval', 'number_format', 'json_encode', 'nl2br'];
    foreach ($modifiers as $fn) {
        $smarty->registerPlugin('modifier', $fn, $fn);
    }
    $smarty->registerPlugin('function', 'csrf_token', 'csrf_token');

    Hook::fire('smarty.register_modifiers', $smarty);
}

function load_menu(int $menu_id, string $p, int $product_id = 0): array {
	if (!$menu_id) return [];

	// Check menu type - some menus are auto-built rather than item-driven
	$menu = DB::row("SELECT menu_type FROM `{$p}menus` WHERE id=?", [$menu_id]);

	if ($menu && ($menu['menu_type'] ?? '') === 'related_products') {
		if (!$product_id) return [];
		$products = DB::rows(
			"SELECT p.id, p.name, p.slug, p.price, p.list_price,
			        (SELECT filename FROM `{$p}product_images`
			         WHERE product_id=p.id ORDER BY display_order ASC LIMIT 1) AS thumbnail
			 FROM `{$p}product_related` pr
			 JOIN `{$p}products` p ON p.id = pr.related_product_id
			 WHERE pr.product_id = ? AND p.status > 0
			 ORDER BY pr.display_order ASC",
			[$product_id]
		);
		$items = [];
		foreach ($products as $prod) {
			$items[] = [
				'id'            => 0,
				'menu_id'       => $menu_id,
				'label'         => $prod['name'],
				'item_type'     => 'related_product',
				'slug'          => $prod['slug'],
				'thumbnail'     => $prod['thumbnail'] ?? '',
				'price'         => $prod['price'],
				'list_price'    => $prod['list_price'],
				'url'           => '',
				'page_slug'     => null,
				'category_slug' => null,
				'category_id'   => null,
				'submenu_id'    => null,
				'submenu_items' => [],
				'show_count'    => 0,
				'enabled'       => 1,
				'target'        => '',
				'js_code'       => '',
				'settings'      => null,
			];
		}
		return $items;
	}

	if ($menu && ($menu['menu_type'] ?? '') === 'category_list') {
		// Get excluded categories from the single config item's settings
		$config = DB::row("SELECT settings FROM `{$p}menu_items` WHERE menu_id=? LIMIT 1", [$menu_id]);
		$excluded = [];
		if ($config && $config['settings']) {
			$s = json_decode($config['settings'], true);
			$excluded = $s['excluded_cats'] ?? [];
		}
		$cats = DB::rows(
			"SELECT id, name, slug,
			 (SELECT COUNT(*) FROM `{$p}categories_products` cp
			  JOIN `{$p}products` pp ON pp.id=cp.product_id
			  WHERE cp.category_id=c.id AND pp.status>0) AS product_count
			 FROM `{$p}categories` c
			 WHERE status>0
			 ORDER BY display_order ASC, name ASC"
		);
		$items = [];
		foreach ($cats as $cat) {
			if (in_array((string)$cat['id'], array_map('strval', $excluded))) continue;
			$items[] = [
				'id'              => 0,
				'menu_id'         => $menu_id,
				'label'           => $cat['name'],
				'item_type'       => 'category',
				'category_slug'   => $cat['slug'],
				'category_id'     => $cat['id'],
				'product_count'   => $cat['product_count'],
				'show_count'      => 1,
				'enabled'         => 1,
				'url'             => '',
				'page_slug'       => null,
				'submenu_id'      => null,
				'submenu_items'   => [],
				'target'          => '',
				'js_code'         => '',
				'settings'        => null,
			];
		}
		return $items;
	}

	$items = DB::rows(
		"SELECT mi.*, p.slug AS page_slug, c.slug AS category_slug,
		        c.name AS category_name
		 FROM `{$p}menu_items` mi
		 LEFT JOIN `{$p}pages` p ON p.id = mi.page_id
		 LEFT JOIN `{$p}categories` c ON c.id = mi.category_id
		 WHERE mi.menu_id=? AND mi.enabled=1
		 ORDER BY mi.display_order ASC",
		[$menu_id]
	);
	foreach ($items as &$item) {
		if ($item['item_type'] === 'category_tree') {
			// Expand all active categories
			$cats = DB::rows(
				"SELECT slug, name,
				 (SELECT COUNT(*) FROM `{$p}categories_products` cp
				  JOIN `{$p}products` pp ON pp.id=cp.product_id
				  WHERE cp.category_id=c.id AND pp.status>0) AS cnt
				 FROM `{$p}categories` c WHERE status>0 ORDER BY display_order ASC, name ASC"
			);
			$item['expanded_categories'] = $cats;
		}
		if ($item['show_count'] && $item['category_id']) {
			$item['product_count'] = (int)DB::val(
				"SELECT COUNT(*) FROM `{$p}categories_products` cp
				 JOIN `{$p}products` p ON p.id=cp.product_id
				 WHERE cp.category_id=? AND p.status>0",
				[$item['category_id']]
			);
		}
		if ($item['submenu_id']) {
			$item['submenu_items'] = load_menu((int)$item['submenu_id'], $p);
		}
	}
	unset($item);
	return $items;
}

function catalog_sidebar(Smarty $smarty, int $product_id = 0): void {
	// $_nc_settings (lib/db.php) is populated at bootstrap as a top-level
	// global with the full settings table - functions don't inherit
	// outer-scope variables automatically, so it must be pulled in explicitly.
	global $_nc_settings;
	$p = DB_PREFIX;

	// Active categories
	$hide_empty = (int)($_nc_settings['hide_empty_categories'] ?? 1);
	if ($hide_empty) {
		// Only include categories with products
		$cats = DB::rows(
			"SELECT c.id, c.name, c.slug FROM `{$p}categories` c
			 INNER JOIN `{$p}categories_products` cp ON cp.category_id = c.id
			 WHERE c.status > 0
			 GROUP BY c.id
			 ORDER BY c.display_order ASC, c.name ASC"
		);
	} else {
		$cats = DB::rows(
			"SELECT id, name, slug FROM `{$p}categories`
			 WHERE status > 0 ORDER BY display_order ASC, name ASC"
		);
	}
	$smarty->assign('sidebar_categories', $cats);

	// What's New (last 6 products)
	$new = DB::rows(
		"SELECT id, name, slug FROM `{$p}products`
		 WHERE status > 0 ORDER BY id DESC LIMIT 6"
	);
	$smarty->assign('sidebar_new', $new);

	// Top sellers (by order count)
	$top = DB::rows(
		"SELECT p.id, p.name, p.slug, COUNT(oi.id) AS sold
		 FROM `{$p}products` p
		 LEFT JOIN `{$p}order_items` oi ON oi.product_id = p.id
		 WHERE p.status > 0
		 GROUP BY p.id ORDER BY sold DESC, p.name ASC LIMIT 6"
	);
	$smarty->assign('sidebar_top', $top);

	// Global menus
	$menu1_row = DB::row("SELECT id, menu_type FROM `{$p}menus` WHERE menu_role='menu1' LIMIT 1");
	$menu2_row = DB::row("SELECT id, menu_type FROM `{$p}menus` WHERE menu_role='menu2' LIMIT 1");
	$smarty->assign('menu1', $menu1_row ? load_menu((int)$menu1_row['id'], $p) : []);

	$menu2_type = $menu2_row['menu_type'] ?? '';
	$smarty->assign('menu2',      $menu2_row ? load_menu((int)$menu2_row['id'], $p, $product_id) : []);
	$smarty->assign('menu2_type', $menu2_type);

	// Store settings for layout
	$s = [];
	$rows = DB::rows("SELECT `key`,`value` FROM `{$p}settings` WHERE `key` IN ('store_phone','store_logo_url')");
	foreach ($rows as $row) $s[$row['key']] = $row['value'];
	$smarty->assign('store_phone',    $s['store_phone']    ?? '');
	$smarty->assign('store_logo_url', $s['store_logo_url'] ?? '');
	$smarty->assign('cart_subtotal',  Cart::subtotal());
}

// ── Product deduplication (for featured/related products) ──────────────────────
function track_displayed_product(int $product_id): void {
	if (!isset($_SESSION['_nc_displayed_products'])) {
		$_SESSION['_nc_displayed_products'] = [];
	}
	if (!in_array($product_id, $_SESSION['_nc_displayed_products'], true)) {
		$_SESSION['_nc_displayed_products'][] = $product_id;
	}
}

function get_displayed_products(): array {
	return $_SESSION['_nc_displayed_products'] ?? [];
}

// ── Order confirmation email ───────────────────────────────────────────────────
function send_order_confirmation_email(array $order): bool {
	$p = DB_PREFIX;

	// Fetch order items
	$items = DB::rows(
		"SELECT * FROM `{$p}order_items` WHERE order_id = ?",
		[$order['id']]
	);

	if (!$items) return false;

	$to = $order['ship_email'];
	$subject = 'Your Order #' . $order['id'] . ' - ' . (SITE_NAME ?? 'Order Confirmation');

	// Build email body (plain text)
	$body = "Thank you for your order!\n\n";
	$body .= "Order #: " . $order['id'] . "\n";
	$body .= "Date: " . date('M d, Y', strtotime($order['created_at'])) . "\n\n";

	$body .= "ITEMS:\n";
	$body .= str_repeat('-', 50) . "\n";
	foreach ($items as $item) {
		$body .= $item['name'] ?? 'Unknown Product';
		if (!empty($item['options_summary'])) {
			$body .= " (" . $item['options_summary'] . ")";
		}
		$body .= "\n";
	}
	$body .= str_repeat('-', 50) . "\n\n";

	$body .= "Subtotal: " . money($order['subtotal']) . "\n";
	if ($order['discount_amount'] > 0) {
		$body .= "Discount: - " . money($order['discount_amount']) . "\n";
	}
	if ($order['tax'] > 0) {
		$body .= "Tax: " . money($order['tax']) . "\n";
	}
	$body .= "TOTAL: " . money($order['total']) . "\n\n";

	$body .= "MANAGE YOUR ORDER:\n";
	$body .= "Order #: " . $order['id'] . "\n";
	$body .= "To view your order details, create an account at: " . URL_ROOT . "account-verify?order=" . $order['id'] . "\n\n";

	$body .= "Thank you for shopping with us!\n";
	if (SITE_NAME) $body .= SITE_NAME . "\n";
	$body .= URL_ROOT . "\n";

	return nc_mail($to, $subject, $body);
}

function sys_page_content(int $page_id): array {
    $p = DB_PREFIX;
    return [
        'before' => DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`=?", ["sys_page_before_{$page_id}"]) ?? '',
        'after'  => DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`=?", ["sys_page_after_{$page_id}"])  ?? '',
    ];
}

/**
 * Validate a discount code against the database.
 * Returns ['amount' => float, 'error' => ?string].
 * Plugins may override via Hook::instead('checkout.discount.apply', ...).
 */
function checkout_validate_discount(string $code, float $subtotal): array {
    if (!$code) return ['amount' => 0, 'error' => null];
    $p        = DB_PREFIX;
    $discount = DB::row(
        "SELECT type, amount, min_order_amount, single_use, usage_limit, used_count,
                active_from, active_until, status
         FROM `{$p}discount_codes` WHERE code = ? AND status = 1",
        [$code]
    );
    if (!$discount) return ['amount' => 0, 'error' => 'Invalid or expired discount code.'];
    $today = date('Y-m-d');
    if ($discount['active_from'] > $today)
        return ['amount' => 0, 'error' => 'This discount code is not yet active.'];
    if ($discount['active_until'] && $discount['active_until'] < $today)
        return ['amount' => 0, 'error' => 'This discount code has expired.'];
    if ($discount['single_use'] && $discount['used_count'] >= 1)
        return ['amount' => 0, 'error' => 'This discount code has already been used.'];
    if ($discount['usage_limit'] && $discount['used_count'] >= $discount['usage_limit'])
        return ['amount' => 0, 'error' => 'This discount code has been used up.'];
    if ($discount['min_order_amount'] && $subtotal < $discount['min_order_amount'])
        return ['amount' => 0, 'error' => 'Order amount is below the minimum for this discount code.'];
    $disc_amount = $discount['type'] === 'percent'
        ? ($subtotal * $discount['amount'] / 100)
        : $discount['amount'];
    return ['amount' => round($disc_amount, 2), 'error' => null];
}

/**
 * Increment used_count for a discount code after a successful order.
 */
function checkout_mark_discount_used(string $code): void {
    if (!$code) return;
    $p = DB_PREFIX;
    DB::exec("UPDATE `{$p}discount_codes` SET used_count = used_count + 1 WHERE code = ?", [$code]);
}

/**
 * Default sales-tax calculation, used when no plugin overrides
 * checkout.tax.calculate.instead. Reads the merchant-managed zones/rates
 * from the core Locations & Tax admin screen (admin/ctl/locations.php) -
 * no external tax provider or API key required.
 */
function checkout_calculate_tax(string $state, string $country, array $items, float $shipping = 0.0): float {
    if (!$state || !$country) {
        return 0.0;
    }

    $p = DB_PREFIX;

    $rate_row = DB::row(
        "SELECT tr.rate, tr.applies_to_shipping
         FROM `{$p}tax_rates` tr
         JOIN `{$p}tax_zones` tz ON tr.zone_id = tz.zone_id
         WHERE tz.country_code=? AND tz.state_code=? AND tr.active=1
         ORDER BY tz.priority DESC
         LIMIT 1",
        [$country, $state]
    );

    if (!$rate_row) {
        return 0.0;
    }

    $rate = floatval($rate_row['rate']);
    $applies_to_shipping = $rate_row['applies_to_shipping'];

    $taxable_subtotal = 0.0;
    foreach ($items as $item) {
        if ($item['taxable'] ?? true) {
            $taxable_subtotal += floatval($item['line_total'] ?? 0);
        }
    }

    if ($applies_to_shipping) {
        $taxable_subtotal += $shipping;
    }

    return round($taxable_subtotal * $rate, 2);
}

// ── Order message history ─────────────────────────────────────────────────────
// Every email sent to a customer about an order (the order drawer's Message tab,
// plus plugin sends like Email Templates) is recorded here so the order shows
// what the customer has been told. Body is stored as plain text.
function order_messages_ensure_table(): void {
	static $done = false;
	if ($done) return;
	$p = DB_PREFIX;
	DB::exec("CREATE TABLE IF NOT EXISTS `{$p}order_messages` (
		`id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
		`order_id`   INT UNSIGNED NOT NULL,
		`to_email`   VARCHAR(255) NOT NULL DEFAULT '',
		`subject`    VARCHAR(255) NOT NULL DEFAULT '',
		`body`       MEDIUMTEXT,
		`source`     VARCHAR(64)  NOT NULL DEFAULT '',
		`sent_by`    VARCHAR(64)  NOT NULL DEFAULT '',
		`result`     VARCHAR(16)  NOT NULL DEFAULT 'sent',
		`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (`id`),
		KEY `order_id` (`order_id`)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
	$done = true;
}

function order_message_log(int $order_id, string $to, string $subject, string $body, string $source, bool $ok): void {
	if (!$order_id) return;
	order_messages_ensure_table();
	// HTML bodies (the Message tab sends <p>..<br>..</p>) become readable text
	if ($body !== strip_tags($body)) {
		$body = preg_replace('~<br\s*/?>|</p>\s*<p[^>]*>~i', "\n", $body);
		$body = html_entity_decode(strip_tags($body), ENT_QUOTES | ENT_HTML5, 'UTF-8');
	}
	DB::exec(
		"INSERT INTO `" . DB_PREFIX . "order_messages` (order_id, to_email, subject, body, source, sent_by, result) VALUES (?,?,?,?,?,?,?)",
		[$order_id, mb_substr($to, 0, 255), mb_substr($subject, 0, 255), trim($body), mb_substr($source, 0, 64),
		 mb_substr((string)($_SESSION['admin_username'] ?? ''), 0, 64), $ok ? 'sent' : 'failed']
	);
}

function order_messages_for(int $order_id): array {
	order_messages_ensure_table();
	return DB::rows(
		"SELECT id, to_email, subject, body, source, sent_by, result,
		        DATE_FORMAT(created_at, '%b %e, %Y %l:%i %p') AS date_fmt
		 FROM `" . DB_PREFIX . "order_messages` WHERE order_id = ? ORDER BY id DESC",
		[$order_id]
	);
}
