<?php
/**
 * new-cart Hook system
 *
 * Three variants per hook point:
 *   :before  — runs before, receives data by reference, can modify it
 *   :after   — runs after, receives result data, cannot prevent execution
 *   :instead — replaces default behavior entirely; only one plugin may
 *              register :instead per hook (second registration throws)
 *
 * Usage (plugin hooks.php):
 *   Hook::on('catalog.product.view.before', function(&$data) { ... });
 *   Hook::on('catalog.product.price.instead', function($data) { return $price; });
 *
 * Usage (new-cart core):
 *   Hook::fire('catalog.product.view.before', $data);
 *   $price = Hook::fireInstead('catalog.product.price', $default_price, $data);
 */
class Hook {

	private static array $listeners = [];
	private static array $instead   = [];

	// ── Register a listener ────────────────────────────────────────────────────
	public static function on(string $event, callable $fn): void {
		if (str_ends_with($event, '.instead')) {
			$base = substr($event, 0, -8);
			if (isset(self::$instead[$base])) {
				throw new \RuntimeException(
					"Hook conflict: ':instead' already registered for '{$base}'. " .
					"Only one plugin may register :instead per hook."
				);
			}
			self::$instead[$base] = $fn;
			return;
		}
		self::$listeners[$event][] = $fn;
	}

	// ── Fire :before or :after ─────────────────────────────────────────────────
	public static function fire(string $event, mixed &$data = null): void {
		foreach (self::$listeners[$event] ?? [] as $fn) {
			$fn($data);
		}
	}

	// ── Fire :instead — returns plugin result or default ──────────────────────
	// Usage:
	//   $result = Hook::instead('catalog.product.price', $default, $data);
	public static function instead(string $base, mixed $default, mixed $data = null): mixed {
		if (isset(self::$instead[$base])) {
			return (self::$instead[$base])($data);
		}
		return $default;
	}

	// ── Filter — passes value through all listeners, each may modify it ────────
	public static function filter(string $event, mixed $value, mixed $context = null): mixed {
		foreach (self::$listeners[$event] ?? [] as $fn) {
			$value = $fn($value, $context);
		}
		return $value;
	}

	// ── Collect — gathers non-null return values from all listeners ───────────
	public static function collect(string $event, mixed $context = null): array {
		$results = [];
		foreach (self::$listeners[$event] ?? [] as $fn) {
			$result = $fn($context);
			if ($result !== null) $results[] = $result;
		}
		return $results;
	}

	// ── Check if :instead is registered ───────────────────────────────────────
	public static function hasInstead(string $base): bool {
		return isset(self::$instead[$base]);
	}

	// ── Clear all listeners (testing / reload) ─────────────────────────────────
	public static function clear(): void {
		self::$listeners = [];
		self::$instead   = [];
	}

	// ── List of all defined hook points ───────────────────────────────────────
	// Informational — used by admin Plugins page to show available hooks.
	public static function defined(): array {
		return [
			// Catalog
			'catalog.bootstrap',
			'catalog.page.head',
			'catalog.page.foot',
			'catalog.layout.nav',
			'catalog.utility.links',          // collect: return <a> tag HTML for utility bar
			'catalog.layout.sidebar',
			'catalog.layout.footer',
			'catalog.product.list',
			'catalog.product.view',
			'catalog.product.price',
			'catalog.product.add_to_cart',
			'catalog.category.view',
			'catalog.search',
			'catalog.cart.view',
			'catalog.cart.add',
			'catalog.cart.remove',
			'catalog.cart.update',
			'catalog.checkout',
			'catalog.checkout.shipping_rates',   // filter: [{service,rate,days,carrier}]
			'catalog.checkout.payment_methods',  // filter: [{id,label,icon}]
			'catalog.checkout.payment_scripts',  // collect: return {head,scripts} HTML per payment plugin
			'checkout.tax.calculate',            // instead: return float tax amount; context: {state,country,items,shipping}
			'checkout.discount.apply',           // instead: return {amount,error}; context: {code,subtotal}
			'checkout.discount.used',            // action: fired after order created; data: {code}
			'catalog.product.can_view',          // instead: return bool; context: {product} — false → 404
			'catalog.product.can_review',        // instead: return bool; context: {product_id,customer_id}
			'catalog.checkout.shipping',
			'catalog.checkout.payment',
			'catalog.checkout.confirm',
			'catalog.order.create',
			'catalog.order.complete',
			'catalog.order.payment_complete',    // action: order confirmed by gateway
			'catalog.order.label_generate',      // action: shipping label requested
			'account.login.providers',           // collect: return HTML string per provider button
			'smarty.register_modifiers',         // action: register_smarty_modifiers() passes $smarty — a plugin
			                                      // needing its own {$x|modifier} calls $smarty->registerPlugin() here
			'catalog.customer.login',
			'catalog.customer.register',
			'catalog.customer.logout',
			// Admin
			'admin.bootstrap',
			'admin.page.head',
			'admin.page.foot',
			'admin.nav',
			'admin.category.list',
			'admin.category.save',
			'admin.category.delete',
			'admin.plugin.install',
			'admin.plugin.uninstall',
			'admin.plugin.enable',
			'admin.plugin.disable',
			'admin.plugin.settings.{code}.load',   // filter: return HTML for settings form (null = use default)
			'admin.plugin.settings.{code}.save',   // action: fired after settings are saved to DB
			'admin.reports.register',              // action: plugins register custom reports
			'admin.order.status.changed',          // action: ctx {order_id, old_status, new_status}
			'admin.page.scripts',                  // collect: return <script> tag HTML; ctx {route}
			'admin.product.drawer.tabs',           // collect: return tab button HTML
			'admin.product.drawer.panels',         // collect: return tab panel HTML
			'admin.customer.drawer.tabs',          // collect: return tab button HTML
			'admin.customer.drawer.panels',        // collect: return tab panel HTML
			// Admin limits (instead: return PHP_INT_MAX to remove cap)
			'admin.limit.categories',          // default: 3
			'admin.limit.products_per_cat',    // default: 5
			'admin.limit.product_categories',  // default: 1 (categories per product)
			'admin.limit.options_per_product', // default: 2
			'admin.limit.images_per_product',  // default: 2
			'admin.limit.discounts',           // default: 3
			// System
			'system.error',
			'system.email.send',
			'system.image.resize',
			'system.cron',
		];
	}
}
