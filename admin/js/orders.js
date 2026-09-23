/* admin/js/orders.js — orders list page */
(function ($) {
	'use strict';

	var ajaxUrl   = NC.adminUrl + '?route=orders/ajax';
	var statusUrl = NC.adminUrl + '?route=settings/ajax';
	var statuses  = [];
	var dt;
	var btnBulk = document.getElementById('btn-bulk-delete');

	// ── Load statuses then bootstrap table ───────────────────────────────────
	$.post(statusUrl, { action: 'os_list', csrf_token: getCsrfToken() }, function (r) {
		if (r.ok) statuses = r.rows;
		initTable();
	});

	function initTable() {
		dt = $('#ord-table').DataTable({
			stateSave: true,
			ajax: {
				url:  ajaxUrl,
				type: 'POST',
				data: function(d) {
					d.action = 'list';
					d.csrf_token = getCsrfToken();
					return d;
				},
				dataSrc: 'rows'
			},
			columns: [
				{   // 0 — Order #
					data: 'id',
					type: 'num',
					render: function (d, type) {
						if (type !== 'display') return +d;
						return '<strong>' + d + '</strong>';
					}
				},
				{   // 1 — Customer
					data: null,
					render: function (d, type) {
						var name = ((d.customer_name || '')).trim() || d.customer_email || '—';
						if (type === 'filter' || type === 'sort') return name + ' ' + (d.customer_email || '');
						return esc(name);
					}
				},
				{   // 2 — Type
					data: 'customer_id', orderable: false, searchable: false,
					render: function (d, type) {
						if (type !== 'display') return d ? 'Customer' : 'Guest';
						return d
							? '<span style="font-size:.78rem;font-weight:600;color:var(--nc-primary)">Customer</span>'
							: '<span style="font-size:.78rem;color:var(--nc-text-dim)">Guest</span>';
					}
				},
				{   // 3 — Date (sort by raw created_at)
					data: 'date_fmt',
					render: function (d, type, row) {
						return type === 'sort' ? row.created_at : esc(d);
					}
				},
				{   // 4 — Status (inline select, not sortable)
					data: 'status',
					orderable: false,
					render: function (d, type, row) {
						if (type !== 'display') return d;
						return statusSelect(row.id, d);
					}
				},
				{   // 4 — Total
					data: 'total',
					render: function (d, type) {
						if (type !== 'display') return parseFloat(d);
						return '<span style="float:right">$' + parseFloat(d).toFixed(2) + '</span>';
					}
				},
				{   // 5 — Checkbox
					data: null, orderable: false, searchable: false,
					render: function (d, type) {
						if (type !== 'display') return '';
						return '<input type="checkbox" class="row-chk" data-id="' + esc(d.id) + '">';
					}
				}
			],
			createdRow: function (row, data) {
				row.cells[0].classList.add('ord-id-cell');
				if (data.customer_id) row.cells[1].classList.add('ord-cust-cell');
			},
			order:      [[3, 'desc']],
			pageLength: 20,
			dom:        't<"ord-dt-bottom"ip>',
			language: { emptyTable: 'No orders found.' },
			initComplete: function () {
				var info = dt.page.info();
				document.getElementById('ord-count').textContent =
					info.recordsTotal + ' order' + (info.recordsTotal === 1 ? '' : 's');
			}
		});

		// Search
		document.getElementById('ord-search').addEventListener('input', function () {
			dt.search(this.value).draw();
		});
	}

	// ── Inline status change ─────────────────────────────────────────────────
	$(document).on('change', '#ord-table .status-select', function () {
		var sel     = this;
		var orderId = sel.dataset.orderId;
		var newSlug = sel.value;
		sel.classList.add('saving');
		$.post(ajaxUrl, { action: 'set_status', id: orderId, status: newSlug, csrf_token: getCsrfToken() }, function (r) {
			sel.classList.remove('saving');
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			applyStatusColor(sel, newSlug);
			// keep DT internal data in sync
			var row = dt.rows(function (i, d) { return String(d.id) === String(orderId); });
			if (row.any()) row.data()[0].status = newSlug;
		});
	});

	// ── Mark payment received (check/money order) ────────────────────────────
	document.getElementById('btn-ord-mark-paid').addEventListener('click', function () {
		var btn     = this;
		var orderId = btn.dataset.orderId;
		btn.disabled = true;
		$.post(ajaxUrl, { action: 'mark_paid', id: orderId, csrf_token: getCsrfToken() }, function (r) {
			btn.disabled = false;
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			SimpleNotification.success({ text: r.message });
			openOrderDrawer(orderId);      // refresh drawer + hide the button now that it's paid
			dt.ajax.reload(null, false);   // refresh the list's status column too, keep paging
		});
	});

	// ── Helpers ──────────────────────────────────────────────────────────────
	function statusColor(slug) {
		for (var i = 0; i < statuses.length; i++) {
			if (statuses[i].slug === slug) return statuses[i].color;
		}
		return '#6b7280';
	}

	function applyStatusColor(sel, slug) {
		var c = statusColor(slug);
		sel.style.backgroundColor = c + '1a';
		sel.style.color           = c;
		sel.style.borderColor     = c + '66';
	}

	function statusSelect(orderId, currentSlug) {
		var c    = statusColor(currentSlug);
		var html = '<select class="status-select" data-order-id="' + orderId + '" '
			+ 'style="background-color:' + c + '1a;color:' + c + ';border-color:' + c + '66">';
		statuses.forEach(function (s) {
			html += '<option value="' + esc(s.slug) + '"'
				+ (s.slug === currentSlug ? ' selected' : '') + '>'
				+ esc(s.label) + '</option>';
		});
		html += '</select>';
		return html;
	}

	function esc(s) {
		return String(s ?? '')
			.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
			.replace(/"/g,'&quot;');
	}

	// ── Order detail drawer ──────────────────────────────────────────────────
	var ordDrawer  = document.getElementById('ord-drawer');
	var ordOverlay = document.getElementById('drawer-overlay');

	var ordMsgSend       = document.getElementById('ord-msg-send');
	var ordReceiptLink   = document.getElementById('ord-receipt-link');
	var ordLabelLink     = document.getElementById('ord-label-link');
	var ordLabelGenerate = document.getElementById('ord-label-generate');
	var ordActiveTab     = 'details';
	var ordCurrentEmail  = '';
	var ordCurrentRow    = null;

	function openOrderDrawer(id) {
		document.getElementById('ord-drawer-title').textContent = 'Order ' + id;
		document.getElementById('ord-detail-loading').style.display = '';
		document.getElementById('ord-detail-body').style.display   = 'none';
		ordReceiptLink.href = NC.adminUrl + '?route=orders/receipt&id=' + id;
		ordReceiptLink.style.display = 'none';
		ordLabelLink.style.display     = 'none';
		ordLabelGenerate.style.display = 'none';
		ordMsgSend.style.display = 'none';
		switchOrdTab('details');
		ordDrawer.classList.add('open');
		ordOverlay.classList.add('show');

		var fd = new FormData();
		fd.append('action', 'get');
		fd.append('id', id);
		fd.append('csrf_token', getCsrfToken());
		fetch(ajaxUrl, { method: 'POST', body: fd })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				if (!res.ok) { SimpleNotification.error({ text: res.message }); return; }
				populateOrderDrawer(res.row, res.items || []);
			});
	}

	function switchOrdTab(tab) {
		ordActiveTab = tab;
		document.querySelectorAll('#ord-drawer .drawer-tab').forEach(function (btn) {
			btn.classList.toggle('active', btn.dataset.ordTab === tab);
		});
		document.getElementById('ord-panel-details').classList.toggle('active', tab === 'details');
		document.getElementById('ord-panel-message').classList.toggle('active', tab === 'message');
		ordMsgSend.style.display    = tab === 'message' ? '' : 'none';
		ordReceiptLink.style.display = tab === 'details' ? '' : 'none';
	}

	document.querySelectorAll('#ord-drawer .drawer-tab').forEach(function (btn) {
		btn.addEventListener('click', function () { switchOrdTab(this.dataset.ordTab); });
	});

	function populateOrderDrawer(o, items) {
		var name = (o.customer_name || '').trim() || '—';
		ordCurrentEmail = o.customer_email || '';
		document.getElementById('ord-d-customer').textContent    = name;
		document.getElementById('ord-d-email').textContent       = ordCurrentEmail;
		document.getElementById('ord-d-date').textContent        = o.date_fmt || '';
		document.getElementById('ord-d-ship-method').textContent = o.ship_method || '—';
		document.getElementById('ord-d-payment-ref').textContent = o.payment_ref  || '—';

		var markPaidRow = document.getElementById('ord-d-mark-paid-row');
		var showMarkPaid = o.payment_method === 'check' && o.status !== 'paid';
		markPaidRow.style.display = showMarkPaid ? '' : 'none';
		document.getElementById('btn-ord-mark-paid').dataset.orderId = o.id;

		var addr = [
			[o.ship_firstname, o.ship_lastname].filter(Boolean).join(' '),
			o.ship_address1,
			o.ship_address2,
			[o.ship_city, o.ship_state, o.ship_zip].filter(Boolean).join(', '),
			o.ship_country,
		].filter(Boolean).join('<br>');
		document.getElementById('ord-d-address').innerHTML = addr || '—';

		var tbody = document.getElementById('ord-d-items');
		tbody.innerHTML = '';
		items.forEach(function (item) {
			var tr = document.createElement('tr');
			var label = esc(item.name) + (item.options_summary ? '<br><small style="color:var(--nc-text-dim)">' + esc(item.options_summary) + '</small>' : '');
			var line  = (parseFloat(item.price) * parseInt(item.qty, 10)).toFixed(2);
			tr.innerHTML = '<td>' + label + '</td>'
				+ '<td style="text-align:center">' + esc(item.qty) + '</td>'
				+ '<td style="text-align:right">$' + parseFloat(item.price).toFixed(2) + '</td>'
				+ '<td style="text-align:right">$' + line + '</td>';
			tbody.appendChild(tr);
		});

		document.getElementById('ord-d-subtotal').textContent = '$' + parseFloat(o.subtotal || 0).toFixed(2);
		document.getElementById('ord-d-shipping').textContent = '$' + parseFloat(o.shipping || 0).toFixed(2);
		document.getElementById('ord-d-total').textContent    = '$' + parseFloat(o.total    || 0).toFixed(2);

		ordCurrentRow = o;

		// Label buttons: show Print Label if a label was already bought, otherwise
		// always offer Generate Label — the backend will quote a fresh rate itself
		// if the order has no shippo_rate_token yet (e.g. free/flat-rate shipping).
		if (o.label_url) {
			ordLabelLink.href          = o.label_url;
			ordLabelLink.style.display = '';
			ordLabelGenerate.style.display = 'none';
		} else {
			ordLabelLink.style.display     = 'none';
			ordLabelGenerate.style.display = '';
		}

		document.getElementById('ord-detail-loading').style.display = 'none';
		document.getElementById('ord-detail-body').style.display    = '';
		ordReceiptLink.style.display = '';
	}

	function closeOrderDrawer() {
		ordDrawer.classList.remove('open');
		ordOverlay.classList.remove('show');
		document.getElementById('ord-msg-subject').value = '';
		document.getElementById('ord-msg-body').value    = '';
	}

	debounceBtn(ordLabelGenerate, async function () {
		if (!ordCurrentRow) return;
		ordLabelGenerate.textContent = 'Generating…';
		var fd = new FormData();
		fd.append('order_id',          ordCurrentRow.id);
		fd.append('shippo_rate_token', ordCurrentRow.shippo_rate_token);
		fd.append('csrf_token',        getCsrfToken());
		var res = await fetch(NC.adminUrl + '?route=goshippo/label', { method: 'POST', body: fd }).then(function (r) { return r.json(); });
		ordLabelGenerate.textContent = 'Generate Label';
		if (!res.ok) { SimpleNotification.error({ text: res.message || 'Label generation failed.' }); return; }
		ordCurrentRow.label_url = res.label_url;
		ordCurrentRow.tracking_number = res.tracking_number;
		ordCurrentRow.tracking_url    = res.tracking_url;
		ordLabelLink.href          = res.label_url;
		ordLabelLink.style.display = '';
		ordLabelGenerate.style.display = 'none';
		window.open(res.label_url, '_blank');
		SimpleNotification.success({ text: 'Label generated.' });
	});

	debounceBtn(ordMsgSend, function () {
		var subject = document.getElementById('ord-msg-subject').value.trim();
		var body    = document.getElementById('ord-msg-body').value.trim();
		if (!subject) { SimpleNotification.error({ text: 'Subject is required.' }); document.getElementById('ord-msg-subject').focus(); return; }
		if (!body)    { SimpleNotification.error({ text: 'Message body is required.' }); return; }
		var fd = new FormData();
		fd.append('action', 'send_message');
		fd.append('email', ordCurrentEmail);
		fd.append('subject', subject);
		fd.append('body', '<p>' + body.replace(/\n/g, '<br>') + '</p>');
		fd.append('csrf_token', getCsrfToken());
		fetch(ajaxUrl, { method: 'POST', body: fd })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				if (!res.ok) { SimpleNotification.error({ text: res.message }); return; }
				SimpleNotification.success({ text: res.message });
				closeOrderDrawer();
			});
	});

	document.getElementById('ord-drawer-close').addEventListener('click', closeOrderDrawer);
	document.getElementById('ord-drawer-cancel').addEventListener('click', closeOrderDrawer);
	ordOverlay.addEventListener('click', function () {
		if (peekDrawer && peekDrawer.classList.contains('open')) closePeekDrawer();
		else closeOrderDrawer();
	});

	document.addEventListener('click', function (e) {
		var idCell = e.target.closest('#ord-table td.ord-id-cell');
		if (idCell) {
			var row = dt.row(idCell.closest('tr')).data();
			if (row) openOrderDrawer(row.id);
			return;
		}
		var custCell = e.target.closest('#ord-table td.ord-cust-cell');
		if (custCell) {
			var row2 = dt.row(custCell.closest('tr')).data();
			if (row2 && row2.customer_id) openCustomer(row2.customer_id);
		}
	});

	// ── Customer peek drawer ────────────────────────────────────────────────
	var custUrl      = NC.adminUrl + '?route=customers/ajax';
	var peekDrawer   = document.getElementById('cust-peek-drawer');
	var peekSendBtn  = document.getElementById('cust-peek-send');
	var peekCustomerId = null;
	var peekActiveTab  = 'info';

	function openCustomer(customerId) {
		peekCustomerId = customerId;
		peekActiveTab  = 'info';
		document.getElementById('cust-peek-loading').style.display = '';
		document.getElementById('cust-peek-body').style.display    = 'none';
		peekSendBtn.style.display = 'none';
		peekDrawer.classList.add('open');
		ordOverlay.classList.add('show');
		switchPeekTab('info');

		var fd = new FormData();
		fd.append('action', 'get');
		fd.append('id', customerId);
		fd.append('csrf_token', getCsrfToken());
		fetch(custUrl, { method: 'POST', body: fd })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				if (!res.ok) { SimpleNotification.error({ text: res.message }); return; }
				populateCustomerPeek(res.row);
			});
	}

	function populateCustomerPeek(c) {
		var name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
		document.getElementById('cust-peek-title').textContent      = name;
		document.getElementById('cust-peek-name').textContent       = name;
		document.getElementById('cust-peek-email').textContent      = c.email || '—';
		document.getElementById('cust-peek-registered').textContent = c.registered || '—';
		document.getElementById('cust-peek-status').textContent     = c.status == 1 ? 'Active' : 'Inactive';
		document.getElementById('cust-peek-status').style.color     = c.status == 1 ? 'var(--nc-success)' : 'var(--nc-danger)';

		var addr = [
			c.address1, c.address2,
			[c.city, c.state, c.zip].filter(Boolean).join(', '),
			c.country,
		].filter(Boolean).join('<br>');
		document.getElementById('cust-peek-address').innerHTML = addr || '—';

		document.getElementById('cust-peek-loading').style.display = 'none';
		document.getElementById('cust-peek-body').style.display    = '';
	}

	function switchPeekTab(tab) {
		peekActiveTab = tab;
		document.querySelectorAll('#cust-peek-drawer .drawer-tab').forEach(function (btn) {
			btn.classList.toggle('active', btn.dataset.peekTab === tab);
		});
		document.getElementById('cust-peek-panel-info').classList.toggle('active',    tab === 'info');
		document.getElementById('cust-peek-panel-message').classList.toggle('active', tab === 'message');
		peekSendBtn.style.display = tab === 'message' ? '' : 'none';
	}

	document.querySelectorAll('#cust-peek-drawer .drawer-tab').forEach(function (btn) {
		btn.addEventListener('click', function () { switchPeekTab(this.dataset.peekTab); });
	});

	function closePeekDrawer() {
		peekDrawer.classList.remove('open');
		ordOverlay.classList.remove('show');
		document.getElementById('cust-peek-subject').value = '';
		document.getElementById('cust-peek-msg').value    = '';
	}

	document.getElementById('cust-peek-close').addEventListener('click', closePeekDrawer);
	document.getElementById('cust-peek-cancel').addEventListener('click', closePeekDrawer);

	debounceBtn(peekSendBtn, function () {
		var subject = document.getElementById('cust-peek-subject').value.trim();
		var body    = document.getElementById('cust-peek-msg').value.trim();
		if (!subject) { SimpleNotification.error({ text: 'Subject is required.' }); document.getElementById('cust-peek-subject').focus(); return; }
		if (!body)    { SimpleNotification.error({ text: 'Message body is required.' }); return; }
		var fd = new FormData();
		fd.append('action', 'send_message');
		fd.append('customer_id', peekCustomerId);
		fd.append('subject', subject);
		fd.append('body', '<p>' + body.replace(/\n/g, '<br>') + '</p>');
		fd.append('csrf_token', getCsrfToken());
		fetch(custUrl, { method: 'POST', body: fd })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				if (!res.ok) { SimpleNotification.error({ text: res.message }); return; }
				SimpleNotification.success({ text: res.message });
				closePeekDrawer();
			});
	});

	// ── Select-all checkbox ──────────────────────────────────────────────────
	document.addEventListener('change', function (e) {
		if (e.target.id === 'chk-all') {
			document.querySelectorAll('#ord-table .row-chk').forEach(function (c) {
				c.checked = e.target.checked;
			});
		}
		if (e.target.classList.contains('row-chk') || e.target.id === 'chk-all') {
			updateBulkBtn();
		}
	});

	function updateBulkBtn() {
		var n = document.querySelectorAll('#ord-table .row-chk:checked').length;
		btnBulk.disabled    = n === 0;
		btnBulk.textContent = n > 0 ? 'Delete Selected (' + n + ')' : 'Delete Selected';
	}

	// ── Bulk delete ──────────────────────────────────────────────────────────
	debounceBtn(btnBulk, async function () {
		var ids = Array.from(document.querySelectorAll('#ord-table .row-chk:checked'))
			.map(function (c) { return c.dataset.id; });
		if (!ids.length) return;
		const fd = new FormData();
		fd.append('action', 'bulk_delete');
		fd.append('ids', JSON.stringify(ids));
		fd.append('csrf_token', getCsrfToken());
		const res = await fetch(ajaxUrl, { method: 'POST', body: fd }).then(function (r) { return r.json(); });
		if (!res.ok) { SimpleNotification.error({ text: res.message }); return; }
		var dtRows = dt.rows(function (i, row) { return ids.indexOf(String(row.id)) !== -1; });
		Array.from(dtRows.nodes()).forEach(function (trEl) { animateDelete(trEl, function () {}); });
		setTimeout(function () {
			dtRows.remove().draw(false);
			var chkAll = document.getElementById('chk-all');
			if (chkAll) chkAll.checked = false;
			updateBulkBtn();
			var info = dt.page.info();
			document.getElementById('ord-count').textContent =
				info.recordsTotal + ' order' + (info.recordsTotal === 1 ? '' : 's');
		}, 350);
	});

}(jQuery));
