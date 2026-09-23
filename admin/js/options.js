/**
 * new-cart admin — Options
 */
(function () {
'use strict';

const AJAX    = NC.adminUrl + '?route=options/ajax';
const AJAX_FM = NC.adminUrl + '?route=filemanager/ajax';

// Choice types that support values
const CHOICE_TYPES = ['select','radio','checkbox','toggle'];

function ajax(data) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) fd.append(k, v);
	fd.append('csrf_token', getCsrfToken());
	return fetch(AJAX, { method: 'POST', body: fd }).then(r => r.json());
}

function notifyOk(msg)  { SimpleNotification.success({ text: msg }); }
function notifyErr(msg) { SimpleNotification.error({ text: msg }); }

// ── State ──────────────────────────────────────────────────────────────────────
let currentOptionId = null;
let currentValues   = [];  // [{id, option_id, text, image, display_order, price_prefix, price_modifier, weight_modifier}]
let dragSrcIdx      = null;
let dragSrcValIdx   = null;

// ── Init ───────────────────────────────────────────────────────────────────────
const drawer         = document.getElementById('opt-drawer');
const overlay        = document.getElementById('drawer-overlay');
const drawerTitle    = document.getElementById('drawer-title');
const optId          = document.getElementById('opt-id');
const optName        = document.getElementById('opt-name');
const optType        = document.getElementById('opt-type');
const optPlaceholder = document.getElementById('opt-placeholder');
const valSection     = document.getElementById('opt-values-section');
const valList        = document.getElementById('opt-values-list');
const optsList       = document.getElementById('options-list');
const emptyMsg       = document.getElementById('options-empty');
const loadingEl      = document.getElementById('options-loading');

loadOptions();

// ── Load options list ──────────────────────────────────────────────────────────
async function loadOptions() {
	const res = await ajax({ action: 'list' });
	if (!res.ok) { notifyErr(res.message); return; }
	renderList(res.rows || []);
}

function renderList(rows) {
	optsList.innerHTML = '';
	loadingEl.style.display = 'none';
	if (!rows.length) {
		emptyMsg.style.display = '';
		return;
	}
	emptyMsg.style.display = 'none';
	rows.forEach(row => {
		const card = document.createElement('div');
		card.className = 'opt-card';
		card.dataset.id = row.id;
		card.setAttribute('role', 'button');
		card.setAttribute('tabindex', '0');
		card.setAttribute('aria-label', row.name);
		card.draggable = true;

		const dragH = document.createElement('span');
		dragH.className = 'opt-card-drag';
		dragH.textContent = '⠿';
		dragH.setAttribute('aria-hidden', 'true');

		const name = document.createElement('span');
		name.className = 'opt-card-name';
		name.textContent = row.name;

		const cloneBtn = document.createElement('button');
		cloneBtn.className = 'opt-card-clone';
		cloneBtn.title = 'Clone';
		cloneBtn.setAttribute('aria-label', 'Clone option');
		cloneBtn.textContent = '📋 Clone';
		cloneBtn.addEventListener('click', async function (e) {
			e.stopPropagation();
			const res = await ajax({ action: 'clone', id: row.id });
			if (!res.ok) { notifyErr(res.message); return; }
			// notifyOk('Option cloned.');
			loadOptions();
		});

		const dip = document.createElement('delete-in-place');
		dip.setAttribute('caption', '🗑');
		dip.setAttribute('confirm', 'Delete option?');
		dip.dataset.id = row.id;

		card.appendChild(dragH);
		card.appendChild(name);
		card.appendChild(cloneBtn);
		card.appendChild(dip);

		card.addEventListener('click', e => {
			if (e.target.closest('delete-in-place')) return;
			openDrawer(row.id);
		});
		card.addEventListener('keydown', e => {
			if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('delete-in-place')) {
				e.preventDefault();
				openDrawer(row.id);
			}
		});

		// Drag to reorder
		card.addEventListener('dragstart', e => {
			dragSrcIdx = [...optsList.children].indexOf(card);
			e.dataTransfer.effectAllowed = 'move';
		});
		card.addEventListener('dragover', e => {
			e.preventDefault();
			card.classList.add('drag-over');
		});
		card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
		card.addEventListener('drop', async e => {
			e.preventDefault();
			card.classList.remove('drag-over');
			const destIdx = [...optsList.children].indexOf(card);
			if (dragSrcIdx === null || dragSrcIdx === destIdx) return;
			const cards = [...optsList.children];
			const src   = cards[dragSrcIdx];
			if (destIdx < dragSrcIdx) {
				optsList.insertBefore(src, card);
			} else {
				optsList.insertBefore(src, card.nextSibling);
			}
			const ids = [...optsList.children].map(c => c.dataset.id);
			await ajax({ action: 'reorder', ids: JSON.stringify(ids) });
			dragSrcIdx = null;
		});

		optsList.appendChild(card);
	});

	// dip-confirm delegation
	optsList.addEventListener('dip-confirm', function (e) {
		const id   = e.target.dataset.id;
		if (!id) return;
		const card = e.target.closest('.opt-card');
		if (!card) return;
		animateDelete(card, async function () {
			const res = await ajax({ action: 'delete', id });
			if (!res.ok) { card.style.opacity = '1'; card.style.outline = ''; notifyErr(res.message); return; }
			card.remove();
		});
	}, { once: false });
}

