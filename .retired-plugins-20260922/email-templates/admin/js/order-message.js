/* Email Templates: template picker + token info on the order drawer's Message tab */
(function () {
	'use strict';
	const panel = document.getElementById('ord-panel-message');
	if (!panel) return;

	const AJAX = NC.adminUrl + '?route=email-templates/ajax';
	let orderId = 0, tokens = {};

	async function ajax(payload) {
		const fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		for (const [k, v] of Object.entries(payload)) fd.append(k, String(v ?? ''));
		return (await fetch(AJAX, { method: 'POST', body: fd })).json();
	}
	function esc(s) {
		return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	const wrap = document.createElement('div');
	wrap.className = 'df et-picker';
	wrap.innerHTML = '<label for="et-pick">Template <button type="button" class="et-info" id="et-pick-info" title="Available tokens" aria-label="Show available tokens">i</button></label>'
		+ '<select id="et-pick"><option value="">None</option></select>'
		+ '<div class="et-tokens" id="et-pick-tokens" hidden></div>';
	const to = document.getElementById('ord-msg-to');
	const anchor = to ? to.closest('.df') : panel.firstElementChild.firstElementChild;
	anchor.parentNode.insertBefore(wrap, anchor);

	const sel = wrap.querySelector('#et-pick'), box = wrap.querySelector('#et-pick-tokens');
	wrap.querySelector('#et-pick-info').addEventListener('click', function () { box.hidden = !box.hidden; });

	function renderTokens() {
		box.innerHTML = '<div class="hint">These fill in from the order when you choose a template:</div>' + Object.keys(tokens).map(function (k) {
			return '<div class="et-token-line"><code>[' + esc(k) + ']</code> ' + esc(tokens[k]) + '</div>';
		}).join('');
	}

	document.addEventListener('nc:order-opened', async function (e) {
		orderId = e.detail.id;
		sel.value = ''; box.hidden = true;
		const res = await ajax({ action: 'picker' });
		if (!res.ok) return;
		tokens = res.tokens; renderTokens();
		sel.innerHTML = '<option value="">None</option>' + res.templates.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
	});

	sel.addEventListener('change', async function () {
		if (!sel.value || !orderId) return;
		const res = await ajax({ action: 'render', template_id: sel.value, order_id: orderId });
		if (!res.ok) { SimpleNotification.error({ text: res.message }); return; }
		document.getElementById('ord-msg-subject').value = res.subject;
		const body = document.getElementById('ord-msg-body');
		body.value = res.body;
		// Jump to the first spot that still needs typing
		const m = res.body.match(/\[[^\]]+\]/);
		body.focus();
		if (m) body.setSelectionRange(m.index, m.index + m[0].length);
	});
}());
