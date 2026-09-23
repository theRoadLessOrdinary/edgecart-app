/* global SimpleNotification, jQuery */
(function () {
	'use strict';

	const AJAX     = NC.adminUrl + '?route=products/ajax';
	const ROW_TPL  = '/admin/tpl/products/row.html';

	const tbody    = document.getElementById('prod-tbody');
	const emptyRow   = document.getElementById('prod-empty-row');
	const loadingRow = document.getElementById('prod-loading-row');
	const drawer   = document.getElementById('prod-drawer');
	const overlay  = document.getElementById('drawer-overlay');
	const chkAll   = document.getElementById('chk-all');
	const btnBulk  = document.getElementById('btn-bulk-delete');
	const btnAddProduct = document.getElementById('btn-add-product');

	const PROD_PER_CAT_LIMIT    = parseInt(btnAddProduct?.dataset.prodPerCatLimit, 10) || Infinity;
	const OPTIONS_PER_PROD_LIMIT = parseInt(btnAddProduct?.dataset.optionsLimit,   10) || Infinity;
	const IMAGES_PER_PROD_LIMIT  = parseInt(btnAddProduct?.dataset.imagesLimit,    10) || Infinity;
	const CAT_LIMIT             = parseInt(btnAddProduct?.dataset.catLimit,         10) || Infinity;
	const PRODUCT_CAT_LIMIT     = parseInt(btnAddProduct?.dataset.productCatLimit, 10) || Infinity;
	let   catCount              = parseInt(btnAddProduct?.dataset.catCount,         10) || 0;

	let allCategories = [];
	let allRows       = [];
	let sortCol       = localStorage.getItem('nc_prod_sort_col') || '';
	let sortDir       = parseInt(localStorage.getItem('nc_prod_sort_dir') || '1', 10) || 1;
	let featuredReorderMode = false; // true when the only active filter is "Featured only" - reorders write to featured_order instead of display_order
	let rowTemplate   = null;
	let currentProdId = null;

	// ── Ajax ──────────────────────────────────────────────────────────────────
	// TODO: if the session expires, require_admin() issues a Location redirect and
	// the response comes back as HTML (the login page) rather than JSON. r.json()
	// throws, the caller gets an unhandled rejection, and the user has no idea why
	// the UI stopped working. Fix: check r.redirected or r.url for the login URL
	// (or have require_admin() detect X-Requested-With / an AJAX header and return
	// JSON {ok:false,expired:true} instead of a redirect), then do
	// window.top.location.href = LOGIN_URL to send the whole tab to the login page.
	async function post(data) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		try { return await r.json(); } catch (e) { return { ok: false, message: 'Server error' }; }
	}

	async function postFile(data, files) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		if (files) Object.entries(files).forEach(([k, v]) => {
		fd.append('csrf_token', getCsrfToken());
			if (v) fd.append(k, v);
			else console.warn('postFile: skipped key "' + k + '" - value is', v);
		});
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		try { return await r.json(); } catch (e) { return { ok: false, message: 'Server error' }; }
	}

	function notifyOk(msg)  { SimpleNotification.success({ text: msg }); }
	function notifyErr(msg) { SimpleNotification.error({ text: msg }); }

	// ── ios-toggle value helpers ──────────────────────────────────────────────
	function togVal(id) {
		var h = document.getElementById('_nc_' + id);
		if (h) return parseInt(h.value || 0) ? 1 : 0;
		var t = document.querySelector('ios-toggle[name="' + id + '"]');
		if (t) { var cb = t.querySelector('input[type=checkbox]'); return cb && cb.checked ? 1 : 0; }
		return 0;
	}
	function setTogVal(id, v) {
		var label = document.getElementById(id);
		if (!label) return;
		var tog = label.closest('ios-toggle');
		if (!tog) return;
		var cb = tog.querySelector('input[type=checkbox]');
		var h  = tog.querySelector('input[type=hidden]');
		var on = !!parseInt(v);
		if (cb) cb.checked  = on;
		if (h)  h.value     = on ? 1 : 0;
	}

	// ── Load row template ─────────────────────────────────────────────────────
	async function fetchRowTemplate() {
		const r = await fetch(ROW_TPL + '?v=' + Date.now());
		rowTemplate = await r.text();
	}

	function buildRow(d) {
		if (!rowTemplate) return null;
		const price     = parseFloat(d.price     || 0).toFixed(2);
		const listPrice = parseFloat(d.list_price || 0).toFixed(2);
		const stock     = parseInt(d.stock ?? -1);
		const inactive  = d.status == 0;

		const html = rowTemplate
			.replace(/{{id}}/g,              esc(d.id))
			.replace(/{{name}}/g,            esc(d.name))
			.replace(/{{sku_html}}/g,        d.sku ? '<div class="prod-sku">' + esc(d.sku) + '</div>' : '')
			.replace(/{{categories}}/g,      esc(d.categories || '-'))
			.replace(/{{price}}/g,           '$' + price)
			.replace(/{{list_price}}/g,      '$' + listPrice)
			.replace(/{{price_raw}}/g,       price)
			.replace(/{{list_price_raw}}/g,  listPrice)
			.replace(/{{stock}}/g,           stockLabel(stock))
			.replace(/{{stock_raw}}/g,       stock)
			.replace(/{{stock_class}}/g,     stockClass(stock))
			.replace(/{{status_checked}}/g,  d.status   == 1 ? 'checked' : '')
			.replace(/{{featured_checked}}/g,d.featured  == 1 ? 'checked' : '')
			.replace(/{{delete_show}}/g,     inactive ? 'show' : '')
			.replace(/{{chk_disabled}}/g,    inactive ? '' : 'disabled')
			.replace(/{{catalog_url}}/g,     NC.rootUrl + 'product/' + esc(d.slug));

		const tr = document.createElement('tr');
		tr.dataset.id = d.id;
		tr.innerHTML  = html;
		return tr;
	}

	function stockLabel(stock) {
		return stock < 0 ? '∞' : stock;
	}
	function stockClass(stock) {
		if (stock < 0)  return 'stock-unlimited';
		if (stock === 0) return 'stock-zero';
		if (stock <= 5) return 'stock-low';
		return 'stock-ok';
	}

	function esc(str) {
		return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
	}

	// ── Render ────────────────────────────────────────────────────────────────
	function renderRows(rows) {
		Array.from(tbody.querySelectorAll('tr[data-id]')).forEach(r => r.remove());
		loadingRow.style.display = 'none';
		if (!rows || !rows.length) { emptyRow.style.display = ''; return; }
		emptyRow.style.display = 'none';
		rows.forEach(r => { const tr = buildRow(r); if (tr) tbody.appendChild(tr); });
		updateBulkBtn();
	}

	function updateRow(d) {
		const idx = allRows.findIndex(r => String(r.id) === String(d.id));
		let merged = d;
		if (idx >= 0) { allRows[idx] = Object.assign({}, allRows[idx], d); merged = allRows[idx]; }
		else           { allRows.push(d); }
		const tr    = tbody.querySelector('tr[data-id="' + d.id + '"]');
		const newTr = buildRow(merged);
		if (!newTr) return;
		if (!tr) { emptyRow.style.display = 'none'; tbody.appendChild(newTr); }
		else      { tbody.replaceChild(newTr, tr); }
		updateBulkBtn();
	}

	// ── Filter + sort ─────────────────────────────────────────────────────────
	function applyFiltersAndSort() {
		const nameQ      = (document.getElementById('flt-name')?.value    || '').trim().toLowerCase();
		const catId      =  document.getElementById('flt-cat')?.value     || '';
		const fltStatus  =  document.getElementById('flt-status')?.value  ?? '';
		const fltFeat    =  document.getElementById('flt-featured')?.value ?? '';

		const isFiltered = !!(nameQ || catId || fltStatus !== '' || fltFeat !== '');
		const isSorted   = !!sortCol;
		featuredReorderMode = fltFeat === '1' && !nameQ && !catId && fltStatus === '' && !sortCol;

		let rows = allRows.filter(function (r) {
			if (nameQ     && !(r.name || '').toLowerCase().includes(nameQ))                          return false;
			if (catId     && !(r.category_ids || '').split(',').includes(String(catId)))             return false;
			if (fltStatus  !== '' && String(r.status)   !== fltStatus)                              return false;
			if (fltFeat    !== '' && String(r.featured)  !== fltFeat)                               return false;
			return true;
		});

		if (featuredReorderMode) {
			rows = rows.slice().sort(function (a, b) {
				const av = parseInt(a.featured_order, 10) || 0, bv = parseInt(b.featured_order, 10) || 0;
				return av - bv || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
			});
		} else if (sortCol) {
			const NUMERIC = ['price', 'list_price', 'stock', 'status', 'featured'];
			rows = rows.slice().sort(function (a, b) {
				let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
				if (NUMERIC.includes(sortCol)) { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
				else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
				return av < bv ? -sortDir : av > bv ? sortDir : 0;
			});
		}

		renderRows(rows);
		updateSortIndicators();

		const table = document.getElementById('prod-table');
		if (table) table.classList.toggle('drag-disabled', (isFiltered && !featuredReorderMode) || isSorted);

		const clearBtn = document.getElementById('btn-flt-clear');
		if (clearBtn) clearBtn.style.display = (isFiltered || isSorted) ? '' : 'none';
	}

	function updateSortIndicators() {
		document.querySelectorAll('th[data-sort]').forEach(function (th) {
			th.classList.remove('sort-asc', 'sort-desc');
			if (th.dataset.sort === sortCol) th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
		});
	}

	// ── Load ──────────────────────────────────────────────────────────────────
	async function loadProducts() {
		const res = await post({ action: 'list' });
		if (!res.ok) { notifyErr(res.message); return; }
		allRows = res.rows || [];
		applyFiltersAndSort();
	}

	async function loadCategories() {
		const res = await post({ action: 'categories' });
		if (!res.ok) return;
		allCategories = res.categories || [];
		const fltCat = document.getElementById('flt-cat');
		if (fltCat) {
			allCategories.forEach(function (c) {
				const opt = document.createElement('option');
				opt.value = c.id; opt.textContent = c.name;
				fltCat.appendChild(opt);
			});
			// Arrived from Categories > "Show Products" (?cat=ID): preselect that category.
			const preCat = new URLSearchParams(window.location.search).get('cat');
			if (preCat) {
				fltCat.value = preCat;
				if (allRows.length) applyFiltersAndSort();
			}
		}
	}

	// ── Edit-in-place: click to show, blur or Enter to commit ────────────────
	tbody.addEventListener('click', function (e) {
		// Price
		const pd = e.target.closest('.price-display');
		if (pd) {
			const id  = pd.dataset.id;
			const inp = document.getElementById('price-edit-' + id);
			if (inp && inp.style.display === 'none') {
				pd.style.display = 'none';
				inp.style.display = 'inline';
				inp.focus(); inp.select();
			}
			return;
		}
		// List price
		const ld = e.target.closest('.list-price-display');
		if (ld) {
			const id  = ld.dataset.id;
			const inp = document.getElementById('list-price-edit-' + id);
			if (inp && inp.style.display === 'none') {
				ld.style.display = 'none';
				inp.style.display = 'inline';
				inp.focus(); inp.select();
			}
			return;
		}
		// Stock
		const sd = e.target.closest('.stock-display');
		if (sd) {
			const id  = sd.dataset.id;
			const inp = document.getElementById('stock-edit-' + id);
			if (inp && inp.style.display === 'none') {
				sd.style.display = 'none';
				inp.style.display = 'inline';
				inp.focus(); inp.select();
			}
			return;
		}
		// Hamburger menu toggle
		const menuBtn = e.target.closest('.row-menu-btn');
		if (menuBtn) {
			e.stopPropagation();
			const drop = menuBtn.nextElementSibling;
			const isOpen = drop.style.display !== 'none';
			document.querySelectorAll('.row-menu-drop').forEach(d => d.style.display = 'none');
			if (!isOpen) {
				const rect = menuBtn.getBoundingClientRect();
				drop.style.top   = rect.bottom + 'px';
				drop.style.right = (window.innerWidth - rect.right) + 'px';
				drop.style.left  = '';
				drop.style.display = 'block';
			}
			return;
		}
		// Close menus on any other click
		document.querySelectorAll('.row-menu-drop').forEach(d => d.style.display = 'none');
	});

	// Close menus when clicking outside
	document.addEventListener('click', function () {
		document.querySelectorAll('.row-menu-drop').forEach(d => d.style.display = 'none');
	});

	// Enter key commits eip
	tbody.addEventListener('keydown', function (e) {
		if (e.key !== 'Enter') return;
		const input = e.target.closest('.eip-input');
		if (input) { e.preventDefault(); input.blur(); }
	});

	// Blur: save whichever field was edited
	tbody.addEventListener('blur', async function (e) {
		// Price blur
		const pi = e.target.closest('.price-input[data-field="price"]');
		if (pi) {
			const id    = pi.dataset.id;
			const price = parseFloat(pi.value || 0);
			pi.style.display = 'none';
			const pd = tbody.querySelector('.price-display[data-id="' + id + '"]');
			if (pd) { pd.textContent = '$' + price.toFixed(2); pd.style.display = 'inline'; }
			const res = await post({ action: 'save_prices', id, price, list_price: currentListPrice(id) });
			if (!res.ok) notifyErr(res.message);
		}
		// List price blur
		const li = e.target.closest('.price-input[data-field="list_price"]');
		if (li) {
			const id     = li.dataset.id;
			const listPr = parseFloat(li.value || 0);
			li.style.display = 'none';
			const ld = tbody.querySelector('.list-price-display[data-id="' + id + '"]');
			if (ld) { ld.textContent = '$' + listPr.toFixed(2); ld.style.display = 'inline'; }
			const res = await post({ action: 'save_prices', id, price: currentPrice(id), list_price: listPr });
			if (!res.ok) notifyErr(res.message);
		}
		// Stock blur
		const si = e.target.closest('.stock-input');
		if (si) {
			const id    = si.dataset.id;
			const stock = parseInt(si.value ?? -1);
			si.style.display = 'none';
			const sd = tbody.querySelector('.stock-display[data-id="' + id + '"]');
			if (sd) { sd.textContent = stockLabel(stock); sd.className = 'stock-display ' + stockClass(stock); sd.style.display = 'inline'; }
			const res = await post({ action: 'save_stock', id, stock });
			if (!res.ok) notifyErr(res.message);
		}
	}, true);

	function currentPrice(id) {
		const inp  = document.getElementById('price-edit-' + id);
		if (inp)  return parseFloat(inp.value || 0);
		const span = tbody.querySelector('.price-display[data-id="' + id + '"]');
		return span ? parseFloat(span.textContent.replace('$','') || 0) : 0;
	}
	function currentListPrice(id) {
		const inp  = document.getElementById('list-price-edit-' + id);
		if (inp)  return parseFloat(inp.value || 0);
		const span = tbody.querySelector('.list-price-display[data-id="' + id + '"]');
		return span ? parseFloat(span.textContent.replace('$','') || 0) : 0;
	}

	// ── Clone via hamburger ───────────────────────────────────────────────────
	tbody.addEventListener('click', async function (e) {
		const cloneBtn = e.target.closest('.clone-btn');
		if (!cloneBtn) return;
		document.querySelectorAll('.row-menu-drop').forEach(d => d.style.display = 'none');
		const id  = cloneBtn.dataset.id;
		const res = await post({ action: 'clone', id });
		if (!res.ok) { notifyErr(res.message); return; }
		allRows.push(res.row);
		applyFiltersAndSort();
	});

	// ── Category selector (dropdown in single-cat mode, checkboxes otherwise) ──
	const SINGLE_CAT_MODE = isFinite(PRODUCT_CAT_LIMIT) && PRODUCT_CAT_LIMIT === 1;

	function renderCatList(selectedIds) {
		const list = document.getElementById('prod-cat-list');
		list.innerHTML = '';

		// Hide quick-add in single-category mode (adding categories is done from Categories page)
		const quickAddRow = document.querySelector('.quick-add-row');
		if (quickAddRow) quickAddRow.style.display = SINGLE_CAT_MODE ? 'none' : '';

		if (!allCategories.length) {
			list.innerHTML = '<span style="color:var(--nc-text-dim);font-size:.83rem">No categories yet.</span>';
			return;
		}

		if (SINGLE_CAT_MODE) {
			const sel = document.createElement('select');
			sel.id = 'prod-cat-select';
			sel.setAttribute('aria-label', 'Product category');
			const none = document.createElement('option');
			none.value = ''; none.textContent = '- Uncategorized -';
			sel.appendChild(none);
			allCategories.forEach(function (c) {
				const opt = document.createElement('option');
				opt.value = c.id; opt.textContent = c.name;
				if (selectedIds.map(String).includes(String(c.id))) opt.selected = true;
				sel.appendChild(opt);
			});
			list.appendChild(sel);
		} else {
			allCategories.forEach(function (c) {
				const label = document.createElement('label');
				const cb    = document.createElement('input');
				cb.type = 'checkbox'; cb.value = c.id; cb.name = 'prod_cat';
				if (selectedIds.map(String).includes(String(c.id))) cb.checked = true;
				label.appendChild(cb);
				label.appendChild(document.createTextNode(' ' + c.name));
				list.appendChild(label);
			});
		}
	}

	function getSelectedCatIds() {
		if (SINGLE_CAT_MODE) {
			const sel = document.getElementById('prod-cat-select');
			return sel && sel.value ? [sel.value] : [];
		}
		return Array.from(document.querySelectorAll('#prod-cat-list input[type=checkbox]:checked'))
			.map(cb => cb.value);
	}

	function syncCatLimitUI() {
		const quickAddRow = document.querySelector('.quick-add-row');
		if (!quickAddRow) return;
		const atLimit = isFinite(CAT_LIMIT) && catCount >= CAT_LIMIT;
		let hint = document.getElementById('quick-cat-limit-hint');
		if (atLimit) {
			quickAddRow.style.display = 'none';
			if (!hint) {
				hint = document.createElement('p');
				hint.id = 'quick-cat-limit-hint';
				hint.className = 'ec-limit-hint';
				hint.innerHTML = 'Category limit reached. <a href="' + (NC.upgradeUrl || '#') + '" target="_blank" rel="noopener">Upgrade to add more &rarr;</a>';
				quickAddRow.insertAdjacentElement('afterend', hint);
			}
		} else {
			quickAddRow.style.display = '';
			if (hint) hint.remove();
		}
	}

	// ── Quick-add category ────────────────────────────────────────────────────
	syncCatLimitUI();

	document.getElementById('btn-quick-add-cat').addEventListener('click', async function () {
		const input = document.getElementById('quick-cat-name');
		const name  = input.value.trim();
		if (!name) { notifyErr('Enter a category name.'); return; }
		const res = await post({ action: 'quick_add_category', name });
		if (!res.ok) { notifyErr(res.message); return; }
		allCategories.push(res.category);
		catCount++;
		const selected = getSelectedCatIds();
		selected.push(String(res.category.id));
		renderCatList(selected);
		input.value = '';
		syncCatLimitUI();
		notifyOk('Category "' + res.category.name + '" added. Remember to complete its details.');
	});

	// ── Drawer tabs ───────────────────────────────────────────────────────────
	let lastActiveTab = 'details';

	function activateTab(panel) {
		document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
		document.querySelectorAll('.drawer-tab-panel').forEach(p => p.classList.remove('active'));
		const btn = document.querySelector('.drawer-tab[data-panel="' + panel + '"]');
		if (btn) btn.classList.add('active');
		const panelEl = document.getElementById('panel-' + panel);
		if (panelEl) panelEl.classList.add('active');
		const nameEl = document.getElementById('drawer-tab-name');
		if (nameEl) {
			const isDetails = panel === 'details';
			nameEl.textContent = isDetails ? '' : (document.getElementById('prod-name')?.value.trim() || '');
			nameEl.classList.toggle('visible', !isDetails);
		}
		if (panel === 'options') {
			const productId = document.getElementById('prod-id')?.value;
			if (productId) loadProductOptions(productId);
		}
		document.dispatchEvent(new CustomEvent('nc-drawer-tab', {detail: {
			page: 'product', panel, productId: document.getElementById('prod-id')?.value || ''
		}}));
	}

	document.querySelectorAll('.drawer-tab').forEach(function (btn) {
		btn.addEventListener('click', function () {
			lastActiveTab = this.dataset.panel;
			activateTab(lastActiveTab);
		});
	});

	// ── Image upload ──────────────────────────────────────────────────────────
	const imgDropZone  = document.getElementById('img-drop-zone');
	const imgFileInput = document.getElementById('img-file-input');
	const imgGrid      = document.getElementById('img-grid');

	let pendingImages  = []; // { file, url, isPrimary, id? }

	function syncPrimary() {
		pendingImages.forEach(function (img, i) { img.isPrimary = i === 0; });
	}

	function renderImageGrid() {
		imgGrid.innerHTML = '';
		pendingImages.forEach(function (img, idx) {
			const div = document.createElement('div');
			div.className   = 'img-thumb' + (img.isPrimary ? ' is-primary' : '');
			div.dataset.idx = idx;
			div.innerHTML =
				'<img src="' + img.url + '" alt="" draggable="false">' +
				(img.isPrimary ? '<div class="img-primary-label">Primary</div>' : '');

			const dip = document.createElement('delete-in-place');
			dip.setAttribute('caption', '&#128465;');
			dip.setAttribute('confirm', 'Remove image?');
			dip.className = 'img-thumb-dip';
			div.appendChild(dip);

			// Delete - red border → fade → remove and re-render
			dip.addEventListener('dip-confirm', function (e) {
				e.stopPropagation();
				animateDelete(div, function () {
					if (img.id) post({ action: 'delete_image', id: img.id });
					pendingImages.splice(idx, 1);
					syncPrimary();
					renderImageGrid();
					syncImagesLimitUI();
					scheduleAutoSave();
				});
			});

			imgGrid.appendChild(div);
		});
	}

	// Drag reorder (SortableJS, forceFallback - native HTML5 Drag and Drop
	// has a real Chromium/Linux platform bug where a real physical drag
	// never progresses past dragstart; forceFallback uses pointer events
	// instead, sidestepping the native OS drag handoff entirely. Bound once
	// to the grid container, which persists across renderImageGrid()
	// rebuilding its children.) Dropping an OS file onto an existing
	// thumbnail to upload it is no longer supported here - use the drop
	// zone or the file-manager button instead.
	if (window.Sortable) {
		Sortable.create(imgGrid, {
			animation: 150,
			forceFallback: true,
			fallbackOnBody: true,
			filter: '.img-thumb-dip',
			preventOnFilter: false,
			onEnd: function (evt) {
				if (evt.oldIndex === evt.newIndex) return;
				const moved = pendingImages.splice(evt.oldIndex, 1)[0];
				pendingImages.splice(evt.newIndex, 0, moved);
				syncPrimary();
				renderImageGrid();
				scheduleAutoSave();
			},
		});
	}

	const btnOpenFm = document.getElementById('btn-open-fm');

	function syncImagesLimitUI() {
		if (!isFinite(IMAGES_PER_PROD_LIMIT)) return;
		const atLimit = pendingImages.length >= IMAGES_PER_PROD_LIMIT;
		imgDropZone.style.display = atLimit ? 'none' : '';
		if (btnOpenFm) btnOpenFm.style.display = atLimit ? 'none' : '';
		let hint = document.getElementById('img-limit-hint');
		if (atLimit) {
			if (!hint) {
				hint = document.createElement('p');
				hint.id        = 'img-limit-hint';
				hint.className = 'ec-limit-hint';
				hint.innerHTML = 'Image limit reached (' + IMAGES_PER_PROD_LIMIT + ' per product). ' +
					'<a href="' + (NC.upgradeUrl || '#') + '" target="_blank" rel="noopener">Upgrade to add more</a>.';
				imgGrid.parentNode.insertBefore(hint, imgGrid);
			}
		} else {
			if (hint) hint.remove();
		}
	}

	function addImageFiles(files) {
		Array.from(files).forEach(function (file) {
			if (!file.type.match(/image\/(jpeg|png|webp)/)) return;
			if (isFinite(IMAGES_PER_PROD_LIMIT) && pendingImages.length >= IMAGES_PER_PROD_LIMIT) return;
			const url = URL.createObjectURL(file);
			pendingImages.push({ file, url, isPrimary: false });
		});
		syncPrimary();
		renderImageGrid();
		syncImagesLimitUI();
		scheduleAutoSave();
	}

	// ── Auto-save images (existing products only) ─────────────────────────────
	let _autoSaveTimer = null;
	function scheduleAutoSave() {
		if (!currentProdId) return;
		clearTimeout(_autoSaveTimer);
		_autoSaveTimer = setTimeout(doAutoSaveImages, 500);
	}

	async function doAutoSaveImages() {
		if (!currentProdId) return;

		// Upload any new file images not yet in the DB
		const toUpload = pendingImages.filter(i => i.file && !i.id);
		for (const img of toUpload) {
			const r = await postFile({ action: 'upload_image', product_id: currentProdId, is_primary: 0 }, { image: img.file });
			if (!r.ok) { notifyErr(r.message || 'Image upload failed.'); return; }
			if (r.image) img.id = r.image.id;
		}

		// Link any FM-sourced images not yet in the DB
		const toLink = pendingImages.filter(i => !i.file && !i.id && i.db_path);
		for (const fmImg of toLink) {
			const r = await post({ action: 'link_fm_image', product_id: currentProdId, db_path: fmImg.db_path });
			if (r.ok && r.image) fmImg.id = r.image.id;
		}

		// Persist order and primary for everything now in the DB
		const saved = pendingImages.filter(i => i.id);
		if (saved.length) {
			const primary = saved.find(i => i.isPrimary) || saved[0];
			await post({
				action:     'reorder_images',
				product_id: currentProdId,
				ids:        JSON.stringify(saved.map(i => i.id)),
				primary_id: primary.id,
			});
		}

		notifyOk('Images saved.');
	}

	// Click to browse
	imgDropZone.addEventListener('click', function () { imgFileInput.click(); });
	imgFileInput.addEventListener('change', function () { addImageFiles(this.files); this.value = ''; });

	btnOpenFm?.addEventListener('click', function () {
		if (!window.openFilePicker) return;
		window.openFilePicker(function (items) {
			items.forEach(function (item) {
				if (pendingImages.some(function (i) { return i.db_path === item.db_path; })) return;
				if (isFinite(IMAGES_PER_PROD_LIMIT) && pendingImages.length >= IMAGES_PER_PROD_LIMIT) return;
				pendingImages.push({ url: item.url, db_path: item.db_path, isPrimary: false });
			});
			syncPrimary();
			renderImageGrid();
			syncImagesLimitUI();
			scheduleAutoSave();
		});
	});

	// Drag/drop files onto drop zone
	let imgDragCount = 0;
	imgDropZone.addEventListener('dragenter', function (e) {
		e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; imgDragCount++;
		this.classList.add('drag-over');
	});
	imgDropZone.addEventListener('dragleave', function () {
		imgDragCount--;
		if (imgDragCount <= 0) { imgDragCount = 0; this.classList.remove('drag-over'); }
	});
	// preventDefault() alone permits the drop, but some browsers still show a
	// "denied" cursor unless dropEffect is also set explicitly - it's a
	// separate signal from whether the drop is technically allowed.
	imgDropZone.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
	imgDropZone.addEventListener('drop', function (e) {
		e.preventDefault(); imgDragCount = 0; this.classList.remove('drag-over');
		// Only handle file drops, not thumb reorders
		if (e.dataTransfer.files.length) addImageFiles(e.dataTransfer.files);
	});

	// ── Drawer open/close ─────────────────────────────────────────────────────
	function openDrawer(title) {
		document.getElementById('drawer-title').textContent = title;
		drawer.classList.add('open');
		overlay.classList.add('show');
		activateTab(lastActiveTab);
		// Init Trumbowyg
		setTimeout(function () {
			if (!window._trumbProdDone && window.jQuery && jQuery.fn.trumbowyg) {
				var tbCfg = {
					svgPath: '/js/vendor/trumbowyg/src/ui/icons.svg',
					btns: [['bold','italic','underline'],['link'],['unorderedList','orderedList'],['indent','outdent'],['viewHTML']]
				};
				jQuery('#prod-desc').trumbowyg(tbCfg);
				jQuery('#prod-desc-long').trumbowyg(tbCfg);
				window._trumbProdDone = true;
			}
		}, 50);
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
		currentProdId = null;
	}

	function resetDrawer() {
		currentProdId = null;
		document.getElementById('prod-id').value              = '';
		document.getElementById('prod-name').value            = '';
		document.getElementById('prod-sku').value             = '';
		document.getElementById('prod-price').value           = '';
		document.getElementById('prod-list-price').value      = '';
		document.getElementById('prod-weight').value          = '';
		document.getElementById('prod-stock').value           = '0';
		if (window._trumbProdDone) jQuery('#prod-desc').trumbowyg('html', '');
		else document.getElementById('prod-desc').value = '';
		document.getElementById('prod-seo-title').value       = '';
		document.getElementById('prod-seo-keywords').value    = '';
		document.getElementById('prod-seo-description').value = '';
		document.getElementById('quick-cat-name').value       = '';
		if (window._trumbProdDone) jQuery('#prod-desc-long').trumbowyg('html', '');
		else document.getElementById('prod-desc-long').value = '';
		setTogVal('prod-active',   1);
		setTogVal('prod-featured', 0);
		setTogVal('prod-free-ship',0);
		setTogVal('prod-requires-shipping', 1);
		renderCatList([]);
		pendingImages = [];
		renderImageGrid();
		syncImagesLimitUI();
	}

	// ── Add ───────────────────────────────────────────────────────────────────
	async function addProduct() {
		resetDrawer();
		openDrawer('Add Product');
		document.getElementById('prod-name').focus();
	}
	document.getElementById('btn-add-product').addEventListener('click', addProduct);
	document.getElementById('btn-add-first').addEventListener('click', addProduct);

	// ── Edit ──────────────────────────────────────────────────────────────────
	tbody.addEventListener('click', async function (e) {
		const btn = e.target.closest('.prod-name-link');
		if (!btn) return;
		const res = await post({ action: 'get', id: btn.dataset.id });
		if (!res.ok) { notifyErr(res.message); return; }
		const d = res.row;
		currentProdId = d.id;

		document.getElementById('prod-id').value              = d.id;
		document.getElementById('prod-name').value            = d.name;
		document.getElementById('prod-sku').value             = (d.sku || '').toUpperCase();
		document.getElementById('prod-price').value           = parseFloat(d.price || 0).toFixed(2);
		document.getElementById('prod-list-price').value      = parseFloat(d.list_price || 0).toFixed(2);
		document.getElementById('prod-weight').value          = parseFloat(d.weight || 0).toFixed(2);
		document.getElementById('prod-stock').value           = d.stock;
		if (window._trumbProdDone) jQuery('#prod-desc').trumbowyg('html', d.description || '');
		else document.getElementById('prod-desc').value = d.description || '';
		document.getElementById('prod-seo-title').value       = d.seo_title || '';
		document.getElementById('prod-seo-keywords').value    = d.seo_keywords || '';
		document.getElementById('prod-seo-description').value = d.seo_description || '';

		if (window._trumbProdDone) jQuery('#prod-desc-long').trumbowyg('html', d.description_long || '');
		else document.getElementById('prod-desc-long').value = d.description_long || '';

		setTogVal('prod-active',    d.status       == 1 ? 1 : 0);
		setTogVal('prod-featured',  d.featured     == 1 ? 1 : 0);
		setTogVal('prod-free-ship', d.free_shipping == 1 ? 1 : 0);
		setTogVal('prod-requires-shipping', d.requires_shipping == 0 ? 0 : 1);

		renderCatList(d.category_ids || []);

		// Load existing images
		pendingImages = (d.images || []).map(function (img) {
			return { file: null, url: img.filename, isPrimary: img.is_primary == 1, id: img.id };
		});
		renderImageGrid();
		syncImagesLimitUI();

		openDrawer('Edit Product');
	});

	// ── SKU uppercase ─────────────────────────────────────────────────────────
	document.getElementById('prod-sku').addEventListener('input', function () {
		var pos = this.selectionStart;
		this.value = this.value.toUpperCase();
		this.setSelectionRange(pos, pos);
	});

	// ── Save ──────────────────────────────────────────────────────────────────
	async function doSave(btn) {
		const nameEl = document.getElementById('prod-name');
		if (!nameEl.reportValidity()) return;
		btn.setLoading();

		const descLong = window._trumbProdDone
			? jQuery('#prod-desc-long').trumbowyg('html')
			: document.getElementById('prod-desc-long').value;

		const res = await post({
			action:           'save',
			id:               document.getElementById('prod-id').value,
			name:             document.getElementById('prod-name').value.trim(),
			sku:              document.getElementById('prod-sku').value.toUpperCase(),
			price:            document.getElementById('prod-price').value,
			list_price:       document.getElementById('prod-list-price').value || 0,
			weight:           document.getElementById('prod-weight').value || '',
			stock:            document.getElementById('prod-stock').value,
			status:           togVal('prod-active'),
			featured:         togVal('prod-featured'),
			free_shipping:    togVal('prod-free-ship'),
			requires_shipping: togVal('prod-requires-shipping'),
			description:      window._trumbProdDone ? jQuery('#prod-desc').trumbowyg('html') : document.getElementById('prod-desc').value,
			description_long: descLong,
			seo_title:        document.getElementById('prod-seo-title').value,
			seo_keywords:     document.getElementById('prod-seo-keywords').value,
			seo_description:  document.getElementById('prod-seo-description').value,
			category_ids:     JSON.stringify(getSelectedCatIds()),
		});

		if (!res.ok) {
			notifyErr(res.message);
			btn.reset();
			return;
		}

		// Keep currentProdId in sync (needed for new products that stay open)
		if (!currentProdId) {
			currentProdId = res.row.id;
			document.getElementById('prod-id').value = res.row.id;
		}

		// Upload any new images not yet in the DB
		const newImages = pendingImages.filter(i => i.file && !i.id);
		for (var i = 0; i < newImages.length; i++) {
			const img = newImages[i];
			const isPrimary = img.isPrimary && i === 0 ? 1 : 0;
			const ir = await postFile({
				action:     'upload_image',
				product_id: res.row.id,
				is_primary:  isPrimary,
			}, { image: img.file });
			if (!ir.ok) { notifyErr(ir.message || 'Image upload failed.'); continue; }
			if (ir.image) img.id = ir.image.id;
		}

		// Link images selected from the file manager (have db_path but no file/id yet)
		const fmImages = pendingImages.filter(i => !i.file && !i.id && i.db_path);
		for (var j = 0; j < fmImages.length; j++) {
			const fmImg = fmImages[j];
			const linkRes = await post({
				action:     'link_fm_image',
				product_id: res.row.id,
				db_path:    fmImg.db_path,
			});
			if (linkRes.ok && linkRes.image) {
				fmImg.id = linkRes.image.id;
			}
		}

		// Persist display_order and is_primary for existing + newly linked images
		const existingImages = pendingImages.filter(i => i.id);
		if (existingImages.length) {
			const primaryImg = existingImages.find(i => i.isPrimary) || existingImages[0];
			await post({
				action:     'reorder_images',
				product_id: res.row.id,
				ids:        JSON.stringify(existingImages.map(i => i.id)),
				primary_id: primaryImg.id,
			});
		}

		updateRow(res.row);
		btn.showSuccess();
	}

	document.getElementById('btn-drawer-save').addEventListener('save', async function () { await doSave(this); });

	document.getElementById('drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);
	overlay.addEventListener('click', closeDrawer);

	// ── Debounced inline toggles ──────────────────────────────────────────────
	// Keyed per id+field - a single shared timer would let toggling one row's
	// field cancel another row's (or another field's) still-pending save.
	var toggleTimers = {};
	function debouncedToggle(id, field, value) {
		const key = id + ':' + field;
		clearTimeout(toggleTimers[key]);
		toggleTimers[key] = setTimeout(function () {
			delete toggleTimers[key];
			post({ action: 'toggle', id, field, value });
		}, 1000);
	}

	document.addEventListener('ios-toggle', function (e) {
		const src = e.detail.source;
		if (!src.dataset.id || !src.dataset.field) return;
		if (src.dataset.field === 'status') {
			const id      = src.dataset.id;
			const inactive = !e.detail.checked;
			const delSpan  = document.getElementById('prod-del-' + id);
			const chk      = tbody.querySelector('tr[data-id="' + id + '"] .row-chk');
			if (delSpan) delSpan.classList.toggle('show', inactive);
			if (chk)     chk.disabled = !inactive;
		}
		// Keep the in-memory row data current so a later re-render (e.g. changing
		// the category filter) doesn't rebuild this row from a stale value and
		// visually revert a toggle that already saved (or is about to).
		const row = allRows.find(r => String(r.id) === String(src.dataset.id));
		if (row) row[src.dataset.field] = e.detail.value;
		debouncedToggle(src.dataset.id, src.dataset.field, e.detail.value);
	});

	// ── Delete single ─────────────────────────────────────────────────────────
	tbody.addEventListener('dip-confirm', async function (e) {
		const id  = e.detail['data-id'];
		const res = await post({ action: 'delete', id });
		if (!res.ok) { notifyErr(res.message); return; }
		allRows = allRows.filter(r => String(r.id) !== String(id));
		const tr = tbody.querySelector('tr[data-id="' + id + '"]');
		if (tr) {
			tr.classList.add('row-deleting');
			setTimeout(function () {
				tr.classList.add('row-deleting-fade');
				setTimeout(function () {
					tr.remove();
					updateBulkBtn();
					if (!tbody.querySelector('tr[data-id]')) emptyRow.style.display = '';
				}, 300);
			}, 200);
		}
	});

	// ── Bulk delete ───────────────────────────────────────────────────────────
	chkAll.addEventListener('change', function () {
		tbody.querySelectorAll('.row-chk:not(:disabled)').forEach(c => c.checked = this.checked);
		updateBulkBtn();
	});
	tbody.addEventListener('change', function (e) { if (e.target.classList.contains('row-chk')) updateBulkBtn(); });

	function updateBulkBtn() {
		const n = tbody.querySelectorAll('.row-chk:checked').length;
		btnBulk.disabled    = n === 0;
		btnBulk.textContent = n > 0 ? 'Delete Selected (' + n + ')' : 'Delete Selected';
	}

	btnBulk.addEventListener('click', async function () {
		const ids = Array.from(tbody.querySelectorAll('.row-chk:checked')).map(c => c.dataset.id);
		if (!ids.length) return;
		const res = await post({ action: 'bulk_delete', ids: JSON.stringify(ids) });
		if (!res.ok) { notifyErr(res.message); return; }
		allRows = allRows.filter(r => !ids.includes(String(r.id)));
		ids.forEach(function (id) {
			const tr = tbody.querySelector('tr[data-id="' + id + '"]');
			if (tr) {
				tr.classList.add('row-deleting');
				setTimeout(function () {
					tr.classList.add('row-deleting-fade');
					setTimeout(function () { tr.remove(); }, 300);
				}, 200);
			}
		});
		setTimeout(function () { if (!tbody.querySelector('tr[data-id]')) emptyRow.style.display = ''; updateBulkBtn(); }, 550);
		chkAll.checked = false;
	});

	// ── Drag-drop reorder (SortableJS, forceFallback - see the note near the
	// top of this file for why native HTML5 DnD isn't used) ─────────────────
	if (window.Sortable) {
		Sortable.create(tbody, {
			handle: '.drag-handle',
			animation: 150,
			forceFallback: true,
			fallbackOnBody: true,
			draggable: 'tr[data-id]',
			filter: function () {
				return document.getElementById('prod-table')?.classList.contains('drag-disabled');
			},
			preventOnFilter: false,
			onEnd: function () { saveOrder(); },
		});
	}

	function initDragDrop() { /* delegated */ }

	async function saveOrder() {
		var ids   = Array.from(tbody.querySelectorAll('tr[data-id]')).map(r => r.dataset.id);
		var field = featuredReorderMode ? 'featured_order' : 'display_order';

		if (featuredReorderMode) {
			// Only the featured subset is visible/reordered here - update their featured_order in place,
			// leave display_order (and non-featured rows' featured_order) untouched.
			ids.forEach(function (id, order) {
				var row = allRows.find(r => String(r.id) === String(id));
				if (row) row.featured_order = order;
			});
		} else {
			// Keep allRows in sync with the new drag order
			allRows.sort(function (a, b) {
				var ai = ids.indexOf(String(a.id)), bi = ids.indexOf(String(b.id));
				if (ai < 0) ai = ids.length; if (bi < 0) bi = ids.length;
				return ai - bi;
			});
		}
		const res = await post({ action: 'reorder', ids: JSON.stringify(ids), field: field });
		if (res.ok) notifyOk('Order saved.'); else notifyErr(res.message || 'Could not save order.');
	}

	// ── Column sort ───────────────────────────────────────────────────────────
	document.querySelectorAll('th[data-sort]').forEach(function (th) {
		th.addEventListener('click', function () {
			const col = this.dataset.sort;
			if (sortCol === col) { sortDir = -sortDir; }
			else { sortCol = col; sortDir = 1; }
			localStorage.setItem('nc_prod_sort_col', sortCol);
			localStorage.setItem('nc_prod_sort_dir', sortDir);
			applyFiltersAndSort();
		});
	});

	// ── Filters ───────────────────────────────────────────────────────────────
	var fltTimer = null;
	document.getElementById('flt-name')?.addEventListener('input', function () {
		clearTimeout(fltTimer);
		fltTimer = setTimeout(applyFiltersAndSort, 200);
	});
	document.getElementById('flt-cat')?.addEventListener('change', applyFiltersAndSort);
	document.addEventListener('roller-change', function (e) {
		if (e.detail.source.id === 'flt-status' || e.detail.source.id === 'flt-featured') {
			// Selecting "Featured only" enters featured-reorder mode, which displays rows by
			// featured_order - any leftover column sort (including one restored from localStorage
			// on page load) would silently keep drag-reorder disabled despite looking like only
			// the Featured filter is active, so clear it here rather than requiring a separate
			// "Clear" click.
			if (e.detail.source.id === 'flt-featured' && e.detail.value === '1' && sortCol) {
				sortCol = ''; sortDir = 1;
				localStorage.removeItem('nc_prod_sort_col');
				localStorage.removeItem('nc_prod_sort_dir');
			}
			applyFiltersAndSort();
		}
	});
	document.getElementById('btn-flt-clear')?.addEventListener('click', function () {
		document.getElementById('flt-name').value    = '';
		document.getElementById('flt-cat').value     = '';
		document.getElementById('flt-status').value  = '';
		document.getElementById('flt-featured').value = '';
		sortCol = ''; sortDir = 1;
		localStorage.removeItem('nc_prod_sort_col');
		localStorage.removeItem('nc_prod_sort_dir');
		applyFiltersAndSort();
	});

	// ── Init ──────────────────────────────────────────────────────────────────
	fetchRowTemplate().then(function () {
		loadProducts();
		loadCategories();

		// Auto-open product drawer if ?edit=productId is in the URL
		const urlParams = new URLSearchParams(window.location.search);
		const editProductId = urlParams.get('edit');
		if (editProductId) {
			// Wait a moment for products to load, then open the drawer
			setTimeout(async function () {
				const res = await post({ action: 'get', id: editProductId });
				if (!res.ok) { notifyErr(res.message); return; }
				const d = res.row;
				currentProdId = d.id;

				document.getElementById('prod-id').value              = d.id;
				document.getElementById('prod-name').value            = d.name;
				document.getElementById('prod-sku').value             = (d.sku || '').toUpperCase();
				document.getElementById('prod-price').value           = parseFloat(d.price || 0).toFixed(2);
				document.getElementById('prod-list-price').value      = parseFloat(d.list_price || 0).toFixed(2);
				document.getElementById('prod-weight').value          = parseFloat(d.weight || 0).toFixed(2);
				document.getElementById('prod-stock').value           = d.stock;
				if (window._trumbProdDone) jQuery('#prod-desc').trumbowyg('html', d.description || '');
				else document.getElementById('prod-desc').value = d.description || '';
				document.getElementById('prod-seo-title').value       = d.seo_title || '';
				document.getElementById('prod-seo-keywords').value    = d.seo_keywords || '';
				document.getElementById('prod-seo-description').value = d.seo_description || '';

				if (window._trumbProdDone) jQuery('#prod-desc-long').trumbowyg('html', d.description_long || '');
				else document.getElementById('prod-desc-long').value = d.description_long || '';

				setTogVal('prod-active',    d.status       == 1 ? 1 : 0);
				setTogVal('prod-featured',  d.featured     == 1 ? 1 : 0);
				setTogVal('prod-free-ship', d.free_shipping == 1 ? 1 : 0);
				setTogVal('prod-requires-shipping', d.requires_shipping == 0 ? 0 : 1);

				renderCatList(d.category_ids || []);

				// Load existing images
				pendingImages = (d.images || []).map(function (img) {
					return { file: null, url: img.filename, isPrimary: img.is_primary == 1, id: img.id };
				});
				renderImageGrid();
				syncImagesLimitUI();

				openDrawer('Edit Product');
				// Remove the edit param from the URL
				window.history.replaceState({}, document.title, window.location.pathname + '?route=products');
			}, 500);
		}
	});

	// ── Drawer scroll indicator ───────────────────────────────────────────────
	(function () {
		const drawerContent = document.getElementById('prod-drawer-content');
		const indicator     = document.getElementById('prod-scroll-indicator');
		if (!drawerContent || !indicator) return;

		function checkOverflow() {
			const detailsActive = document.getElementById('panel-details')?.classList.contains('active');
			const overflows = drawerContent.scrollHeight > drawerContent.clientHeight + 10;
			const atBottom  = drawerContent.scrollTop + drawerContent.clientHeight >= drawerContent.scrollHeight - 20;
			indicator.classList.toggle('hidden', !detailsActive || !overflows || atBottom);
		}

		const drawerEl = document.getElementById('prod-drawer');
		if (drawerEl && window.MutationObserver) {
			new MutationObserver(checkOverflow).observe(drawerEl, { attributes: true, attributeFilter: ['class'] });
		}
		drawerContent.addEventListener('scroll', checkOverflow);
		drawerContent.addEventListener('focusin', function (e) {
			if (e.target.tagName === 'TEXTAREA' || e.target.classList.contains('trumbowyg-editor')) {
				indicator.classList.add('hidden');
			}
		});
		// Re-check when tabs switch
		document.querySelectorAll('.drawer-tab').forEach(function (btn) {
			btn.addEventListener('click', function () { setTimeout(checkOverflow, 50); });
		});
		window.addEventListener('resize', checkOverflow);
	}());

	// ── AI helpers ────────────────────────────────────────────────────────────
	async function aiGenerate(prompt) {
		var key = (NC.deepaiKey || '').trim();
		if (!key) {
			notifyErr('DeepAI API key not set. Add it in Settings \u2192 Options \u2192 AI.');
			return null;
		}
		var fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		fd.append('text', prompt);
		try {
			var res  = await fetch('https://api.deepai.org/api/text-generator', {
				method: 'POST',
				headers: { 'api-key': key },
				body: fd,
			});
			var data = await res.json();
			if (data.err) { notifyErr('AI error: ' + data.err); return null; }
			return (data.output || '').trim();
		} catch (e) {
			notifyErr('AI request failed: ' + e.message);
			return null;
		}
	}

	function prodName() {
		return document.getElementById('prod-name').value.trim();
	}

	// Short description
	document.getElementById('btn-prod-ai-short')?.addEventListener('click', async function () {
		var name = prodName();
		if (!name) { notifyErr('Enter a product name first.'); return; }
		this.disabled = true; this.textContent = '\u2728 Generating\u2026';
		var result = await aiGenerate(
			'Write a short, compelling 1-2 sentence product description (plain text, no HTML, no heading) for a product called "' + name + '".'
		);
		this.disabled = false; this.textContent = '\u2728 AI';
		if (result) {
			if (window._trumbProdDone) jQuery('#prod-desc').trumbowyg('html', result);
			else document.getElementById('prod-desc').value = result;
		}
	});

	// Long description
	document.getElementById('btn-prod-ai-long')?.addEventListener('click', async function () {
		var name  = prodName();
		var short = document.getElementById('prod-desc').value.trim();
		if (!name) { notifyErr('Enter a product name first.'); return; }
		this.disabled = true; this.textContent = '\u2728 Generating\u2026';
		var ctx    = short ? ' The short description is: ' + short : '';
		var result = await aiGenerate(
			'Write a detailed HTML product description (3-5 sentences, use <p> tags, no heading) for a product called "' + name + '".' + ctx
		);
		this.disabled = false; this.textContent = '\u2728 AI';
		if (!result) return;
		if (window._trumbProdDone) jQuery('#prod-desc-long').trumbowyg('html', result);
		else document.getElementById('prod-desc-long').value = result;
	});

	// All SEO fields
	document.getElementById('btn-prod-ai-seo')?.addEventListener('click', async function () {
		var name = prodName();
		if (!name) { notifyErr('Enter a product name first.'); return; }
		this.disabled = true; this.textContent = '\u2728 Generating\u2026';
		var result = await aiGenerate(
			'For a product named "' + name + '", provide ONLY a JSON object (no markdown, no explanation) with: ' +
			'seo_title (page title under 70 chars), ' +
			'seo_keywords (comma-separated, max 150 chars), ' +
			'seo_description (meta description under 160 chars).'
		);
		this.disabled = false; this.textContent = '\u2728 Generate All SEO';
		if (!result) return;
		try {
			var obj = JSON.parse(result.replace(/```json|```/g, '').trim());
			if (obj.seo_title)       document.getElementById('prod-seo-title').value       = obj.seo_title;
			if (obj.seo_keywords)    document.getElementById('prod-seo-keywords').value    = obj.seo_keywords;
			if (obj.seo_description) document.getElementById('prod-seo-description').value = obj.seo_description;
		} catch (e) {
			notifyErr('AI returned unexpected format. Try again.');
		}
	});

	// ── Product Options tab ─────────────────────────────────────────────────────
	const optSearchInput   = document.getElementById('opt-search-input');
	const optSearchResults = document.getElementById('opt-search-results');
	const poList           = document.getElementById('product-options-list');
	let optionToggleCtrl   = new AbortController();

	async function loadProductOptions(productId) {
		if (!poList) return;
		const res = await post({ action: 'list_options', product_id: productId });
		if (!res.ok) return;
		optionToggleCtrl.abort();
		optionToggleCtrl = new AbortController();
		poList.innerHTML = '';
		(res.product_options || []).forEach(po => poList.appendChild(buildPoCard(po)));
		syncOptionsLimitUI();
	}

	function syncOptionsLimitUI() {
		if (!optSearchInput) return;
		const count   = poList ? poList.querySelectorAll('.po-card').length : 0;
		const atLimit = isFinite(OPTIONS_PER_PROD_LIMIT) && count >= OPTIONS_PER_PROD_LIMIT;
		const dfRow   = optSearchInput.closest('.df');
		let hint = document.getElementById('opt-limit-hint');
		if (atLimit) {
			if (dfRow) dfRow.style.display = 'none';
			if (!hint) {
				hint = document.createElement('p');
				hint.id = 'opt-limit-hint';
				hint.className = 'ec-limit-hint';
				hint.innerHTML = 'Option limit reached. <a href="' + (NC.upgradeUrl || '#') + '" target="_blank" rel="noopener">Upgrade to add more &rarr;</a>';
				(dfRow || optSearchInput).insertAdjacentElement('afterend', hint);
			}
		} else {
			if (dfRow) dfRow.style.display = '';
			if (hint) hint.remove();
		}
	}

	function buildPoCard(po) {
		const card = document.createElement('div');
		card.className = 'po-card';
		card.dataset.poId = po.id;
		card.setAttribute('role', 'listitem');

		const CHOICE = ['select','radio','checkbox','toggle'];
		const isChoice = CHOICE.includes(po.type);

		// Local mutable copies so cross-field saves don't clobber each other
		let currentUseAsImages = po.use_as_images ? 1 : 0;
		let currentRequired    = po.required ? 1 : 0;

		// ── Head ──
		const head = document.createElement('div');
		head.className = 'po-card-head';
		head.setAttribute('aria-expanded', 'false');

		const toggle = document.createElement('span');
		toggle.className = 'po-card-toggle';
		toggle.textContent = '▶';
		toggle.setAttribute('aria-hidden', 'true');

		const nameEl = document.createElement('span');
		nameEl.className = 'po-card-name';
		nameEl.textContent = po.label || po.option_name;

		// const typeEl = document.createElement('span');
		// typeEl.className = 'po-card-type';
		// typeEl.textContent = po.type;

		// Required toggle
		const reqWrap = document.createElement('label');
		reqWrap.className = 'po-card-required';
		reqWrap.innerHTML = '<ios-toggle size="sm" ' + (po.required ? 'checked' : '') + ' aria-label="Required"></ios-toggle><span>Required</span>';
		const reqToggle = reqWrap.querySelector('ios-toggle');
		document.addEventListener('ios-toggle', async function (e) {
			if (e.detail.source !== reqToggle) return;
			currentRequired = e.detail.checked ? 1 : 0;
			await post({ action: 'save_option', po_id: po.id, label: po.label || '', required: currentRequired, use_as_images: currentUseAsImages });
		}, { signal: optionToggleCtrl.signal });

		head.appendChild(toggle);
		head.appendChild(nameEl);
		// head.appendChild(typeEl);
		head.appendChild(reqWrap);

		// Clone button
		// const cloneBtn = document.createElement('button');
		// cloneBtn.type = 'button';
		// cloneBtn.className = 'po-card-action-btn';
		// cloneBtn.title = 'Clone option';
		// cloneBtn.setAttribute('aria-label', 'Clone option');
		// cloneBtn.textContent = 'Clone';
		// cloneBtn.addEventListener('click', async function (e) {
		// 	e.stopPropagation();
		// 	const res = await post({ action: 'clone_option', po_id: po.id });
		// 	if (!res.ok) { notifyErr(res.message); return; }
		// 	poList.appendChild(buildPoCard(res.product_option));
		// 	notifyOk('Option cloned.');
		// });
		// head.appendChild(cloneBtn);

		// Remove (delete-in-place)
		const dip = document.createElement('delete-in-place');
		dip.setAttribute('caption', '🗑');
		dip.setAttribute('confirm', 'Remove option?');
		dip.dataset.poId = po.id;
		dip.addEventListener('dip-confirm', function () {
			animateDelete(card, async function () {
				const res = await post({ action: 'remove_option', po_id: po.id });
				if (!res.ok) { card.style.opacity = '1'; card.style.outline = ''; notifyErr(res.message); return; }
				card.remove();
				syncOptionsLimitUI();
			});
		});

		head.appendChild(dip);

		// ── Body ──
		const body = document.createElement('div');
		body.className = 'po-card-body';

		// "Use as product images" toggle - choice types only, in body for visibility
		if (isChoice) {
			const uaiWrap = document.createElement('label');
			uaiWrap.className = 'po-card-use-as-images';
			const uaiToggle = document.createElement('ios-toggle');
			uaiToggle.setAttribute('size', 'sm');
			uaiToggle.setAttribute('aria-label', 'Use option value images as product gallery');
			if (po.use_as_images) uaiToggle.setAttribute('checked', '');
			document.addEventListener('ios-toggle', async function (e) {
				if (e.detail.source !== uaiToggle) return;
				currentUseAsImages = e.detail.checked ? 1 : 0;
				await post({ action: 'save_option', po_id: po.id, label: po.label || '', required: currentRequired, use_as_images: currentUseAsImages });
			}, { signal: optionToggleCtrl.signal });
			const uaiSpan = document.createElement('span');
			uaiSpan.textContent = 'Use option images as product gallery';
			uaiWrap.appendChild(uaiToggle);
			uaiWrap.appendChild(uaiSpan);
			body.appendChild(uaiWrap);
		}

		// Label override (edit-in-place)
		const labelWrap = document.createElement('div');
		labelWrap.className = 'po-label-field';
		labelWrap.innerHTML = '<label>Label (overrides "' + esc(po.option_name) + '" for this product)</label>';
		const labelInput = document.createElement('input');
		labelInput.type  = 'text';
		labelInput.value = po.label || '';
		labelInput.placeholder = po.option_name;
		labelInput.setAttribute('aria-label', 'Option label override');
		async function saveLabel() {
			po.label = labelInput.value.trim();
			nameEl.textContent = po.label || po.option_name;
			await post({ action: 'save_option', po_id: po.id, label: po.label, required: currentRequired, use_as_images: currentUseAsImages });
		}
		labelInput.addEventListener('blur', saveLabel);
		labelInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveLabel(); } });
		labelWrap.appendChild(labelInput);
		body.appendChild(labelWrap);

		// Value rows (choice types only)
		if (isChoice && po.values) {
			po.values.forEach(v => body.appendChild(buildPovRow(v)));
		}

		// Toggle open/close
		head.addEventListener('click', function (e) {
			if (e.target.closest('delete-in-place') || e.target.closest('ios-toggle') || e.target.closest('label')) return;
			card.classList.toggle('open');
			toggle.textContent = card.classList.contains('open') ? '▼' : '▶';
			head.setAttribute('aria-expanded', String(card.classList.contains('open')));
		});

		card.appendChild(head);
		card.appendChild(body);
		return card;
	}

	function buildPovRow(v) {
		const row = document.createElement('div');
		row.className = 'po-value-row';
		row.dataset.povId = v.id;

		// Enabled toggle
		const enabledToggle = document.createElement('ios-toggle');
		enabledToggle.className = 'po-value-enabled';
		enabledToggle.setAttribute('size', 'sm');
		enabledToggle.setAttribute('aria-label', 'Enable ' + v.value_text);
		if (v.enabled == 1) enabledToggle.setAttribute('checked', '');

		// Name / label - the visible label is itself editable inline; base name shown as tooltip
		const nameEl = document.createElement('span');
		nameEl.className       = 'po-value-name' + (v.enabled == 0 ? ' disabled' : '');
		nameEl.textContent     = v.label || v.value_text;
		nameEl.title           = 'Base: ' + v.value_text + ' - click to edit label';
		nameEl.contentEditable = 'true';
		nameEl.spellcheck      = false;

		// Price modifier
		const prefixRoller = document.createElement('roller-select');
		prefixRoller.setAttribute('aria-label', 'Price modifier sign');
		prefixRoller.setAttribute('value', ['=', '+', '-'].includes(v.price_prefix) ? v.price_prefix : '=');
		[{value: '+', label: '+'}, {value: '-', label: '−'}, {value: '=', label: '='}].forEach(function (item) {
			const ri = document.createElement('rs-item');
			ri.setAttribute('value', item.value);
			ri.textContent = item.label;
			prefixRoller.appendChild(ri);
		});
		document.addEventListener('roller-change', function (e) {
			if (e.detail.source === prefixRoller) savePov();
		});

		const priceWrapInner = document.createElement('span');
		priceWrapInner.className = 'po-value-field-wrap';
		const priceLabel = document.createElement('span');
		priceLabel.className   = 'po-value-field-label';
		priceLabel.textContent = 'price';
		const priceIn = document.createElement('input');
		priceIn.type      = 'number';
		priceIn.className = 'po-value-price-input';
		priceIn.value     = parseFloat(v.price_modifier || 0).toFixed(2);
		priceIn.min       = '0';
		priceIn.step      = '0.01';
		priceIn.setAttribute('aria-label', 'Price modifier for ' + v.value_text);
		priceIn.setAttribute('title', 'Price modifier for ' + v.value_text);
		priceWrapInner.appendChild(priceLabel);
		priceWrapInner.appendChild(priceIn);

		// Weight modifier - plain input with CSS floating label (no shadow DOM)
		const weightWrap = document.createElement('span');
		weightWrap.className = 'po-value-field-wrap';
		const weightLabel = document.createElement('span');
		weightLabel.className   = 'po-value-field-label';
		weightLabel.textContent = NC.weightClass || 'lb';
		const weightIn = document.createElement('input');
		weightIn.type      = 'number';
		weightIn.className = 'po-value-weight-input';
		weightIn.value     = parseFloat(v.weight_modifier || 0).toFixed(2);
		weightIn.min       = '0';
		weightIn.step      = '0.01';
		weightIn.setAttribute('aria-label', 'Weight modifier (' + (NC.weightClass || 'lb') + ') for ' + v.value_text);
		weightIn.setAttribute('title', 'Weight modifier (' + (NC.weightClass || 'lb') + ') for ' + v.value_text);
		weightWrap.appendChild(weightLabel);
		weightWrap.appendChild(weightIn);

		// Stock
		const stockWrap = document.createElement('span');
		stockWrap.className = 'po-value-field-wrap';
		const stockLabel = document.createElement('span');
		stockLabel.className   = 'po-value-field-label';
		stockLabel.textContent = 'stock';
		const stockIn = document.createElement('input');
		stockIn.type      = 'number';
		stockIn.className = 'po-value-stock-input';
		stockIn.value     = v.stock || 0;
		stockIn.min       = '0';
		stockIn.setAttribute('aria-label', 'Stock for ' + v.value_text);
		stockIn.setAttribute('title', 'Stock for ' + v.value_text);
		stockWrap.appendChild(stockLabel);
		stockWrap.appendChild(stockIn);

		// Default - one per option, pre-selects this value on the product page
		const defaultLabel = document.createElement('label');
		defaultLabel.className = 'po-value-default';
		defaultLabel.title = 'Pre-select this value on the product page';
		const defaultRadio = document.createElement('input');
		defaultRadio.type = 'radio';
		defaultRadio.name = 'po-default-' + v.product_option_id;
		defaultRadio.setAttribute('aria-label', 'Set ' + v.value_text + ' as the default selection');
		if (v.is_default == 1) defaultRadio.checked = true;
		defaultLabel.appendChild(defaultRadio);
		defaultLabel.appendChild(document.createTextNode(' Default'));

		let lastGoodPrefix = prefixRoller.value;
		async function savePov() {
			const attemptedPrefix = prefixRoller.value;
			const res = await post({
				action:          'save_option_value',
				pov_id:          v.id,
				label:           nameEl.textContent.trim(),
				price_prefix:    attemptedPrefix,
				price_modifier:  priceIn.value,
				weight_prefix:   '+',
				weight_modifier: weightIn.value,
				stock:           stockIn.value,
				subtract_stock:  0,
				enabled:         enabledToggle.checked ? 1 : 0,
				is_default:      defaultRadio.checked ? 1 : 0,
			});
			if (!res.ok) {
				notifyErr(res.message);
				prefixRoller.value = lastGoodPrefix;
				return;
			}
			lastGoodPrefix = attemptedPrefix;
		}

		document.addEventListener('ios-toggle', async function (e) {
			if (e.detail.source !== enabledToggle) return;
			nameEl.classList.toggle('disabled', !e.detail.checked);
			await savePov();
		}, { signal: optionToggleCtrl.signal });
		[priceIn, weightIn, stockIn].forEach(el => {
			el.addEventListener('change', savePov);
			el.addEventListener('blur', savePov);
		});
		defaultRadio.addEventListener('change', savePov);
		nameEl.addEventListener('blur', savePov);
		// Prevent Enter from inserting a newline in the contenteditable label
		nameEl.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
		});

		const priceWrap = document.createElement('div');
		priceWrap.className = 'po-value-price';
		priceWrap.appendChild(prefixRoller);
		priceWrap.appendChild(priceWrapInner);

		row.appendChild(enabledToggle);
		row.appendChild(nameEl);
		row.appendChild(priceWrap);
		row.appendChild(weightWrap);
		row.appendChild(stockWrap);
		row.appendChild(defaultLabel);
		return row;
	}

	// ── Option autocomplete ─────────────────────────────────────────────────────
	let acTimer = null;

	async function showOptions(q) {
		const res = await post({ action: 'search_options', q: q || '' });
		if (!res.ok) return;
		optSearchResults.innerHTML = '';
		if (!res.rows.length) { optSearchResults.style.display = 'none'; return; }
		res.rows.forEach(function (r) {
			const li = document.createElement('li');
			li.setAttribute('role', 'option');
			li.innerHTML = esc(r.name) + '<span class="opt-autocomplete-type">' + esc(r.type) + '</span>';
			li.addEventListener('mousedown', async function (e) {
				e.preventDefault(); // prevent blur before click fires
				optSearchResults.style.display = 'none';
				optSearchInput.value = '';
				const productId = document.getElementById('prod-id')?.value;
				if (!productId) return;
				if (isFinite(OPTIONS_PER_PROD_LIMIT) && poList.querySelectorAll('.po-card').length >= OPTIONS_PER_PROD_LIMIT) {
					notifyErr('Option limit reached (' + OPTIONS_PER_PROD_LIMIT + ' per product). Upgrade to add more.');
					return;
				}
				const addRes = await post({ action: 'add_option', product_id: productId, option_id: r.id });
				if (!addRes.ok) { notifyErr(addRes.message); return; }
				poList.appendChild(buildPoCard(addRes.product_option));
				syncOptionsLimitUI();
			});
			optSearchResults.appendChild(li);
		});
		optSearchResults.style.display = '';
	}

	// Show all on focus
	optSearchInput?.addEventListener('focus', function () { showOptions(''); });

	// A pick's mousedown handler preventDefault()s the blur so the click
	// registers before the list disappears -- but that also means the input
	// never loses focus, so 'focus' won't fire again to reopen the list for
	// a second pick. A real click on the input (as opposed to it merely
	// already having focus) should still reopen it.
	optSearchInput?.addEventListener('click', function () { showOptions(this.value.trim()); });

	// Filter on type
	optSearchInput?.addEventListener('input', function () {
		clearTimeout(acTimer);
		const q = this.value.trim();
		acTimer = setTimeout(() => showOptions(q), 200);
	});

	optSearchInput?.addEventListener('blur', function () {
		setTimeout(() => { if (optSearchResults) optSearchResults.style.display = 'none'; }, 200);
	});

	function esc(str) {
		return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
	}

})();
