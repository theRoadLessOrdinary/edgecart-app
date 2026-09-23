/* admin/js/order-statuses.js — order statuses management in settings */
(function ($) {
	'use strict';

	var ajaxUrl = NC.adminUrl + '?route=settings/ajax';
	var rows    = [];   // [{id, slug, label, color, sort_order, is_cancellation}]

	// ── Boot ─────────────────────────────────────────────────────────────────
	$.post(ajaxUrl, { action: 'os_list', csrf_token: getCsrfToken() }, function (r) {
		if (!r.ok) return;
		rows = r.rows;
		renderTable();
	});

	// ── Render ────────────────────────────────────────────────────────────────
	function renderTable() {
		var tbody = document.getElementById('os-tbody');
		tbody.innerHTML = '';
		rows.forEach(function (row) {
			var tr = document.createElement('tr');
			tr.dataset.id = row.id;
			tr.innerHTML =
				'<td class="col-drag"><span class="os-drag-handle" title="Drag to reorder">⠿</span></td>' +
				'<td>' +
					'<span class="os-color-dot" style="background:' + esc(row.color) + '"></span>' +
					'<button class="cat-name-link os-edit-btn" data-id="' + row.id + '">' + esc(row.label) + '</button>' +
				'</td>' +
				'<td><code>' + esc(row.slug) + '</code></td>' +
				'<td>' +
					'<span class="os-color-dot" style="background:' + esc(row.color) + '"></span>' +
					'<span style="font-family:monospace;font-size:.82rem">' + esc(row.color) + '</span>' +
				'</td>' +
				'<td>' + (parseInt(row.is_cancellation) ? '<span style="color:var(--nc-danger);font-weight:600">Yes</span>' : '<span style="color:var(--nc-text-dim)">No</span>') + '</td>' +
				'<td class="col-delete"><button class="os-delete-btn" data-id="' + row.id + '" title="Delete" style="background:none;border:none;cursor:pointer;color:var(--nc-danger);font-size:1.1rem">&#128465;</button></td>';
			tbody.appendChild(tr);
		});
		initDrag();
	}

	// ── Drag-to-reorder ────────────────────────────────────────────────────────
	var dragSrc = null;

	function initDrag() {
		var tbody = document.getElementById('os-tbody');
		Array.from(tbody.querySelectorAll('tr')).forEach(function (tr) {
			tr.setAttribute('draggable', 'true');
			tr.addEventListener('dragstart', function (e) {
				dragSrc = tr;
				tr.classList.add('os-dragging');
				e.dataTransfer.effectAllowed = 'move';
			});
			tr.addEventListener('dragend', function () {
				tr.classList.remove('os-dragging');
				document.querySelectorAll('#os-tbody tr').forEach(function (r) {
					r.classList.remove('os-drag-over');
				});
			});
			tr.addEventListener('dragover', function (e) {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				if (tr !== dragSrc) tr.classList.add('os-drag-over');
			});
			tr.addEventListener('dragleave', function () {
				tr.classList.remove('os-drag-over');
			});
			tr.addEventListener('drop', function (e) {
				e.preventDefault();
				tr.classList.remove('os-drag-over');
				if (!dragSrc || dragSrc === tr) return;
				var trs = Array.from(tbody.querySelectorAll('tr'));
				var srcI  = trs.indexOf(dragSrc);
				var destI = trs.indexOf(tr);
				if (srcI < destI) {
					tbody.insertBefore(dragSrc, tr.nextSibling);
				} else {
					tbody.insertBefore(dragSrc, tr);
				}
				saveOrder();
			});
		});
	}

	function saveOrder() {
		var ids = Array.from(document.querySelectorAll('#os-tbody tr')).map(function (tr) {
			return tr.dataset.id;
		});
		$.post(ajaxUrl, { action: 'os_reorder', ids: JSON.stringify(ids), csrf_token: getCsrfToken() });
	}

	// ── Add button ────────────────────────────────────────────────────────────
	document.getElementById('btn-add-status').addEventListener('click', function () {
		openDrawer(null);
	});

	// ── Edit button (delegated) ───────────────────────────────────────────────
	$(document).on('click', '.os-edit-btn', function () {
		var id  = parseInt(this.dataset.id);
		var row = rows.find(function (r) { return r.id == id; });
		if (row) openDrawer(row);
	});

	// ── Delete button (delegated) ─────────────────────────────────────────────
	$(document).on('click', '.os-delete-btn', function () {
		var id  = parseInt(this.dataset.id);
		var row = rows.find(function (r) { return r.id == id; });
		if (!row) return;
		if (!confirm('Delete status "' + row.label + '"? This cannot be undone.')) return;
		$.post(ajaxUrl, { action: 'os_delete', id: id, csrf_token: getCsrfToken() }, function (r) {
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			rows = rows.filter(function (r) { return r.id != id; });
			renderTable();
		});
	});

	// ── Drawer ────────────────────────────────────────────────────────────────
	var drawer  = document.getElementById('os-drawer');
	var overlay = document.getElementById('drawer-overlay');

	function openDrawer(row) {
		document.getElementById('os-drawer-title').textContent = row ? 'Edit Status' : 'Add Status';
		document.getElementById('os-id').value    = row ? row.id    : '';
		document.getElementById('os-label').value = row ? row.label : '';
		document.getElementById('os-slug').value  = row ? row.slug  : '';

		var color = (row && row.color) ? row.color : '#6b7280';
		document.getElementById('os-color-picker').value = color;
		document.getElementById('os-color-hex').value    = color;

		var cb = drawer.querySelector('#os-is-cancellation');
		if (cb) {
			var inner = cb.querySelector('input[type=checkbox]');
			var hid   = cb.querySelector('input[type=hidden]');
			var on    = row ? !!parseInt(row.is_cancellation) : false;
			if (inner) inner.checked = on;
			if (hid)   hid.value     = on ? '1' : '0';
		}

		drawer.classList.add('open');
		overlay.classList.add('show');
		document.getElementById('os-label').focus();
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
	}

	document.getElementById('os-drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('os-drawer-cancel').addEventListener('click', closeDrawer);
	overlay.addEventListener('click', closeDrawer);

	// ── Color picker sync ─────────────────────────────────────────────────────
	document.getElementById('os-color-picker').addEventListener('input', function () {
		document.getElementById('os-color-hex').value = this.value;
	});
	document.getElementById('os-color-hex').addEventListener('input', function () {
		var v = this.value.trim();
		if (/^#[0-9a-fA-F]{6}$/.test(v)) {
			document.getElementById('os-color-picker').value = v;
		}
	});

	// ── Auto-slug from label ──────────────────────────────────────────────────
	document.getElementById('os-label').addEventListener('input', function () {
		var slugEl = document.getElementById('os-slug');
		if (document.getElementById('os-id').value) return; // don't overwrite on edit
		slugEl.value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	});

	// ── Save ─────────────────────────────────────────────────────────────────
	debounceBtn(document.getElementById('os-drawer-save'), function () {
		var cb    = drawer.querySelector('#os-is-cancellation');
		var inner = cb ? cb.querySelector('input[type=checkbox]') : null;

		var payload = {
			action:          'os_save',
			id:              document.getElementById('os-id').value,
			label:           document.getElementById('os-label').value.trim(),
			slug:            document.getElementById('os-slug').value.trim(),
			color:           document.getElementById('os-color-hex').value.trim() || '#6b7280',
			is_cancellation: (inner && inner.checked) ? '1' : '0',
			csrf_token:      getCsrfToken()
		};

		$.post(ajaxUrl, payload, function (r) {
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			var existing = rows.findIndex(function (x) { return x.id == r.row.id; });
			if (existing >= 0) {
				rows[existing] = r.row;
			} else {
				rows.push(r.row);
			}
			renderTable();
			closeDrawer();
		});
	});

	function esc(s) {
		return String(s ?? '')
			.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
			.replace(/"/g,'&quot;');
	}

}(jQuery));
