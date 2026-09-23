/**
 * new-cart admin — Pages
 */
(function () {
'use strict';

const AJAX = NC.adminUrl + '?route=pages/ajax';

function ajax(data) {
	const fd = new FormData();
	for (const [k,v] of Object.entries(data)) fd.append(k, v);
	fd.append('csrf_token', getCsrfToken());
	return fetch(AJAX, { method:'POST', body:fd }).then(r => r.json());
}
function notifyOk(m)  { SimpleNotification.success({ text: m }); }
function notifyErr(m) { SimpleNotification.error({ text: m }); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── State ──────────────────────────────────────────────────────────────────────
let currentBlocks = [];
let blockToggleCtrl = new AbortController();
let dragSrc = null;

// ── Elements ───────────────────────────────────────────────────────────────────
const tbody    = document.getElementById('pages-tbody');
const table    = document.getElementById('pages-table');
const emptyMsg = document.getElementById('pages-empty');
const drawer   = document.getElementById('page-drawer');
const overlay  = document.getElementById('drawer-overlay');

loadPages();

// ── Load ───────────────────────────────────────────────────────────────────────
async function loadPages() {
	const res = await ajax({ action:'list' });
	if (!res.ok) { notifyErr(res.message); return; }
	renderList(res.rows || []);
}

const CORE_TYPES   = ['home', 'account', 'cart', 'checkout', 'product', 'about', 'contact', 'privacy', 'returns', 'terms'];
const SYSTEM_TYPES = CORE_TYPES; // all core pages have before/after content slots surrounding their blocks

function makePageRow(r) {
	const isCore = CORE_TYPES.includes(r.page_type);
	const tr = document.createElement('tr');
	tr.dataset.id = r.id;
	tr.innerHTML =
		'<td>' + (!isCore ? '<span class="drag-handle" aria-hidden="true">⠿</span>' : '') + '</td>' +
		'<td><a class="nc-table-link" href="' + NC.adminUrl + '?route=page-edit&id=' + r.id + '">' + esc(r.title) + '</a></td>' +
		'<td><code>' + esc(r.slug) + '</code></td>' +
		'<td>' + (['<span class="badge-inactive">Draft</span>','<span class="badge-active">Public</span>','<span class="badge-link">With Link</span>'][r.status] || '<span class="badge-inactive">Draft</span>') + '</td>' +
		'<td>' + (isCore
			? '<span class="badge-system" title="System page — cannot be deleted">&#128274;</span>'
			: '<delete-in-place caption="🗑" confirm="Delete page?" data-id="' + r.id + '"></delete-in-place>') + '</td>';
	return tr;
}

function makeSectionRow(label) {
	const tr = document.createElement('tr');
	tr.className = 'pages-section-head';
	tr.innerHTML = '<td colspan="5">' + label + '</td>';
	return tr;
}

function renderList(rows) {
	tbody.innerHTML = '';
	emptyMsg.style.display = 'none';
	table.style.display    = '';

	// Preserve the backend's order (display_order ASC, title ASC) — this used
	// to re-sort both groups alphabetically by title on every render, which
	// silently discarded any saved drag-reorder the moment the list reloaded.
	const core = rows.filter(r => CORE_TYPES.includes(r.page_type));
	const site = rows.filter(r => !CORE_TYPES.includes(r.page_type));

	tbody.appendChild(makeSectionRow('Core'));
	core.forEach(r => tbody.appendChild(makePageRow(r)));
	if (!core.length) {
		const empty = document.createElement('tr');
		empty.innerHTML = '<td colspan="5" style="color:var(--nc-text-dim);font-size:.85rem;padding:.5rem .85rem">No core pages found.</td>';
		tbody.appendChild(empty);
	}

	tbody.appendChild(makeSectionRow('Your Site'));
	site.forEach(r => tbody.appendChild(makePageRow(r)));
	if (!site.length) {
		const empty = document.createElement('tr');
		empty.innerHTML = '<td colspan="5"><div class="nc-empty" style="padding:1.2rem">No pages yet. Click + Add Page to create one.</div></td>';
		tbody.appendChild(empty);
	}
}

// ── dip-confirm — bound once, delegates to any tr[data-id] ────────────────────
tbody.addEventListener('dip-confirm', async function(e) {
	const id = e.target.dataset.id;
	const tr = e.target.closest('tr[data-id]');
	if (!id) return;
	const res = await ajax({ action:'delete', id });
	if (!res.ok) { notifyErr(res.message); return; }
	if (tr) animateDelete(tr, function () { tr.remove(); });
});

// ── Drag reorder (SortableJS, forceFallback — native HTML5 Drag and Drop has
// a real Chromium/Linux platform bug where a real physical drag never
// progresses past dragstart; forceFallback uses pointer events instead,
// sidestepping the native OS drag handoff entirely) ────────────────────────
if (window.Sortable) {
	Sortable.create(tbody, {
		handle: '.drag-handle',
		animation: 150,
		forceFallback: true,
		fallbackOnBody: true,
		draggable: 'tr[data-id]',
		onEnd: async () => {
			const ids = [...tbody.querySelectorAll('tr[data-id]')].map(r => r.dataset.id);
			const res = await ajax({ action:'reorder', ids: JSON.stringify(ids) });
			if (res.ok) notifyOk('Order saved.'); else notifyErr(res.message || 'Could not save order.');
		},
	});
}

// ── Drawer ─────────────────────────────────────────────────────────────────────
async function openDrawer(id) {
	currentBlocks = [];
	document.getElementById('page-id').value      = id || '';
	document.getElementById('page-title').value   = '';
	document.getElementById('page-slug').value    = '';
	document.getElementById('page-seo-title').value = '';
	document.getElementById('page-seo-desc').value  = '';
	document.getElementById('blocks-list').innerHTML = '';
	document.getElementById('drawer-title').textContent = id ? 'Edit Page' : 'Add Page';

	if (id) {
		const res = await ajax({ action:'get', id });
		if (!res.ok) { notifyErr(res.message); return; }
		document.getElementById('page-id').value        = res.page.id;
		document.getElementById('page-title').value     = res.page.title;
		document.getElementById('page-slug').value      = res.page.slug;
		document.getElementById('page-seo-title').value    = res.page.seo_title    || '';
		document.getElementById('page-seo-keywords').value = res.page.seo_keywords  || '';
		document.getElementById('page-seo-desc').value  = res.page.seo_description || '';
		const roller = document.getElementById('page-status');
		if (roller) { roller.value = String(res.page.status || 0); roller.setAttribute('value', String(res.page.status || 0)); }
		if (NC.blockEditor) {
			currentBlocks = res.blocks || [];
			renderBlocks();
		} else {
			const isSystem = SYSTEM_TYPES.includes(res.page.page_type);
			document.getElementById('page-content')?.closest('.df')?.style.setProperty('display', isSystem ? 'none' : '');
			document.getElementById('page-content-before-wrap')?.style.setProperty('display', isSystem ? '' : 'none');
			document.getElementById('page-content-after-wrap')?.style.setProperty('display', isSystem ? '' : 'none');
			if (isSystem) {
				const tb = document.getElementById('page-content-before');
				const ta = document.getElementById('page-content-after');
				if (tb) tb.value = res.page.content_before || '';
				if (ta) ta.value = res.page.content_after  || '';
			} else {
				const ta = document.getElementById('page-content');
				if (ta) ta.value = res.page.content || '';
			}
		}
		// Show preview button for existing pages
		const prevBtn = document.getElementById('btn-preview-page');
		if (prevBtn) prevBtn.style.display = '';
	} else {
		const roller = document.getElementById('page-status');
		if (roller) { roller.value = '1'; roller.setAttribute('value', '1'); }
		const prevBtn = document.getElementById('btn-preview-page');
		if (prevBtn) prevBtn.style.display = 'none';
	}

	// Activate first tab
	activateTab('panel-info');
	drawer.classList.add('open');
	overlay.classList.add('show');
}

function closeDrawer() {
	drawer.classList.remove('open');
	overlay.classList.remove('show');
}

function activateTab(panelId) {
	document.querySelectorAll('.drawer-tab').forEach(t => {
		const active = t.dataset.panel === panelId;
		t.classList.toggle('active', active);
		t.setAttribute('aria-selected', String(active));
	});
	document.querySelectorAll('.drawer-tab-panel').forEach(p => {
		p.classList.toggle('active', p.id === panelId);
	});
}

document.querySelectorAll('.drawer-tab').forEach(btn => {
	btn.addEventListener('click', () => activateTab(btn.dataset.panel));
});



// ── Blocks rendering ───────────────────────────────────────────────────────────
const BLOCK_LABELS = {
	rich_text: 'Rich Text', html: 'Custom HTML',
	featured_products: 'Featured Products', best_sellers: 'Best Sellers',
	best_sellers_category: 'Best Sellers by Category', new_arrivals: 'New Arrivals',
	related_products: 'Related Products',
	slideshow: 'Slideshow', file: 'File', contact_form: 'Contact Form', sitemap: 'Site Map',
	menu: 'Menu',
	cart_contents: 'Cart Contents', checkout_form: 'Checkout Form', product_view: 'Product View',
};

function renderBlocks() {
	blockToggleCtrl.abort();
	blockToggleCtrl = new AbortController();
	const list = document.getElementById('blocks-list');
	list.innerHTML = '';
	currentBlocks.forEach((b, idx) => list.appendChild(buildBlockCard(b, idx)));
	// Init rich-text editors now that cards are in the DOM
	requestAnimationFrame(() => initBlockEditors());
}

function initBlockEditors() {
	if (!window.jQuery || !jQuery.fn.trumbowyg) return;
	currentBlocks.forEach((b) => {
		if (b.block_type !== 'rich_text') return;
		const card = document.querySelector(`.block-card[data-idx="${currentBlocks.indexOf(b)}"]`);
		if (!card) return;
		const $ta = jQuery(card).find('.block-ta[data-key="content"]');
		if (!$ta.length || $ta.data('trumbowyg')) return;
		$ta.trumbowyg({
			svgPath: NC.rootUrl + 'js/vendor/trumbowyg/src/ui/icons.svg',
			semantic: false,
			btns: [
				['bold','italic','underline'],
				['link'],
				['unorderedList','orderedList'],
				['indent','outdent'],
				['viewHTML']
			]
		});
		// Append plain FM image button to toolbar
		setTimeout(function() {
			if (!window.openFilePicker) return;
			const toolbar = $ta.closest('.trumbowyg-box')[0]?.querySelector('.trumbowyg-button-pane');
			if (!toolbar || toolbar.querySelector('.nc-fm-img-btn')) return;
			const fmBtn = document.createElement('button');
			fmBtn.type = 'button';
			fmBtn.className = 'nc-fm-img-btn trumbowyg-button-group';
			fmBtn.style.cssText = 'padding:2px 6px;cursor:pointer;border:none;background:none;font-size:14px;line-height:32px;height:35px;color:var(--nc-text,#333)';
			fmBtn.title = 'Insert Image';
			fmBtn.setAttribute('aria-label', 'Insert image from file manager');
			fmBtn.textContent = '🖼';
			fmBtn.addEventListener('mousedown', function(e) {
				e.preventDefault(); // keep editor focus
			});
			fmBtn.addEventListener('click', function(e) {
				e.preventDefault();
				openFilePicker(function(items) {
					if (!items.length) return;
					// Focus editor before inserting
					const ed = $ta.closest('.trumbowyg-box')[0]?.querySelector('.trumbowyg-editor');
					if (ed) ed.focus();
					var img = '<img src="' + items[0].url + '" alt="" style="max-width:100%">';
					$ta.trumbowyg('execCmd', { cmd: 'insertHTML', param: img, forceCss: false });
				});
			});
			toolbar.appendChild(fmBtn);
		}, 0);
		// Save on change — sync textarea first
		$ta.on('tbwchange tbwblur', async function() {
			if (!b.settings || typeof b.settings !== 'object') b.settings = {};
			b.settings.content = $ta.trumbowyg('html');
			if (!b.id) return;
			const pageId = document.getElementById('page-id').value;
			if (!pageId) return;
			const res = await ajax({
				action:     'save_block',
				id:         b.id,
				page_id:    pageId,
				block_type: b.block_type,
				settings:   JSON.stringify(b.settings),
				enabled:    b.enabled ?? 1
			});
			if (!res.ok) notifyErr('Block save failed: ' + (res.message || 'unknown error'));
		});
	});
}

function buildBlockCard(b, idx) {
	const card = document.createElement('div');
	card.className = 'block-card' + (b.enabled ? '' : ' block-disabled');
	card.dataset.idx = idx;
	card.setAttribute('role', 'listitem');
	card.draggable = true;

	const label = BLOCK_LABELS[b.block_type] || b.block_type;

	const isCore = !!(b.settings && b.settings.is_core);
	card.innerHTML =
		'<div class="block-card-head">' +
			'<span class="drag-handle" aria-hidden="true">⠿</span>' +
			'<span class="block-label">' + esc(label) + '</span>' +
			'<ios-toggle size="sm" ' + (b.enabled ? 'checked' : '') + ' aria-label="Enable block"></ios-toggle>' +
			(!isCore ? '<delete-in-place caption="🗑" confirm="Remove block?" data-idx="' + idx + '"></delete-in-place>' : '') +
		'</div>' +
		'<div class="block-card-settings" id="block-settings-' + idx + '"></div>';

	// Enable toggle
	const blockToggle = card.querySelector('ios-toggle');
	document.addEventListener('ios-toggle', async function(e) {
		if (e.detail.source !== blockToggle) return;
		b.enabled = e.detail.checked ? 1 : 0;
		card.classList.toggle('block-disabled', !e.detail.checked);
		if (b.id) await ajax({ action:'save_block', id:b.id, page_id:document.getElementById('page-id').value, block_type:b.block_type, settings:JSON.stringify(b.settings||{}), enabled:b.enabled });
	}, { signal: blockToggleCtrl.signal });

	// dip-confirm (not present for core blocks)
	const dipEl = card.querySelector('delete-in-place');
	if (dipEl) {
		dipEl.addEventListener('dip-confirm', function() {
			animateDelete(card, async function () {
				if (b.id) await ajax({ action:'delete_block', id:b.id });
				currentBlocks.splice(idx, 1);
				renderBlocks();
			});
		});
	}

	// Render settings fields
	renderBlockSettings(b, idx, card.querySelector('.block-card-settings'));

	// Drag reorder
	card.addEventListener('dragstart', e => { dragSrc = card; e.dataTransfer.effectAllowed='move'; });
	card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
	card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
	card.addEventListener('drop', async e => {
		e.preventDefault();
		card.classList.remove('drag-over');
		const srcIdx  = parseInt(dragSrc.dataset.idx);
		const destIdx = idx;
		if (srcIdx === destIdx) return;
		const moved = currentBlocks.splice(srcIdx, 1)[0];
		currentBlocks.splice(destIdx, 0, moved);
		renderBlocks();
		const ids = currentBlocks.filter(b => b.id).map(b => b.id);
		if (ids.length) await ajax({ action:'reorder_blocks', ids:JSON.stringify(ids) });
	});

	return card;
}

function renderBlockSettings(b, idx, container) {
	if (!b.settings || typeof b.settings !== 'object') b.settings = {};
	const s = b.settings;
	let html = '';

	switch (b.block_type) {
		case 'rich_text':
			html = '<div class="block-field"><label>Content</label><textarea class="block-ta" data-key="content" rows="4">' + esc(s.content||'') + '</textarea></div>';
			break;
		case 'html':
			html = '<div class="block-field"><label>HTML</label><textarea class="block-ta block-code" data-key="html" rows="4">' + esc(s.html||'') + '</textarea></div>';
			break;
		case 'slideshow':
			html = '<div class="block-field"><label>Slideshow</label><select class="block-sel" data-key="slideshow_id"><option value="">— loading —</option></select></div>';
			break;
		case 'file':
			html = '<div class="block-field"><label>File Type</label><select class="block-sel" data-key="file_type"><option value="text"' + (s.file_type==='text' ? ' selected':'') + '>Text</option><option value="html"' + (s.file_type==='html' ? ' selected':'') + '>HTML</option><option value="php"' + (s.file_type==='php' ? ' selected':'') + '>PHP</option></select></div>' +
			       '<div class="block-field"><label>File</label><div class="file-select-wrapper"><input type="text" class="block-in" data-key="file_path" value="' + esc(s.file_path||'') + '" placeholder="Select a file..." readonly><button type="button" class="btn btn-secondary btn-sm btn-file-picker" aria-label="Browse files">Browse</button></div></div>' +
			       (s.file_path ? '<div class="block-field"><p style="font-size:.8rem;color:var(--nc-text-dim);margin:0">File: <code>' + esc(s.file_path) + '</code></p></div>' : '');
			break;
		case 'featured_products':
		case 'best_sellers':
		case 'new_arrivals':
			html = '<div class="block-field"><label>Count</label><input type="number" class="block-in" data-key="count" value="' + (s.count||6) + '" min="1" max="24"></div>' +
			       '<div class="block-field"><label>Heading</label><input type="text" class="block-in" data-key="heading" value="' + esc(s.heading||'') + '"></div>';
			break;
		case 'related_products':
			html = '<div class="block-field"><label>Heading</label><input type="text" class="block-in" data-key="heading" value="' + esc(s.heading||'Related Products') + '"></div>' +
			       '<div class="block-field"><label>Max items</label><input type="number" class="block-in" data-key="max_items" value="' + (s.max_items||0) + '" min="0" max="24"></div>' +
			       '<div class="block-field"><p style="font-size:.8rem;color:var(--nc-text-dim);margin:0">Shows this product\'s related items on the product page. Empty on other pages.</p></div>';
			break;
		case 'best_sellers_category':
			html = '<div class="block-field"><label>Category</label><select class="block-sel" data-key="category_id"><option value="">— loading —</option></select></div>' +
			       '<div class="block-field"><label>Count</label><input type="number" class="block-in" data-key="count" value="' + (s.count||6) + '" min="1" max="24"></div>' +
			       '<div class="block-field"><label>Heading</label><input type="text" class="block-in" data-key="heading" value="' + esc(s.heading||'') + '"></div>';
			break;
		case 'menu':
			html = '<div class="block-field"><label>Menu</label><select class="block-sel" data-key="menu_id"><option value="">— loading —</option></select></div>' +
			       '<div class="block-field"><label>Max items</label><input type="number" class="block-in" data-key="max_items" value="' + (s.max_items||0) + '" min="0" max="100" aria-label="Max items (0 = show all)"></div>' +
			       '<span class="hint" style="display:block;margin-top:-.25rem">0 shows all items.</span>';
			break;
		case 'contact_form':
			html = '<div class="block-field"><label>Form</label><select class="block-sel" data-key="form_id"><option value="">— loading —</option></select></div>' +
			       '<div class="block-field"><label>Display</label><select class="block-sel" data-key="modal">' +
			       '<option value="0"' + (!s.modal ? ' selected' : '') + '>Inline</option>' +
			       '<option value="1"' + (s.modal  ? ' selected' : '') + '>Modal (button)</option>' +
			       '</select></div>' +
			       '<div class="block-field"><label>Button Label</label><input type="text" class="block-in" data-key="btn_label" value="' + esc(s.btn_label || 'Ask a question') + '" placeholder="Ask a question"></div>';
			break;
		case 'cart_contents':
			html = '<div class="block-field"><p style="font-size:.82rem;color:var(--nc-text-dim);margin:0">Core block — renders the shopping cart contents and totals.</p></div>';
			break;
		case 'checkout_form':
			html = '<div class="block-field"><p style="font-size:.82rem;color:var(--nc-text-dim);margin:0">Core block — renders the checkout form and payment step.</p></div>';
			break;
		case 'product_view':
			html = '<div class="block-field"><p style="font-size:.82rem;color:var(--nc-text-dim);margin:0">Core block — renders the product gallery, details, options, and add-to-cart. Blocks added above appear before this; blocks below appear after.</p></div>';
			break;
		case 'sitemap':
			html = '<div class="block-field">' +
			       '<button class="btn btn-primary btn-sm btn-gen-sitemap" style="margin-bottom:.65rem" ' +
			       'aria-label="Generate site map now">&#9881; Generate Site Map</button>' +
			       '<span class="hint" style="display:block;margin-bottom:.65rem">Auto-generates an HTML list of all public pages, categories and products.</span>' +
			       '</div>' +
			       '<div class="block-field"><label>Custom XML Sitemap</label>' +
			       '<div class="sitemap-upload-area" id="sitemap-upload-' + idx + '">' +
			       (s.custom_xml_path
			         ? '<span class="sitemap-file-set">&#10003; Custom sitemap.xml uploaded. <button class="btn btn-secondary btn-sm" data-clear-sitemap="' + idx + '">Remove</button></span>'
			         : '<p style="font-size:.82rem;color:var(--nc-text-dim)">Auto-generated XML sitemap is active. Upload a custom sitemap.xml to override:</p>' +
			           '<input type="file" class="sitemap-xml-input" data-idx="' + idx + '" accept=".xml" aria-label="Upload custom sitemap XML">') +
			       '</div></div>';
			break;
	}

	container.innerHTML = html;

	// Load dynamic selects
	if (['slideshow','best_sellers_category','contact_form','menu'].includes(b.block_type)) {
		ajax({ action:'block_data', type:b.block_type }).then(res => {
			if (!res.ok) return;
			const d = res.data;
			const sel = container.querySelector('[data-key="slideshow_id"],[data-key="category_id"],[data-key="form_id"],[data-key="menu_id"]');
			if (!sel) return;
			const key = sel.dataset.key;
			const items = d.slideshows || d.categories || d.forms || d.menus || [];
			sel.innerHTML = '<option value="">— Select —</option>' +
				items.map(i => '<option value="' + i.id + '"' + (s[key] == i.id ? ' selected':'') + '>' + esc(i.name) + '</option>').join('');
		});
	}

	// Auto-save: use 'input' + debounce for text, 'change' for select
	// (blur doesn't fire reliably on hidden panels)
	container.querySelectorAll('.block-in,.block-ta,.block-sel').forEach(el => {
		let saveTimer = null;
		const doSave = async function() {
			if (!b.settings || typeof b.settings !== 'object') b.settings = {};
			const key = el.dataset.key;
			if (!key) return;
			b.settings[key] = el.value;
			if (!b.id) return;
			const pageId = document.getElementById('page-id').value;
			if (!pageId) return;
			const res = await ajax({
				action:     'save_block',
				id:         b.id,
				page_id:    pageId,
				block_type: b.block_type,
				settings:   JSON.stringify(b.settings),
				enabled:    b.enabled ?? 1
			});
			if (!res.ok) notifyErr('Block save failed: ' + (res.message || 'unknown error'));
		};
		if (el.tagName === 'SELECT') {
			el.addEventListener('change', doSave);
		} else {
			el.addEventListener('input', function() {
				clearTimeout(saveTimer);
				saveTimer = setTimeout(doSave, 800);
			});
			el.addEventListener('blur', function() {
				clearTimeout(saveTimer);
				doSave();
			});
		}
	});

	// Trumbowyg init deferred — see initBlockEditors() called after DOM append

	// Generate site map button
	const genBtn = container.querySelector('.btn-gen-sitemap');
	if (genBtn) {
		genBtn.addEventListener('click', async function() {
			this.disabled = true;
			this.textContent = 'Generating…';
			const res = await ajax({ action: 'generate_sitemap', page_id: document.getElementById('page-id').value });
			this.disabled = false;
			this.innerHTML = '&#9881; Generate Site Map';
			if (res.ok) {
				SimpleNotification.success({ text: 'Site map generated.' });
			} else {
				notifyErr(res.message || 'Could not generate site map.');
			}
		});
	}

	// Sitemap XML upload
	const xmlInput = container.querySelector('.sitemap-xml-input');
	if (xmlInput) {
		xmlInput.addEventListener('change', async function() {
			if (!this.files.length) return;
			if (!b.id) { notifyErr('Save the page first.'); return; }
			const fd = new FormData();
			fd.append('csrf_token', getCsrfToken());
			fd.append('action', 'upload_sitemap_xml');
			fd.append('block_id', b.id);
			fd.append('xml', this.files[0]);
			const res = await fetch(AJAX, { method: 'POST', body: fd }).then(r => r.json());
			if (!res.ok) { notifyErr(res.message); return; }
			if (!b.settings) b.settings = {};
			b.settings.custom_xml_path = 'sitemap-custom.xml';
			renderBlocks();
		});
	}

	// Sitemap clear button
	const clearBtn = container.querySelector('[data-clear-sitemap]');
	if (clearBtn) {
		clearBtn.addEventListener('click', async function() {
			if (!b.id) return;
			const res = await ajax({ action: 'clear_sitemap_xml', block_id: b.id });
			if (!res.ok) { notifyErr('Could not remove custom sitemap.'); return; }
			delete b.settings.custom_xml_path;
			renderBlocks();
		});
	}

	// File picker button
	const filePickerBtn = container.querySelector('.btn-file-picker');
	if (filePickerBtn) {
		filePickerBtn.addEventListener('click', function(e) {
			e.preventDefault();
			if (!window.openFilePickerFiles) return;
			openFilePickerFiles(function(files) {
				if (!files.length) return;
				const fileInput = container.querySelector('[data-key="file_path"]');
				if (fileInput) {
					fileInput.value = files[0];
					const ev = new Event('change', { bubbles: true });
					fileInput.dispatchEvent(ev);
					// Trigger save
					if (!b.settings || typeof b.settings !== 'object') b.settings = {};
					b.settings.file_path = files[0];
					if (b.id) {
						const pageId = document.getElementById('page-id').value;
						if (pageId) {
							ajax({
								action:     'save_block',
								id:         b.id,
								page_id:    pageId,
								block_type: b.block_type,
								settings:   JSON.stringify(b.settings),
								enabled:    b.enabled ?? 1
							}).then(res => {
								if (!res.ok) notifyErr('Could not save file selection: ' + (res.message || 'unknown error'));
							});
						}
					}
					renderBlocks();
				}
			});
		});
	}
}

// ── Add block ──────────────────────────────────────────────────────────────────
document.getElementById('btn-add-block')?.addEventListener('click', async function() {
	const type = document.getElementById('block-type-select').value;
	if (!type) return;
	const pageId = document.getElementById('page-id').value;
	if (!pageId) { notifyErr('Save the page first before adding blocks.'); return; }

	const res = await ajax({ action:'save_block', id:0, page_id:pageId, block_type:type, settings:'{}', enabled:1 });
	if (!res.ok) { notifyErr(res.message); return; }
	currentBlocks.push(res.block);
	renderBlocks();
	document.getElementById('block-type-select').value = '';
});

// ── Save page ──────────────────────────────────────────────────────────────────
async function savePage() {
	const title = document.getElementById('page-title').value.trim();
	if (!title) { notifyErr('Title is required.'); return false; }

	// Flush any active Trumbowyg editors before saving
	if (NC.blockEditor && window.jQuery) {
		document.querySelectorAll('.block-ta[data-key="content"]').forEach(function(ta) {
			const $ta = jQuery(ta);
			if ($ta.data('trumbowyg')) {
				const b = currentBlocks.find(bl => bl.block_type === 'rich_text');
				if (b) b.settings = Object.assign(b.settings || {}, { content: $ta.trumbowyg('html') });
			}
		});
	}

	const res = await ajax({
		action:          'save',
		id:              document.getElementById('page-id').value,
		title,
		slug:            document.getElementById('page-slug').value.trim(),
		status:          parseInt(document.getElementById('page-status')?.value ?? document.getElementById('page-status')?.getAttribute('value') ?? '1', 10),
		seo_title:       document.getElementById('page-seo-title').value,
		seo_keywords:    document.getElementById('page-seo-keywords').value,
		seo_description: document.getElementById('page-seo-desc').value,
	});
	if (!res.ok) { notifyErr(res.message); return false; }
	// Update id in case it was a new page
	document.getElementById('page-id').value = res.page.id;

	if (!NC.blockEditor) {
		const beforeWrap = document.getElementById('page-content-before-wrap');
		const isSystem   = beforeWrap && beforeWrap.style.display !== 'none';
		let contentRes;
		if (isSystem) {
			const tb = document.getElementById('page-content-before');
			const ta = document.getElementById('page-content-after');
			contentRes = await ajax({
				action: 'save_content', id: res.page.id,
				content_before: tb ? tb.value : '',
				content_after:  ta ? ta.value : '',
			});
		} else {
			const ta = document.getElementById('page-content');
			contentRes = await ajax({ action: 'save_content', id: res.page.id, content: ta ? ta.value : '' });
		}
		if (!contentRes.ok) { notifyErr(contentRes.message || 'Content save failed.'); return false; }
	}

	// Show preview button now that page exists
	const prevBtn = document.getElementById('btn-preview-page');
	if (prevBtn) prevBtn.style.display = '';
	loadPages();
	return true;
}

document.getElementById('btn-drawer-save').addEventListener('save', async function () {
	this.setLoading();
	const ok = await savePage();
	if (ok) this.showSuccess();
	else    this.reset();
});

// ── Preview button ─────────────────────────────────────────────────────────────
document.getElementById('btn-preview-page')?.addEventListener('click', async function() {
	const pageId = document.getElementById('page-id').value;
	if (!pageId) return;
	// First save, then open preview
	const res = await ajax({ action:'preview_token', id: pageId });
	if (!res.ok) { notifyErr(res.message || 'Could not generate preview.'); return; }
	window.open(NC.rootUrl + 'page-preview/' + res.token, '_blank', 'noopener');
});

// ── Controls ───────────────────────────────────────────────────────────────────
document.getElementById('btn-add-page')?.addEventListener('click', () => {
	window.location.href = NC.adminUrl + '?route=page-edit';
});
document.getElementById('btn-add-first')?.addEventListener('click', () => {
	window.location.href = NC.adminUrl + '?route=page-edit';
});
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);

})();
