<?php
/**
 * EdgeCart — front controller
 */

// ── First run: redirect to install wizard ──────────────────────────────────────
// cfg/config.php is only ever written by the installer's final step, on success -
// its existence alone is the real "has this site been installed" signal. This
// used to also require install/.installed, a marker file living INSIDE the
// install/ folder - which broke every site the moment its owner followed the
// docs' own advice to delete that folder after setup, permanently redirecting
// an already-installed, working site to a /install/ that no longer exists.
if (!file_exists(__DIR__ . '/cfg/config.php')) {
	header('Location: /install/');
	exit;
}

// ── Config ─────────────────────────────────────────────────────────────────────
require __DIR__ . '/cfg/config.php';

// ── Core libs ──────────────────────────────────────────────────────────────────
require_once DIR_LIB . 'db.php';
require_once DIR_LIB . 'functions.php';
require_once DIR_LIB . 'mailer.php';
require_once DIR_LIB . 'hook.php';
require_once DIR_LIB . 'license-limits.php';
require_once DIR_LIB . 'shortcode.php';
require_once DIR_LIB . 'license.php';
require_once DIR_LIB . 'page_block_helper.php';
require_once DIR_LIB . 'cart.php';

// ── Session ────────────────────────────────────────────────────────────────────
ini_set('session.name', SESSION_NAME);
ini_set('session.save_path', DIR_ROOT . 'cache/sessions');
if (!is_dir(DIR_ROOT . 'cache/sessions')) mkdir(DIR_ROOT . 'cache/sessions', 0777, true);
ini_set('session.gc_maxlifetime', SESSION_LIFETIME);
ini_set('session.gc_probability', 1);
ini_set('session.gc_divisor', 1000);
session_set_cookie_params([
	'httponly' => true,
	'secure'   => !empty($_SERVER['HTTPS']),
	'samesite' => 'Lax'
]);
session_start();

// ── Security Headers ───────────────────────────────────────────────────────────
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');

// ── DB ─────────────────────────────────────────────────────────────────────────
DB::connect();

// ── Plugins ────────────────────────────────────────────────────────────────────
require_once DIR_LIB . 'plugin-loader.php';
// No cfg/license.php at all means this isn't a fulfillment-built customer
// install (e.g. EdgeCart's own source tree, or store.edgecart.io itself,
// neither of which are domain-licensed) — nothing to enforce. A license file
// that IS present but doesn't match this domain is enforced below.
if (file_exists(DIR_ROOT . 'cfg/license.php')) {
    require_once DIR_ROOT . 'cfg/license.php';
    License::enforceOrBlock();
}
PluginLoader::boot();
require_once DIR_LIB . 'shipping.php';
Hook::fire('app.boot');

// ── Smarty ─────────────────────────────────────────────────────────────────────
require_once DIR_LIB . 'vendor/smarty/smarty/libs/Smarty.class.php';

$smarty = new Smarty();
$smarty->setTemplateDir(array_merge(PluginLoader::templateDirs(), [DIR_TPL]));
$smarty->assign('theme_head', Hook::filter('theme.head', ''));
$smarty->assign('catalog_foot', Hook::filter('catalog.page.foot', ''));
$smarty->assign('utility_links', Hook::collect('catalog.utility.links'));
$smarty->setCompileDir(DIR_CACHE . 'tpl/');
$smarty->setCacheDir(DIR_CACHE . 'smarty/');
$smarty->registerClass('Smarty', 'Smarty');
// Vendor debug.tpl uses {Smarty::SMARTY_VERSION}, which triggers a PHP 8
// "unregistered static method" deprecation warning on every debug-console
// render regardless of registerClass() above (that call doesn't cover
// constant access) — override with a local copy that hardcodes the version
// string instead.
$smarty->debug_tpl = 'file:' . DIR_LIB . 'smarty-overrides/debug.tpl';
register_smarty_modifiers($smarty);