// ── Drawer open/close ──────────────────────────────────────────────────────────
function openDrawer(id) {
	currentValues   = [];
	currentOptionId = id || null;

	if (id) {
		drawerTitle.textContent = 'Edit Option';
		ajax({ action: 'get', id }).then(res => {
			if (!res.ok) { notifyErr(res.message); return; }
			optId.value          = res.row.id;
			optName.value        = res.row.name;
			optType.value        = res.row.type;
			optPlaceholder.value = res.row.placeholder || '';
			currentValues        = res.values || [];
			updateTypeUI();
			renderValues();
		});
	} else {
		drawerTitle.textContent = 'Add Option';
		optId.value          = '';
		optName.value        = '';
		optType.value        = 'select';
		optPlaceholder.value = '';
		updateTypeUI();
		renderValues();
	}

	drawer.classList.add('open');
	overlay.classList.add('show');
	optName.focus();
}

function closeDrawer() {
	drawer.classList.remove('open');
	overlay.classList.remove('show');
}

// ── Type UI: show/hide values section and placeholder ─────────────────────────
function updateTypeUI() {
	const t       = optType.value;
	const isChoice = CHOICE_TYPES.includes(t);
	valSection.style.display = isChoice ? '' : 'none';
	// Placeholder label makes sense for input types only
	document.getElementById('opt-placeholder-wrap').style.display = isChoice ? 'none' : '';
}

optType.addEventListener('change', updateTypeUI);

// ── Render values ──────────────────────────────────────────────────────────────
function renderValues() {
	valList.innerHTML = '';
	currentValues.forEach((v, idx) => {
		const row = buildValueRow(v, idx);
		valList.appendChild(row);
	});
}

