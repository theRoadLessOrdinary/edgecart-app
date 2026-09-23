<?php
/**
 * PayPal plugin — hooks.php
 * Loaded by PluginLoader on every bootstrap when plugin is enabled.
 */

// Shared by both hooks below — same reasoning as Stripe's equivalent helper:
// showing PayPal as an option with no client ID configured just silently
// completes the order with no payment flow at all.
function _paypal_client_id(): string {
	$p    = DB_PREFIX;
	$mode = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_mode'") ?: 'sandbox';
	return $mode === 'live'
		? (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_live_client_id'") ?: '')
		: (DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='paypal_sandbox_client_id'") ?: '');
}

Hook::on('catalog.checkout.payment_methods', function(array $methods): array {
	if (!_paypal_client_id()) return $methods;
	$methods[] = [
		'id'    => 'paypal',
		'label' => 'PayPal',
		'icon'  => '',
	];
	return $methods;
});

Hook::on('catalog.checkout.payment_scripts', function(): ?array {
	$p         = DB_PREFIX;
	$client_id = _paypal_client_id();
	if (!$client_id) return null;

	$currency = strtoupper(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_currency_code'") ?: 'USD');
	$js_v     = filemtime(DIR_ROOT . 'plugins/paypal/catalog/paypal-checkout.js');
	$sdk_url  = 'https://www.paypal.com/sdk/js?client-id=' . urlencode($client_id)
	          . '&currency=' . urlencode($currency)
	          . '&intent=capture';

	return [
		'head'    => '<script src="' . htmlspecialchars($sdk_url, ENT_QUOTES) . '" crossorigin="anonymous"></script>',
		'scripts' => '<script>window.PAYPAL_CLIENT_ID=' . json_encode($client_id) . ';</script>'
		           . '<script src="' . htmlspecialchars(URL_ROOT, ENT_QUOTES) . 'plugins/paypal/catalog/paypal-checkout.js?v=' . $js_v . '"></script>',
	];
});