// ── Global template vars ───────────────────────────────────────────────────────
// Read live values from settings table; fall back to install-time constants
$_nc_site_settings = [];
try {
	$_nc_site_rows = DB::rows("SELECT `key`, `value` FROM `" . DB_PREFIX . "settings` WHERE `key` IN ('site_name','site_currency','img_cart_size','smarty_debug','smarty_force_compile','smarty_caching','display_errors','log_errors','store_phone','store_logo_url','store_logo_link','site_favicon','favicon_svg_url','ga4_measurement_id','maintenance_mode')");
	foreach ($_nc_site_rows as $_r) $_nc_site_settings[$_r['key']] = $_r['value'];
} catch (Exception $e) {}

// Set error handling from settings or fall back to constants. Display Errors
// and the Smarty Debug Console (below) put raw stack traces/template internals
// straight into the page — gate both behind an actual logged-in admin session
// so a toggle left on in Settings never leaks anything to public visitors.
// log_errors only writes to the server-side log file, no visitor exposure, so
// it stays ungated.
$_nc_is_admin = is_admin();
ini_set('display_errors', ($_nc_is_admin && (!empty($_nc_site_settings['display_errors']) || DISPLAY_ERRORS)) ? 1 : 0);
ini_set('log_errors', !empty($_nc_site_settings['log_errors']) ? 1 : (LOG_ERRORS ? 1 : 0));
set_error_handler('cc_error_handler');
set_exception_handler('cc_exception_handler');

// Set Smarty compilation/caching from settings or fall back to constants
$smarty->force_compile  = !empty($_nc_site_settings['smarty_force_compile']) ? true : SMARTY_FORCE_COMPILE;
$smarty->cache_lifetime = 600; // 10 minutes

// Only cache public catalog pages for anonymous, empty-cart visitors
$_nc_cacheable_routes = ['home', 'category', 'product', 'page', 'sitemap-xml'];
$_nc_current_route    = preg_replace('/[^a-z0-9_\/\-]/', '', strtolower(get('route', 'home')));
$_nc_use_cache = (!empty($_nc_site_settings['smarty_caching']) || SMARTY_CACHING)
    && in_array($_nc_current_route, $_nc_cacheable_routes, true)
    && empty($_SESSION['customer_id'])
    && empty($_SESSION['cart'])
    && $_SERVER['REQUEST_METHOD'] === 'GET';

$smarty->caching    = $_nc_use_cache ? Smarty::CACHING_LIFETIME_CURRENT : Smarty::CACHING_OFF;
$smarty->cache_id   = $_nc_use_cache ? md5($_SERVER['REQUEST_URI']) : null;
$smarty->debugging  = $_nc_is_admin && !empty($_nc_site_settings['smarty_debug']);

$smarty->assign('site_name',     $_nc_site_settings['site_name']     ?? SITE_NAME);
$smarty->assign('site_currency', $_nc_site_settings['site_currency'] ?? SITE_CURRENCY);
$smarty->assign('img_cart_size', max(40, (int)($_nc_site_settings['img_cart_size'] ?? 100)));
$smarty->assign('store_phone',    $_nc_site_settings['store_phone']    ?? '');
$smarty->assign('store_logo_url',    $_nc_site_settings['store_logo_url']    ?? '');
$smarty->assign('store_logo_link',   $_nc_site_settings['store_logo_link']   ?? '');
$smarty->assign('site_favicon',      $_nc_site_settings['site_favicon']      ?? '');
$smarty->assign('favicon_svg_url',   $_nc_site_settings['favicon_svg_url']   ?? '');
$smarty->assign('ga4_measurement_id', $_nc_site_settings['ga4_measurement_id'] ?? '');
$smarty->assign('active_plugins', array_flip(PluginLoader::loaded()));
$smarty->assign('url_root',      URL_ROOT);
$smarty->assign('url_admin',     URL_ADMIN);
$smarty->assign('url_img',       URL_IMG);
$smarty->assign('flash',         flash_get());
$smarty->assign('is_logged_in',  is_logged_in());

// Get logged-in customer's first name for greeting
$customer_first_name = '';
if (is_logged_in()) {
	$customer = DB::row("SELECT first_name FROM `" . DB_PREFIX . "customers` WHERE id = ?", [$_SESSION['customer_id']]);
	$customer_first_name = $customer['first_name'] ?? '';
}
$smarty->assign('customer_first_name', $customer_first_name);