function buildValueRow(v, idx) {
	const row = document.createElement('div');
	row.className = 'opt-value-row';
	row.dataset.id  = v.id || '';
	row.dataset.idx = idx;
	row.setAttribute('role', 'listitem');
	row.draggable = true;

	const dragH = document.createElement('span');
	dragH.className = 'opt-value-drag';
	dragH.textContent = '⠿';
	dragH.setAttribute('aria-hidden', 'true');

	// Image thumbnail / drop zone
	const imgWrap = document.createElement('div');
	imgWrap.className = 'opt-value-img-wrap';

	if (v.image) {
		const img = document.createElement('img');
		img.src   = v.image;
		img.alt   = v.text;
		img.className = 'opt-value-img';
		img.title = 'Click to change image';
		img.style.cursor = 'pointer';
		img.addEventListener('click', () => pickValueImage(idx));
		imgWrap.appendChild(img);

		const removeBtn = document.createElement('button');
		removeBtn.className = 'opt-value-img-remove';
		removeBtn.setAttribute('aria-label', 'Remove image');
		removeBtn.textContent = '×';
		removeBtn.addEventListener('click', async e => {
			e.stopPropagation();
			currentValues[idx].image = '';
			if (v.id) {
				await ajax({ action: 'save_value', id: v.id, option_id: currentOptionId || 0, text: v.text, image: '', price_prefix: v.price_prefix || '=', price_modifier: v.price_modifier != null ? v.price_modifier : '', weight_modifier: v.weight_modifier != null ? v.weight_modifier : '' });
			}
			renderValues();
		});
		imgWrap.appendChild(removeBtn);
	} else {
		const ph = document.createElement('div');
		ph.className = 'opt-value-img-placeholder';
		ph.title = 'Click or drop to add image';
		ph.setAttribute('aria-label', 'Add image');
		ph.textContent = '＋';
		ph.addEventListener('click', () => pickValueImage(idx));
		imgWrap.appendChild(ph);
	}

	// Drop zone on img wrap
	imgWrap.addEventListener('dragover', e => {
		if (e.dataTransfer.types.includes('Files')) {
			e.preventDefault();
			imgWrap.style.outline = '2px dashed var(--nc-primary)';
		}
	});
	imgWrap.addEventListener('dragleave', () => imgWrap.style.outline = '');
	imgWrap.addEventListener('drop', e => {
		e.preventDefault();
		imgWrap.style.outline = '';
		const file = e.dataTransfer.files[0];
		if (file) uploadValueImage(idx, file);
	});

	// Edit-in-place text
	const textSpan = document.createElement('span');
	textSpan.className = 'opt-value-text';
	textSpan.textContent = v.text;
	textSpan.title = 'Click to edit';
	textSpan.style.cursor = 'text';
	textSpan.addEventListener('click', () => editValueText(idx, textSpan));

	// Delete-in-place
	const dip = document.createElement('delete-in-place');
	dip.setAttribute('caption', '🗑');
	dip.setAttribute('confirm', 'Delete?');
	dip.dataset.idx = idx;

	dip.addEventListener('dip-confirm', function () {
		const val = currentValues[idx];
		animateDelete(row, async function () {
			if (val.id) {
				const res = await ajax({ action: 'delete_value', id: val.id });
				if (!res.ok) { row.style.opacity = '1'; row.style.outline = ''; notifyErr(res.message); return; }
			}
			currentValues.splice(idx, 1);
			renderValues();
		});
	});

	// Modifiers section
	const modifiersWrap = document.createElement('div');
	modifiersWrap.className = 'opt-value-modifiers';

	// Modifier operator (roller-select, same as products)
	const prefixRoller = document.createElement('roller-select');
	prefixRoller.setAttribute('aria-label', 'Price modifier sign');
	prefixRoller.setAttribute('value', ['+', '-', '='].includes(v.price_prefix) ? v.price_prefix : '=');
	[{value: '+', label: '+'}, {value: '-', label: '−'}, {value: '=', label: '='}].forEach(function (item) {
		const ri = document.createElement('rs-item');
		ri.setAttribute('value', item.value);
		ri.textContent = item.label;
		prefixRoller.appendChild(ri);
	});
	document.addEventListener('roller-change', function (e) {
		if (e.detail.source === prefixRoller) currentValues[idx].price_prefix = prefixRoller.value;
	});
	modifiersWrap.appendChild(prefixRoller);

	// Price modifier with floating label
	const priceWrap = document.createElement('span');
	priceWrap.className = 'po-value-field-wrap';
	const priceLabel = document.createElement('span');
	priceLabel.className = 'po-value-field-label';
	priceLabel.textContent = 'price';
	const priceInput = document.createElement('input');
	priceInput.type = 'number';
	priceInput.className = 'po-value-price-input';
	priceInput.step = '0.01';
	priceInput.min = '0';
	priceInput.value = parseFloat(v.price_modifier || 0).toFixed(2);
	priceInput.setAttribute('aria-label', 'Price modifier');
	priceInput.setAttribute('title', 'Price modifier');
	priceInput.addEventListener('change', () => {
		currentValues[idx].price_modifier = priceInput.value ? parseFloat(priceInput.value) : null;
	});
	priceWrap.appendChild(priceLabel);
	priceWrap.appendChild(priceInput);
	modifiersWrap.appendChild(priceWrap);

	// Weight modifier with floating label
	const weightUnit = NC.weightUnit || 'lbs';
	const weightWrap = document.createElement('span');
	weightWrap.className = 'po-value-field-wrap';
	const weightLabel = document.createElement('span');
	weightLabel.className = 'po-value-field-label';
	weightLabel.textContent = weightUnit;
	const weightInput = document.createElement('input');
	weightInput.type = 'number';
	weightInput.className = 'po-value-weight-input';
	weightInput.step = '0.01';
	weightInput.min = '0';
	weightInput.value = parseFloat(v.weight_modifier || 0).toFixed(2);
	weightInput.setAttribute('aria-label', 'Weight modifier (' + weightUnit + ')');
	weightInput.setAttribute('title', 'Weight modifier (' + weightUnit + ')');
	weightInput.addEventListener('change', () => {
		currentValues[idx].weight_modifier = weightInput.value ? parseFloat(weightInput.value) : null;
	});
	weightWrap.appendChild(weightLabel);
	weightWrap.appendChild(weightInput);
	modifiersWrap.appendChild(weightWrap);

	row.appendChild(dragH);
	row.appendChild(imgWrap);
	row.appendChild(textSpan);
	row.appendChild(modifiersWrap);
	row.appendChild(dip);

	// Value row drag-to-reorder
	row.addEventListener('dragstart', e => {
		if (e.target.closest('.opt-value-img-wrap')) { e.preventDefault(); return; }
		dragSrcValIdx = idx;
		e.dataTransfer.effectAllowed = 'move';
	});
	row.addEventListener('dragover', e => {
		e.preventDefault();
		row.classList.add('drag-over');
	});
	row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
	row.addEventListener('drop', async e => {
		e.preventDefault();
		row.classList.remove('drag-over');
		if (dragSrcValIdx === null || dragSrcValIdx === idx) return;
		const moved = currentValues.splice(dragSrcValIdx, 1)[0];
		currentValues.splice(idx, 0, moved);
		dragSrcValIdx = null;
		renderValues();
		// Persist reorder if values are saved
		const savedIds = currentValues.filter(v => v.id).map(v => v.id);
		if (savedIds.length) await ajax({ action: 'reorder_values', ids: JSON.stringify(savedIds) });
	});

	return row;
}

