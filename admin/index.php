<?php
/**
 * EdgeCart admin - front controller
 */
define('IS_ADMIN', true);

// ── Bootstrap ──────────────────────────────────────────────────────────────────
require __DIR__ . '/../cfg/config.php';

// Reject any request that didn't come in through the obfuscated admin path.
// This file is also reachable directly at the real /admin/ URL (it's a real
// directory with a DirectoryIndex), which defeats the point of ADMIN_PATH -
// close that off rather than letting it fall through to the normal
// not-logged-in redirect, which would confirm the real path back to a scanner.
if (php_sapi_name() !== 'cli') {
	$_nc_admin_req_uri = $_SERVER['REQUEST_URI'] ?? '';
	if (strpos($_nc_admin_req_uri, '/' . ADMIN_PATH) !== 0) {
		http_response_code(404);
		exit;
	}
}

require_once DIR_LIB . 'db.php';
require_once DIR_LIB . 'functions.php';
require_once DIR_LIB . 'mailer.php';
require_once DIR_LIB . 'hook.php';
require_once DIR_LIB . 'license-limits.php';
require_once DIR_LIB . 'shortcode.php';
require_once DIR_LIB . 'license.php';
require_once DIR_LIB . 'reports.php';
require_once DIR_LIB . 'opensalestax.php';
require_once DIR_LIB . 'plugin-loader.php';

ini_set('session.name', SESSION_NAME);
ini_set('session.save_path', DIR_ROOT . 'cache/sessions');
if (!is_dir(DIR_ROOT . 'cache/sessions')) mkdir(DIR_ROOT . 'cache/sessions', 0777, true);
ini_set('session.gc_maxlifetime', SESSION_LIFETIME);
session_set_cookie_params([
	'httponly' => true,
	'secure'   => !empty($_SERVER['HTTPS']),
	'samesite' => 'Strict'  // Stricter protection for admin
]);
session_start();

// ── Security Headers (Admin) ───────────────────────────────────────────────────
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');

DB::connect();

// ── Load live settings from DB (overrides config.php constants) ────────────────
$_nc_settings = [];
try {
	$_nc_settings_rows = DB::rows("SELECT `key`, `value` FROM `" . DB_PREFIX . "settings`");
	foreach ($_nc_settings_rows as $_r) {
		$_nc_settings[$_r['key']] = $_r['value'];
	}
} catch (Exception $e) { /* DB may not be ready on first install */ }

$_nc_site_name = $_nc_settings['site_name'] ?? SITE_NAME;
$_nc_site_favicon    = $_nc_settings['site_favicon']    ?? '';
$_nc_favicon_svg_url = $_nc_settings['favicon_svg_url'] ?? '';

// ── Boot plugins ───────────────────────────────────────────────────────────────
// No cfg/license.php at all means this isn't a fulfillment-built customer
// install (e.g. EdgeCart's own source tree, or store.edgecart.io itself,
// neither of which are domain-licensed) - nothing to enforce. A license file
// that IS present but doesn't match this domain is enforced below.
if (file_exists(DIR_ROOT . 'cfg/license.php')) {
    require_once DIR_ROOT . 'cfg/license.php';
    License::enforceOrBlock();
}
PluginLoader::boot();
require_once DIR_LIB . 'shipping.php';
Hook::fire('app.boot');
Hook::fire('admin.bootstrap.before');

// ── Smarty ─────────────────────────────────────────────────────────────────────
require_once DIR_LIB . 'vendor/smarty/smarty/libs/Smarty.class.php';

$smarty = new Smarty();
$smarty->registerClass('Smarty', 'Smarty');
// Vendor debug.tpl uses {Smarty::SMARTY_VERSION}, which triggers a PHP 8
// "unregistered static method" deprecation warning on every debug-console
// render regardless of registerClass() above (that call doesn't cover
// constant access) - override with a local copy that hardcodes the version
// string instead.
$smarty->debug_tpl = 'file:' . DIR_LIB . 'smarty-overrides/debug.tpl';
register_smarty_modifiers($smarty);
$smarty->debugging = is_admin() && !empty($_nc_settings['smarty_debug']);

// Plugin template dirs take priority over default
$tpl_dirs = array_merge(
	PluginLoader::adminTemplateDirs(),
	[DIR_ADMIN . 'tpl/']
);
$smarty->assign('plugin_menu_setup',       PluginLoader::adminMenuItems('setup'));
$_catalog_items   = PluginLoader::adminMenuItems('catalog');
$_customers_items = PluginLoader::adminMenuItems('customers');
$_content_items   = PluginLoader::adminMenuItems('content');
$smarty->assign('plugin_menu_catalog',   $_catalog_items);
$smarty->assign('plugin_menu_customers', $_customers_items);
$smarty->assign('plugin_menu_content',   $_content_items);
$smarty->assign('active_plugins',     array_flip(PluginLoader::loaded()));
$smarty->assign('theme_head', Hook::filter('theme.head', ''));
$smarty->setTemplateDir($tpl_dirs);
$smarty->setCompileDir(DIR_CACHE . 'tpl/admin/');
$smarty->setCacheDir(DIR_CACHE . 'smarty/admin/');

	// Cache bust on deploy
	$rebuild_flag = DIR_CACHE . '.rebuild';
	if (file_exists($rebuild_flag)) {
		array_map('unlink', glob(DIR_CACHE . 'tpl/admin/*.php'));
		array_map('unlink', glob(DIR_CACHE . 'smarty/admin/*.php'));
		@unlink($rebuild_flag);
	}