$smarty->assign('cart_count',    Cart::count());
$smarty->assign('cart_subtotal', Cart::subtotal());
$smarty->assign('csrf_token',    csrf_token());
$smarty->assign('nowstr', date('YmdHis'));

// ── Global layout data ─────────────────────────────────────────────────────────
try {
	$_p = DB_PREFIX;
	$_hide_empty = (int)($_nc_settings['hide_empty_categories'] ?? 1);
	if ($_hide_empty) {
		$smarty->assign('cat_nav', DB::rows(
			"SELECT c.id, c.name, c.slug FROM `{$_p}categories` c
			 INNER JOIN `{$_p}categories_products` cp ON cp.category_id = c.id
			 WHERE c.parent_id=0 AND c.status=1
			 GROUP BY c.id
			 ORDER BY c.display_order ASC, c.name ASC"
		));
	} else {
		$smarty->assign('cat_nav', DB::rows(
			"SELECT id, name, slug FROM `{$_p}categories` WHERE parent_id=0 AND status=1 ORDER BY display_order ASC, name ASC"
		));
	}

	// Sidebar blocks — from the 'sidebar' system page
	$_sidebar_page = DB::row("SELECT id FROM `{$_p}pages` WHERE slug='sidebar' AND page_type='sidebar' LIMIT 1");
	if ($_sidebar_page) {
		require_once DIR_LIB . 'page_block_helper.php';
		$smarty->assign('sidebar_blocks', hydrate_page_blocks((int)$_sidebar_page['id'], $_p, $smarty));
	}

	// Second-level thumbnail size (featured products blocks)
	$_sl = DB::row("SELECT `value` FROM `{$_p}settings` WHERE `key`='img_second_level_size' LIMIT 1");
	$smarty->assign('second_level_size', max(40, (int)(($_sl['value'] ?? null) ?: 200)));

	// Sidebar thumbnail size (sidebar product list blocks)
	$_sb = DB::row("SELECT `value` FROM `{$_p}settings` WHERE `key`='img_sidebar_size' LIMIT 1");
	$smarty->assign('sidebar_thumb_size', max(40, (int)(($_sb['value'] ?? null) ?: 80)));
} catch (Exception $_e) {}

// ── Maintenance mode ───────────────────────────────────────────────────────────
if (!empty($_nc_site_settings['maintenance_mode']) && empty($_SESSION['admin_username'])) {
	http_response_code(503);
	header('Retry-After: 3600');
	echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Down for Maintenance</title>'
		. '<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f2f5}'
		. '.box{text-align:center;padding:3rem;max-width:480px}'
		. 'h1{font-size:1.8rem;margin-bottom:1rem}p{color:#555}</style></head>'
		. '<body><div class="box"><h1>Down for Maintenance</h1>'
		. '<p>We\'ll be back shortly. Thank you for your patience.</p></div></body></html>';
	exit;
}

// ── CSS cache-busting version ──────────────────────────────────────────────────
$smarty->assign('css_v', max(
	filemtime(DIR_ROOT . 'css/catalog.css'),
	filemtime(DIR_ROOT . 'css/vars.css')
));

// ── Route ──────────────────────────────────────────────────────────────────────
// Detect SEO-friendly paths: category/slug, product/slug, cart, checkout, order-complete
$request_uri  = trim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
$uri_parts    = explode('/', $request_uri, 2);

// Self-referencing canonical — every page was missing one entirely (found
// via SEO audit). Google's own guidance wants an absolute URL here, not a
// root-relative path (absolute_url(), lib/functions.php, already exists for
// exactly this — email links use it for the same reason). Uses the clean
// path only (no query string), which is the correct target for the SEO-
// friendly URLs this router already produces (/product/slug, /category/
// slug, etc.) — a page reachable at more than one URL (tracking params,
// sort/filter query strings) should still declare this same clean URL as
// canonical.
$smarty->assign('canonical_url', absolute_url(URL_ROOT . $request_uri));

// Whether this request is the true homepage — used by layout.html to inject
// Organization/WebSite JSON-LD site-wide but only once, regardless of
// whether the homepage is rendered by ctl/home.php's own product-grid
// fallback or redirected to a CMS page via ctl/page.php (which assigns
// page_type='page' unconditionally for every CMS page, home included —
// can't tell them apart that way).
$smarty->assign('is_homepage', $request_uri === '');

