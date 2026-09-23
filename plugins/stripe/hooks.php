<?php
/**
 * Stripe plugin — hooks.php
 * Loaded by PluginLoader on every bootstrap when plugin is enabled.
 */

// Shared by both hooks below — a Stripe payment option showing up on checkout
// with no key configured just silently completes the order without ever
// loading a payment form, which is worse than not showing the option at all.
function _stripe_publishable_key(): string {
	$p    = DB_PREFIX;
	$mode = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='stripe_mode'") ?: 'test';
	return $mode === 'live'
		? (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='stripe_publishable_key'") ?: '')
		: (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='stripe_test_publishable_key'") ?: '');
}

Hook::on('catalog.checkout.payment_methods', function(array $methods): array {
	if (!_stripe_publishable_key()) return $methods;
	$methods[] = [
		'id'    => 'stripe',
		'label' => 'Credit / Debit Card',
		'icon'  => '/plugins/stripe/img/stripe.svg',
	];
	return $methods;
});

Hook::on('catalog.checkout.payment_scripts', function(): ?array {
	$key = _stripe_publishable_key();
	if (!$key) return null;

	$js_v = filemtime(DIR_ROOT . 'plugins/stripe/catalog/stripe-checkout.js');
	return [
		'head'    => '<script src="https://js.stripe.com/v3/" crossorigin="anonymous"></script>',
		'scripts' => '<script>window.STRIPE_PUBLISHABLE_KEY=' . json_encode($key) . ';</script>'
		           . '<script src="' . htmlspecialchars(URL_ROOT, ENT_QUOTES) . 'plugins/stripe/catalog/stripe-checkout.js?v=' . $js_v . '"></script>',
	];
});