// ── Edit value text in place ───────────────────────────────────────────────────
function editValueText(idx, span) {
	const v     = currentValues[idx];
	const input = document.createElement('input');
	input.type      = 'text';
	input.value     = v.text;
	input.className = 'opt-value-text-input';
	input.setAttribute('aria-label', 'Option value text');
	span.replaceWith(input);
	input.focus();
	input.select();

	async function save() {
		const newText = input.value.trim();
		if (!newText) { input.focus(); return; }
		v.text = newText;
		if (v.id) {
			await ajax({ action: 'save_value', id: v.id, option_id: currentOptionId || 0, text: newText, image: v.image || '', price_prefix: v.price_prefix || '=', price_modifier: v.price_modifier != null ? v.price_modifier : '', weight_modifier: v.weight_modifier != null ? v.weight_modifier : '' });
		}
		const newSpan       = document.createElement('span');
		newSpan.className   = 'opt-value-text';
		newSpan.textContent = newText;
		newSpan.title       = 'Click to edit';
		newSpan.style.cursor = 'text';
		newSpan.addEventListener('click', () => editValueText(idx, newSpan));
		input.replaceWith(newSpan);
	}

	input.addEventListener('blur', save);
	input.addEventListener('keydown', e => {
		if (e.key === 'Enter')  { e.preventDefault(); save(); }
		if (e.key === 'Escape') {
			const sp = document.createElement('span');
			sp.className   = 'opt-value-text';
			sp.textContent = v.text;
			sp.title       = 'Click to edit';
			sp.style.cursor = 'text';
			sp.addEventListener('click', () => editValueText(idx, sp));
			input.replaceWith(sp);
		}
	});
}

