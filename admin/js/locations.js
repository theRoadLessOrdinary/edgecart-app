(function() {
	'use strict';

	window.NC = window.NC || {};

	// ── Initialize tabs ───────────────────────────────────────────────────────
	const tabs = NcTabs.init('[data-nc-tabs]');

	// Add click handlers to tab links for lazy-loading
	document.querySelectorAll('[data-nc-tabs] a').forEach(link => {
		link.addEventListener('click', function() {
			const href = this.getAttribute('href');
			if (href === '#zones-tab') {
				setTimeout(loadZones, 0);
			} else if (href === '#rates-tab') {
				setTimeout(loadRates, 0);
			}
		});
	});

	// Load zones on initial page load
	loadZones();

	// ──────────────────────────────────────────────────────────────────────────
	// ZONES
	// ──────────────────────────────────────────────────────────────────────────

async function loadZones() {
	try {
		const fd = new FormData();
		fd.append('action', 'zones_list');
		fd.append('csrf_token', getCsrfToken());
		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (data.ok) {
			renderZonesTable(data.zones || []);
		}
	} catch (err) {
		console.error('Error loading zones:', err);
	}
}

function renderZonesTable(zones) {
	const tbody = document.getElementById('zones-tbody');
	if (zones.length === 0) {
		tbody.innerHTML = '<tr class="nc-empty"><td colspan="4"><div class="nc-empty">No zones configured.</div></td></tr>';
		return;
	}

	// Priority column hidden: will be restored if zip ranges are introduced
	tbody.innerHTML = zones.map(z => `
		<tr data-id="${z.zone_id}" style="cursor: pointer">
			<td><strong>${escapeHtml(z.zone_name)}</strong></td>
			<td>${z.country_code}</td>
			<td>${z.state_code || '—'}</td>
			<td class="delete-col">
				<delete-in-place caption="🗑" confirm="OK?" data-id="${z.zone_id}" onclick="event.stopPropagation()"></delete-in-place>
			</td>
		</tr>
	`).join('');

	// Make rows clickable to edit
	document.querySelectorAll('#zones-tbody tr[data-id]').forEach(row => {
		row.addEventListener('click', function(e) {
			if (e.target.closest('delete-in-place')) return;
			editZone(parseInt(this.dataset.id));
		});
	});
}

async function editZone(id) {
	if (!id) {
		// New zone
		document.getElementById('zone-drawer-title').textContent = 'Add Zone';
		document.getElementById('zone-name').value = '';
		document.getElementById('zone-country').value = 'US';
		document.getElementById('zone-state').value = '';
		document.getElementById('zone-zip-from').value = '';
		document.getElementById('zone-zip-to').value = '';
		document.getElementById('zone-priority').value = '0';
		document.getElementById('zone-drawer').dataset.id = '';
		document.getElementById('btn-delete-zone').style.display = 'none';
	} else {
		// Edit existing zone
		try {
			const fd = new FormData();
			fd.append('action', 'zone_get');
			fd.append('csrf_token', getCsrfToken());
			fd.append('id', id);
			const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
			const data = await res.json();
			if (!data.ok) {
				SimpleNotification.error({ text: 'Failed to load zone' });
				return;
			}
			const z = data.zone;
			document.getElementById('zone-drawer-title').textContent = 'Edit Zone';
			document.getElementById('zone-name').value = z.zone_name;
			document.getElementById('zone-country').value = z.country_code;
			document.getElementById('zone-state').value = z.state_code || '';
			document.getElementById('zone-zip-from').value = z.zip_from || '';
			document.getElementById('zone-zip-to').value = z.zip_to || '';
			document.getElementById('zone-priority').value = z.priority;
			document.getElementById('zone-drawer').dataset.id = id;
			document.getElementById('btn-delete-zone').style.display = '';
			document.getElementById('btn-delete-zone').dataset.id = id;
		} catch (err) {
			SimpleNotification.error({ text: 'Error loading zone' });
			return;
		}
	}
	openDrawer('zone-drawer');
}

async function saveZone() {
	const id = document.getElementById('zone-drawer').dataset.id || '';
	const name = document.getElementById('zone-name').value.trim();
	const country = document.getElementById('zone-country').value;
	const state = document.getElementById('zone-state').value;
	const zipFrom = document.getElementById('zone-zip-from').value.trim();
	const zipTo = document.getElementById('zone-zip-to').value.trim();
	const priority = document.getElementById('zone-priority').value;

	if (!name) {
		SimpleNotification.error({ text: 'Zone name is required' });
		return;
	}

	try {
		const fd = new FormData();
		fd.append('action', 'zone_save');
		fd.append('csrf_token', getCsrfToken());
		fd.append('id', id);
		fd.append('zone_name', name);
		fd.append('country_code', country);
		fd.append('state_code', state);
		fd.append('zip_from', zipFrom);
		fd.append('zip_to', zipTo);
		fd.append('priority', priority);

		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			SimpleNotification.error({ text: data.message || 'Failed to save zone' });
			return;
		}
		closeDrawer('zone-drawer');
		loadZones();
		SimpleNotification.success({ text: data.message });
	} catch (err) {
		SimpleNotification.error({ text: 'Error saving zone' });
	}
}

async function deleteZone(id) {
	try {
		const fd = new FormData();
		fd.append('action', 'zone_delete');
		fd.append('csrf_token', getCsrfToken());
		fd.append('id', id);

		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			SimpleNotification.error({ text: data.message || 'Failed to delete zone' });
			return;
		}
		closeDrawer('zone-drawer');
		loadZones();
		SimpleNotification.success({ text: data.message });
	} catch (err) {
		SimpleNotification.error({ text: 'Error deleting zone' });
	}
}

