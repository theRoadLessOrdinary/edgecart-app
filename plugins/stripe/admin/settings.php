<?php
// Stripe plugin settings form.
// Receives: $settings (current values from nc_settings), $manifest (plugin manifest).
$mode       = $settings['stripe_mode'] ?? 'test';
$hs         = fn(string $k) => htmlspecialchars($settings[$k] ?? '', ENT_QUOTES, 'UTF-8');
$head_style = 'font-weight:700;font-size:.83rem;margin:1.1rem 0 .5rem;color:var(--nc-text)';
$hint_style = 'font-size:.8rem;color:var(--nc-text-dim);margin-top:.3rem;line-height:1.4';
?>
<div class="df">
	<label for="stripe_mode">Mode</label>
	<select name="stripe_mode" id="stripe_mode">
		<option value="test"<?= $mode === 'test' ? ' selected' : '' ?>>Test</option>
		<option value="live"<?= $mode === 'live' ? ' selected' : '' ?>>Live</option>
	</select>
</div>

<div class="df">
	<label for="stripe_site_tag">Site Identifier (optional)</label>
	<input type="text" name="stripe_site_tag" id="stripe_site_tag"
	       value="<?= $hs('stripe_site_tag') ?>"
	       maxlength="255" autocomplete="off" placeholder="<?= htmlspecialchars($_SERVER['HTTP_HOST'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
	<p style="<?= $hint_style ?>">Only needed if you run more than one site on this same Stripe account. Each site's webhook only processes its own events — normally this is figured out automatically from the domain, but set a custom value here if you'd rather not rely on that (e.g. the site is reachable at more than one domain).</p>
</div>

<p style="<?= $head_style ?>">Test Credentials</p>

<div class="df">
	<label for="stripe_test_publishable_key">Test Publishable Key</label>
	<input type="text" name="stripe_test_publishable_key" id="stripe_test_publishable_key"
	       value="<?= $hs('stripe_test_publishable_key') ?>"
	       maxlength="255" autocomplete="off" placeholder="pk_test_…">
</div>

<div class="df">
	<label for="stripe_test_secret_key">Test Secret Key</label>
	<input type="text" name="stripe_test_secret_key" id="stripe_test_secret_key"
	       value="<?= $hs('stripe_test_secret_key') ?>"
	       maxlength="255" autocomplete="off" placeholder="sk_test_…">
</div>

<div class="df">
	<label for="stripe_test_webhook_secret">Test Webhook Secret</label>
	<input type="text" name="stripe_test_webhook_secret" id="stripe_test_webhook_secret"
	       value="<?= $hs('stripe_test_webhook_secret') ?>"
	       maxlength="255" autocomplete="off" placeholder="whsec_…">
</div>

<p style="<?= $head_style ?>">Live Credentials</p>

<div class="df">
	<label for="stripe_publishable_key">Live Publishable Key</label>
	<input type="text" name="stripe_publishable_key" id="stripe_publishable_key"
	       value="<?= $hs('stripe_publishable_key') ?>"
	       maxlength="255" autocomplete="off" placeholder="pk_live_…">
</div>

<div class="df">
	<label for="stripe_secret_key">Live Secret Key</label>
	<input type="text" name="stripe_secret_key" id="stripe_secret_key"
	       value="<?= $hs('stripe_secret_key') ?>"
	       maxlength="255" autocomplete="off" placeholder="sk_live_…">
</div>

<div class="df">
	<label for="stripe_webhook_secret">Live Webhook Secret</label>
	<input type="text" name="stripe_webhook_secret" id="stripe_webhook_secret"
	       value="<?= $hs('stripe_webhook_secret') ?>"
	       maxlength="255" autocomplete="off" placeholder="whsec_…">
	<p style="<?= $hint_style ?>">Webhook endpoint: <code><?= htmlspecialchars(URL_ROOT, ENT_QUOTES, 'UTF-8') ?>?route=stripe/webhook</code></p>
</div>
