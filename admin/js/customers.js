/* global SimpleNotification, debounceBtn, jQuery */
(function () {
	'use strict';

	const AJAX    = NC.adminUrl + '?route=customers/ajax';
	const btnBulk = document.getElementById('btn-bulk-delete');
	const btnSave = document.getElementById('btn-drawer-save');
	const drawer  = document.getElementById('cust-drawer');
	const overlay = document.getElementById('drawer-overlay');

	var activeTab      = 'details';
	var ordersLoaded   = false;
	var msgEditorReady = false;

	function esc(str) {
		return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

	// ── ios-toggle helpers (bypass setter to avoid re-render race) ────────────
	function setToggle(el, on) {
		var cb = el ? el.querySelector('input[type=checkbox]') : null;
		var h  = el ? el.querySelector('input[type=hidden]')   : null;
		if (cb) cb.checked = !!on;
		if (h)  h.value    = on ? '1' : '0';
	}
	function getToggle(el) {
		var cb = el ? el.querySelector('input[type=checkbox]') : null;
		return (cb && cb.checked) ? 1 : 0;
	}

	// ── DataTables ────────────────────────────────────────────────────────────
	var dt = jQuery('#cust-table').DataTable({
		pageLength: 10,
		order:      [[0, 'asc']],
		stateSave:  true,   // sort by name col (uses last_name for sort)
		autoWidth:  false,
		dom:        't<"cust-dt-bottom"ip>',
		language: {
			emptyTable:   'No customers found.',
			zeroRecords:  'No customers match that search.',
			info:         'Showing _START_–_END_ of _TOTAL_',
			infoEmpty:    'No customers',
			infoFiltered: '(filtered from _MAX_)',
		},
		createdRow: function (row) {
			row.cells[0].classList.add('cust-name-cell');
		},
		columns: [
			{
				// Name — sorted by last_name, filtered by first+last (email covered by col 2)
				data: null,
				render: function (d, type) {
					if (type === 'sort')   return (d.last_name || '\xff') + '\x00' + (d.first_name || '');
					if (type === 'filter') return (d.first_name || '') + ' ' + (d.last_name || '');
					var name = [d.first_name, d.last_name].filter(Boolean).map(esc).join(' ');
					return '<button class="cust-name-link" data-id="' + esc(d.id) + '">'
					     + (name || '<em style="opacity:.5">No name</em>') + '</button>';
				}
			},
			{ data: 'email' },
			{
				data: 'status', orderable: false, searchable: false,
				render: function (val, type, row) {
					if (type !== 'display') return val;
					return '<ios-toggle ' + (val == 1 ? 'checked' : '') + ' size="sm"'
					     + ' data-id="' + esc(row.id) + '" data-field="status"></ios-toggle>';
				}
			},
			{
				data: 'registered_iso', searchable: false,
				render: function (val, type, row) {
					if (type === 'display') return esc(row.registered || val || '');
					return val || '';
				}
			},
			{
				data: null, orderable: false, searchable: false,
				render: function (d, type) {
					if (type !== 'display') return '';
					return '<delete-in-place caption="&#128465;" confirm="Delete?" data-id="'
					     + esc(d.id) + '"></delete-in-place>';
				}
			},
			{
				data: null, orderable: false, searchable: false,
				render: function (d, type) {
					if (type !== 'display') return '';
					return '<input type="checkbox" class="row-chk" data-id="' + esc(d.id) + '">';
				}
			}
		]
	});

	// Search input wired manually (sits in toolbar, not inside DT dom)
	document.getElementById('cust-search').addEventListener('input', function () {
		dt.search(this.value).draw();
	});

	// ── Load ──────────────────────────────────────────────────────────────────
	async function loadCustomers() {
		const res = await ajax({ action: 'list' });
		if (!res.ok) { notifyErr(res.message); return; }
		dt.rows.add(res.rows).draw(false);
	}

	function updateRow(d) {
		dt.rows(function (i, row) { return row.id == d.id; }).remove();
		dt.rows.add([d]).draw(false);
	}

	// ── Tabs ──────────────────────────────────────────────────────────────────
	document.querySelectorAll('.drawer-tab').forEach(function (btn) {
		btn.addEventListener('click', function () { switchTab(this.dataset.panel); });
	});

	function switchTab(panel) {
		activeTab = panel;
		document.querySelectorAll('.drawer-tab').forEach(function (t) {
			t.classList.toggle('active', t.dataset.panel === panel);
		});
		document.querySelectorAll('.drawer-tab-panel').forEach(function (p) {
			p.classList.toggle('active', p.id === 'cust-panel-' + panel);
		});
		if (panel === 'orders')  onOrdersTabOpen();
		if (panel === 'message') onMessageTabOpen();
		if (panel === 'details') {
			btnSave.setLabel('Save Customer');
			btnSave.style.display = '';
		} else if (panel === 'message') {
			btnSave.setLabel('Send Message');
			btnSave.style.display = '';
		} else {
			btnSave.style.display = 'none';
		}
		document.dispatchEvent(new CustomEvent('nc-drawer-tab', {detail: {
			page: 'customer', panel, customerId: document.getElementById('cust-id')?.value || ''
		}}));
	}

	// ── Drawer open / close ───────────────────────────────────────────────────
	function openDrawer(title) {
		document.getElementById('drawer-title').textContent = title;
		drawer.classList.add('open');
		overlay.classList.add('show');
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
	}

	function resetDrawer(isNew) {
		switchTab('details');
		ordersLoaded = false;
		['cust-id','cust-first-name','cust-last-name','cust-email','cust-password',
		 'cust-address1','cust-address2','cust-city','cust-state','cust-zip',
		 'cust-country','cust-notes','cust-msg-subject'].forEach(function (id) {
			var el = document.getElementById(id);
			if (el) el.value = '';
		});
		setToggle(document.getElementById('cust-status'), true);

		var pwLabel = document.getElementById('cust-password-label');
		var pwStar  = document.getElementById('cust-pw-star');
		var pwInput = document.getElementById('cust-password');
		if (isNew) {
			if (pwLabel) pwLabel.firstChild.textContent = 'Password ';
			if (pwStar)  pwStar.style.display = '';
			if (pwInput) pwInput.required = true;
		} else {
			if (pwLabel) pwLabel.firstChild.textContent = 'New Password ';
			if (pwStar)  pwStar.style.display = 'none';
			if (pwInput) pwInput.required = false;
		}

		if (msgEditorReady) jQuery('#cust-msg-body').trumbowyg('html', '');
		else document.getElementById('cust-msg-body').value = '';

		document.getElementById('cust-orders-loading').style.display = '';
		document.getElementById('cust-orders-table').style.display   = 'none';
		document.getElementById('cust-orders-empty').style.display   = 'none';
		document.getElementById('cust-orders-tbody').innerHTML       = '';
	}

	function addCustomer() {
		resetDrawer(true);
		openDrawer('Add Customer');
		document.getElementById('cust-first-name').focus();
	}

	document.getElementById('btn-add-customer').addEventListener('click', addCustomer);

	// ── Edit (delegated — DT manages tbody DOM) ───────────────────────────────
	document.addEventListener('click', function (e) {
		var btn = e.target.closest('#cust-table .cust-name-link');
		if (!btn) return;
		openEdit(btn.dataset.id);
	});

	async function openEdit(id) {
		const res = await ajax({ action: 'get', id: id });
		if (!res.ok) { notifyErr(res.message); return; }
		const d = res.row;
		resetDrawer(false);
		document.getElementById('cust-id').value         = d.id;
		document.getElementById('cust-first-name').value = d.first_name || '';
		document.getElementById('cust-last-name').value  = d.last_name  || '';
		document.getElementById('cust-email').value      = d.email;
		document.getElementById('cust-address1').value   = d.address1   || '';
		document.getElementById('cust-address2').value   = d.address2   || '';
		document.getElementById('cust-city').value       = d.city       || '';
		document.getElementById('cust-state').value      = d.state      || '';
		document.getElementById('cust-zip').value        = d.zip        || '';
		document.getElementById('cust-country').value    = d.country    || '';
		document.getElementById('cust-notes').value      = d.notes      || '';
		setToggle(document.getElementById('cust-status'), d.status == 1);
		openDrawer('Edit Customer');
	}

	// ── Save / Send ───────────────────────────────────────────────────────────
	btnSave.addEventListener('save', async function () {
		this.setLoading();
		if (activeTab === 'message') await doSendMessage(this);
		else await doSaveCustomer(this);
	});

	async function doSaveCustomer(btn) {
		const emailEl = document.getElementById('cust-email');
		if (!emailEl.reportValidity()) { btn.reset(); return; }
		const id      = document.getElementById('cust-id').value;
		const pwInput = document.getElementById('cust-password');
		if (!id && pwInput && !pwInput.value.trim()) {
			notifyErr('A password is required for new customers.');
			pwInput.focus();
			btn.reset();
			return;
		}
		const res = await ajax({
			action:     'save',
			id:         id,
			first_name: document.getElementById('cust-first-name').value.trim(),
			last_name:  document.getElementById('cust-last-name').value.trim(),
			email:      emailEl.value.trim(),
			password:   pwInput ? pwInput.value : '',
			status:     getToggle(document.getElementById('cust-status')),
			address1:   document.getElementById('cust-address1').value.trim(),
			address2:   document.getElementById('cust-address2').value.trim(),
			city:       document.getElementById('cust-city').value.trim(),
			state:      document.getElementById('cust-state').value.trim(),
			zip:        document.getElementById('cust-zip').value.trim(),
			country:    document.getElementById('cust-country').value.trim(),
			notes:      document.getElementById('cust-notes').value.trim(),
		});
		if (!res.ok) { notifyErr(res.message); btn.reset(); return; }
		updateRow(res.row);
		btn.showSuccess();
		setTimeout(() => closeDrawer(), 1500);
	}

	async function doSendMessage(btn) {
		const subject = document.getElementById('cust-msg-subject').value.trim();
		const body    = msgEditorReady
			? jQuery('#cust-msg-body').trumbowyg('html')
			: document.getElementById('cust-msg-body').value;
		const custId  = document.getElementById('cust-id').value;
		if (!custId)  { notifyErr('Save the customer first.'); btn.reset(); return; }
		if (!subject) { notifyErr('Subject is required.'); document.getElementById('cust-msg-subject').focus(); btn.reset(); return; }
		if (!body || !body.trim()) { notifyErr('Message body is required.'); btn.reset(); return; }
		const res = await ajax({ action: 'send_message', customer_id: custId, subject, body });
		if (!res.ok) { notifyErr(res.message); btn.reset(); return; }
		document.getElementById('cust-msg-subject').value = '';
		if (msgEditorReady) jQuery('#cust-msg-body').trumbowyg('html', '');
		else document.getElementById('cust-msg-body').value = '';
		btn.showSuccess();
	}

	document.getElementById('drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);
	overlay.addEventListener('click', closeDrawer);

	// ── Orders tab ────────────────────────────────────────────────────────────
	function onOrdersTabOpen() {
		if (ordersLoaded) return;
		const custId = document.getElementById('cust-id').value;
		if (!custId) {
			document.getElementById('cust-orders-loading').style.display = 'none';
			var emp = document.getElementById('cust-orders-empty');
			emp.textContent  = 'Save the customer first to view order history.';
			emp.style.display = '';
			return;
		}
		loadOrders(custId);
	}

	async function loadOrders(custId) {
		const res = await ajax({ action: 'orders', customer_id: custId });
		document.getElementById('cust-orders-loading').style.display = 'none';
		if (!res.ok) { notifyErr(res.message); return; }
		ordersLoaded = true;
		const orders = res.orders || [];
		if (!orders.length) { document.getElementById('cust-orders-empty').style.display = ''; return; }
		const tbody2 = document.getElementById('cust-orders-tbody');
		tbody2.innerHTML = '';
		orders.forEach(function (o) {
			var tr = document.createElement('tr');
			tr.innerHTML =
				'<td>#' + esc(o.id) + '</td>' +
				'<td>' + esc(o.date_fmt) + '</td>' +
				'<td>' + esc(o.status)   + '</td>' +
				'<td style="text-align:right">$' + parseFloat(o.total || 0).toFixed(2) + '</td>';
			tbody2.appendChild(tr);
		});
		document.getElementById('cust-orders-table').style.display = '';
	}

	// ── Message tab / Trumbowyg ───────────────────────────────────────────────
	function onMessageTabOpen() {
		if (msgEditorReady || !window.jQuery || !jQuery.fn.trumbowyg) return;
		jQuery('#cust-msg-body').trumbowyg({
			svgPath: '/js/vendor/trumbowyg/src/ui/icons.svg',
			semantic: false,
			btns: [['bold', 'italic', 'underline'], ['link'], ['unorderedList', 'orderedList'], ['viewHTML']]
		});
		msgEditorReady = true;
	}

	// ── Inline ios-toggle (status) ────────────────────────────────────────────
	var toggleTimers = {};
	document.addEventListener('ios-toggle', function (e) {
		const src = e.detail.source;
		if (!src || !src.dataset.id || !src.dataset.field) return;
		// Keep DT internal data in sync so sort/page redraw uses correct value
		var tr = src.closest('tr');
		if (tr) {
			var rowData = dt.row(tr).data();
			if (rowData) rowData[src.dataset.field] = parseInt(e.detail.value);
		}
		const id = src.dataset.id, field = src.dataset.field, value = e.detail.value;
		clearTimeout(toggleTimers[id]);
		toggleTimers[id] = setTimeout(function () {
			ajax({ action: 'toggle', id: id, field: field, value: value });
		}, 1000);
	});

	// ── Delete (delegated) ────────────────────────────────────────────────────
	document.addEventListener('dip-confirm', function (e) {
		if (!e.target.closest('#cust-table')) return;
		var id = e.detail['data-id'];
		ajax({ action: 'delete', id: id }).then(function (res) {
			if (!res.ok) { notifyErr(res.message); return; }
			var dtRow = dt.rows(function (i, r) { return r.id == id; });
			var trEl  = dtRow.nodes()[0];
			if (trEl) {
				animateDelete(trEl, function () { dtRow.remove().draw(false); updateBulkBtn(); });
			} else {
				dtRow.remove().draw(false);
				updateBulkBtn();
			}
		});
	});

	// ── Bulk delete ───────────────────────────────────────────────────────────
	document.addEventListener('change', function (e) {
		if (e.target.id === 'chk-all') {
			document.querySelectorAll('#cust-table .row-chk').forEach(function (c) {
				c.checked = e.target.checked;
			});
		}
		if (e.target.classList.contains('row-chk') || e.target.id === 'chk-all') updateBulkBtn();
	});

	function updateBulkBtn() {
		var n = document.querySelectorAll('#cust-table .row-chk:checked').length;
		btnBulk.disabled    = n === 0;
		btnBulk.textContent = n > 0 ? 'Delete Selected (' + n + ')' : 'Delete Selected';
	}

	debounceBtn(btnBulk, async function () {
		var ids = Array.from(document.querySelectorAll('#cust-table .row-chk:checked'))
			.map(function (c) { return c.dataset.id; });
		if (!ids.length) return;
		const res = await ajax({ action: 'bulk_delete', ids: JSON.stringify(ids) });
		if (!res.ok) { notifyErr(res.message); return; }
		var dtRows = dt.rows(function (i, row) { return ids.indexOf(String(row.id)) !== -1; });
		Array.from(dtRows.nodes()).forEach(function (trEl) { animateDelete(trEl, function () {}); });
		setTimeout(function () { dtRows.remove().draw(false); document.getElementById('chk-all').checked = false; updateBulkBtn(); }, 350);
	});

	// Hard-load: check URL for ?open=
	var openId = new URLSearchParams(location.search).get('open');
	if (openId) openEdit(openId);
	loadCustomers();

	// SPA navigation: listen for nc:navigate fired by the SPA router
	window.addEventListener('nc:navigate', function(e) {
		var u = new URL(e.detail.url, location.origin);
		if (u.searchParams.get('route') !== 'customers') return;
		var id = u.searchParams.get('open');
		if (id) openEdit(id);
	});
}());
