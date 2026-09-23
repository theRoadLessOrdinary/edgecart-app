<?php
// PayPal plugin settings form.
// Receives: $settings (current values from nc_settings), $manifest (plugin manifest).
$mode     = $settings['paypal_mode'] ?? 'sandbox';
$hs       = fn(string $k) => htmlspecialchars($settings[$k] ?? '', ENT_QUOTES, 'UTF-8');
$hd_style = 'font-weight:700;font-size:.83rem;margin:1.4rem 0 .5rem;color:var(--nc-text)';
$hn_style = 'font-size:.8rem;color:var(--nc-text-dim);margin-top:.3rem;line-height:1.4';
?>
<div class="df">
	<label for="paypal_mode">Mode</label>
	<select name="paypal_mode" id="paypal_mode">
		<option value="sandbox"<?= $mode === 'sandbox' ? ' selected' : '' ?>>Sandbox (Testing)</option>
		<option value="live"<?= $mode === 'live' ? ' selected' : '' ?>>Live</option>
	</select>
</div>

<p style="<?= $hd_style ?>">Sandbox Credentials</p>

<div class="df">
	<label for="paypal_sandbox_client_id">Sandbox Client ID</label>
	<input type="text" name="paypal_sandbox_client_id" id="paypal_sandbox_client_id"
	       value="<?= $hs('paypal_sandbox_client_id') ?>"
	       maxlength="255" autocomplete="off" placeholder="AYour_Sandbox_Client_ID…">
</div>

<div class="df">
	<label for="paypal_sandbox_secret_key">Sandbox Secret</label>
	<input type="text" name="paypal_sandbox_secret_key" id="paypal_sandbox_secret_key"
	       value="<?= $hs('paypal_sandbox_secret_key') ?>"
	       maxlength="255" autocomplete="off" placeholder="EYour_Sandbox_Secret…">
</div>

<p style="<?= $hd_style ?>">Live Credentials</p>

<div class="df">
	<label for="paypal_live_client_id">Live Client ID</label>
	<input type="text" name="paypal_live_client_id" id="paypal_live_client_id"
	       value="<?= $hs('paypal_live_client_id') ?>"
	       maxlength="255" autocomplete="off" placeholder="AYour_Live_Client_ID…">
</div>

<div class="df">
	<label for="paypal_live_secret_key">Live Secret</label>
	<input type="text" name="paypal_live_secret_key" id="paypal_live_secret_key"
	       value="<?= $hs('paypal_live_secret_key') ?>"
	       maxlength="255" autocomplete="off" placeholder="EYour_Live_Secret…">
	<p style="<?= $hn_style ?>">
		Get credentials at
		<a href="https://developer.paypal.com/dashboard/" target="_blank" rel="noopener">developer.paypal.com/dashboard</a>
		under Apps &amp; Credentials.
	</p>
</div>
