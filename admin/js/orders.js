/* admin/js/orders.js - orders list page */
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
				{   // 0 - Order #
					data: 'id',
					type: 'num',
					render: function (d, type) {
						if (type !== 'display') return +d;
						return '<strong>' + d + '</strong>';
					}
				},
				{   // 1 - Customer
					data: null,
					render: function (d, type) {
						var name = ((d.customer_name || '')).trim() || d.customer_email || '-';
						if (type === 'filter' || type === 'sort') return name + ' ' + (d.customer_email || '');
						return esc(name);
					}
				},
				{   // 2 - Type
					data: 'customer_id', orderable: false, searchable: false,
					render: function (d, type) {
						if (type !== 'display') return d ? 'Customer' : 'Guest';
						return d
							? '<span style="font-size:.78rem;font-weight:600;color:var(--nc-primary)">Customer</span>'
							: '<span style="font-size:.78rem;color:var(--nc-text-dim)">Guest</span>';
					}
				},
				{   // 3 - Date (sort by raw created_at)
					data: 'date_fmt',
					render: function (d, type, row) {
						return type === 'sort' ? row.created_at : esc(d);
					}
				},
				{   // 4 - Status (inline select, not sortable)
					data: 'status',
					orderable: false,
					render: function (d, type, row) {
						if (type !== 'display') return d;
						return statusSelect(row.id, d);
					}
				},
				{   // 4 - Total
					data: 'total',
					render: function (d, type) {
						if (type !== 'display') return parseFloat(d);
						return '<span style="float:right">$' + parseFloat(d).toFixed(2) + '</span>';
					}
				},
				{   // 5 - Checkbox
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
		oeId = id;
		oeSetTabsVisible(true);
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
				renderMsgHistory(res.messages || []);
			});
	}

	function switchOrdTab(tab) {
		ordActiveTab = tab;
		document.querySelectorAll('#ord-drawer .drawer-tab').forEach(function (btn) {
			btn.classList.toggle('active', btn.dataset.ordTab === tab);
		});
		document.getElementById('ord-panel-details').classList.toggle('active', tab === 'details');
		document.getElementById('ord-panel-message').classList.toggle('active', tab === 'message');
		document.getElementById('ord-panel-edit').classList.toggle('active', tab === 'edit');
		ordMsgSend.style.display    = tab === 'message' ? '' : 'none';
		document.getElementById('ord-edit-save').style.display = tab === 'edit' ? '' : 'none';
		ordReceiptLink.style.display = (tab === 'details' && oeId) ? '' : 'none';
	}

	document.querySelectorAll('#ord-drawer .drawer-tab').forEach(function (btn) {
		btn.addEventListener('click', function () { switchOrdTab(this.dataset.ordTab); });
	});

	function populateOrderDrawer(o, items) {
		var name = (o.customer_name || '').trim() || '-';
		ordCurrentEmail = o.customer_email || '';
		document.getElementById('ord-msg-to').value = ordCurrentEmail;
		document.getElementById('ord-d-customer').textContent    = name;
		document.getElementById('ord-d-email').textContent       = ordCurrentEmail;
		document.getElementById('ord-d-date').textContent        = o.date_fmt || '';
		document.getElementById('ord-d-ship-method').textContent = o.ship_method || '-';
		document.getElementById('ord-d-payment-ref').textContent = o.payment_ref  || '-';

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
		].filter(Boolean).map(esc).join('<br>');
		document.getElementById('ord-d-address').innerHTML = addr || '-';

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
		oePopulate(o, items);
		document.dispatchEvent(new CustomEvent('nc:order-opened', { detail: { id: o.id } }));

		// Label buttons: show Print Label if a label was already bought, otherwise
		// always offer Generate Label - the backend will quote a fresh rate itself
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

	function renderMsgHistory(msgs) {
		var box = document.getElementById('ord-msg-history');
		if (!msgs.length) {
			box.innerHTML = '<p class="ord-msg-empty">No messages have been sent for this order.</p>';
			return;
		}
		box.innerHTML = msgs.map(function (m) {
			var meta = [m.date_fmt, 'to ' + m.to_email, m.sent_by ? 'by ' + m.sent_by : '', m.source].filter(Boolean).map(esc).join(' · ');
			return '<details class="ord-msg-item"><summary>' + esc(m.subject || '(no subject)')
				+ (m.result === 'failed' ? ' <span class="ord-msg-failed">Not sent</span>' : '')
				+ '<span class="ord-msg-meta">' + meta + '</span></summary>'
				+ '<div class="ord-msg-text">' + esc(m.body) + '</div></details>';
		}).join('');
	}

	function closeOrderDrawer() {
		ordDrawer.classList.remove('open');
		ordOverlay.classList.remove('show');
		document.getElementById('ord-msg-subject').value = '';
		document.getElementById('ord-msg-body').value    = '';
		document.getElementById('ord-msg-to').value      = '';
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
		fd.append('order_id', oeId);
		fd.append('email', document.getElementById('ord-msg-to').value.trim());
		fd.append('subject', subject);
		fd.append('body', '<p>' + body.replace(/\n/g, '<br>') + '</p>');
		fd.append('csrf_token', getCsrfToken());
		fetch(ajaxUrl, { method: 'POST', body: fd })
			.then(function (r) { return r.json(); })
			.then(function (res) {
				if (res.messages) renderMsgHistory(res.messages);
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
		var name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '-';
		document.getElementById('cust-peek-title').textContent      = name;
		document.getElementById('cust-peek-name').textContent       = name;
		document.getElementById('cust-peek-email').textContent      = c.email || '-';
		document.getElementById('cust-peek-registered').textContent = c.registered || '-';
		document.getElementById('cust-peek-status').textContent     = c.status == 1 ? 'Active' : 'Inactive';
		document.getElementById('cust-peek-status').style.color     = c.status == 1 ? 'var(--nc-success)' : 'var(--nc-danger)';

		var addr = [
			c.address1, c.address2,
			[c.city, c.state, c.zip].filter(Boolean).join(', '),
			c.country,
		].filter(Boolean).map(esc).join('<br>');
		document.getElementById('cust-peek-address').innerHTML = addr || '-';

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

	// ── Edit tab / new order ─────────────────────────────────────────────────
	var oeId = 0;            // 0 = creating a new order
	var oeToken = '';        // Shippo rate token for the chosen live rate
	var oeItemsBody = document.getElementById('oe-items');
	var oeSaveBtn = document.getElementById('ord-edit-save');

	function oeSetTabsVisible(all) {
		document.querySelectorAll('#ord-drawer .drawer-tab').forEach(function (b) {
			b.style.display = (all || b.dataset.ordTab === 'edit') ? '' : 'none';
		});
	}

	function oeVal(id) { return document.getElementById(id).value; }
	function oeSet(id, v) { document.getElementById(id).value = v == null ? '' : v; }
	function oeMoney(n) { return '$' + (isFinite(n) ? n : 0).toFixed(2); }
	function oeNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

	function oeAddRow(it) {
		var tr = document.createElement('tr');
		var defs = it.option_defs || [];
		var sel  = {};
		if (it.selected) Object.keys(it.selected).forEach(function (k) { sel[k] = it.selected[k]; });
		tr.dataset.productId  = it.product_id || 0;
		tr.dataset.selections = JSON.stringify(sel);
		var opts = '<input type="text" class="oe-opts" maxlength="500" placeholder="Options (optional)" style="margin-top:.35rem" value="' + esc(it.options_summary || '') + '"'
			+ (defs.length ? ' readonly' : '') + '>';
		var selects = defs.map(function (d) {
			var h = '<select class="oe-optsel" data-po="' + d.po_id + '" style="margin-top:.35rem;width:100%"><option value="">' + esc(d.name) + ': choose…</option>';
			d.values.forEach(function (v) {
				if (!v.enabled && String(sel[d.po_id]) !== String(v.pov_id)) return;
				h += '<option value="' + v.pov_id + '"' + (String(sel[d.po_id]) === String(v.pov_id) ? ' selected' : '') + '>' + esc(d.name + ': ' + v.text) + '</option>';
			});
			return h + '</select>';
		}).join('');
		tr.innerHTML = '<td><input type="text" class="oe-name" maxlength="255" value="' + esc(it.name) + '">'
			+ selects + (defs.length ? '' : opts)
			+ (defs.length ? '<input type="hidden" class="oe-opts" value="' + esc(it.options_summary || '') + '">' : '')
			+ (it.unmatched ? '<div class="hint" style="margin-top:.35rem;color:#92400e">Saved options ("' + esc(it.options_summary) + '") could not be matched to this product\'s current options, so weight is the base weight. Pick options above or set the weight by hand.</div>' : '')
			+ '</td>'
			+ '<td><input type="number" class="oe-qty" min="1" step="1" value="' + (parseInt(it.qty, 10) || 1) + '"></td>'
			+ '<td><input type="number" class="oe-price" min="0" step="0.01" value="' + oeNum(it.price).toFixed(2) + '"></td>'
			+ '<td><input type="number" class="oe-wt" min="0" step="0.001" value="' + (it.weight == null || it.weight === '' ? '' : oeNum(it.weight)) + '"></td>'
			+ '<td><button type="button" class="drawer-close oe-rm" title="Remove item" style="font-size:1.2rem">&times;</button></td>';
		oeItemsBody.appendChild(tr);
	}

	function oeItems() {
		return Array.from(oeItemsBody.querySelectorAll('tr')).map(function (tr) {
			return {
				product_id: parseInt(tr.dataset.productId, 10) || 0,
				name: tr.querySelector('.oe-name').value.trim(),
				options_summary: tr.querySelector('.oe-opts').value.trim(),
				selections: JSON.parse(tr.dataset.selections || '{}'),
				qty: parseInt(tr.querySelector('.oe-qty').value, 10) || 0,
				price: tr.querySelector('.oe-price').value,
				weight: tr.querySelector('.oe-wt').value
			};
		});
	}

	// Fill the package fields from per-product sizes, stacked; user can still override
	var oePkgTimer = null;
	function oeSuggestPackage() {
		clearTimeout(oePkgTimer);
		oePkgTimer = setTimeout(function () {
			var items = oeItems().filter(function (i) { return i.product_id; });
			if (!items.length) return;
			oePost('package', { items: JSON.stringify(items) }).then(function (r) {
				if (!r.ok || !r.package) return;
				oeSet('oe-pkg-l', r.package.length); oeSet('oe-pkg-w', r.package.width); oeSet('oe-pkg-h', r.package.height);
			});
		}, 300);
	}

	function oeRecalc() {
		var sub = 0, wt = 0;
		oeItems().forEach(function (it) {
			sub += oeNum(it.price) * it.qty;
			wt  += oeNum(it.weight) * it.qty;
		});
		var total = Math.max(0, sub + oeNum(oeVal('oe-shipping')) + oeNum(oeVal('oe-tax')) - oeNum(oeVal('oe-discount')));
		document.getElementById('oe-subtotal').textContent = oeMoney(sub);
		document.getElementById('oe-total').textContent    = oeMoney(total);
		document.getElementById('oe-weight').textContent   = (Math.round(wt * 1000) / 1000).toString();
	}

	function oePopulate(o, items) {
		o = o || {}; items = items || [];
		oeSet('oe-first', o.ship_firstname); oeSet('oe-last', o.ship_lastname);
		oeSet('oe-email', o.ship_email || o.customer_email); oeSet('oe-phone', o.ship_phone);
		oeSet('oe-addr1', o.ship_address1); oeSet('oe-addr2', o.ship_address2);
		oeSet('oe-city', o.ship_city); oeSet('oe-state', o.ship_state);
		oeSet('oe-zip', o.ship_zip); oeSet('oe-country', o.ship_country || 'US');
		oeSet('oe-ship-method', o.ship_method);
		oeSet('oe-tracking', o.tracking_number);
		oeSet('oe-shipping', oeNum(o.shipping).toFixed(2));
		oeSet('oe-tax', oeNum(o.tax).toFixed(2));
		oeSet('oe-discount', oeNum(o.discount_amount).toFixed(2));
		oeToken = o.shippo_rate_token || '';
		oeItemsBody.innerHTML = '';
		items.forEach(oeAddRow);
		document.getElementById('oe-rates').innerHTML = '';
		document.getElementById('oe-prod-results').style.display = 'none';
		document.getElementById('oe-prod-search').value = '';
		document.getElementById('oe-paid-warn').style.display = (o.status === 'paid') ? '' : 'none';
		oeRecalc();
		oePost('parcel_defaults').then(function (r) {
			if (!r.ok) return;
			oeSet('oe-pkg-l', r.length); oeSet('oe-pkg-w', r.width); oeSet('oe-pkg-h', r.height);
			document.getElementById('oe-pkg-unit').textContent = r.dist;
			oeSuggestPackage();
		});
	}

	function oeAddressFields() {
		return {
			first_name: oeVal('oe-first'), last_name: oeVal('oe-last'),
			address1: oeVal('oe-addr1'), address2: oeVal('oe-addr2'),
			city: oeVal('oe-city'), state: oeVal('oe-state'),
			zip: oeVal('oe-zip'), country: oeVal('oe-country')
		};
	}

	function oePost(action, extra) {
		var fd = new FormData();
		fd.append('action', action);
		fd.append('csrf_token', getCsrfToken());
		Object.keys(extra || {}).forEach(function (k) { fd.append(k, extra[k]); });
		return fetch(ajaxUrl, { method: 'POST', body: fd }).then(function (r) { return r.json(); });
	}

	// New order
	document.getElementById('btn-new-order').addEventListener('click', function () {
		oeId = 0;
		document.getElementById('ord-drawer-title').textContent = 'New Order';
		document.getElementById('ord-detail-loading').style.display = 'none';
		document.getElementById('ord-detail-body').style.display    = '';
		ordReceiptLink.style.display = 'none';
		ordLabelLink.style.display = 'none';
		ordLabelGenerate.style.display = 'none';
		oePopulate({}, []);
		oeSetTabsVisible(false);
		switchOrdTab('edit');
		ordDrawer.classList.add('open');
		ordOverlay.classList.add('show');
	});

	// Live totals + editing the shipping fields by hand drops the live-rate token
	document.getElementById('ord-panel-edit').addEventListener('input', function (e) {
		if (e.target.id === 'oe-ship-method' || e.target.id === 'oe-shipping') oeToken = '';
		oeRecalc();
	});
	oeItemsBody.addEventListener('input', function (e) { if (e.target.classList.contains('oe-qty')) oeSuggestPackage(); });
	oeItemsBody.addEventListener('click', function (e) {
		var rm = e.target.closest('.oe-rm');
		if (rm) { rm.closest('tr').remove(); oeRecalc(); oeSuggestPackage(); }
	});
	// Changing an option re-prices and re-weighs the line the way checkout would
	oeItemsBody.addEventListener('change', function (e) {
		if (!e.target.classList.contains('oe-optsel')) return;
		var tr = e.target.closest('tr');
		var sel = {};
		tr.querySelectorAll('.oe-optsel').forEach(function (el) { if (el.value) sel[el.dataset.po] = el.value; });
		tr.dataset.selections = JSON.stringify(sel);
		oePost('resolve_item', { product_id: tr.dataset.productId, selections: JSON.stringify(sel) }).then(function (r) {
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			tr.querySelector('.oe-price').value = oeNum(r.unit_price).toFixed(2);
			tr.querySelector('.oe-wt').value    = oeNum(r.unit_weight);
			tr.querySelector('.oe-opts').value  = r.summary;
			oeRecalc();
		});
	});
	document.getElementById('oe-add-custom').addEventListener('click', function () {
		oeAddRow({ product_id: 0, name: '', qty: 1, price: 0, weight: '' });
		oeItemsBody.lastElementChild.querySelector('.oe-name').focus();
	});

	// Product search
	var oeSearchTimer = null;
	var oeResults = document.getElementById('oe-prod-results');
	document.getElementById('oe-prod-search').addEventListener('input', function () {
		var q = this.value.trim();
		clearTimeout(oeSearchTimer);
		if (q.length < 2) { oeResults.style.display = 'none'; return; }
		oeSearchTimer = setTimeout(function () {
			oePost('product_search', { q: q }).then(function (r) {
				if (!r.ok) return;
				oeResults.innerHTML = '';
				r.rows.forEach(function (p) {
					var b = document.createElement('button');
					b.type = 'button';
					b.textContent = p.name + '  ($' + oeNum(p.price).toFixed(2) + ')';
					b.addEventListener('click', function () {
						oeResults.style.display = 'none';
						document.getElementById('oe-prod-search').value = '';
						oePost('product_options', { product_id: p.id }).then(function (o) {
							oeAddRow({ product_id: p.id, name: p.name, qty: 1,
								price: o.ok ? o.unit_price : p.price, weight: o.ok ? o.unit_weight : p.weight,
								option_defs: o.ok ? o.defs : [] });
							oeRecalc(); oeSuggestPackage();
						});
					});
					oeResults.appendChild(b);
				});
				if (!r.rows.length) oeResults.innerHTML = '<div style="padding:.5rem .7rem;font-size:.85rem;color:var(--nc-text-dim)">No products found.</div>';
				oeResults.style.display = '';
			});
		}, 250);
	});

	// Recalculate shipping
	debounceBtn(document.getElementById('oe-get-rates'), function () {
		var box = document.getElementById('oe-rates');
		box.textContent = 'Getting rates…';
		var data = oeAddressFields();
		data.items = JSON.stringify(oeItems());
		data.pkg_length = oeVal('oe-pkg-l'); data.pkg_width = oeVal('oe-pkg-w'); data.pkg_height = oeVal('oe-pkg-h');
		return oePost('rates', data).then(function (r) {
			if (!r.ok) { box.textContent = ''; SimpleNotification.error({ text: r.message }); return; }
			box.innerHTML = '';
			if (!r.rates.length) { box.textContent = 'No rates returned for this address and weight. Enter the cost by hand above.'; return; }
			r.rates.forEach(function (rt, i) {
				var label = document.createElement('label');
				label.className = 'oe-rate';
				var radio = document.createElement('input');
				radio.type = 'radio'; radio.name = 'oe-rate';
				radio.addEventListener('change', function () {
					oeSet('oe-ship-method', [rt.carrier, rt.service].filter(Boolean).join(' '));
					oeSet('oe-shipping', oeNum(rt.rate).toFixed(2));
					oeToken = rt.shippo_token || '';
					oeRecalc();
				});
				label.appendChild(radio);
				label.appendChild(document.createTextNode(
					[rt.carrier, rt.service].filter(Boolean).join(' ') + ' - ' + oeMoney(oeNum(rt.rate))
					+ (rt.days ? ' (' + rt.days + (isNaN(rt.days) ? '' : ' days') + ')' : '')));
				box.appendChild(label);
			});
		});
	});

	// Recalculate tax
	debounceBtn(document.getElementById('oe-calc-tax'), function () {
		var data = oeAddressFields();
		data.items = JSON.stringify(oeItems());
		data.shipping = oeVal('oe-shipping');
		return oePost('tax', data).then(function (r) {
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			oeSet('oe-tax', oeNum(r.tax).toFixed(2));
			oeRecalc();
			SimpleNotification.success({ text: 'Tax recalculated.' });
		});
	});

	// Save (create or update)
	debounceBtn(oeSaveBtn, function () {
		var a = oeAddressFields();
		var data = {
			id: oeId, items: JSON.stringify(oeItems()),
			first_name: a.first_name, last_name: a.last_name,
			email: oeVal('oe-email'), phone: oeVal('oe-phone'),
			address1: a.address1, address2: a.address2, city: a.city,
			state: a.state, zip: a.zip, country: a.country,
			ship_method: oeVal('oe-ship-method'), tracking_number: oeVal('oe-tracking'), shipping: oeVal('oe-shipping'),
			shippo_rate_token: oeToken, tax: oeVal('oe-tax'), discount_amount: oeVal('oe-discount')
		};
		return oePost('save', data).then(function (r) {
			if (!r.ok) { SimpleNotification.error({ text: r.message }); return; }
			SimpleNotification.success({ text: r.message });
			dt.ajax.reload(null, false);
			openOrderDrawer(r.id);
		});
	});


}(jQuery));
