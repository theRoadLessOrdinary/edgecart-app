(function () {
	'use strict';

	const AJAX = NC.ajaxUrl;
	const tbody = document.getElementById('messages-tbody');
	const table = document.getElementById('messages-table');
	const emptyRow = document.getElementById('empty-row');
	const drawer = document.getElementById('msg-drawer');
	const overlay = document.getElementById('drawer-overlay');
	const btnBulkDelete = document.getElementById('btn-bulk-delete');
	const chkAll = document.getElementById('chk-all');
	let currentMessageId = null;

	// ── Helpers ────────────────────────────────────────────────────────────────
	async function ajax(data) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		return r.json();
	}

	function openDrawer(message) {
		currentMessageId = message.id;
		document.getElementById('drawer-title').textContent = message.form_name || 'Message';
		document.getElementById('msg-form').textContent = message.form_name || 'Contact Form';
		document.getElementById('msg-date').textContent = new Date(message.created_at).toLocaleString();
		document.getElementById('msg-ip').textContent = message.ip || '—';

		// Render message fields
		const fieldsDiv = document.getElementById('message-fields');
		fieldsDiv.innerHTML = '';
		if (message.data && typeof message.data === 'object') {
			Object.entries(message.data).forEach(([label, value]) => {
				const field = document.createElement('div');
				field.className = 'msg-field';
				field.innerHTML = `
					<div class="msg-field-label">${h(label)}</div>
					<div class="msg-field-value">${h(value)}</div>
				`;
				fieldsDiv.appendChild(field);
			});
		}

		// Show elements
		document.getElementById('message-detail').style.display = '';
		document.getElementById('reply-form').style.display = 'none';
		document.getElementById('btn-toggle-reply').style.display = '';
		document.getElementById('btn-send-reply').style.display = 'none';
		document.getElementById('reply-text').value = '';
		document.getElementById('btn-delete-msg').dataset.id = message.id;

		// Mark as read
		if (!message.read_at) {
			ajax({ action: 'mark_read', id: message.id });
			const tr = tbody.querySelector('tr[data-id="' + message.id + '"]');
			if (tr) tr.classList.remove('msg-unread');
		}

		drawer.classList.add('open');
		overlay.classList.add('show');
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
		currentMessageId = null;
	}

	function h(s) {
		const div = document.createElement('div');
		div.textContent = s;
		return div.innerHTML;
	}

	function notifyErr(msg) {
		SimpleNotification.show(msg || 'An error occurred.', 'error');
	}

	function updateBulkBtn() {
		const checked = tbody.querySelectorAll('input.row-chk:checked').length;
		btnBulkDelete.style.display = checked ? '' : 'none';
		chkAll.checked = checked > 0 && checked === tbody.querySelectorAll('input.row-chk').length;
	}

	function buildRow(msg) {
		const tr = document.createElement('tr');
		tr.dataset.id = msg.id;
		if (!msg.read_at) tr.classList.add('msg-unread');

		const dateStr = new Date(msg.created_at).toLocaleDateString();
		const statusIcon = msg.read_at ? '✓' : '◯';

		tr.innerHTML = `
			<td>${dateStr}</td>
			<td>${h(msg.form_name || 'Form')}</td>
			<td class="summary-col">${h(msg.summary)}</td>
			<td class="col-status">${statusIcon}</td>
			<td><delete-in-place caption="🗑" confirm="Delete?" data-id="${msg.id}"></delete-in-place></td>
			<td class="checkbox-col"><input type="checkbox" class="row-chk" data-id="${msg.id}"></td>
		`;

		// Click to open drawer
		tr.addEventListener('click', function (e) {
			if (e.target.closest('delete-in-place, input')) return;
			ajax({ action: 'get', id: msg.id }).then(r => {
				if (!r.ok) return notifyErr(r.message);
				openDrawer(r.message);
			});
		});

		return tr;
	}

	// ── Load messages ──────────────────────────────────────────────────────────
	async function loadMessages() {
		const res = await ajax({ action: 'list' });
		if (!res.ok) {
			notifyErr(res.message);
			return;
		}
		renderRows(res.rows);
	}

	function renderRows(rows) {
		Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(r => r.remove());
		if (!rows || !rows.length) {
			emptyRow.style.display = '';
			return;
		}
		emptyRow.style.display = 'none';
		rows.forEach(msg => tbody.appendChild(buildRow(msg)));
		updateBulkBtn();
	}

	// ── Events ────────────────────────────────────────────────────────────────
	overlay.addEventListener('click', closeDrawer);
	document.getElementById('drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);

	// Reply toggle
	document.getElementById('btn-toggle-reply').addEventListener('click', function () {
		const replyForm = document.getElementById('reply-form');
		const isHidden = replyForm.style.display === 'none';
		replyForm.style.display = isHidden ? '' : 'none';
		document.getElementById('btn-toggle-reply').style.display = isHidden ? 'none' : '';
		document.getElementById('btn-send-reply').style.display = isHidden ? '' : 'none';
		if (isHidden) {
			document.getElementById('reply-text').focus();
		}
	});

	// Send reply
	debounceBtn(document.getElementById('btn-send-reply'), async function () {
		const text = document.getElementById('reply-text').value.trim();
		if (!text) {
			notifyErr('Reply cannot be empty.');
			return;
		}

		const res = await ajax({
			action: 'reply',
			id: currentMessageId,
			reply_text: text
		});

		if (!res.ok) {
			notifyErr(res.message);
			return;
		}

		SimpleNotification.show(res.message, 'success');
		closeDrawer();
		loadMessages();
	}, 1000);

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
				if (!tbody.querySelector('tr[data-id]')) {
					emptyRow.style.display = '';
				}
			});
		}
		if (currentMessageId === id) {
			closeDrawer();
		}
	});

	// Delete from drawer
	document.getElementById('btn-delete-msg').addEventListener('dip-confirm', async function (e) {
		const id = parseInt(e.detail.id);
		if (!id) return;
		const res = await ajax({ action: 'delete', id: id });
		if (!res.ok) {
			notifyErr(res.message);
			return;
		}
		SimpleNotification.show(res.message, 'success');
		closeDrawer();
		loadMessages();
	});

	// Bulk delete
	btnBulkDelete.addEventListener('click', async function () {
		const ids = Array.from(tbody.querySelectorAll('input.row-chk:checked'))
			.map(el => parseInt(el.dataset.id));
		if (!ids.length) {
			notifyErr('No messages selected.');
			return;
		}

		if (!confirm('Delete ' + ids.length + ' message' + (ids.length === 1 ? '' : 's') + '?')) return;

		const res = await ajax({ action: 'bulk_delete', ids: JSON.stringify(ids) });
		if (!res.ok) {
			notifyErr(res.message);
			return;
		}

		SimpleNotification.show(res.message, 'success');
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
		if (ids.includes(currentMessageId)) {
			closeDrawer();
		}
	});

	// Checkbox logic
	chkAll.addEventListener('change', function () {
		tbody.querySelectorAll('input.row-chk').forEach(chk => {
			chk.checked = this.checked;
		});
		updateBulkBtn();
	});

	tbody.addEventListener('change', function (e) {
		if (e.target.classList.contains('row-chk')) {
			updateBulkBtn();
		}
	});

	// Initial load
	loadMessages();
})();
