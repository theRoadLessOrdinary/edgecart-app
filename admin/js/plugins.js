/* global SimpleNotification */
(function () {
	'use strict';

	// Abort previous instance's document-level listeners (re-registered on each AJAX nav visit)
	if (window._pluginsPageCtrl) window._pluginsPageCtrl.abort();
	const ctrl = new AbortController();
	window._pluginsPageCtrl = ctrl;
	const signal = ctrl.signal;

	const AJAX = NC.adminUrl + '?route=plugins/ajax';

	const tbody    = document.getElementById('plugin-tbody');
	const tabsEl   = document.getElementById('plugin-tabs');
	const progress = document.getElementById('upload-progress');
	const progMsg  = document.getElementById('upload-progress-msg');
	const fileInput = document.getElementById('plugin-file-input');
	const dropZone  = document.getElementById('plugin-upload-zone');

	let activeType = sessionStorage.getItem('nc_plugins_tab') || 'all';
	let allPlugins = [];

	// ── Ajax ──────────────────────────────────────────────────────────────────
	async function ajax(data) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		return r.json();
	}

	function notifyOk(msg)  { SimpleNotification.success({ text: msg }); }
	function notifyErr(msg) { SimpleNotification.error({ text: msg }); }

	// ── Sidebar refresh ───────────────────────────────────────────────────────
	async function refreshSidebar() {
		try {
			const res = await ajax({ action: 'sidebar_items', section: 'setup' });
			if (!res.ok) return;
			const currentRoute = new URLSearchParams(location.search).get('route') || '';

			// Update items in the setup section
			const setupContainer = document.querySelector('.nav-group-items[data-section="setup"]');
			if (setupContainer) {
				setupContainer.querySelectorAll('[data-plugin-nav="setup"]').forEach(el => el.remove());
				res.items.forEach(function (item) {
					const a = document.createElement('a');
					a.href = NC.adminUrl + '?route=' + encodeURIComponent(item.route);
					a.className = 'nav-link nav-child' + (currentRoute === item.route ? ' active' : '');
					a.dataset.pluginNav = 'setup';
					a.textContent = item.label;
					setupContainer.appendChild(a);
				});
			}

			// Rebuild plugin nav groups
			document.querySelectorAll('.nav-group[data-plugin-group]').forEach(el => el.remove());
			const beforeSentinel = document.getElementById('plugin-groups-before');
			const afterSentinel  = document.getElementById('plugin-groups-after');
			let insertAfterBefore = beforeSentinel;
			let insertAfterAfter  = afterSentinel;

			(res.groups || []).forEach(function (group) {
				const isActive = (group.items || []).some(i => i.route === currentRoute);
				const div = document.createElement('div');
				div.className = 'nav-group' + (isActive ? ' open' : '');
				div.dataset.pluginGroup = group.code;

				const itemsHtml = (group.items || []).map(function (item) {
					const active = currentRoute === item.route ? ' active' : '';
					return '<a href="' + esc(NC.adminUrl + '?route=' + item.route) + '" ' +
						'class="nav-link nav-child' + active + '" ' +
						'data-plugin-nav="' + esc(group.section) + '">' +
						esc(item.label) + '</a>';
				}).join('');

				div.innerHTML =
					'<button class="nav-group-head" aria-expanded="' + (isActive ? 'true' : 'false') + '">' +
						'<span class="nav-icon">' + esc(group.icon || '⚙') + '</span>' +
						'<span class="nav-label">' + esc(group.label) + '</span>' +
						'<span class="nav-group-arrow">&#8250;</span>' +
					'</button>' +
					'<div class="nav-group-items" data-section="' + esc(group.section) + '">' + itemsHtml + '</div>';

				if (group.placement === 'before' && insertAfterBefore) {
					insertAfterBefore.insertAdjacentElement('afterend', div);
					insertAfterBefore = div;
				} else if (insertAfterAfter) {
					insertAfterAfter.insertAdjacentElement('afterend', div);
					insertAfterAfter = div;
				}
			});
		} catch (_) {}
	}

	// ── Load plugins ──────────────────────────────────────────────────────────
	async function loadPlugins() {
		const res = await ajax({ action: 'list' });
		if (!res.ok) { notifyErr(res.message); return; }
		renderPlugins(res.plugins);
	}

	function buildTabs(plugins) {
		const types = ['all', ...new Set(plugins.map(p => p.type || 'plugin').sort())];
		if (!types.includes(activeType)) activeType = 'all';
		tabsEl.innerHTML = '';
		types.forEach(function (type) {
			const btn = document.createElement('button');
			btn.className = 'plugin-tab' + (type === activeType ? ' active' : '');
			btn.dataset.type = type;
			btn.textContent = type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1);
			btn.addEventListener('click', function () {
				activeType = type;
				sessionStorage.setItem('nc_plugins_tab', type);
				tabsEl.querySelectorAll('.plugin-tab').forEach(b => b.classList.toggle('active', b.dataset.type === type));
				filterRows();
			});
			tabsEl.appendChild(btn);
		});
	}

	function filterRows() {
		tbody.querySelectorAll('tr[data-code]').forEach(function (tr) {
			const rowType = tr.dataset.type || 'plugin';
			tr.style.display = (activeType === 'all' || rowType === activeType) ? '' : 'none';
		});
		const visible = tbody.querySelectorAll('tr[data-code]:not([style*="none"])');
		let empty = tbody.querySelector('tr.empty-row');
		if (!visible.length) {
			if (!empty) {
				empty = document.createElement('tr');
				empty.className = 'empty-row';
				empty.innerHTML = '<td colspan="6"><div class="nc-empty">No plugins in this category.</div></td>';
				tbody.appendChild(empty);
			}
		} else if (empty) {
			empty.remove();
		}
	}

	function renderPlugins(plugins) {
		allPlugins = plugins || [];
		tbody.innerHTML = '';
		if (!allPlugins.length) {
			tbody.innerHTML = '<tr><td colspan="6"><div class="nc-empty">No plugins installed.</div></td></tr>';
			buildTabs([]);
			return;
		}
		buildTabs(allPlugins);
		allPlugins.forEach(p => tbody.appendChild(buildRow(p)));
		filterRows();
	}

	function buildRow(p) {
		const tr = document.createElement('tr');
		tr.dataset.code = p.code;
		tr.dataset.type = p.type || 'plugin';
		// has_settings alone — a plugin whose only admin surface is its own
		// full page (admin/index.php, usually reached via the sidebar) has no
		// drawer-style settings to show here; including has_admin used to
		// make this button appear and open to a dead-end "no configurable
		// settings" message for those plugins.
		const settingsBtn = p.has_settings
			? '<button class="btn btn-secondary btn-sm plugin-settings-btn" ' +
			  'data-code="' + esc(p.code) + '" data-name="' + esc(p.name) + '" ' +
			  'aria-label="Settings for ' + esc(p.name) + '"' +
			  (p.enabled ? '' : ' disabled') + '>&#9881; Settings</button>'
			: '';
		const iconHtml = p.icon ? '<span class="plugin-icon" aria-hidden="true">' + esc(p.icon) + '</span>' : '';
		const toggleCell = p.licensed === false
			? '<span class="plugin-unlicensed-badge">Unlicensed</span>'
			: '<ios-toggle ' + (p.enabled ? 'checked' : '') + ' data-code="' + esc(p.code) + '" data-action="toggle" size="sm"></ios-toggle>';
		tr.innerHTML =
			'<td>' +
				'<div class="plugin-name">' + iconHtml + esc(p.name) + '</div>' +
				'<div class="plugin-code">' + esc(p.code) + ' v' + esc(p.version) + '</div>' +
				(p.description ? '<div class="plugin-author">' + esc(p.description) + '</div>' : '') +
			'</td>' +
			'<td class="plugin-author">' + esc(p.author) + '</td>' +
			'<td class="plugin-link">' + (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.link) + '</a>' : '—') + '</td>' +
			'<td class="col-settings">' + settingsBtn + '</td>' +
			'<td class="col-toggle">' + toggleCell + '</td>' +
			'<td class="col-delete">' +
				'<delete-in-place caption="&#128465;" confirm="Remove plugin?" code="' + esc(p.code) + '"></delete-in-place>' +
			'</td>';
		return tr;
	}

	// ── Toggle enable/disable ─────────────────────────────────────────────────
	document.addEventListener('ios-toggle', async function (e) {
		const src = e.detail.source;
		if (src.dataset.action !== 'toggle') return;
		const code    = src.dataset.code;
		const enabled = e.detail.checked;
		const action  = enabled ? 'enable' : 'disable';
		const res     = await ajax({ action, code });
		if (!res.ok) { notifyErr(res.message); loadPlugins(); return; }
		// Enabling a theme auto-disables any other active theme server-side
		// (only one theme may be active at a time) — reload the whole list
		// so those other rows' toggles flip off immediately, instead of
		// still showing "on" until the next full page load. Without this,
		// manually flipping the now-already-disabled theme's toggle off
		// used to fail with a confusing "Plugin not found."
		if (res.also_disabled && res.also_disabled.length) {
			loadPlugins();
			refreshSidebar();
			return;
		}
		// Update settings button disabled state without rebuilding the row
		const row = tbody.querySelector('tr[data-code="' + code + '"]');
		if (row) {
			const settBtn = row.querySelector('.plugin-settings-btn');
			if (settBtn) settBtn.disabled = !enabled;
		}
		refreshSidebar();
	}, { signal });

	// ── Remove ────────────────────────────────────────────────────────────────
	tbody.addEventListener('dip-confirm', async function (e) {
		const code = e.detail.code;
		const tr   = tbody.querySelector('tr[data-code="' + code + '"]');
		const res  = await ajax({ action: 'remove', code });
		if (!res.ok) { notifyErr(res.message); return; }
		refreshSidebar();
		if (tr) {
			animateDelete(tr, function () {
				tr.remove();
				if (!tbody.querySelector('tr[data-code]')) {
					tbody.innerHTML = '<tr><td colspan="6"><div class="nc-empty">No plugins installed.</div></td></tr>';
				}
			});
		} else if (!tbody.querySelector('tr[data-code]')) {
			tbody.innerHTML = '<tr><td colspan="6"><div class="nc-empty">No plugins installed.</div></td></tr>';
		}
	});

	// ── Settings drawer ───────────────────────────────────────────────────────
	const drawer        = document.getElementById('plugin-drawer');
	const drawerOverlay = document.getElementById('drawer-overlay');
	const drawerTitle   = document.getElementById('plugin-drawer-title');
	const drawerContent = document.getElementById('plugin-drawer-content');

	let currentPluginCode = null;

	function openDrawer(name) {
		drawerTitle.textContent = name + ' — Settings';
		drawer.classList.add('open');
		drawerOverlay.classList.add('show');
	}
	function closeDrawer() {
		drawer.classList.remove('open');
		drawerOverlay.classList.remove('show');
		drawerContent.innerHTML = '';
		currentPluginCode = null;
		window._pluginCustomSave = null;
	}

	document.getElementById('plugin-drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('plugin-drawer-cancel').addEventListener('click', closeDrawer);
	drawerOverlay.addEventListener('click', closeDrawer);

	tbody.addEventListener('click', async function (e) {
		const btn = e.target.closest('.plugin-settings-btn');
		if (!btn) return;
		const code = btn.dataset.code;
		const name = btn.dataset.name;
		currentPluginCode = code;
		drawerContent.innerHTML = '<p style="color:var(--nc-text-dim);padding:.5rem 0">Loading…</p>';
		openDrawer(name);
		const res = await ajax({ action: 'load_plugin_settings', code });
		if (!res.ok) {
			drawerContent.innerHTML = '<p style="color:var(--nc-danger)">' + esc(res.message) + '</p>';
			return;
		}
		drawerContent.innerHTML = res.html || '<p style="color:var(--nc-text-dim)">No settings available.</p>';
		// innerHTML does not execute <script> tags — re-run them manually
		drawerContent.querySelectorAll('script').forEach(function (orig) {
			const s = document.createElement('script');
			s.textContent = orig.textContent;
			document.body.appendChild(s);
			s.remove();
		});
		drawerContent.querySelectorAll('[data-nc-tabs]').forEach(function(el) {
			NcTabs.init(el);
		});
	});

	document.getElementById('plugin-drawer-save').addEventListener('save', async function () {
		if (!currentPluginCode) return;
		if (window._pluginCustomSave) { await window._pluginCustomSave(); return; }
		this.setLoading();
		const fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		fd.append('action', 'save_plugin_settings');
		fd.append('code', currentPluginCode);
		drawerContent.querySelectorAll('input, select, textarea').forEach(function (el) {
			if (el.name) fd.append(el.name, el.value);
		});
		const r   = await fetch(AJAX, { method: 'POST', body: fd });
		const res = await r.json();
		if (!res.ok) { notifyErr(res.message); this.reset(); return; }
		this.showSuccess();
	});

	// ── Upload ────────────────────────────────────────────────────────────────
	async function installFile(file) {
		if (!file.name.endsWith('.zip')) {
			notifyErr('Plugin must be a .zip file.');
			return;
		}
		progress.classList.add('show');
		progMsg.textContent = 'Installing ' + file.name + '…';

		const fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		fd.append('action', 'install');
		fd.append('file', file);

		try {
			const r   = await fetch(AJAX, { method: 'POST', body: fd });
			const res = await r.json();
			progress.classList.remove('show');
			if (!res.ok) { notifyErr(res.message); return; }
			await loadPlugins();
			refreshSidebar();
		} catch (e) {
			progress.classList.remove('show');
			notifyErr('Upload failed: ' + e.message);
		}
		fileInput.value = '';
	}

	// ── Drop zone ─────────────────────────────────────────────────────────────
	dropZone.addEventListener('click', () => fileInput.click());

	fileInput.addEventListener('change', function () {
		if (fileInput.files[0]) installFile(fileInput.files[0]);
	});

	let dragCount = 0;
	dropZone.addEventListener('dragenter', function (e) {
		e.preventDefault(); dragCount++;
		this.classList.add('drag-over');
	});
	dropZone.addEventListener('dragleave', function () {
		dragCount--;
		if (dragCount <= 0) { dragCount = 0; this.classList.remove('drag-over'); }
	});
	dropZone.addEventListener('dragover', e => e.preventDefault());
	dropZone.addEventListener('drop', function (e) {
		e.preventDefault(); dragCount = 0;
		this.classList.remove('drag-over');
		const file = e.dataTransfer.files[0];
		if (file) installFile(file);
	});

	// ── Notice dismiss ────────────────────────────────────────────────────────
	const dismiss = document.getElementById('notice-dismiss');
	if (dismiss) {
		dismiss.addEventListener('click', function () {
			const notice = document.getElementById('plugin-notice');
			if (notice) notice.style.display = 'none';
			sessionStorage.setItem('nc_plugin_notice_dismissed', '1');
		});
		if (sessionStorage.getItem('nc_plugin_notice_dismissed') === '1') {
			const notice = document.getElementById('plugin-notice');
			if (notice) notice.style.display = 'none';
		}
	}

	function esc(str) {
		return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
	}

	loadPlugins();

})();