// ──────────────────────────────────────────────────────────────────────────
// RATES
// ──────────────────────────────────────────────────────────────────────────

async function loadRates() {
	try {
		const fd = new FormData();
		fd.append('action', 'rates_list');
		fd.append('csrf_token', getCsrfToken());
		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (data.ok) {
			renderRatesTable(data.rates || []);
		}
	} catch (err) {
		console.error('Error loading rates:', err);
	}
}

function renderRatesTable(rates) {
	const tbody = document.getElementById('rates-tbody');
	if (rates.length === 0) {
		tbody.innerHTML = '<tr class="nc-empty"><td colspan="6"><div class="nc-empty">No rates configured.</div></td></tr>';
		return;
	}

	tbody.innerHTML = rates.map(r => `
		<tr data-id="${r.rate_id}" style="cursor: pointer">
			<td><strong>${escapeHtml(r.rate_name)}</strong></td>
			<td>${escapeHtml(r.zone_name)}</td>
			<td style="text-align: right">${(r.rate * 100).toFixed(2)}%</td>
			<td style="text-align: center">
				${r.applies_to_shipping ? '✓' : '—'}
			</td>
			<td style="text-align: center">
				<ios-toggle size="sm" data-id="${r.rate_id}" ${r.active ? 'checked' : ''} title="Toggle active"></ios-toggle>
			</td>
			<td class="delete-col">
				<delete-in-place caption="🗑" confirm="OK?" data-id="${r.rate_id}" onclick="event.stopPropagation()"></delete-in-place>
			</td>
		</tr>
	`).join('');

	// Make rows clickable to edit
	document.querySelectorAll('#rates-tbody tr[data-id]').forEach(row => {
		row.addEventListener('click', function(e) {
			if (e.target.closest('ios-toggle, delete-in-place')) return;
			editRate(parseInt(this.dataset.id));
		});
	});
}

