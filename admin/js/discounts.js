(function () {
	'use strict';

	const AJAX = NC.ajaxUrl;
	const tbody = document.getElementById('discounts-tbody');
	const table = document.getElementById('discounts-table');
	const emptyRow = document.getElementById('empty-row');
	const drawer = document.getElementById('code-drawer');
	const overlay = document.getElementById('drawer-overlay');
	const btnAdd = document.getElementById('btn-add-code');
	const btnBulkDelete = document.getElementById('btn-bulk-delete');
	const chkAll = document.getElementById('chk-all');

	let discountLimit = parseInt(btnAdd?.dataset.limit, 10) || Infinity;

	function syncLimitUI() {
		if (!btnAdd) return;
		const count   = tbody.querySelectorAll('tr[data-id]').length;
		const atLimit = isFinite(discountLimit) && count >= discountLimit;
		let hint = document.getElementById('discount-limit-hint');
		if (atLimit) {
			btnAdd.style.display = 'none';
			if (!hint) {
				hint = document.createElement('span');
				hint.id = 'discount-limit-hint';
				hint.className = 'ec-limit-hint';
				hint.innerHTML = 'Discount limit reached. <a href="' + (NC.upgradeUrl || '#') + '" target="_blank" rel="noopener">Upgrade to add more &rarr;</a>';
				btnAdd.insertAdjacentElement('afterend', hint);
			}
		} else {
			btnAdd.style.display = '';
			if (hint) hint.remove();
		}
	}


	// ── Helpers ────────────────────────────────────────────────────────────────
	async function ajax(data) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		return r.json();
	}

	function openDrawer(title, code = null) {
		if (!drawer || !overlay) return;

		document.getElementById('drawer-title').textContent = title;
		document.getElementById('c_id').value = code ? code.id : '';
		document.getElementById('c_code').value = code ? code.code : '';
		document.getElementById('c_type').value = code ? code.type : 'percent';
		document.getElementById('c_amount').value = code ? code.amount : '';
		document.getElementById('c_min_amount').value = code && code.min_order_amount ? code.min_order_amount : '';
		const today = new Date().toISOString().split('T')[0];
		const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		document.getElementById('c_active_from').value = code ? code.active_from : today;
		document.getElementById('c_active_until').value = code ? code.active_until : nextYear;
		document.getElementById('c_usage_limit').value = code && code.usage_limit ? code.usage_limit : '1';
		document.getElementById('c_single_use').checked = code && code.single_use == 1;
		document.getElementById('c_status').checked = !code || code.status == 1;

		// Disable code editing on update
		document.getElementById('c_code').disabled = !!code;

		drawer.classList.add('open');
		overlay.classList.add('show');
		document.getElementById('c_code').focus();
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
	}

	function formatDate(date) {
		return date ? date.substring(5) + '/' + date.substring(0, 4) : '—';
	}

	function buildRow(d) {
		const tr = document.createElement('tr');
		tr.dataset.id = d.id;

		const typeBadge = d.type === 'percent' ? d.amount + '%' : '$' + parseFloat(d.amount).toFixed(2);
		let uses = d.used_count + ' ';
		if (d.single_use) {
			uses += '(single-use)';
		} else if (d.usage_limit) {
			uses += '/ ' + d.usage_limit;
		} else {
			uses += '(∞)';
		}
		const statusToggle = `<ios-toggle data-id="${d.id}" data-field="status" value="${d.status}" size="sm"${d.status ? ' checked' : ''}></ios-toggle>`;

		tr.innerHTML = `
			<td class="code-col"><code>${h(d.code)}</code></td>
			<td>${d.type === 'percent' ? 'Percent' : 'Fixed'}</td>
			<td>${typeBadge}</td>
			<td>${formatDate(d.active_from)}</td>
			<td>${formatDate(d.active_until)}</td>
			<td>${uses}</td>
			<td class="col-toggle">${statusToggle}</td>
			<td><delete-in-place caption="🗑" confirm="OK?" data-id="${d.id}"></delete-in-place></td>
			<td class="checkbox-col"><input type="checkbox" class="row-chk" data-id="${d.id}"></td>
		`;

		// Edit on click
		tr.addEventListener('click', function (e) {
			if (e.target.closest('delete-in-place, input, ios-toggle')) return;
			ajax({ action: 'get', id: d.id }).then(r => {
				if (!r.ok) return notifyErr(r.message);
				openDrawer('Edit Discount Code', r.row);
			});
		});

		return tr;
	}

	function h(s) {
		const div = document.createElement('div');
		div.textContent = s;
		return div.innerHTML;
	}

	function notifyErr(msg) {
		SimpleNotification.error({ text: msg || 'An error occurred.' });
	}

	function updateBulkBtn() {
		const checked = tbody.querySelectorAll('input.row-chk:checked').length;
		btnBulkDelete.style.display = checked ? '' : 'none';
		chkAll.checked = checked > 0 && checked === tbody.querySelectorAll('input.row-chk').length;
	}

	// ── Load codes ──────────────────────────────────────────────────────────────
	async function loadCodes() {
		const res = await ajax({ action: 'list' });
		if (!res.ok) {
			notifyErr(res.message);
			return;
		}
		if (res.limit !== undefined) discountLimit = res.limit;
		renderRows(res.rows);
	}

	function renderRows(rows) {
		Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(r => r.remove());
		if (!rows || !rows.length) {
			emptyRow.style.display = '';
			table.style.display = '';
		} else {
			emptyRow.style.display = 'none';
			rows.forEach(row => tbody.appendChild(buildRow(row)));
		}
		updateBulkBtn();
		syncLimitUI();
	}

	// ── Events ────────────────────────────────────────────────────────────────
	if (btnAdd) {
		btnAdd.addEventListener('click', function(e) {
			e.preventDefault();
			openDrawer('New Discount Code');
		});
	}
	if (overlay) {
		overlay.addEventListener('click', closeDrawer);
	}
	const drawerClose = document.getElementById('drawer-close');
	if (drawerClose) {
		drawerClose.addEventListener('click', closeDrawer);
	}
	const btnCancel = document.getElementById('btn-drawer-cancel');
	if (btnCancel) {
		btnCancel.addEventListener('click', closeDrawer);
	}

	// Generate code
	const genBtn = document.getElementById('btn-generate-code');
	if (genBtn) {
		genBtn.addEventListener('click', async function () {
			const res = await ajax({ action: 'generate_code' });
			if (res.ok) {
				document.getElementById('c_code').value = res.code;
			}
		});
	}

	// Save code
	const saveBtn = document.getElementById('btn-drawer-save');
	if (saveBtn) {
		debounceBtn(saveBtn, async function () {
		const id = parseInt(document.getElementById('c_id').value) || 0;
		const code = document.getElementById('c_code').value.toUpperCase().trim();
		const type = document.getElementById('c_type').value;
		const amount = document.getElementById('c_amount').value;
		const minAmount = document.getElementById('c_min_amount').value;
		const activeFrom = document.getElementById('c_active_from').value;
		const activeUntil = document.getElementById('c_active_until').value;
		const usageLimit = document.getElementById('c_usage_limit').value;
		const singleUse = document.getElementById('c_single_use').checked ? 1 : 0;
		const status = document.getElementById('c_status').checked ? 1 : 0;

		if (!code) {
			notifyErr('Please enter or generate a code.');
			return;
		}
		if (!amount) {
			notifyErr('Amount is required.');
			return;
		}
		if (!activeFrom) {
			notifyErr('Active from date is required.');
			return;
		}

		const res = await ajax({
			action: 'save',
			id: id,
			code: code,
			type: type,
			amount: amount,
			min_order_amount: minAmount,
			active_from: activeFrom,
			active_until: activeUntil,
			usage_limit: usageLimit,
			single_use: singleUse,
			status: status
		});

		if (!res.ok) {
			notifyErr(res.message);
			return;
		}

		SimpleNotification.success({ text: res.message });
		closeDrawer();

		if (id) {
			// Update existing row
			const tr = tbody.querySelector('tr[data-id="' + id + '"]');
			if (tr) tbody.replaceChild(buildRow(res.row), tr);
		} else {
			// Add new row
			emptyRow.style.display = 'none';
			tbody.appendChild(buildRow(res.row));
		}

		updateBulkBtn();
		syncLimitUI();
	}, 1000);
	}

	// Toggle status
	document.addEventListener('ios-toggle', function (e) {
		const src = e.detail.source;
		if (!src.dataset.id || !src.dataset.field) return;
		ajax({
			action: 'toggle',
			id: src.dataset.id,
			value: e.detail.value ? 1 : 0
		});
	});

	// Delete single
	tbody.addEventListener('dip-confirm', async function (e) {
		const id = e.detail.id;
		const tr = tbody.querySelector('tr[data-id="' + id + '"]');
		const res = await ajax({ action: 'delete', id: id });
		if (!res.ok) {
			notifyErr(res.message);
			return;
		}
		if (tr) {
			animateDelete(tr, function () {
				tr.remove();
				updateBulkBtn();
				syncLimitUI();
				if (!tbody.querySelector('tr[data-id]')) {
					emptyRow.style.display = '';
				}
			});
		}
	});

	// Bulk delete
	if (btnBulkDelete) {
		btnBulkDelete.addEventListener('click', async function () {
		const ids = Array.from(tbody.querySelectorAll('input.row-chk:checked'))
			.map(el => parseInt(el.dataset.id));
		if (!ids.length) {
			notifyErr('No codes selected.');
			return;
		}

		if (!confirm('Delete ' + ids.length + ' code' + (ids.length === 1 ? '' : 's') + '?')) return;

		const res = await ajax({ action: 'bulk_delete', ids: JSON.stringify(ids) });
		if (!res.ok) {
			notifyErr(res.message);
			return;
		}

		SimpleNotification.success({ text: res.message });
		ids.forEach(id => {
			const tr = tbody.querySelector('tr[data-id="' + id + '"]');
			if (tr) {
				animateDelete(tr, () => tr.remove());
			}
		});
		updateBulkBtn();
		if (!tbody.querySelector('tr[data-id]')) {
			emptyRow.style.display = '';
		}
	});
	}

	// Checkbox logic
	if (chkAll) {
		chkAll.addEventListener('change', function () {
		tbody.querySelectorAll('input.row-chk').forEach(chk => {
			chk.checked = this.checked;
		});
		updateBulkBtn();
	});
	}

	if (tbody) {
		tbody.addEventListener('change', function (e) {
		if (e.target.classList.contains('row-chk')) {
			updateBulkBtn();
		}
	});
	}

	loadCodes();
})();
