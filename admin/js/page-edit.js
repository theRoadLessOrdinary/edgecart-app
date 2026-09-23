/**
 * new-cart — Page editor v3 (2-column: sidebar | main content)
 */
(function() {
'use strict';

const AJAX     = NC.adminUrl + '?route=pages/ajax';
const AJAX_LIB = NC.adminUrl + '?route=block-library/ajax';

function ajax(url, data) {
	const fd = new FormData();
	for (const [k,v] of Object.entries(data)) fd.append(k, String(v ?? ''));
	fd.append('csrf_token', getCsrfToken());
	return fetch(url, { method:'POST', body:fd }).then(r => r.json());
}
function post(data)   { return ajax(AJAX, data); }
function notifyErr(m) { SimpleNotification.error({ text: m }); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const BLOCK_LABELS = {
	rich_text:'Rich Text', html:'HTML', slideshow:'Slideshow',
	menu:'Menu',
	featured_products:'Featured Products', best_sellers:'Best Sellers',
	best_sellers_category:'By Category',   new_arrivals:'New Arrivals',
	random_products:'Random Products',     related_products:'Related Products',
	contact_form:'Form', sitemap:'Site Map',
	cart_contents:'Cart', checkout_form:'Checkout Form',
};

let blocks = [];
let pageId = parseInt(document.getElementById('pe-page-id').value) || 0;

function parsePipe(id) {
	const raw = document.getElementById(id)?.value || '';
	return raw.split('|').filter(Boolean).map(s => {
		const i = s.indexOf(':');
		return { id: s.slice(0, i), name: s.slice(i+1) };
	});
}
const slideshows = parsePipe('pe-slideshows-data');
const categories = parsePipe('pe-categories-data');
const menus      = parsePipe('pe-menus-data');
const forms      = parsePipe('pe-forms-data');

function normalizeCol(val) {
	return (parseInt(val) || 2) >= 2 ? 2 : 1;
}

function colBlocks(col) {
	return blocks.filter(b => b.col_start === col);
}

// ── Load ─────────────────────────────────────────────────────────────────────
async function load() {
	if (!pageId) return renderCanvas();
	const res = await post({ action:'get', id:pageId });
	if (!res.ok) return;
	blocks = (res.blocks||[]).map(b => ({
		...b,
		settings:  b.settings  || {},
		col_start: normalizeCol(b.col_start),
		is_core:   !!(b.settings?.is_core),
	}));
	renderCanvas();
	loadLibrary();
}

// ── Canvas ────────────────────────────────────────────────────────────────────
function renderCanvas() {
	renderColumn(1);
	renderColumn(2);
}

function renderColumn(col) {
	const body = document.getElementById('pe-col-' + col + '-body');
	if (!body) return;

	// Destroy Trumbowyg on existing cards before clearing
	if (window.jQuery) {
		body.querySelectorAll('.pe-block-card').forEach(card => {
			jQuery(card).find('.pe-rte').each(function() {
				const $ta = jQuery(this);
				if ($ta.data('trumbowyg')) try { $ta.trumbowyg('destroy'); } catch(e) {}
			});
		});
	}

	const emptyEl = body.querySelector('.pe-col-empty');
	body.querySelectorAll('.pe-block-card').forEach(el => el.remove());

	const cb = colBlocks(col);
	if (emptyEl) emptyEl.style.display = cb.length ? 'none' : '';

	cb.forEach(b => {
		const card = buildCard(b);
		if (emptyEl) body.insertBefore(card, emptyEl);
		else body.appendChild(card);
	});

	initAllTrumbowyg();
}

// ── Block card ────────────────────────────────────────────────────────────────
function buildCard(b) {
	const card = document.createElement('div');
	card.className = 'pe-block-card' + (b.enabled ? '' : ' pe-disabled') + (b.is_core ? ' pe-core' : '');
	card.dataset.blockId = b.id;
	card.setAttribute('role', 'listitem');

	// ── Head ──
	const head = document.createElement('div');
	head.className = 'pe-block-head';

	const handle = document.createElement('span');
	handle.className = 'pe-drag-handle';
	handle.textContent = '⠿';
	handle.setAttribute('aria-hidden', 'true');
	handle.setAttribute('draggable', 'true');
	handle.addEventListener('dragstart', e => {
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', 'block:' + (b.id || ''));
		setTimeout(() => card.classList.add('pe-drag-source'), 0);
	});
	handle.addEventListener('dragend', () => card.classList.remove('pe-drag-source'));

	const label = document.createElement('span');
	label.className = 'pe-block-label';
	label.textContent = BLOCK_LABELS[b.block_type] || b.block_type;

	const nameInp = document.createElement('input');
	nameInp.type = 'text';
	nameInp.className = 'pe-block-name-input';
	nameInp.value = b.name || '';
	nameInp.placeholder = 'name…';
	nameInp.title = 'Give this block a name to save it to the library';
	let nameTimer;
	nameInp.addEventListener('input', () => {
		clearTimeout(nameTimer);
		nameTimer = setTimeout(() => saveBlockName(b, nameInp.value.trim()), 800);
	});
	nameInp.addEventListener('blur', () => { clearTimeout(nameTimer); saveBlockName(b, nameInp.value.trim()); });

	if (b.is_core) {
		const badge = document.createElement('span');
		badge.className = 'pe-core-badge';
		badge.textContent = 'Core';
		badge.title = 'This block is required and cannot be removed';
		head.append(handle, label, nameInp, badge);
	} else {
		const dip = document.createElement('delete-in-place');
		dip.setAttribute('caption', '✕');
		dip.setAttribute('confirm', 'OK?');
		dip.className = 'pe-block-delete-btn';
		dip.addEventListener('dip-confirm', function () {
			const col = b.col_start;
			animateDelete(card, async function () {
				if (b.id) await post({ action:'delete_block', id:b.id });
				const i = blocks.indexOf(b);
				if (i > -1) blocks.splice(i, 1);
				renderColumn(col);
			});
		});
		head.append(handle, label, nameInp, dip);
	}

	// ── Body ──
	const body = document.createElement('div');
	body.className = 'pe-block-body';
	buildBlockFields(b, body);

	card.appendChild(head);
	card.appendChild(body);

	// Drop target: insert this card as the insertion point
	card.addEventListener('dragover', e => {
		if (!e.dataTransfer.types.includes('text/plain')) return;
		e.preventDefault();
		e.stopPropagation();
		card.classList.add('pe-drop-before');
	});
	card.addEventListener('dragleave', e => {
		if (!card.contains(e.relatedTarget)) card.classList.remove('pe-drop-before');
	});
	card.addEventListener('drop', async e => {
		e.preventDefault();
		e.stopPropagation();
		card.classList.remove('pe-drop-before');
		// Remove drop-over highlight from parent column body
		card.closest('.pe-col-body')?.classList.remove('pe-col-drop-over');
		const raw = e.dataTransfer.getData('text/plain') || '';
		if (raw.startsWith('block:')) {
			const srcId = parseInt(raw.slice(6));
			if (srcId !== b.id) await moveBlockBefore(srcId, b);
		} else if (raw) {
			await addBlockBefore(raw, b);
		}
	});

	return card;
}

// ── Column drop targets ───────────────────────────────────────────────────────
[1, 2].forEach(col => {
	const colBody = document.getElementById('pe-col-' + col + '-body');
	if (!colBody) return;

	colBody.addEventListener('dragover', e => {
		e.preventDefault();
		colBody.classList.add('pe-col-drop-over');
	});
	colBody.addEventListener('dragleave', e => {
		if (!colBody.contains(e.relatedTarget)) colBody.classList.remove('pe-col-drop-over');
	});
	colBody.addEventListener('drop', async e => {
		e.preventDefault();
		colBody.classList.remove('pe-col-drop-over');
		const raw = e.dataTransfer.getData('text/plain') || '';
		if (raw.startsWith('block:')) {
			const srcId = parseInt(raw.slice(6));
			await moveBlockToColumn(srcId, col);
		} else if (raw) {
			await addBlock(raw, col);
		}
	});
});

// ── Block operations ──────────────────────────────────────────────────────────
async function moveBlockBefore(srcId, targetBlock) {
	const src = blocks.find(x => x.id === srcId);
	if (!src || src === targetBlock) return;

	const oldCol = src.col_start;
	src.col_start = targetBlock.col_start;

	const srcI = blocks.indexOf(src);
	blocks.splice(srcI, 1);
	const dstI = blocks.indexOf(targetBlock);
	blocks.splice(dstI, 0, src);

	if (oldCol !== src.col_start) await saveBlock(src);
	await reorderAll();
	renderColumn(src.col_start);
	if (oldCol !== src.col_start) renderColumn(oldCol);
}

async function moveBlockToColumn(srcId, col) {
	const src = blocks.find(x => x.id === srcId);
	if (!src) return;

	const oldCol = src.col_start;
	src.col_start = col;

	// Move to end of target column in the array
	const srcI = blocks.indexOf(src);
	blocks.splice(srcI, 1);
	const cb = blocks.filter(b => b.col_start === col);
	const last = cb[cb.length - 1];
	const insAt = last ? blocks.indexOf(last) + 1 : blocks.length;
	blocks.splice(insAt, 0, src);

	if (oldCol !== col) await saveBlock(src);
	await reorderAll();
	renderColumn(col);
	if (oldCol !== col) renderColumn(oldCol);
}

async function addBlockBefore(type, targetBlock) {
	if (!pageId) { const ok = await savePage(); if (!ok) return; }
	const col = targetBlock.col_start;
	const res = await post({
		action:'save_block', id:0, page_id:pageId,
		block_type:type, settings:'{}', enabled:1, col_start:col,
	});
	if (!res.ok) { notifyErr(res.message || 'Could not add block.'); return; }
	const b = { ...res.block, settings:res.block.settings||{}, col_start:col, is_core:false };
	const dstI = blocks.indexOf(targetBlock);
	blocks.splice(dstI, 0, b);
	await reorderAll();
	renderColumn(col);
}

async function addBlock(type, col) {
	col = col || 2;
	if (!pageId) { const ok = await savePage(); if (!ok) return; }
	const res = await post({
		action:'save_block', id:0, page_id:pageId,
		block_type:type, settings:'{}', enabled:1, col_start:col,
	});
	if (!res.ok) { notifyErr(res.message || 'Could not add block.'); return; }
	const b = { ...res.block, settings:res.block.settings||{}, col_start:col, is_core:false };
	blocks.push(b);
	await reorderAll();
	renderColumn(col);
	setTimeout(() => {
		const body = document.getElementById('pe-col-' + col + '-body');
		const cards = body?.querySelectorAll('.pe-block-card');
		cards?.[cards.length-1]?.scrollIntoView({ behavior:'smooth', block:'nearest' });
	}, 50);
}

async function reorderAll() {
	const ids = blocks.filter(b => b.id).map(b => b.id);
	if (ids.length) await post({ action:'reorder_blocks', ids:JSON.stringify(ids) });
}

// ── Palette buttons ───────────────────────────────────────────────────────────
document.querySelectorAll('.pe-pal-btn').forEach(btn => {
	btn.setAttribute('draggable', 'true');
	btn.addEventListener('dragstart', e => {
		e.dataTransfer.effectAllowed = 'copy';
		try { e.dataTransfer.setData('text/plain', btn.dataset.type); } catch(_) {}
	});
	btn.addEventListener('click', () => {
		if (!btn.disabled) addBlock(btn.dataset.type, 2);
	});
});

// ── Save block ────────────────────────────────────────────────────────────────
async function saveBlock(b) {
	if (!b?.id || !pageId) return;
	await post({
		action:     'save_block',
		id:         b.id,
		page_id:    pageId,
		block_type: b.block_type,
		settings:   JSON.stringify(b.settings || {}),
		enabled:    b.enabled ?? 1,
		col_start:  b.col_start || 2,
	});
}

// ── Save block name / library ─────────────────────────────────────────────────
async function saveBlockName(b, name) {
	b.name = name;
	await saveBlock(b);
	if (name) {
		await ajax(AJAX_LIB, { action:'save', block_id:b.id, name });
		loadLibrary();
	}
}

async function loadLibrary() {
	const list = document.getElementById('pe-library-list');
	if (!list) return;
	const res = await ajax(AJAX_LIB, { action:'list' });
	if (!res.ok || !res.items?.length) {
		list.innerHTML = '<p class="pe-library-empty">No saved blocks yet.</p>';
		return;
	}
	list.innerHTML = '';
	res.items.forEach(item => {
		const el = document.createElement('div');
		el.className = 'pe-library-item';
		el.textContent = item.name;
		el.title = 'Click to insert';
		el.addEventListener('click', () => insertLibraryBlock(item));
		list.appendChild(el);
	});
}

async function insertLibraryBlock(item) {
	if (!pageId) { const ok = await savePage(); if (!ok) return; }
	const res = await post({
		action:'save_block', id:0, page_id:pageId,
		block_type:'library_ref', settings:JSON.stringify({library_id:item.id}),
		enabled:1, col_start:2,
	});
	if (!res.ok) { notifyErr('Could not insert block.'); return; }
	blocks.push({ ...res.block, settings:res.block.settings||{}, col_start:2 });
	renderColumn(2);
}

// ── Block field builders ──────────────────────────────────────────────────────
function buildProductFields(b, body) {
	const s = b.settings || {};
	const subtypes = [
		{ value:'featured_products',     label:'Featured Products' },
		{ value:'best_sellers',          label:'Best Sellers' },
		{ value:'best_sellers_category', label:'By Category' },
		{ value:'new_arrivals',          label:'New Arrivals' },
		{ value:'random_products',       label:'Random Products' },
		{ value:'related_products',      label:'Related Products' },
	];
	const typeSel = document.createElement('select');
	typeSel.innerHTML = subtypes.map(t =>
		`<option value="${t.value}"${b.block_type===t.value?' selected':''}>${esc(t.label)}</option>`
	).join('');
	typeSel.addEventListener('change', async () => {
		b.block_type = typeSel.value;
		const card = body.closest('.pe-block-card');
		if (card) {
			const labelEl = card.querySelector('.pe-block-label');
			if (labelEl) labelEl.textContent = BLOCK_LABELS[b.block_type] || b.block_type;
		}
		await saveBlock(b);
		body.innerHTML = '';
		buildProductFields(b, body);
	});
	body.appendChild(labelWrap('Type', typeSel));

	let catSel = null;
	if (b.block_type === 'best_sellers_category') {
		catSel = document.createElement('select');
		catSel.innerHTML = '<option value="">— Select category —</option>' +
			categories.map(x => `<option value="${x.id}"${s.category_id==x.id?' selected':''}>${esc(x.name)}</option>`).join('');
		catSel.addEventListener('change', async () => { b.settings.category_id = catSel.value; await saveBlock(b); checkProductCount(); });
		body.appendChild(labelWrap('Category', catSel));
	}
	body.appendChild(makeField('Heading',    'text',   { value:s.heading||'',    key:'heading' }, b));
	body.appendChild(makeField('Count',      'number', { value:s.count||6,       key:'count',      min:1,  max:24  }, b));
	body.appendChild(makeField('Thumb Size', 'number', { value:s.thumb_size||'', key:'thumb_size', min:40, max:600 }, b));

	// "Related Products" only ever has content on a real product page, being
	// empty here is expected, not a misconfiguration — no warning for it.
	if (b.block_type === 'related_products') return;

	const warn = document.createElement('div');
	warn.className = 'pe-field-warning';
	warn.style.cssText = 'display:none;margin-top:.5rem;padding:.5rem .75rem;background:#fef3c7;color:#92400e;border-radius:var(--nc-radius,.375rem);font-size:.82rem';
	body.appendChild(warn);

	let countTimer;
	async function checkProductCount() {
		clearTimeout(countTimer);
		countTimer = setTimeout(async () => {
			const res = await post({ action: 'product_count', type: b.block_type, category_id: catSel ? catSel.value : '' });
			if (!res.ok) return;
			warn.style.display = res.count === 0 ? '' : 'none';
			warn.textContent = res.count === 0
				? (b.block_type === 'best_sellers_category' && !(catSel && catSel.value)
					? 'No category selected — this block won\'t show anything on the page.'
					: 'No matching products found — this block won\'t show anything on the page.')
				: '';
		}, 400);
	}
	checkProductCount();
	typeSel.addEventListener('change', checkProductCount);
}

function buildBlockFields(b, body) {
	const s = b.settings || {};
	switch (b.block_type) {
		case 'rich_text': {
			const ta = document.createElement('textarea');
			ta.className = 'pe-rte';
			ta.value = s.content || '';
			body.appendChild(ta);
			break;
		}
		case 'html':
			body.appendChild(makeField('HTML', 'textarea', { value:s.html||'', key:'html', rows:6, mono:true }, b));
			break;
		case 'slideshow': {
			const sel = document.createElement('select');
			sel.innerHTML = '<option value="">— Select slideshow —</option>' +
				slideshows.map(x => `<option value="${x.id}"${s.slideshow_id==x.id?' selected':''}>${esc(x.name)}</option>`).join('');
			sel.addEventListener('change', async () => { b.settings.slideshow_id = sel.value; await saveBlock(b); });
			body.appendChild(labelWrap('Slideshow', sel));
			break;
		}
		case 'featured_products': case 'best_sellers': case 'new_arrivals':
		case 'best_sellers_category': case 'related_products': case 'random_products':
			buildProductFields(b, body);
			break;
		case 'menu': {
			const sel = document.createElement('select');
			sel.innerHTML = '<option value="">— Select menu —</option>' +
				menus.map(x => `<option value="${x.id}"${s.menu_id==x.id?' selected':''}>${esc(x.name)}</option>`).join('');
			sel.addEventListener('change', async () => { b.settings.menu_id = sel.value; await saveBlock(b); });
			body.appendChild(labelWrap('Menu', sel));
			break;
		}
		case 'cart_contents': case 'checkout_form': {
			const note = document.createElement('p');
			note.style.cssText = 'font-size:.8rem;color:var(--nc-text-dim);padding:.25rem 0';
			note.textContent = b.block_type === 'cart_contents'
				? 'Displays the shopping cart table and checkout button.'
				: 'Displays the checkout address and payment form.';
			body.appendChild(note);
			break;
		}
		case 'sitemap': {
			const note = document.createElement('p');
			note.style.cssText = 'font-size:.8rem;color:var(--nc-text-dim);padding:.25rem 0';
			note.textContent = 'Renders site map automatically.';
			body.appendChild(note);
			break;
		}
		case 'contact_form': {
			const s = b.settings || {};
			const formSel = document.createElement('select');
			formSel.innerHTML = '<option value="">— Select form —</option>' +
				forms.map(x => `<option value="${x.id}"${s.form_id==x.id?' selected':''}>${esc(x.name)}</option>`).join('');
			formSel.addEventListener('change', async () => { b.settings.form_id = formSel.value; await saveBlock(b); });
			body.appendChild(labelWrap('Form', formSel));

			const displaySel = document.createElement('select');
			displaySel.innerHTML =
				`<option value="0"${!s.modal?' selected':''}>Inline</option>` +
				`<option value="1"${s.modal?' selected':''}>Modal (button)</option>`;
			displaySel.addEventListener('change', async () => { b.settings.modal = displaySel.value === '1'; await saveBlock(b); });
			body.appendChild(labelWrap('Display', displaySel));

			const btnIn = document.createElement('input');
			btnIn.type = 'text'; btnIn.value = s.btn_label || ''; btnIn.placeholder = 'Ask a question';
			let t;
			btnIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { b.settings.btn_label = btnIn.value; await saveBlock(b); }, 600); });
			body.appendChild(labelWrap('Button Label', btnIn));
			break;
		}
	}
}