// Organization JSON-LD — an SEO audit found zero structured data anywhere
// on the site (it only scanned the homepage; product pages already had
// their own Product schema, separately fixed in ctl/product.php). Built
// as real data + json_encode() rather than hand-written template markup,
// same reasoning as the product-page fix.
if ($request_uri === '') {
	$_org_json_ld = json_encode(array_filter([
		'@context' => 'https://schema.org/',
		'@type'    => 'Organization',
		'name'     => $_nc_site_settings['site_name'] ?? SITE_NAME,
		'url'      => absolute_url(URL_ROOT),
		'logo'     => !empty($_nc_site_settings['store_logo_url']) ? absolute_url($_nc_site_settings['store_logo_url']) : null,
		'telephone' => $_nc_site_settings['store_phone'] ?? null,
	]), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
	$smarty->assign('org_json_ld', $_org_json_ld);
}

// Map URI patterns to routes
if ($uri_parts[0] === 'category' && !empty($uri_parts[1])) {
	$_GET['route'] = 'category';
	$_GET['slug']  = $uri_parts[1];
} elseif ($uri_parts[0] === 'product' && !empty($uri_parts[1])) {
	$_GET['route'] = 'product';
	$_GET['slug']  = $uri_parts[1];
} elseif ($uri_parts[0] === 'cart') {
	$_GET['route'] = 'cart';
} elseif ($uri_parts[0] === 'checkout') {
	$_GET['route'] = 'checkout';
} elseif ($uri_parts[0] === 'order-complete') {
	$_GET['route'] = 'order-complete';
} elseif ($uri_parts[0] === 'page' && !empty($uri_parts[1])) {
	$_GET['route'] = 'page';
	$_GET['slug']  = $uri_parts[1];
} elseif ($uri_parts[0] === 'order-details' && !empty($uri_parts[1])) {
	$_GET['route'] = 'order-details';
	$_GET['id']    = $uri_parts[1];
} elseif ($uri_parts[0] === 'account') {
	$_GET['route'] = 'account';
} elseif ($uri_parts[0] === 'page-preview' && !empty($uri_parts[1])) {
	$_GET['route'] = 'page-preview';
	$_GET['token'] = $uri_parts[1];
} elseif ($uri_parts[0] === 'wishlist') {
	$_GET['route'] = 'wishlist/index';
} elseif ($request_uri === 'sitemap.xml') {
	$_GET['route'] = 'sitemap-xml';
}

// get('route', 'home') previously defaulted to 'home' for ANY request with
// no matched pattern above and no explicit ?route= query param — including
// a totally unrecognized path with no route at all (e.g. a stale/typo'd
// link, or a bot probing random URLs). That silently served the homepage
// with HTTP 200 at infinite URLs instead of a real 404: confirmed live
// (2026-07-11, SeoLoupe audit on TRLO) — e.g. /sitemap-index.xml, which is
// not a real file, returned 200 with homepage HTML, and would do the same
// for any other nonexistent path. Only the true root ('') should fall back
// to home; anything else with no matched route must 404.
if (isset($_GET['route'])) {
	$route = preg_replace('/[^a-z0-9_\/\-]/', '', strtolower($_GET['route']));
} elseif ($request_uri === '') {
	$route = 'home';
} else {
	$route = '404';
}

$ctl_file = DIR_CTL . $route . '.php';

if (!file_exists($ctl_file)) {
	$parts      = explode('/', $route, 2);
	// Gated on PluginLoader::loaded(), not just file_exists() — see the
	// matching admin/index.php fallback for why file_exists() alone isn't
	// enough to keep an unlicensed plugin's own routes from being served.
	$plugin_ctl = DIR_ROOT . 'plugins/' . ($parts[0] ?? '') . '/catalog/' . ($parts[1] ?? 'index') . '.php';
	if (file_exists($plugin_ctl) && in_array($parts[0] ?? '', PluginLoader::loaded(), true)) {
		$ctl_file = $plugin_ctl;
	} else {
		$ctl_file = DIR_CTL . '404.php';
	}
}

require $ctl_file;
