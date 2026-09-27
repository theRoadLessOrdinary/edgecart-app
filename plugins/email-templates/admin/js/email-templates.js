/* Email Templates admin page */
(function () {
	'use strict';

	const AJAX = NC.adminUrl + '?route=email-templates/ajax';
	let data = { templates: [], signatures: [], events: [], statuses: [], log: [], tokens: {}, event_types: {} };

	async function ajax(payload) {
		const fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		for (const [k, v] of Object.entries(payload)) fd.append(k, String(v ?? ''));
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		return r.json();
	}
	function notifyOk(m)  { SimpleNotification.success({ text: m }); }
	function notifyErr(m) { SimpleNotification.error({ text: m }); }
	function esc(s) {
		return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	const $ = (id) => document.getElementById(id);
	const overlay = $('drawer-overlay');

	// ── Tabs ────────────────────────────────────────────────────────────────
	document.querySelectorAll('.et-tab').forEach(function (b) {
		b.addEventListener('click', function () {
			document.querySelectorAll('.et-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
			document.querySelectorAll('.et-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'et-panel-' + b.dataset.tab); });
		});
	});

	// ── Drawers ─────────────────────────────────────────────────────────────
	function openDrawer(d)  { d.classList.add('open'); overlay.classList.add('show'); }
	function closeDrawers() {
		document.querySelectorAll('me-drawer.open').forEach(function (d) { d.classList.remove('open'); });
		overlay.classList.remove('show');
	}
	document.querySelectorAll('me-drawer [data-close]').forEach(function (b) { b.addEventListener('click', closeDrawers); });
	overlay.addEventListener('click', closeDrawers);

	function fadeRemove(tr) {
		tr.style.transition = 'opacity .3s';
		tr.style.opacity = '0';
		setTimeout(function () { tr.remove(); }, 320);
	}

	// ── Render lists ────────────────────────────────────────────────────────
	function tplName(id) { const t = data.templates.find(function (x) { return +x.id === +id; }); return t ? t.name : '(deleted template)'; }
	function statusLabel(slug) { const s = data.statuses.find(function (x) { return x.slug === slug; }); return s ? s.label : slug; }

	function renderTemplates() {
		$('et-tpl-body').innerHTML = data.templates.map(function (t) {
			return '<tr data-id="' + t.id + '" class="et-row"><td><strong>' + esc(t.name) + '</strong></td><td>' + esc(t.subject) + '</td>'
				+ '<td><delete-in-place caption="🗑" confirm="OK?" data-id="' + t.id + '"></delete-in-place></td></tr>';
		}).join('') || '<tr><td colspan="3">No templates yet.</td></tr>';
	}
	function renderSignatures() {
		$('et-sig-body').innerHTML = data.signatures.map(function (s) {
			return '<tr data-id="' + s.id + '" class="et-row"><td><code>[' + esc(s.token) + ']</code></td><td>' + esc(s.label) + '</td>'
				+ '<td><delete-in-place caption="🗑" confirm="OK?" data-id="' + s.id + '"></delete-in-place></td></tr>';
		}).join('') || '<tr><td colspan="3">No signatures yet.</td></tr>';
	}
	function renderEvents() {
		$('et-ev-body').innerHTML = data.events.map(function (e) {
			const when = e.event === 'status_changed' ? 'Order status changes to ' + statusLabel(e.status_slug) : (data.event_types[e.event] || e.event);
			return '<tr data-id="' + e.id + '" class="et-row"><td>' + esc(when) + '</td><td>' + esc(tplName(e.template_id)) + '</td>'
				+ '<td class="col-toggle"><ios-toggle size="sm" data-id="' + e.id + '"' + (+e.active ? ' checked' : '') + '></ios-toggle></td>'
				+ '<td><delete-in-place caption="🗑" confirm="OK?" data-id="' + e.id + '"></delete-in-place></td></tr>';
		}).join('') || '<tr><td colspan="4">No events yet.</td></tr>';
		$('et-log-body').innerHTML = data.log.map(function (l) {
			return '<tr><td>' + esc(l.created_at) + '</td><td>' + esc(l.order_id) + '</td><td>' + esc(l.template_name || '') + '</td><td>' + esc(l.to_email)
				+ '</td><td>' + esc(l.result) + (l.note ? ' - ' + esc(l.note) : '') + '</td></tr>';
		}).join('') || '<tr><td colspan="5">Nothing sent automatically yet.</td></tr>';
	}
	function renderAll() { renderTemplates(); renderSignatures(); renderEvents(); }

	// ── Token list ("i" button) ─────────────────────────────────────────────
	function buildTokens() {
		const box = $('et-tpl-tokens');
		box.innerHTML = Object.keys(data.tokens).map(function (k) {
			return '<button type="button" class="et-token" data-token="' + esc(k) + '"><code>[' + esc(k) + ']</code> ' + esc(data.tokens[k]) + '</button>';
		}).join('');
	}
	$('et-tpl-info').addEventListener('click', function () { const b = $('et-tpl-tokens'); b.hidden = !b.hidden; });
	$('et-tpl-tokens').addEventListener('click', function (e) {
		const b = e.target.closest('.et-token'); if (!b) return;
		const ta = $('et-tpl-body-in'), ins = '[' + b.dataset.token + ']';
		const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
		ta.value = ta.value.slice(0, s) + ins + ta.value.slice(en);
		ta.focus(); ta.setSelectionRange(s + ins.length, s + ins.length);
	});

	// ── Templates ───────────────────────────────────────────────────────────
	function openTemplate(t) {
		t = t || { id: '', name: '', subject: '', body: '' };
		$('et-tpl-title').textContent = t.id ? 'Edit Template' : 'New Template';
		$('et-tpl-id').value = t.id; $('et-tpl-name').value = t.name;
		$('et-tpl-subject').value = t.subject; $('et-tpl-body-in').value = t.body;
		$('et-tpl-tokens').hidden = true;
		openDrawer($('et-tpl-drawer'));
	}
	$('et-add-template').addEventListener('click', function () { openTemplate(); });
	debounceBtn($('et-tpl-save'), async function () {
		const res = await ajax({ action: 'template_save', id: $('et-tpl-id').value, name: $('et-tpl-name').value,
			subject: $('et-tpl-subject').value, body: $('et-tpl-body-in').value });
		if (!res.ok) { notifyErr(res.message); return; }
		const i = data.templates.findIndex(function (x) { return +x.id === +res.row.id; });
		if (i >= 0) data.templates[i] = res.row; else data.templates.push(res.row);
		data.templates.sort(function (a, b) { return a.name.localeCompare(b.name); });
		renderAll(); closeDrawers();
	});

	// ── Signatures ──────────────────────────────────────────────────────────
	function openSignature(s) {
		s = s || { id: '', token: '', label: '', body: '' };
		$('et-sig-title').textContent = s.id ? 'Edit Signature' : 'New Signature';
		$('et-sig-id').value = s.id; $('et-sig-token').value = s.token;
		$('et-sig-label').value = s.label; $('et-sig-body-in').value = s.body;
		openDrawer($('et-sig-drawer'));
	}
	$('et-add-sig').addEventListener('click', function () { openSignature(); });
	debounceBtn($('et-sig-save'), async function () {
		const res = await ajax({ action: 'signature_save', id: $('et-sig-id').value, token: $('et-sig-token').value,
			label: $('et-sig-label').value, body: $('et-sig-body-in').value });
		if (!res.ok) { notifyErr(res.message); return; }
		const i = data.signatures.findIndex(function (x) { return +x.id === +res.row.id; });
		if (i >= 0) data.signatures[i] = res.row; else data.signatures.push(res.row);
		data.signatures.sort(function (a, b) { return a.token.localeCompare(b.token); });
		data.tokens = Object.assign({}, data.tokens); // signature tokens appear in the token list
		const r2 = await ajax({ action: 'picker' }); if (r2.ok) { data.tokens = r2.tokens; buildTokens(); }
		renderAll(); closeDrawers();
	});

	// ── Events ──────────────────────────────────────────────────────────────
	function fillEventSelects() {
		$('et-ev-event').innerHTML = Object.keys(data.event_types).map(function (k) { return '<option value="' + k + '">' + esc(data.event_types[k]) + '</option>'; }).join('');
		$('et-ev-status').innerHTML = data.statuses.map(function (s) { return '<option value="' + esc(s.slug) + '">' + esc(s.label) + '</option>'; }).join('');
		$('et-ev-template').innerHTML = data.templates.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
	}
	function syncStatusRow() { $('et-ev-status-row').hidden = $('et-ev-event').value !== 'status_changed'; }
	$('et-ev-event').addEventListener('change', syncStatusRow);
	function openEvent(e) {
		e = e || { id: '', event: 'status_changed', status_slug: '', template_id: '', active: 1 };
		fillEventSelects();
		$('et-ev-title').textContent = e.id ? 'Edit Event' : 'New Event';
		$('et-ev-id').value = e.id; $('et-ev-event').value = e.event;
		if (e.status_slug) $('et-ev-status').value = e.status_slug;
		if (e.template_id) $('et-ev-template').value = e.template_id;
		$('et-ev-active').checked = !!+e.active;
		syncStatusRow(); openDrawer($('et-ev-drawer'));
	}
	$('et-add-event').addEventListener('click', function () { openEvent(); });
	debounceBtn($('et-ev-save'), async function () {
		const res = await ajax({ action: 'event_save', id: $('et-ev-id').value, event: $('et-ev-event').value,
			status_slug: $('et-ev-status').value, template_id: $('et-ev-template').value, active: $('et-ev-active').checked ? 1 : 0 });
		if (!res.ok) { notifyErr(res.message); return; }
		const i = data.events.findIndex(function (x) { return +x.id === +res.row.id; });
		if (i >= 0) data.events[i] = res.row; else data.events.push(res.row);
		renderAll(); closeDrawers();
	});

	// ── Row click to edit + delete-in-place ─────────────────────────────────
	function bind(bodyId, list, opener, delAction) {
		const body = $(bodyId);
		body.addEventListener('click', function (e) {
			if (e.target.closest('delete-in-place, ios-toggle')) return;
			const tr = e.target.closest('tr.et-row'); if (!tr) return;
			const row = data[list].find(function (x) { return +x.id === +tr.dataset.id; });
			if (row) opener(row);
		});
		body.addEventListener('dip-confirm', async function (e) {
			const id = e.detail['data-id'];
			const res = await ajax({ action: delAction, id: id });
			if (!res.ok) { notifyErr(res.message); return; }
			data[list] = data[list].filter(function (x) { return +x.id !== +id; });
			fadeRemove(e.target.closest('tr'));
		});
	}
	bind('et-tpl-body', 'templates',  openTemplate,  'template_delete');
	bind('et-sig-body', 'signatures', openSignature, 'signature_delete');
	bind('et-ev-body',  'events',     openEvent,     'event_delete');

	document.addEventListener('ios-toggle', async function (e) {
		const src = e.detail.source;
		if (!src.closest('#et-ev-body')) return;
		const id = src.dataset.id;
		const res = await ajax({ action: 'event_toggle', id: id, active: e.detail.checked ? 1 : 0 });
		if (!res.ok) {
			notifyErr(res.message);
			src.checked = !e.detail.checked; // revert
			return;
		}
		const row = data.events.find(function (x) { return +x.id === +id; });
		if (row) row.active = e.detail.checked ? 1 : 0;
	});

	(async function init() {
		const res = await ajax({ action: 'load' });
		if (!res.ok) { notifyErr(res.message || 'Could not load.'); return; }
		data = res; buildTokens(); renderAll();
	})();
}());