function makeField(labelText, type, opts, b) {
	const wrap = document.createElement('div');
	wrap.className = 'pe-field';
	const lbl = document.createElement('label');
	lbl.textContent = labelText;

	let el;
	if (type === 'textarea') {
		el = document.createElement('textarea');
		el.rows = opts.rows || 4;
		if (opts.mono) el.style.fontFamily = 'monospace';
		el.value = opts.value || '';
		// Tab key → insert tab character
		el.addEventListener('keydown', e => {
			if (e.key === 'Tab') {
				e.preventDefault();
				const start = el.selectionStart;
				const end = el.selectionEnd;
				const val = el.value;
				el.value = val.substring(0, start) + '\t' + val.substring(end);
				el.selectionStart = el.selectionEnd = start + 1;
				el.dispatchEvent(new Event('input', { bubbles: true }));
			}
		});
	} else {
		el = document.createElement('input');
		el.type = type;
		el.value = opts.value || '';
		if (opts.min !== undefined) el.min = opts.min;
		if (opts.max !== undefined) el.max = opts.max;
	}

	let t;
	const doSave = async () => {
		if (!b.settings) b.settings = {};
		b.settings[opts.key] = el.value;
		await saveBlock(b);
	};
	el.addEventListener('input',  () => { clearTimeout(t); t = setTimeout(doSave, 600); });
	el.addEventListener('blur',   () => { clearTimeout(t); doSave(); });
	el.addEventListener('change', () => { clearTimeout(t); doSave(); });

	wrap.appendChild(lbl);
	wrap.appendChild(el);
	return wrap;
}