async function editRate(id) {
	let selectedZoneId = '';

	if (!id) {
		// New rate
		document.getElementById('rate-drawer-title').textContent = 'Add Rate';
		document.getElementById('rate-name').value = '';
		document.getElementById('rate-zone').value = '';
		document.getElementById('rate-percentage').value = '';
		document.getElementById('rate-applies-shipping').checked = false;
		document.getElementById('rate-active').checked = true;
		document.getElementById('rate-drawer').dataset.id = '';
		document.getElementById('btn-delete-rate').style.display = 'none';
	} else {
		// Edit existing rate
		try {
			const fd = new FormData();
			fd.append('action', 'rate_get');
			fd.append('csrf_token', getCsrfToken());
			fd.append('id', id);
			const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
			const data = await res.json();
			if (!data.ok) {
				SimpleNotification.error({ text: 'Failed to load rate' });
				return;
			}
			const r = data.rate;
			document.getElementById('rate-drawer-title').textContent = 'Edit Rate';
			document.getElementById('rate-name').value = r.rate_name;
			document.getElementById('rate-percentage').value = (r.rate * 100).toFixed(2);
			document.getElementById('rate-applies-shipping').checked = !!r.applies_to_shipping;
			document.getElementById('rate-active').checked = !!r.active;
			document.getElementById('rate-drawer').dataset.id = id;
			document.getElementById('btn-delete-rate').style.display = '';
			document.getElementById('btn-delete-rate').dataset.id = id;
			selectedZoneId = String(r.zone_id);
		} catch (err) {
			SimpleNotification.error({ text: 'Error loading rate' });
			return;
		}
	}

	// Populate zone select with current zones
	await loadZonesForSelect(selectedZoneId);
	openDrawer('rate-drawer');
}

async function loadZonesForSelect(selectedZoneId = '') {
	try {
		const fd = new FormData();
		fd.append('action', 'zones_list');
		fd.append('csrf_token', getCsrfToken());
		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) return;

		const select = document.getElementById('rate-zone');
		select.innerHTML = '<option value="">Select a zone</option>' +
			(data.zones || []).map(z => `<option value="${z.zone_id}">${escapeHtml(z.zone_name)}</option>`).join('');

		if (selectedZoneId) {
			select.value = selectedZoneId;
		}
	} catch (err) {
		console.error('Error loading zones for select', err);
	}
}

async function saveRate() {
	const id = document.getElementById('rate-drawer').dataset.id || '';
	const name = document.getElementById('rate-name').value.trim();
	const zoneId = document.getElementById('rate-zone').value;
	const percentage = parseFloat(document.getElementById('rate-percentage').value);
	const applesShipping = parseInt(document.getElementById('_nc_rate-applies-shipping').value || 0);
	const active = parseInt(document.getElementById('_nc_rate-active').value || 0);

	if (!name || !zoneId || isNaN(percentage)) {
		SimpleNotification.error({ text: 'Rate name, zone, and percentage are required' });
		return;
	}

	try {
		const fd = new FormData();
		fd.append('action', 'rate_save');
		fd.append('csrf_token', getCsrfToken());
		fd.append('id', id);
		fd.append('rate_name', name);
		fd.append('zone_id', zoneId);
		fd.append('rate', percentage);
		fd.append('applies_to_shipping', applesShipping);
		fd.append('active', active);

		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			SimpleNotification.error({ text: data.message || 'Failed to save rate' });
			return;
		}
		closeDrawer('rate-drawer');
		loadRates();
		SimpleNotification.success({ text: data.message });
	} catch (err) {
		SimpleNotification.error({ text: 'Error saving rate' });
	}
}

async function deleteRate(id) {
	try {
		const fd = new FormData();
		fd.append('action', 'rate_delete');
		fd.append('csrf_token', getCsrfToken());
		fd.append('id', id);

		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			SimpleNotification.error({ text: data.message || 'Failed to delete rate' });
			return;
		}
		closeDrawer('rate-drawer');
		loadRates();
		SimpleNotification.success({ text: data.message });
	} catch (err) {
		SimpleNotification.error({ text: 'Error deleting rate' });
	}
}

