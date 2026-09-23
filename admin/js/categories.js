/* global SimpleNotification, jQuery */
(function () {
	'use strict';

	const AJAX     = NC.adminUrl + '?route=categories/ajax';
	const URL_ROOT = NC.rootUrl;

	const STATUS_LABELS = { '0': 'Not Active', '1': 'Active', '2': 'Browse Only' };


	const STATUS_CLASS  = { '0': 'status-0',   '1': 'status-1',  '2': 'status-2' };

	const tbody      = document.getElementById('cat-tbody');
	const emptyRow   = document.getElementById('cat-empty-row');
	const loadingRow = document.getElementById('cat-loading-row');
	const drawer   = document.getElementById('cat-drawer');
	const overlay  = document.getElementById('drawer-overlay');
	const chkAll   = document.getElementById('chk-all');
	const btnBulk  = document.getElementById('btn-bulk-delete');
	const btnAdd   = document.getElementById('btn-add-category');

	let catLimit = parseInt(btnAdd.dataset.limit, 10) || Infinity;

	function syncLimitUI() {
		const count = tbody.querySelectorAll('tr[data-id]').length;
		const atLimit = isFinite(catLimit) && count >= catLimit;
		let hint = document.getElementById('cat-limit-hint');
		if (atLimit) {
			btnAdd.style.display = 'none';
			if (!hint) {
				hint = document.createElement('span');
				hint.id = 'cat-limit-hint';
				hint.className = 'ec-limit-hint';
				hint.innerHTML = 'Category limit reached. <a href="' + (NC.upgradeUrl || '#') + '" target="_blank" rel="noopener">Upgrade to add more &rarr;</a>';
				btnAdd.insertAdjacentElement('afterend', hint);
			}
		} else {
			btnAdd.style.display = '';
			if (hint) hint.remove();
		}
	}

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

	// ── Load ──────────────────────────────────────────────────────────────────
	async function loadCategories() {
		const res = await ajax({ action: 'list' });
		if (!res.ok) { notifyErr(res.message); return; }
		if (res.limit !== undefined) catLimit = res.limit;
		renderRows(res.rows);
	}

	function renderRows(rows) {
		Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(r => r.remove());
		loadingRow.style.display = 'none';
		if (!rows || !rows.length) { emptyRow.style.display = ''; }
		else { emptyRow.style.display = 'none'; }
		(rows || []).forEach(row => tbody.appendChild(buildRow(row)));
		initDragDrop();
		updateBulkBtn();
		syncLimitUI();
	}

	function buildRow(d) {
		const tr  = document.createElement('tr');
		tr.dataset.id = d.id;

		const statusLabel = STATUS_LABELS[String(d.status)] || 'Unknown';
		const statusClass = STATUS_CLASS[String(d.status)]  || '';

		const inactive = d.status == 0;

		const incomplete = NC.incompleteCats && NC.incompleteCats.indexOf(parseInt(d.id)) !== -1;
		const incBadge   = incomplete
			? ' <span class="cat-incomplete-badge" title="Needs more information">&#43;</span>'
			: '';

		tr.innerHTML =
			'<td class="col-drag"><span class="drag-handle" title="Drag to reorder">&#8942;</span></td>' +
			'<td><button class="cat-name-link" data-id="' + d.id + '">' + esc(d.name) + '</button>' + incBadge + '</td>' +
			'<td class="parent-cell">' + (d.parent_name ? esc(d.parent_name) : '&mdash;') + '</td>' +
			'<td class="col-status">' +
				'<roller-select data-id="' + d.id + '" data-field="status" value="' + d.status + '">' +
					'<rs-item value="0">Not Active</rs-item>' +
					'<rs-item value="1">Active</rs-item>' +
					'<rs-item value="2">Browse Only</rs-item>' +
				'</roller-select>' +
			'</td>' +
			'<td class="col-toggle">' +
				'<ios-toggle ' + (d.featured == 1 ? 'checked' : '') + ' size="sm" data-id="' + d.id + '" data-field="featured"></ios-toggle>' +
			'</td>' +
			'<td class="col-toggle">' +
				'<ios-toggle ' + (d.homepage_default == 1 ? 'checked' : '') + ' size="sm" data-id="' + d.id + '" data-field="homepage_default" title="Use as homepage default"></ios-toggle>' +
			'</td>' +
			'<td class="col-products">' +
				'<a href="' + NC.adminUrl + '?route=products&cat=' + encodeURIComponent(d.id) + '" class="btn btn-secondary btn-sm show-products-btn">Show Products</a>' +
			'</td>' +
			'<td class="col-browse">' +
				'<a href="' + URL_ROOT + 'category/' + esc(d.slug) + '" target="_blank" rel="noopener" class="browse-link" title="Browse category">' +
					'<svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
						'<path d="M7 1h4v4M11 1L5 7"/><path d="M9 7v4H1V3h4"/>' +
					'</svg>' +
				'</a>' +
			'</td>' +
			'<td class="col-delete">' +
				(inactive
					? '<span class="delete-fade show" id="cat-del-' + d.id + '">' +
					  '<delete-in-place caption="&#128465;" confirm="Delete?" data-id="' + d.id + '"></delete-in-place>' +
					  '</span>'
					// Deleting an active category is blocked by design (same rule as
					// admin users in settings.js) - but the old markup made the icon
					// fully invisible (opacity:0, pointer-events:none) with no
					// explanation at all, which reads as a broken button rather than
					// a deliberate safeguard. Show a visibly-disabled, hoverable icon
					// with a real explanation instead of hiding it entirely.
					: '<span class="delete-disabled-hint" id="cat-del-' + d.id + '" title="Deactivate this category first, then you can delete it.">&#128465;</span>'
				) +
			'</td>' +
			'<td class="col-check">' +
				'<input type="checkbox" class="row-chk" data-id="' + d.id + '"' + (inactive ? '' : ' disabled') + '>' +
			'</td>';

		return tr;
	}

	function updateRow(d) {
		const tr = tbody.querySelector('tr[data-id="' + d.id + '"]');
		if (!tr) {
			emptyRow.style.display = 'none';
			tbody.appendChild(buildRow(d));
			initDragDrop();
		} else {
			tbody.replaceChild(buildRow(d), tr);
		}
		updateBulkBtn();
		syncLimitUI();
	}

	// ── Drawer ────────────────────────────────────────────────────────────────
	function openDrawer(title) {
		document.getElementById('drawer-title').textContent = title;
		drawer.classList.add('open');
		overlay.classList.add('show');

		// Init Trumbowyg after drawer is visible
		setTimeout(function () {
			if (!window._trumbInitDone && window.jQuery && jQuery.fn.trumbowyg) {
				
				jQuery('#cat-html-long').trumbowyg({
					svgPath: '/js/vendor/trumbowyg/src/ui/icons.svg',
					semantic: false,
					btns: [
						['bold', 'italic', 'underline'],
						['link'],
						['unorderedList', 'orderedList'],
						['indent', 'outdent'],
						['viewHTML']
					]
				});
				window._trumbInitDone = true;
				// Append plain FM image button to toolbar
				setTimeout(function() {
					var $ta = jQuery('#cat-html-long');
					if (!window.openFilePicker) return;
					var toolbar = $ta.closest('.trumbowyg-box')[0]
						? $ta.closest('.trumbowyg-box')[0].querySelector('.trumbowyg-button-pane')
						: null;
					if (!toolbar || toolbar.querySelector('.nc-fm-img-btn')) return;
					var fmBtn = document.createElement('button');
					fmBtn.type = 'button';
					fmBtn.className = 'nc-fm-img-btn';
					fmBtn.style.cssText = 'padding:2px 6px;cursor:pointer;border:none;background:none;font-size:14px;line-height:32px;height:35px;color:var(--nc-text,#333)';
					fmBtn.title = 'Insert Image';
					fmBtn.setAttribute('aria-label', 'Insert image from file manager');
					fmBtn.textContent = '🖼';
					fmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
					fmBtn.addEventListener('click', function(e) {
						e.preventDefault();
						openFilePicker(function(items) {
							if (!items.length) return;
							var ed = $ta.closest('.trumbowyg-box')[0]
								? $ta.closest('.trumbowyg-box')[0].querySelector('.trumbowyg-editor')
								: null;
							if (ed) ed.focus();
							var img = '<img src="' + items[0].url + '" alt="" style="max-width:100%">';
					$ta.trumbowyg('execCmd', { cmd: 'insertHTML', param: img, forceCss: false });
						});
					});
					toolbar.appendChild(fmBtn);
				}, 0);
			}
		}, 50);
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
	}

	function activateTab(panel) {
		document.querySelectorAll('.drawer-tab').forEach(t => {
			t.classList.toggle('active', t.dataset.panel === panel);
			t.setAttribute('aria-selected', t.dataset.panel === panel ? 'true' : 'false');
		});
		document.querySelectorAll('.drawer-tab-panel').forEach(p => p.classList.remove('active'));
		const panelEl = document.getElementById('cat-panel-' + panel);
		if (panelEl) panelEl.classList.add('active');
	}
	document.querySelectorAll('.drawer-tab').forEach(function (btn) {
		btn.addEventListener('click', function () { activateTab(this.dataset.panel); });
	});

	function setCatImage(path) {
		document.getElementById('cat-image').value = path || '';
		const preview = document.getElementById('cat-img-preview');
		const wrap    = document.getElementById('cat-img-preview-wrap');
		const zone    = document.getElementById('cat-img-drop-zone');
		if (path) {
			preview.src      = path;
			wrap.style.display = '';
			zone.style.display = 'none';
		} else {
			preview.src      = '';
			wrap.style.display = 'none';
			zone.style.display = '';
		}
	}

	function setCatBanner(path) {
		document.getElementById('cat-banner').value = path || '';
		const preview = document.getElementById('cat-banner-preview');
		const wrap    = document.getElementById('cat-banner-preview-wrap');
		const zone    = document.getElementById('cat-banner-drop-zone');
		if (path) {
			preview.src        = path;
			wrap.style.display = '';
			zone.style.display = 'none';
		} else {
			preview.src        = '';
			wrap.style.display = 'none';
			zone.style.display = '';
		}
	}

	function resetDrawer() {
		document.getElementById('cat-id').value              = '';
		document.getElementById('cat-name').value            = '';
		document.getElementById('cat-seo').value             = '';
		document.getElementById('cat-seo-keywords').value    = '';
		document.getElementById('cat-seo-description').value = '';
		if (window._trumbInitDone) jQuery('#cat-html-long').trumbowyg('html', '');
		else document.getElementById('cat-html-long').value = '';
		const rs = document.getElementById('cat-status');
		if (rs) rs.value = '1';
		const ft = document.getElementById('cat-featured');
		if (ft) ft.checked = false;
		const hd = document.getElementById('cat-homepage-default');
		if (hd) hd.checked = false;
		setCatImage('');
		setCatBanner('');
		activateTab('details');
	}

	let seoTitleDirty = false;
	let topFourCats   = [];

	document.getElementById('cat-seo').addEventListener('input', function () {
		seoTitleDirty = true;
	});

	document.getElementById('cat-name').addEventListener('input', function () {
		if (seoTitleDirty) return;
		document.getElementById('cat-seo').value = buildSeoTitle(this.value.trim());
	});

	function buildSeoTitle(catName) {
		if (!catName) return '';
		const parts = [catName, NC.siteName];
		if (topFourCats.length) parts.push(topFourCats.join(', '));
		return parts.join(' \u2014 ');
	}

	async function populateParents(excludeId) {
		const res = await ajax({ action: 'parents' });
		const sel = document.getElementById('cat-parent');
		if (!sel) return;
		sel.innerHTML = '<option value="0">\u2014 Top Level \u2014</option>';
		(res.parents || []).forEach(function (p) {
			if (excludeId && p.id == excludeId) return;
			const opt = document.createElement('option');
			opt.value = p.id;
			opt.textContent = p.name;
			sel.appendChild(opt);
		});
		// Update top four for SEO default
		topFourCats = res.top_four || [];
	}

	async function addCategory() {
		await populateParents(0);
		seoTitleDirty = false;
		resetDrawer();
		openDrawer('Add Category');
		document.getElementById('cat-name').focus();
	}

	document.getElementById('btn-add-category').addEventListener('click', addCategory);
	document.getElementById('btn-add-first').addEventListener('click', addCategory);

	// ── Edit ──────────────────────────────────────────────────────────────────
	tbody.addEventListener('click', async function (e) {
		const btn = e.target.closest('.cat-name-link');
		if (!btn) return;
		const res = await ajax({ action: 'get', id: btn.dataset.id });
		if (!res.ok) { notifyErr(res.message); return; }
		const d = res.row;

		await populateParents(d.id);
		document.getElementById('cat-id').value              = d.id;
		document.getElementById('cat-name').value            = d.name;
		document.getElementById('cat-seo').value             = d.seo_title || '';
		document.getElementById('cat-seo-keywords').value    = d.seo_keywords || '';
		document.getElementById('cat-seo-description').value = d.seo_description || '';
		const catParent = document.getElementById('cat-parent');
		if (catParent) catParent.value = d.parent_id || 0;
		seoTitleDirty = !!(d.seo_title && d.seo_title.trim());

		if (window._trumbInitDone) jQuery('#cat-html-long').trumbowyg('html', d.html_long || '');
		else document.getElementById('cat-html-long').value = d.html_long || '';

		const rs = document.getElementById('cat-status');
		if (rs) rs.value = String(d.status);
		const ft = document.getElementById('cat-featured');
		if (ft) ft.checked = d.featured == 1;
		const hd = document.getElementById('cat-homepage-default');
		if (hd) hd.checked = d.homepage_default == 1;
		setCatImage(d.image || '');
		setCatBanner(d.banner || '');
		activateTab('details');

		openDrawer('Edit Category');
	});

	// ── Save ──────────────────────────────────────────────────────────────────
	document.getElementById('btn-drawer-save').addEventListener('save', async function () {
		const nameEl = document.getElementById('cat-name');
		if (!nameEl.reportValidity()) return;
		this.setLoading();
		const name = nameEl.value.trim();

		const htmlLong = window._trumbInitDone
			? jQuery('#cat-html-long').trumbowyg('html')
			: document.getElementById('cat-html-long').value;

		const rs = document.getElementById('cat-status');
		const ft = document.getElementById('cat-featured');

		const res = await ajax({
			action:          'save',
			id:              document.getElementById('cat-id').value,
			name:            name,
			parent_id:       document.getElementById('cat-parent')?.value ?? 0,
			seo_title:       document.getElementById('cat-seo').value,
			seo_keywords:    document.getElementById('cat-seo-keywords').value,
			seo_description: document.getElementById('cat-seo-description').value,
			html_long:       htmlLong,
			status:           rs ? rs.value : '1',
			featured:         ft ? (ft.checked ? 1 : 0) : 0,
			homepage_default: document.getElementById('cat-homepage-default')?.checked ? 1 : 0,
			image:            document.getElementById('cat-image').value,
			banner:           document.getElementById('cat-banner').value,
		});

		if (!res.ok) { notifyErr(res.message); this.reset(); return; }

		// Remove from incomplete list if it was there
		if (res.cleared_reminder && NC.incompleteCats) {
			const idx = NC.incompleteCats.indexOf(parseInt(res.cleared_reminder));
			if (idx !== -1) NC.incompleteCats.splice(idx, 1);
			// Fade out and remove the reminder banner for this category
			const banner = document.querySelector(
				'.reminder-banner[data-entity="category"][data-entity-id="' + res.cleared_reminder + '"]'
			);
			if (banner) {
				banner.style.transition = 'opacity .4s';
				banner.style.opacity = '0';
				setTimeout(() => banner.remove(), 420);
			}
		}

		updateRow(res.row);
		this.showSuccess();
		setTimeout(() => closeDrawer(), 1500);
	});

	document.getElementById('drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);
	overlay.addEventListener('click', closeDrawer);

	// ── Debounce helper ───────────────────────────────────────────────────────
	function debounce(fn, ms) {
		var t;
		return function () {
			var args = arguments;
			clearTimeout(t);
			t = setTimeout(function () { fn.apply(null, args); }, ms);
		};
	}

	var debouncedToggle = debounce(function (id, field, value) {
		ajax({ action: 'toggle', id: id, field: field, value: value });
	}, 1000);

	// ── Inline roller-select (status) ─────────────────────────────────────────
	document.addEventListener('roller-change', function (e) {
		const src = e.detail.source;
		if (!src.dataset.id || !src.dataset.field) return;

		// Show/hide delete and enable/disable checkbox based on status
		if (src.dataset.field === 'status') {
			const id       = src.dataset.id;
			const inactive = e.detail.value == 0;
			const delSpan  = document.getElementById('cat-del-' + id);
			const chk      = tbody.querySelector('tr[data-id="' + id + '"] .row-chk');
			if (delSpan) delSpan.classList.toggle('show', inactive);
			if (chk)     chk.disabled = !inactive;
		}

		debouncedToggle(src.dataset.id, src.dataset.field, e.detail.value);
	});

	// ── Inline ios-toggle (featured / homepage_default) ───────────────────────
	document.addEventListener('ios-toggle', function (e) {
		const src = e.detail.source;
		if (!src.dataset.id || !src.dataset.field) return;
		if (src.dataset.field === 'homepage_default') {
			// homepage_default is mutually exclusive - reload list after save
			ajax({ action: 'toggle', id: src.dataset.id, field: 'homepage_default', value: e.detail.value })
				.then(function () { loadRows(); });
		} else {
			debouncedToggle(src.dataset.id, src.dataset.field, e.detail.value);
		}
	});

	// ── Delete single ─────────────────────────────────────────────────────────
	tbody.addEventListener('dip-confirm', async function (e) {
		const id  = e.detail['data-id'] || e.detail.id;
		const tr  = tbody.querySelector('tr[data-id="' + id + '"]');
		const res = await ajax({ action: 'delete', id: id });
		if (!res.ok) { notifyErr(res.message); return; }
		if (tr) {
			animateDelete(tr, function () {
				tr.remove();
				if (!tbody.querySelector('tr[data-id]')) emptyRow.style.display = '';
				updateBulkBtn();
				syncLimitUI();
			});
		} else {
			if (!tbody.querySelector('tr[data-id]')) emptyRow.style.display = '';
			updateBulkBtn();
			syncLimitUI();
		}
	});

	// ── Bulk delete ───────────────────────────────────────────────────────────
	chkAll.addEventListener('change', function () {
		tbody.querySelectorAll('.row-chk').forEach(function (c) { c.checked = chkAll.checked; });
		updateBulkBtn();
	});

	tbody.addEventListener('change', function (e) {
		if (e.target.classList.contains('row-chk')) updateBulkBtn();
	});

	function updateBulkBtn() {
		const n = tbody.querySelectorAll('.row-chk:checked').length;
		btnBulk.disabled    = n === 0;
		btnBulk.textContent = n > 0 ? 'Delete Selected (' + n + ')' : 'Delete Selected';
	}

	debounceBtn(btnBulk, async function () {
		const ids = Array.from(tbody.querySelectorAll('.row-chk:checked')).map(function (c) { return c.dataset.id; });
		if (!ids.length) return;
		const res = await ajax({ action: 'bulk_delete', ids: JSON.stringify(ids) });
		if (!res.ok) { notifyErr(res.message); return; }
		ids.forEach(function (id) {
			const tr = tbody.querySelector('tr[data-id="' + id + '"]');
			if (tr) animateDelete(tr, function () { tr.remove(); });
		});
		setTimeout(function () {
			if (!tbody.querySelector('tr[data-id]')) emptyRow.style.display = '';
			updateBulkBtn();
			syncLimitUI();
		}, 350);
		chkAll.checked = false;
	});

	// ── Drag-drop reorder - delegated, no duplicate listeners ─────────────────
	var dragSrc = null;

	// Make rows draggable only via handle mousedown
	tbody.addEventListener('mousedown', function (e) {
		var handle = e.target.closest('.drag-handle');
		if (!handle) return;
		var tr = handle.closest('tr[data-id]');
		if (tr) tr.setAttribute('draggable', 'true');
	});

	tbody.addEventListener('mouseup', function () {
		tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
			tr.setAttribute('draggable', 'false');
		});
	});

	tbody.addEventListener('dragstart', function (e) {
		var tr = e.target.closest('tr[data-id]');
		if (!tr) return;
		dragSrc = tr;
		tr.classList.add('dragging');
		e.dataTransfer.effectAllowed = 'move';
	});

	tbody.addEventListener('dragend', function () {
		if (dragSrc) dragSrc.classList.remove('dragging');
		tbody.querySelectorAll('tr').forEach(function (r) { r.classList.remove('drag-over'); });
		tbody.querySelectorAll('tr[data-id]').forEach(function (tr) { tr.setAttribute('draggable', 'false'); });
		dragSrc = null;
		saveOrder();
	});

	tbody.addEventListener('dragover', function (e) {
		e.preventDefault();
		var tr = e.target.closest('tr[data-id]');
		tbody.querySelectorAll('tr').forEach(function (r) { r.classList.remove('drag-over'); });
		if (tr && tr !== dragSrc) tr.classList.add('drag-over');
	});

	tbody.addEventListener('drop', function (e) {
		e.preventDefault();
		var tr = e.target.closest('tr[data-id]');
		if (!tr || tr === dragSrc || !dragSrc) return;
		var rows = Array.from(tbody.querySelectorAll('tr[data-id]'));
		var from = rows.indexOf(dragSrc);
		var to   = rows.indexOf(tr);
		if (from < to) tbody.insertBefore(dragSrc, tr.nextSibling);
		else           tbody.insertBefore(dragSrc, tr);
	});

	function initDragDrop() { /* delegated - no per-row setup needed */ }

	async function saveOrder() {
		var ids = Array.from(tbody.querySelectorAll('tr[data-id]')).map(function (r) { return r.dataset.id; });
		await ajax({ action: 'reorder', ids: JSON.stringify(ids) });
	}

	function esc(str) {
		return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	loadCategories();

	// ── Drawer scroll indicator ───────────────────────────────────────────────
	(function () {
		const drawerContent = document.getElementById('cat-drawer-content');
		const indicator     = document.getElementById('cat-scroll-indicator');
		const descTA        = document.getElementById('cat-html-long');
		if (!drawerContent || !indicator) return;

		function checkOverflow() {
			const overflows = drawerContent.scrollHeight > drawerContent.clientHeight + 10;
			const atBottom  = drawerContent.scrollTop + drawerContent.clientHeight >= drawerContent.scrollHeight - 20;
			indicator.classList.toggle('hidden', !overflows || atBottom);
		}

		// Observe drawer open (class change on me-drawer)
		const drawerEl = document.getElementById('cat-drawer');
		if (drawerEl && window.MutationObserver) {
			new MutationObserver(checkOverflow).observe(drawerEl, { attributes: true, attributeFilter: ['class'] });
		}
		drawerContent.addEventListener('scroll', checkOverflow);
		descTA?.addEventListener('focus', () => indicator.classList.add('hidden'));
		window.addEventListener('resize', checkOverflow);
	}());

	// ── AI integration ────────────────────────────────────────────────────────
	async function aiGenerate(prompt) {
		const key = (NC.deepaiKey || '').trim();
		if (!key) {
			notifyErr('DeepAI API key not set. Add it in Settings → Options.');
			return null;
		}
		const fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		fd.append('text', prompt);
		const res = await fetch('https://api.deepai.org/api/text-generator', {
			method: 'POST',
			headers: { 'api-key': key },
			body: fd,
		});
		const data = await res.json();
		if (data.err) { notifyErr('AI error: ' + data.err); return null; }
		return (data.output || '').trim();
	}

	document.getElementById('btn-cat-ai-desc')?.addEventListener('click', async function () {
		const name = document.getElementById('cat-name').value.trim();
		if (!name) { notifyErr('Enter a category name first.'); return; }
		this.textContent = '✨ Generating…';
		const result = await aiGenerate(
			'Write a short, engaging HTML product category description (2-3 sentences, no heading) for a category called "' + name + '".'
		);
		this.textContent = '✨ AI';
		if (!result) return;
		if (window._trumbInitDone) jQuery('#cat-html-long').trumbowyg('html', result);
		else document.getElementById('cat-html-long').value = result;
	});

	document.getElementById('btn-cat-ai-seo')?.addEventListener('click', async function () {
		const name = document.getElementById('cat-name').value.trim();
		if (!name) { notifyErr('Enter a category name first.'); return; }
		this.textContent = '✨ Generating…';
		const result = await aiGenerate(
			'For a product category named "' + name + '", provide ONLY a JSON object (no markdown, no explanation) with these fields: ' +
			'seo_title (concise page title under 70 chars), ' +
			'seo_keywords (comma-separated keywords, max 150 chars), ' +
			'seo_description (meta description under 160 chars).'
		);
		this.textContent = '✨ Generate SEO';
		if (!result) return;
		try {
			const clean = result.replace(/```json|```/g, '').trim();
			const obj   = JSON.parse(clean);
			if (obj.seo_title)       document.getElementById('cat-seo').value             = obj.seo_title;
			if (obj.seo_keywords)    document.getElementById('cat-seo-keywords').value    = obj.seo_keywords;
			if (obj.seo_description) document.getElementById('cat-seo-description').value = obj.seo_description;
		} catch (e) {
			notifyErr('AI returned unexpected format. Try again.');
		}
	});

	// ── Category image tab ────────────────────────────────────────────────────
	const FM_AJAX = NC.adminUrl + '?route=filemanager/ajax';

	async function autoSaveImage(path) {
		const id = document.getElementById('cat-id').value;
		if (!id) return; // new category - image saved with full save
		const res = await ajax({ action: 'save_image', id, image: path });
		if (!res.ok) { notifyErr(res.message); return; }
		if (res.row) updateRow(res.row);
		notifyOk(path ? 'Image saved.' : 'Image removed.');
	}

	async function uploadCatImage(file) {
		const fd = new FormData();
		fd.append('action', 'upload');
		fd.append('folder', 'categories');
		fd.append('file', file);
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(FM_AJAX, { method: 'POST', body: fd });
		const res = await r.json();
		if (!res.ok) { notifyErr(res.message || 'Upload failed.'); return; }
		setCatImage(res.file.db_path);
		await autoSaveImage(res.file.db_path);
	}

	const dropZone   = document.getElementById('cat-img-drop-zone');
	const fileInput  = document.getElementById('cat-img-file-input');

	dropZone.addEventListener('click', () => fileInput.click());
	dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
	dropZone.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
	dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
	dropZone.addEventListener('drop', e => {
		e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
		const file = e.dataTransfer.files[0];
		if (file) uploadCatImage(file);
	});
	fileInput.addEventListener('change', () => {
		if (fileInput.files[0]) uploadCatImage(fileInput.files[0]);
		fileInput.value = '';
	});

	document.getElementById('btn-cat-open-fm').addEventListener('click', function () {
		if (!window.openFilePicker) { notifyErr('File manager not loaded.'); return; }
		window.openFilePicker(function (items) {
			if (!items.length) return;
			setCatImage(items[0].url);
			autoSaveImage(items[0].url);
		}, { dir: 'categories' });
	});

	document.getElementById('btn-cat-img-clear').addEventListener('click', function () {
		setCatImage('');
		autoSaveImage('');
	});

	// ── Category banner tab ───────────────────────────────────────────────────
	async function autoSaveBanner(path) {
		const id = document.getElementById('cat-id').value;
		if (!id) return;
		const res = await ajax({ action: 'save_banner', id, banner: path });
		if (!res.ok) { notifyErr(res.message); return; }
		notifyOk(path ? 'Banner saved.' : 'Banner removed.');
	}

	async function uploadCatBanner(file) {
		const fd = new FormData();
		fd.append('action', 'upload');
		fd.append('folder', 'categories');
		fd.append('file', file);
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(FM_AJAX, { method: 'POST', body: fd });
		const res = await r.json();
		if (!res.ok) { notifyErr(res.message || 'Upload failed.'); return; }
		setCatBanner(res.file.db_path);
		await autoSaveBanner(res.file.db_path);
	}

	const bannerDropZone  = document.getElementById('cat-banner-drop-zone');
	const bannerFileInput = document.getElementById('cat-banner-file-input');

	bannerDropZone.addEventListener('click', () => bannerFileInput.click());
	bannerDropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') bannerFileInput.click(); });
	bannerDropZone.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); bannerDropZone.classList.add('drag-over'); });
	bannerDropZone.addEventListener('dragleave', () => bannerDropZone.classList.remove('drag-over'));
	bannerDropZone.addEventListener('drop', e => {
		e.preventDefault(); e.stopPropagation(); bannerDropZone.classList.remove('drag-over');
		const file = e.dataTransfer.files[0];
		if (file) uploadCatBanner(file);
	});
	bannerFileInput.addEventListener('change', () => {
		if (bannerFileInput.files[0]) uploadCatBanner(bannerFileInput.files[0]);
		bannerFileInput.value = '';
	});

	document.getElementById('btn-cat-open-fm-banner').addEventListener('click', function () {
		if (!window.openFilePicker) { notifyErr('File manager not loaded.'); return; }
		window.openFilePicker(function (items) {
			if (!items.length) return;
			setCatBanner(items[0].url);
			autoSaveBanner(items[0].url);
		}, { dir: 'categories' });
	});

	document.getElementById('btn-cat-banner-clear').addEventListener('click', function () {
		setCatBanner('');
		autoSaveBanner('');
	});

	// ── Drawer-wide drop target (any tab, replaces existing image) ────────────
	drawer.addEventListener('dragenter', function (e) {
		if (e.dataTransfer.types.includes('Files')) drawer.classList.add('img-drag-target');
	});
	drawer.addEventListener('dragover', function (e) {
		if (e.dataTransfer.types.includes('Files')) e.preventDefault();
	});
	drawer.addEventListener('dragleave', function (e) {
		if (!drawer.contains(e.relatedTarget)) drawer.classList.remove('img-drag-target');
	});
	drawer.addEventListener('drop', function (e) {
		drawer.classList.remove('img-drag-target');
		const file = e.dataTransfer.files[0];
		if (!file) return;
		e.preventDefault();
		activateTab('images');
		uploadCatImage(file);
	});

	// ── Description image picker ──────────────────────────────────────────────
	document.getElementById('btn-cat-insert-image')?.addEventListener('click', function () {
		if (!window.openFilePicker) { notifyErr('File manager not loaded.'); return; }
		window.openFilePicker(function (items) {
			if (!items.length) return;
			const img = '<img src="' + items[0].url + '" alt="">';
			if (window._trumbInitDone) {
				jQuery('#cat-html-long').trumbowyg('execCmd', { cmd: 'insertHTML', param: img, forceCss: false });
			} else {
				const ta = document.getElementById('cat-html-long');
				const pos = ta.selectionStart;
				ta.value = ta.value.slice(0, pos) + img + ta.value.slice(pos);
			}
		});
	});

})();