// Set error handling from settings or fall back to constants. Display Errors
// and the Smarty Debug Console (above) put raw stack traces/template internals
// straight into the page - gate both behind an actual logged-in admin session
// (called directly here, not cached in a shared var, since this runs after
// the debugging line above already made its own is_admin() call) so a toggle
// left on in Settings never leaks anything to an anonymous visitor hitting
// this same front controller pre-login. log_errors only writes to the
// server-side log file, no visitor exposure, so it stays ungated.
ini_set('display_errors', (is_admin() && (!empty($_nc_settings['display_errors']) || DISPLAY_ERRORS)) ? 1 : 0);
ini_set('log_errors', !empty($_nc_settings['log_errors']) ? 1 : (LOG_ERRORS ? 1 : 0));
set_error_handler('cc_error_handler');
set_exception_handler('cc_exception_handler');

// Set Smarty compilation/caching from settings or fall back to constants
$smarty->force_compile = !empty($_nc_settings['smarty_force_compile']) ? true : SMARTY_FORCE_COMPILE;
$smarty->caching       = Smarty::CACHING_OFF; // Admin pages are never cached - authenticated + SPA partials would poison cache

$smarty->assign('site_name',        $_nc_site_name);
$smarty->assign('site_favicon',     $_nc_site_favicon);
$smarty->assign('favicon_svg_url',  $_nc_favicon_svg_url);
$smarty->assign('url_root',    URL_ROOT);
$smarty->assign('url_admin',   URL_ADMIN);
$smarty->assign('url_admin_real', URL_ADMIN_REAL);
$smarty->assign('fm_js_v',       filemtime(DIR_ADMIN . 'js/filemanager.js'));
$smarty->assign('fm_css_v',      filemtime(DIR_ADMIN . 'css/filemanager.css'));
$smarty->assign('prod_js_v',     filemtime(DIR_ADMIN . 'js/products.js'));
$smarty->assign('prod_css_v',    filemtime(DIR_ADMIN . 'css/products.css'));
$smarty->assign('settings_js_v', filemtime(DIR_ADMIN . 'js/settings.js'));
$smarty->assign('flash',       flash_get());
$smarty->assign('admin_user',  $_SESSION['admin_username'] ?? '');
$smarty->assign('admin_avatar',$_SESSION['admin_avatar']   ?? '');
$smarty->assign('access',      (int)($_SESSION['admin_access'] ?? 0));
$smarty->assign('reminders',   reminder_list());
$smarty->assign('csrf_token',  csrf_token());
$smarty->assign('nowstr',      date("YmdHis"));
$smarty->assign('ec_name',        EC_NAME);
$smarty->assign('ec_version',     EC_VERSION);
$smarty->assign('ec_company',     EC_COMPANY);
$smarty->assign('ec_company_url', EC_COMPANY_URL);
$smarty->assign('ec_upgrade_url', EC_UPGRADE_URL);
$smarty->assign('plugin_product_tabs',    Hook::collect('admin.product.drawer.tabs'));
$smarty->assign('plugin_product_panels',  Hook::collect('admin.product.drawer.panels'));
$smarty->assign('plugin_customer_tabs',   Hook::collect('admin.customer.drawer.tabs'));
$smarty->assign('plugin_customer_panels', Hook::collect('admin.customer.drawer.panels'));

// ── Partial request detection ──────────────────────────────────────────────────
$is_partial = (isset($_SERVER['HTTP_X_NC_PARTIAL']) && $_SERVER['HTTP_X_NC_PARTIAL'] === '1');
$smarty->assign('nc_partial', $is_partial);

// ── Route ──────────────────────────────────────────────────────────────────────
$route = preg_replace('/[^a-z0-9_\/\-]/', '', strtolower(get('route', 'dashboard')));
$smarty->assign('plugin_content_active', in_array($route, array_column($_content_items, 'route')));
$smarty->assign('customers_group_open', in_array($route, array_column($_customers_items, 'route')));
$smarty->assign('plugin_menu_groups_before', PluginLoader::adminMenuGroups('before', $route));
$smarty->assign('plugin_menu_groups_after',  PluginLoader::adminMenuGroups('after',  $route));
$smarty->assign('plugin_page_scripts',    Hook::collect('admin.page.scripts', ['route' => $route]));

// Login, and the password-reset flow a locked-out admin needs to reach it,
// don't require auth
if (!in_array($route, ['login', 'forgot-password', 'reset-password'], true)) {
	// AJAX routes (route=X/ajax → ctl/X/ajax.php) must fail with JSON, not a
	// redirect - a redirect breaks a fetch().then(r => r.json()) caller
	// silently (it gets the login page's HTML back, not JSON), which is
	// exactly how "my settings save does nothing" happens on session expiry.
	if (str_ends_with($route, '/ajax')) {
		require_admin_json();
	} else {
		require_admin();
	}
}

// Support nested routes: "categories/ajax" → ctl/categories/ajax.php
$ctl_file = DIR_ADMIN . 'ctl/' . $route . '.php';

// Fallback: try route as directory with index
if (!file_exists($ctl_file)) {
	$ctl_file = DIR_ADMIN . 'ctl/' . $route . '/index.php';
}

if (!file_exists($ctl_file)) {
	// Try plugin admin routes: "lipsum" → plugins/lipsum/admin/index.php
	$parts      = explode('/', $route, 2);
	// Gated on PluginLoader::loaded(), not just file_exists() - a plugin
	// that failed its license check still has its files on disk, so
	// file_exists() alone would dispatch to them regardless.
	$plugin_ctl = DIR_ROOT . 'plugins/' . ($parts[0] ?? '') . '/admin/' . ($parts[1] ?? 'index') . '.php';
	if (file_exists($plugin_ctl) && in_array($parts[0] ?? '', PluginLoader::loaded(), true)) {
		$ctl_file = $plugin_ctl;
	} else {
		$ctl_file = DIR_ADMIN . 'ctl/404.php';
	}
}

require $ctl_file;