async function toggleRateActive(event, id) {
	try {
		const fd = new FormData();
		fd.append('action', 'rate_toggle_active');
		fd.append('csrf_token', getCsrfToken());
		fd.append('id', id);

		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			SimpleNotification.error({ text: 'Failed to toggle rate' });
			loadRates();
			return;
		}
		// Update the toggle state
		const toggle = event.detail.source;
		toggle.checked = data.active;
	} catch (err) {
		SimpleNotification.error({ text: 'Error toggling rate' });
		loadRates();
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Drawer helpers
// ──────────────────────────────────────────────────────────────────────────

function openDrawer(id) {
	document.getElementById('drawer-overlay').classList.add('show');
	document.getElementById(id).classList.add('open');
}

function closeDrawer(id) {
	document.getElementById('drawer-overlay').classList.remove('show');
	document.getElementById(id).classList.remove('open');
}

// Delete-in-place handlers
document.addEventListener('dip-confirm', (e) => {
	if (e.detail.id) {
		const id = parseInt(e.detail.id);
		if (e.target.closest('#zones-tbody')) {
			deleteZone(id);
		} else if (e.target.closest('#rates-tbody')) {
			deleteRate(id);
		}
	}
});

// iOS toggle change handlers
document.addEventListener('ios-toggle', (e) => {
	if (e.detail.source.closest('#rates-tbody')) {
		const rateId = parseInt(e.detail.data.id);
		toggleRateActive(e, rateId);
	}
});

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

// ── Event listeners ────────────────────────────────────────────────────────

// Delete-in-place handlers
document.addEventListener('dip-confirm', (e) => {
	if (e.detail.id) {
		const id = parseInt(e.detail.id);
		if (e.target.closest('#zones-tbody')) {
			deleteZone(id);
		} else if (e.target.closest('#rates-tbody')) {
			deleteRate(id);
		}
	}
});

// OpenSalesTax import
document.getElementById('btn-opensalestax-import').addEventListener('click', async function() {
	const btn = this;
	const status = document.getElementById('opensalestax-last-import');
	btn.disabled = true;
	const originalText = btn.textContent;
	btn.textContent = 'Importing…';
	try {
		const fd = new FormData();
		fd.append('action', 'opensalestax_import');
		fd.append('csrf_token', getCsrfToken());
		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			SimpleNotification.error({ text: data.message || 'Import failed' });
			return;
		}
		const skippedCount = Object.keys(data.skipped || {}).length;
		SimpleNotification.success({
			text: `Imported ${data.imported} state${data.imported === 1 ? '' : 's'}` + (skippedCount ? `, ${skippedCount} skipped` : '')
		});
		if (status) status.textContent = data.last_import ? `Last imported: ${data.last_import}` : '';
		loadZones();
	} catch (err) {
		SimpleNotification.error({ text: 'Error importing from OpenSalesTax' });
	} finally {
		btn.disabled = false;
		btn.textContent = originalText;
	}
});

// Zone drawer events
document.getElementById('btn-add-zone').addEventListener('click', () => editZone(0));
document.getElementById('zone-drawer-close').addEventListener('click', () => closeDrawer('zone-drawer'));
document.getElementById('zone-drawer-cancel').addEventListener('click', () => closeDrawer('zone-drawer'));
document.getElementById('zone-drawer-save').addEventListener('click', saveZone);
document.getElementById('drawer-overlay').addEventListener('click', (e) => {
	if (e.target.id === 'drawer-overlay') {
		closeDrawer('zone-drawer');
		closeDrawer('rate-drawer');
	}
});

// Rate drawer events
document.getElementById('btn-add-rate').addEventListener('click', () => editRate(0));
document.getElementById('rate-drawer-close').addEventListener('click', () => closeDrawer('rate-drawer'));
document.getElementById('rate-drawer-cancel').addEventListener('click', () => closeDrawer('rate-drawer'));
document.getElementById('rate-drawer-save').addEventListener('click', saveRate);
document.getElementById('btn-delete-rate').addEventListener('click', function() {
	deleteRate(this.dataset.id);
});

// Toggle all rates active/inactive - single server call with all IDs
document.getElementById('toggle-all-rates').addEventListener('change', async function() {
	const allToggles = document.querySelectorAll('#rates-tbody ios-toggle');
	if (allToggles.length === 0) return;

	const newState = this.checked;
	const ratesToToggle = [];

	// Collect IDs that need toggling
	for (const toggle of allToggles) {
		if (toggle.checked !== newState) {
			ratesToToggle.push(parseInt(toggle.dataset.id));
		}
	}

	if (ratesToToggle.length === 0) return;

	try {
		const fd = new FormData();
		fd.append('action', 'rates_bulk_toggle');
		fd.append('csrf_token', getCsrfToken());
		fd.append('ids', JSON.stringify(ratesToToggle));
		fd.append('active', newState ? 1 : 0);

		const res = await fetch(window.NC.ajaxUrl, { method: 'POST', body: fd });
		const data = await res.json();
		if (data.ok) {
			// Reload to refresh all toggle states
			loadRates();
		}
	} catch (err) {
		console.error('Error bulk toggling rates:', err);
	}
});

})();