// ── Image picking for values ───────────────────────────────────────────────────
function pickValueImage(idx) {
	if (!window.openFilePicker) { notifyErr('File manager not loaded.'); return; }
	window.openFilePicker(items => {
		if (!items.length) return;
		currentValues[idx].image = items[0].url;
		const v   = currentValues[idx];
		if (v.id) {
			ajax({ action: 'save_value', id: v.id, option_id: currentOptionId || 0, text: v.text, image: v.image, price_prefix: v.price_prefix || '=', price_modifier: v.price_modifier != null ? v.price_modifier : '', weight_modifier: v.weight_modifier != null ? v.weight_modifier : '' });
		}
		renderValues();
	});
}

function uploadValueImage(idx, file) {
	const fd = new FormData();
	fd.append('csrf_token', getCsrfToken());
	fd.append('action', 'upload_value_image');
	fd.append('image', file);
	fetch(AJAX, { method: 'POST', body: fd })
		.then(r => r.json())
		.then(res => {
			if (!res.ok) {
				notifyErr(res.message);
				return;
			}
			currentValues[idx].image = res.url;
			const v = currentValues[idx];
			if (v.id) {
				ajax({ action: 'save_value', id: v.id, option_id: currentOptionId || 0, text: v.text, image: v.image, price_prefix: v.price_prefix || '=', price_modifier: v.price_modifier != null ? v.price_modifier : '', weight_modifier: v.weight_modifier != null ? v.weight_modifier : '' });
			}
			renderValues();
		});
}

// ── Add value ──────────────────────────────────────────────────────────────────
document.getElementById('btn-add-value').addEventListener('click', () => {
	currentValues.push({ id: null, option_id: currentOptionId || 0, text: 'New value', image: '', display_order: currentValues.length, price_prefix: '=', price_modifier: null, weight_modifier: null });
	renderValues();
	// Auto-open edit on last row
	const rows = valList.querySelectorAll('.opt-value-row');
	const last = rows[rows.length - 1];
	if (last) {
		const span = last.querySelector('.opt-value-text');
		if (span) editValueText(currentValues.length - 1, span);
	}
});

// ── Save option ────────────────────────────────────────────────────────────────
document.getElementById('btn-drawer-save').addEventListener('save', async function () {
	const name = optName.value.trim();
	if (!name) { notifyErr('Option name is required.'); optName.focus(); return; }
	this.setLoading();

	const res = await ajax({
		action:      'save',
		id:          optId.value,
		name,
		type:        optType.value,
		placeholder: optPlaceholder.value,
	});
	if (!res.ok) { notifyErr(res.message); this.reset(); return; }

	currentOptionId = res.row.id;
	optId.value     = res.row.id;

	// Save all values (new and existing)
	for (const v of currentValues) {
		const vr = await ajax({
			action:    'save_value',
			id:        v.id || 0,
			option_id: res.row.id,
			text:      v.text,
			image:     v.image || '',
			price_prefix: v.price_prefix || '=',
			price_modifier: v.price_modifier != null ? v.price_modifier : '',
			weight_modifier: v.weight_modifier != null ? v.weight_modifier : '',
		});
		if (vr.ok && !v.id) v.id = vr.row.id;
	}

	this.showSuccess();
	setTimeout(() => { closeDrawer(); loadOptions(); }, 1500);
});

// ── Drawer controls ────────────────────────────────────────────────────────────
document.getElementById('btn-add-option').addEventListener('click', () => openDrawer(null));
document.getElementById('btn-add-first')?.addEventListener('click', () => openDrawer(null));
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);

})();