function labelWrap(labelText, el) {
	const wrap = document.createElement('div');
	wrap.className = 'pe-field';
	const lbl = document.createElement('label');
	lbl.textContent = labelText;
	wrap.appendChild(lbl);
	wrap.appendChild(el);
	return wrap;
}

// ── Trumbowyg ─────────────────────────────────────────────────────────────────
function initAllTrumbowyg() {
	if (!window.jQuery || !jQuery.fn.trumbowyg) return;
	document.querySelectorAll('.pe-rte').forEach(ta => {
		const $ta = jQuery(ta);
		if ($ta.data('trumbowyg')) return;
		const blockId = parseInt(ta.closest('.pe-block-card')?.dataset.blockId);
		$ta.trumbowyg({
			svgPath: NC.rootUrl + 'js/vendor/trumbowyg/src/ui/icons.svg',
			semantic: false,
			btns: [
				['bold','italic','underline'],
				['link'],
				['unorderedList','orderedList'],
				['indent','outdent'],
				['fontsize', 'fontfamily'],
				['viewHTML'],
			].concat(window.ncTrumbowygExtraBtns || []),
			plugins: {
				fontsize: {
					sizeList: ['x-small', 'small', 'medium', 'large', 'x-large'],
					allowCustomSize: true
				},
				fontfamily: {
					fontList: [
						{name: 'Inter', family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"},
						{name: 'Montserrat', family: "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"}
					]
				}
			}
		});

		// File manager image button
		setTimeout(() => {
			const toolbar = $ta.closest('.trumbowyg-box')[0]?.querySelector('.trumbowyg-button-pane');
			if (!toolbar || toolbar.querySelector('.nc-fm-img-btn')) return;
			const fmBtn = document.createElement('button');
			fmBtn.type = 'button';
			fmBtn.className = 'nc-fm-img-btn';
			fmBtn.style.cssText = 'padding:2px 6px;cursor:pointer;border:none;background:none;font-size:14px;height:35px;color:var(--nc-text,#333)';
			fmBtn.title = 'Insert image';
			fmBtn.textContent = '🖼';
			fmBtn.addEventListener('mousedown', e => e.preventDefault());
			fmBtn.addEventListener('click', e => {
				e.preventDefault();
				if (!window.openFilePicker) return;
				openFilePicker(items => {
					if (!items.length) return;
					const ed = $ta.closest('.trumbowyg-box')[0]?.querySelector('.trumbowyg-editor');
					if (ed) ed.focus();
					$ta.trumbowyg('execCmd', {
						cmd:'insertHTML',
						param:'<img src="' + items[0].url + '" alt="" style="max-width:100%">',
						forceCss:false,
					});
				});
			});
			toolbar.appendChild(fmBtn);
		}, 0);

		// Image click → properties panel
		const editor = $ta.closest('.trumbowyg-box')[0]?.querySelector('.trumbowyg-editor');
		if (editor) {
			editor.addEventListener('click', e => {
				if (e.target.tagName === 'IMG') openImgPanel(e.target, e);
			});

			// Tab key → insert tab character (visual editor)
			editor.addEventListener('keydown', e => {
				if (e.key === 'Tab') {
					e.preventDefault();
					const sel = window.getSelection();
					const range = sel.getRangeAt(0);
					const tab = document.createTextNode('\t');
					range.deleteContents();
					range.insertNode(tab);
					range.setStartAfter(tab);
					range.collapse(true);
					sel.removeAllRanges();
					sel.addRange(range);
				}
			});
		}

		// Tab key support in code view (viewHTML mode)
		$ta.on('tbwfocus', function() {
			const box = $ta.closest('.trumbowyg-box')[0];
			if (!box) return;
			const codeArea = box.querySelector('textarea');
			if (codeArea && !codeArea.dataset.tabHandlerAdded) {
				codeArea.addEventListener('keydown', e => {
					if (e.key === 'Tab') {
						e.preventDefault();
						const start = codeArea.selectionStart;
						const end = codeArea.selectionEnd;
						const val = codeArea.value;
						codeArea.value = val.substring(0, start) + '\t' + val.substring(end);
						codeArea.selectionStart = codeArea.selectionEnd = start + 1;
						codeArea.dispatchEvent(new Event('input', { bubbles: true }));
					}
				});
				codeArea.dataset.tabHandlerAdded = 'true';
			}
		});

		$ta.on('tbwchange tbwblur', async function() {
			const b = blocks.find(x => x.id === blockId);
			if (!b) return;
			if (!b.settings) b.settings = {};
			b.settings.content = $ta.trumbowyg('html');
			await saveBlock(b);
		});
	});
}

// ── Image properties panel ────────────────────────────────────────────────────
const imgPanel  = document.getElementById('pe-img-panel');
let   imgTarget = null;
let   imgAspectRatio = 1; // Original aspect ratio

function evaluateExpression(expr) {
	try {
		expr = expr.trim();
		if (!expr) return null;
		// Safe evaluation: only allow numbers and basic math operators
		if (!/^[\d+\-*/(). ]*$/.test(expr)) return null;
		const result = Function('"use strict"; return (' + expr + ')')();
		return Number.isFinite(result) && result > 0 ? Math.round(result) : null;
	} catch (e) {
		return null;
	}
}

function openImgPanel(img, e) {
	imgTarget = img;
	const style = img.style;

	// Store original aspect ratio
	imgAspectRatio = img.naturalWidth && img.naturalHeight ?
		img.naturalWidth / img.naturalHeight : 1;

	// Load current dimensions: explicit style first, then natural dimensions
	const currentWidth = style.width ? parseInt(style.width) : (img.naturalWidth || null);
	const currentHeight = style.height ? parseInt(style.height) : (img.naturalHeight || null);
	document.getElementById('pi-width').value  = currentWidth || '';
	document.getElementById('pi-height').value = currentHeight || '';

	document.getElementById('pi-border').value  = parseInt(style.borderWidth) || img.getAttribute('border') || 0;
	document.getElementById('pi-align').value   = img.getAttribute('align') || style.float || '';
	document.getElementById('pi-hspace').value  = parseInt(style.marginLeft) || img.getAttribute('hspace') || 0;
	document.getElementById('pi-vspace').value  = parseInt(style.marginTop)  || img.getAttribute('vspace') || 0;
	document.getElementById('pi-lock-aspect').checked = true;

	const link = img.closest('a');
	document.getElementById('pi-link').value    = link ? link.href : '';
	document.getElementById('pi-target').value  = link ? (link.target || '') : '';
	const rect = img.getBoundingClientRect();
	imgPanel.style.display = '';

	// Position panel to keep fully on screen
	const panelWidth = 340;
	const panelHeight = 350;
	const gap = 8;

	let top = rect.bottom + gap;
	if (top + panelHeight > window.innerHeight) {
		top = Math.max(gap, rect.top - panelHeight - gap);
	}

	let left = Math.max(gap, Math.min(rect.left, window.innerWidth - panelWidth - gap));

	imgPanel.style.top  = top + 'px';
	imgPanel.style.left = left + 'px';
	document.getElementById('pi-width').focus();
}

// Width/height field handlers with math expression support
document.getElementById('pi-width').addEventListener('blur', () => {
	const widthInput = document.getElementById('pi-width');
	const heightInput = document.getElementById('pi-height');
	const lockAspect = document.getElementById('pi-lock-aspect').checked;

	const width = evaluateExpression(widthInput.value);
	if (width !== null) {
		widthInput.value = width;
		if (lockAspect && imgAspectRatio > 0) {
			const newHeight = Math.round(width / imgAspectRatio);
			heightInput.value = newHeight;
		}
	}
});

document.getElementById('pi-height').addEventListener('blur', () => {
	const widthInput = document.getElementById('pi-width');
	const heightInput = document.getElementById('pi-height');
	const lockAspect = document.getElementById('pi-lock-aspect').checked;

	const height = evaluateExpression(heightInput.value);
	if (height !== null) {
		heightInput.value = height;
		if (lockAspect && imgAspectRatio > 0) {
			const newWidth = Math.round(height * imgAspectRatio);
			widthInput.value = newWidth;
		}
	}
});

document.getElementById('pe-img-panel-close').addEventListener('click', () => {
	imgPanel.style.display = 'none'; imgTarget = null;
});
document.addEventListener('mousedown', e => {
	if (imgPanel.style.display !== 'none' && !imgPanel.contains(e.target) && e.target !== imgTarget) {
		imgPanel.style.display = 'none'; imgTarget = null;
	}
});
document.getElementById('pe-img-panel-save').addEventListener('click', () => {
	if (!imgTarget) return;
	const originalSrc = imgTarget.src;   // match key into the freshly-read html below
	const border  = parseInt(document.getElementById('pi-border').value) || 0;
	const align   = document.getElementById('pi-align').value;
	const hspace  = parseInt(document.getElementById('pi-hspace').value) || 0;
	const vspace  = parseInt(document.getElementById('pi-vspace').value) || 0;
	const width   = evaluateExpression(document.getElementById('pi-width').value);
	const height  = evaluateExpression(document.getElementById('pi-height').value);
	const linkUrl = document.getElementById('pi-link').value.trim();
	const target  = document.getElementById('pi-target').value;

	// Apply to imgTarget too, for instant visual feedback in the ordinary case.
	// It is not what gets saved — see the comment below.
	applyImgProps(imgTarget, { border, align, hspace, vspace, width, height });
	applyImgLink(imgTarget, linkUrl, target);

	const card = imgTarget.closest('.pe-block-card');
	if (card && window.jQuery) {
		const blockId = parseInt(card.dataset.blockId);
		const b = blocks.find(x => x.id === blockId);
		if (b) {
			const $ta = jQuery(card).find('.pe-rte');
			if ($ta.length && $ta.data('trumbowyg')) {
				if (!b.settings) b.settings = {};

				// Trumbowyg re-syncs, and can rebuild, its editor DOM on blur — which
				// fires the moment this panel opens, before any of the fields above
				// are even touched. That can leave `imgTarget` pointing at a node no
				// longer in the document, so mutating it (above) silently goes
				// nowhere. To save reliably regardless, re-read the editor's current
				// html fresh, find the matching <img> by its original src, and apply
				// every property there instead — the same match-by-src approach the
				// old code used for width/height only, which is why those two were
				// the only properties that ever reliably persisted.
				const temp = document.createElement('div');
				temp.innerHTML = $ta.trumbowyg('html');
				const match = Array.from(temp.querySelectorAll('img')).find(im => im.src === originalSrc);
				if (match) {
					applyImgProps(match, { border, align, hspace, vspace, width, height });
					applyImgLink(match, linkUrl, target);
				}

				b.settings.content = temp.innerHTML;
				saveBlock(b);
			}
		}
	}
	imgPanel.style.display = 'none'; imgTarget = null;
});

// Border/align/hspace/vspace/width/height, applied identically whether the
// target is the live editor node or a detached <img> parsed from saved html.
function applyImgProps(img, p) {
	img.style.borderWidth  = p.border ? p.border + 'px' : '';
	img.style.borderStyle  = p.border ? 'solid' : '';
	img.style.float        = (p.align === 'left' || p.align === 'right') ? p.align : '';
	img.style.display      = p.align === 'center' ? 'block' : '';
	img.style.margin       = p.align === 'center' ? '0 auto' : '';
	// H-Space means the float gutter; centering already uses auto margins, so
	// hspace doesn't apply there — setting it would overwrite the "auto" and
	// break centering.
	if (p.align !== 'center') {
		img.style.marginLeft  = p.hspace ? p.hspace + 'px' : '';
		img.style.marginRight = p.hspace ? p.hspace + 'px' : '';
	}
	img.style.marginTop    = p.vspace ? p.vspace + 'px' : '';
	img.style.marginBottom = p.vspace ? p.vspace + 'px' : '';
	img.style.width        = p.width ? p.width + 'px' : '';
	img.style.height       = p.height ? p.height + 'px' : '';
}

function applyImgLink(img, linkUrl, target) {
	const existingLink = img.closest('a');
	if (linkUrl) {
		if (existingLink) {
			existingLink.href = linkUrl; existingLink.target = target;
		} else {
			const a = document.createElement('a');
			a.href = linkUrl; a.target = target;
			img.parentNode.insertBefore(a, img);
			a.appendChild(img);
		}
	} else if (existingLink) {
		existingLink.parentNode.insertBefore(img, existingLink);
		existingLink.remove();
	}
}

// ── Save page ─────────────────────────────────────────────────────────────────
async function savePage() {
	const title = document.getElementById('pe-title').value.trim();
	if (!title) { notifyErr('Title is required.'); return false; }

	// Flush Trumbowyg content into block settings
	if (window.jQuery) {
		document.querySelectorAll('.pe-rte').forEach(ta => {
			const $ta = jQuery(ta);
			if (!$ta.data('trumbowyg')) return;
			const blockId = parseInt(ta.closest('.pe-block-card')?.dataset.blockId);
			const b = blocks.find(x => x.id === blockId);
			if (b) {
				if (!b.settings) b.settings = {};
				b.settings.content = $ta.trumbowyg('html');
			}
		});
	}

	const res = await post({
		action:          'save',
		id:              pageId,
		title,
		slug:            document.getElementById('pe-slug').value.trim(),
		status:          document.getElementById('pe-status').value,
		is_home:         (document.getElementById('pe-is-home')?.checked) ? 1 : 0,
		seo_title:       document.getElementById('pe-seo-title').value,
		seo_keywords:    document.getElementById('pe-seo-keywords').value,
		seo_description: document.getElementById('pe-seo-desc').value,
	});
	if (!res.ok) { notifyErr(res.message); return false; }
	if (res.page?.id && res.page.id != pageId) {
		pageId = res.page.id;
		document.getElementById('pe-page-id').value = pageId;
		document.getElementById('pe-preview-btn').style.display = '';
		const url = new URL(window.location.href);
		url.searchParams.set('id', pageId);
		history.replaceState({}, '', url);
	}
	SimpleNotification.success({ text: 'Page saved.' });
	return true;
}

document.getElementById('pe-save-btn').addEventListener('click', savePage);

// ── Clear canvas ──────────────────────────────────────────────────────────────
(function() {
	const btn = document.getElementById('pe-clear-btn');
	if (!btn) return;
	let armed = false, armTimer;
	btn.addEventListener('click', async function() {
		if (!blocks.length) return;
		if (!armed) {
			armed = true;
			btn.textContent = 'Confirm clear';
			btn.classList.add('pe-btn-danger');
			armTimer = setTimeout(() => {
				armed = false;
				btn.textContent = 'Clear Canvas';
				btn.classList.remove('pe-btn-danger');
			}, 3000);
			return;
		}
		clearTimeout(armTimer);
		armed = false; btn.textContent = 'Clear Canvas'; btn.classList.remove('pe-btn-danger');

		const toDelete = blocks.filter(b => !b.is_core);
		const toKeep   = blocks.filter(b => b.is_core);
		for (const b of toDelete) {
			if (b.id) await post({ action:'delete_block', id:b.id });
		}
		blocks = toKeep;
		renderCanvas();

		if (toKeep.length) {
			setTimeout(() => {
				document.querySelectorAll('.pe-block-card.pe-core').forEach(card => {
					card.classList.add('pe-core-flash');
					card.addEventListener('animationend', () => card.classList.remove('pe-core-flash'), { once:true });
				});
			}, 0);
		}
	});
}());

// ── Properties drawer ─────────────────────────────────────────────────────────
const propsDrawer  = document.getElementById('pe-props-drawer');
const propsOverlay = (function() {
	let ov = document.getElementById('pe-props-overlay');
	if (!ov) {
		ov = document.createElement('div');
		ov.id = 'pe-props-overlay';
		ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:499;background:rgba(0,0,0,0.4);';
		document.body.appendChild(ov);
	}
	return ov;
}());

function openPropsDrawer()  { propsDrawer?.classList.add('open','slideInRight'); propsOverlay.style.display = 'block'; }
function closePropsDrawer() { propsDrawer?.classList.remove('open','slideInRight'); propsOverlay.style.display = 'none'; }

document.getElementById('pe-props-btn')?.addEventListener('click', openPropsDrawer);
document.getElementById('pe-props-close')?.addEventListener('click', closePropsDrawer);
document.getElementById('pe-props-save')?.addEventListener('click', async () => { await savePage(); closePropsDrawer(); });
propsOverlay.addEventListener('click', closePropsDrawer);

document.getElementById('pe-preview-btn')?.addEventListener('click', async () => {
	if (!pageId) return;
	const res = await post({ action:'preview_token', id:pageId });
	if (!res.ok) { notifyErr(res.message || 'Could not generate preview.'); return; }
	window.open(NC.rootUrl + 'page-preview/' + res.token, '_blank', 'noopener');
});

// ── Page switcher ─────────────────────────────────────────────────────────────
document.getElementById('pe-page-switcher')?.addEventListener('change', function() {
	if (this.value) window.location.href = NC.adminUrl + '?route=page-edit&id=' + this.value;
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
(function() {
	const canvas = document.getElementById('pe-canvas');
	const toggleBtn = document.getElementById('pe-sidebar-toggle');
	if (!canvas || !toggleBtn || !pageId) return;

	// Toggle sidebar position on button click
	toggleBtn.addEventListener('click', async (e) => {
		e.preventDefault();
		canvas.classList.toggle('sidebar-right');
		const position = canvas.classList.contains('sidebar-right') ? 'right' : 'left';

		// Save to database
		const res = await post({ action: 'set_sidebar_position', id: pageId, position: position });
		if (!res.ok) {
			notifyErr(res.message || 'Could not save sidebar position.');
			// Revert toggle on error
			canvas.classList.toggle('sidebar-right');
		}
	});
}());

// ── Init ──────────────────────────────────────────────────────────────────────
load();

})();
