/**
 * new-cart File Manager
 * Works in two modes:
 *   page mode   — full-page (NC.fm.mode === 'page')
 *   dialog mode — openFilePicker(callback) spawns a draggable/resizable dialog
 *                 callback receives array of {rel, url, db_path} on selection
 */
(function () {
'use strict';

const AJAX = NC.adminUrl + '?route=filemanager/ajax';

// ── State ──────────────────────────────────────────────────────────────────────
let currentFolder = '';   // rel path, '' = root
let currentFiles  = [];   // [{name, rel, url, fm_url, size, modified}]
let selectedRels  = new Set();
let viewMode      = localStorage.getItem('fm_view') || 'icons'; // 'icons' | 'list'
let sortCol       = localStorage.getItem('nc_fm_sort_col') || 'name';
let sortDir       = localStorage.getItem('nc_fm_sort_dir') || 'asc';
let dialogMode    = false;
let thumbSize     = parseInt(localStorage.getItem('fm_thumb_size') || (window.NC && NC.fmThumbSize ? NC.fmThumbSize : 50), 10);
// bindSizeButtons() runs synchronously during init() (called immediately if
// the DOM is already parsed by the time this script runs, which is the
// normal case for a script tag placed near the end of the page) — these
// must already be initialized by then. A `const` declared further down the
// file would still be in its temporal dead zone at that point, throwing a
// ReferenceError that aborts init() before it ever reaches bindDipDelete(),
// silently breaking every delete-in-place control on the page.
const THUMB_MIN = 50;
const THUMB_MAX = 150;
let dialogCallback = null;
let lastClickedRel = null;

// ── Utilities ─────────────────────────────────────────────────────────────────
let fmOptions = {}; // Global options for file manager (mode, dir, etc.)

function post(action, data) {
	const fd = new FormData();
	fd.append('csrf_token', getCsrfToken());
	fd.append('action', action);
	// Include global file manager options
	for (const [k, v] of Object.entries(fmOptions)) fd.append(k, v);
	for (const [k, v] of Object.entries(data || {})) fd.append(k, v);
	return fetch(AJAX, { method: 'POST', body: fd }).then(r => r.json());
}

function fmtSize(bytes) {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / 1048576).toFixed(2) + ' MB';
}

function fmtDate(ts) {
	const d = new Date(ts * 1000);
	return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

function notify(msg, type) {
	if (window.SimpleNotification) {
		window.SimpleNotification[type === 'error' ? 'error' : 'success']({ text: msg });
	}
}

function notifyPerm(msg) {
	if (window.SimpleNotification) {
		window.SimpleNotification.error({ text: msg, duration: 10000 });
	}
}

function handleError(res, btn) {
	if (btn) { btn.disabled = false; }
	const msg = res && res.message ? res.message : 'An error occurred.';
	const isPerm = /writable|permission|denied/i.test(msg);
	if (isPerm) {
		notifyPerm("Couldn't complete the action. Make sure the img folder and every folder in it is writeable.");
	} else {
		notify(msg, 'error');
	}
}

// ── Init ───────────────────────────────────────────────────────────────────────
function init(shellEl) {
	applyView(shellEl);
	loadTree(shellEl);
	const startFolder = localStorage.getItem('fm_last_folder') || '';
	loadFolder(startFolder, shellEl);
	bindViewToggle(shellEl);
	bindUpload(shellEl);
	bindDropZone(shellEl);
	bindMkdir(shellEl);
	bindSizeButtons(shellEl);
	bindDipDelete(shellEl);
}

// ── View toggle ───────────────────────────────────────────────────────────────
function applyView(shell) {
	const container = shell.querySelector('#fm-list-container');
	if (!container) return;
	container.className = 'fm-list-container view-' + viewMode;

	const btnIcons = shell.querySelector('#btn-fm-view-icons');
	const btnList  = shell.querySelector('#btn-fm-view-list');
	if (btnIcons) {
		btnIcons.setAttribute('aria-pressed', viewMode === 'icons' ? 'true' : 'false');
		btnIcons.classList.toggle('active', viewMode === 'icons');
	}
	if (btnList) {
		btnList.setAttribute('aria-pressed', viewMode === 'list' ? 'true' : 'false');
		btnList.classList.toggle('active', viewMode === 'list');
	}
}

function bindViewToggle(shell) {
	shell.querySelector('#btn-fm-view-icons')?.addEventListener('click', () => {
		viewMode = 'icons';
		localStorage.setItem('fm_view', viewMode);
		applyView(shell);
		renderFiles(shell);
	});
	shell.querySelector('#btn-fm-view-list')?.addEventListener('click', () => {
		viewMode = 'list';
		localStorage.setItem('fm_view', viewMode);
		applyView(shell);
		renderFiles(shell);
	});
}

// ── Tree ───────────────────────────────────────────────────────────────────────
function loadTree(shell) {
	post('tree').then(res => {
		if (!res.ok) return;
		const container = shell.querySelector('#fm-tree-children-root');
		if (!container) return;
		container.innerHTML = '';
		renderTreeNodes(res.tree, container, shell);
		if (currentFolder) {
			const node = shell.querySelector('.fm-tree-node[data-rel="' + currentFolder.replace(/"/g, '\\"') + '"]');
			if (node) {
				shell.querySelector('.fm-tree-root-node')?.classList.remove('fm-tree-selected');
				node.classList.add('fm-tree-selected');
			}
		}
	});
}

function renderTreeNodes(nodes, container, shell) {
	for (const node of nodes) {
		const wrap = document.createElement('div');
		wrap.className = 'fm-tree-item';

		const nodeEl = document.createElement('div');
		nodeEl.className = 'fm-tree-node';
		nodeEl.dataset.rel = node.rel;
		nodeEl.setAttribute('role', 'treeitem');
		nodeEl.setAttribute('tabindex', '0');
		nodeEl.setAttribute('aria-label', node.name);

		const toggle = document.createElement('span');
		toggle.className = 'fm-tree-toggle';
		toggle.textContent = node.children.length ? '▶' : ' ';

		const icon = document.createElement('span');
		icon.className = 'fm-tree-icon';
		icon.textContent = '📁';

		const label = document.createElement('span');
		label.className = 'fm-tree-label';
		label.textContent = node.name;

		// Delete folder — delete-in-place
		const dip = document.createElement('delete-in-place');
		dip.setAttribute('caption', '&#128465;');
		dip.setAttribute('confirm', 'Delete folder?');
		dip.dataset.rel = node.rel;
		dip.dataset.type = 'folder';
		dip.className = 'fm-tree-dip';

		nodeEl.appendChild(toggle);
		nodeEl.appendChild(icon);
		nodeEl.appendChild(label);
		nodeEl.appendChild(dip);

		// Children container
		const children = document.createElement('div');
		children.className = 'fm-tree-children';
		if (node.children.length) {
			children.style.display = 'none';
			renderTreeNodes(node.children, children, shell);
		}

		// Toggle expand
		toggle.addEventListener('click', e => {
			e.stopPropagation();
			const open = children.style.display !== 'none';
			children.style.display = open ? 'none' : '';
			toggle.textContent = open ? '▶' : '▼';
			nodeEl.setAttribute('aria-expanded', String(!open));
		});

		nodeEl.addEventListener('click', e => {
			if (e.target.closest('delete-in-place')) return;
			selectTreeNode(nodeEl, shell);
		});
		nodeEl.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				selectTreeNode(nodeEl, shell);
			}
		});

		// Folder draggable as source
		nodeEl.setAttribute('draggable', 'true');
		nodeEl.addEventListener('dragstart', e => {
			e.stopPropagation();
			e.dataTransfer.setData('text/fm-folder', node.rel);
			nodeEl.classList.add('fm-drag-source');
		});
		nodeEl.addEventListener('dragend', () => nodeEl.classList.remove('fm-drag-source'));

		// Tree node as drop target (files and folders)
		nodeEl.addEventListener('dragover', e => {
			e.preventDefault();
			nodeEl.classList.add('fm-tree-drop-over');
		});
		nodeEl.addEventListener('dragleave', e => {
			if (!nodeEl.contains(e.relatedTarget)) nodeEl.classList.remove('fm-tree-drop-over');
		});
		nodeEl.addEventListener('drop', e => {
			e.preventDefault();
			e.stopPropagation();
			nodeEl.classList.remove('fm-tree-drop-over');
			const fileRel   = e.dataTransfer.getData('text/fm-rel');
			const folderRel = e.dataTransfer.getData('text/fm-folder');
			if (folderRel && folderRel !== node.rel) {
				doMoveFolder(folderRel, node.rel, shell);
			} else if (fileRel) {
				dropToFolder(fileRel, node.rel, shell);
			}
		});

		wrap.appendChild(nodeEl);
		wrap.appendChild(children);
		container.appendChild(wrap);
	}
}

function selectTreeNode(nodeEl, shell) {
	shell.querySelectorAll('.fm-tree-node').forEach(n => n.classList.remove('fm-tree-selected'));
	nodeEl.classList.add('fm-tree-selected');
	loadFolder(nodeEl.dataset.rel, shell);
}

// Root node click
function initFileManager() {
	const shell = document.getElementById('fm-shell');
	if (!shell) return;
	const rootNode = shell.querySelector('.fm-tree-root-node');
	if (rootNode) {
		rootNode.addEventListener('click', () => selectTreeNode(rootNode, shell));
		rootNode.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				selectTreeNode(rootNode, shell);
			}
		});
		// Root as drop target (files and folders)
		rootNode.addEventListener('dragover', e => {
			e.preventDefault();
			rootNode.classList.add('fm-tree-drop-over');
		});
		rootNode.addEventListener('dragleave', e => {
			if (!rootNode.contains(e.relatedTarget)) rootNode.classList.remove('fm-tree-drop-over');
		});
		rootNode.addEventListener('drop', e => {
			e.preventDefault();
			rootNode.classList.remove('fm-tree-drop-over');
			const fileRel   = e.dataTransfer.getData('text/fm-rel');
			const folderRel = e.dataTransfer.getData('text/fm-folder');
			if (folderRel) {
				doMoveFolder(folderRel, '', shell);
			} else if (fileRel) {
				dropToFolder(fileRel, '', shell);
			}
		});
	}
	init(shell);
}

// Initialize on DOMContentLoaded, or immediately if already loaded (e.g., via AJAX)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initFileManager);
} else {
	initFileManager();
}

// ── Load folder ────────────────────────────────────────────────────────────────
function loadFolder(rel, shell) {
	currentFolder = rel;
	selectedRels.clear();
	lastClickedRel = null;
	updateSelectionBar(shell);
	localStorage.setItem('fm_last_folder', rel);

	const bc = shell.querySelector('#fm-breadcrumb');
	if (bc) {
		bc.textContent = rel ? 'Images / ' + rel.replace(/\//g, ' / ') : 'Images';
	}

	post('list', { folder: rel }).then(res => {
		if (!res.ok) { notify(res.message, 'error'); return; }
		currentFiles = res.files || [];
		renderFiles(shell);
	});
}

// ── Render files ──────────────────────────────────────────────────────────────
function renderFiles(shell) {
	const container = shell.querySelector('#fm-list-container');
	if (!container) return;
	container.innerHTML = '';

	// Sort
	const sorted = [...currentFiles].sort((a, b) => {
		let av = a[sortCol], bv = b[sortCol];
		if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
		if (av < bv) return sortDir === 'asc' ? -1 : 1;
		if (av > bv) return sortDir === 'asc' ? 1 : -1;
		return 0;
	});

	if (viewMode === 'icons') {
		renderIconView(sorted, container, shell);
	} else {
		renderListView(sorted, container, shell);
	}
}

function renderIconView(files, container, shell) {
	for (const f of files) {
		const item = document.createElement('div');
		item.className = 'fm-item-icon' + (selectedRels.has(f.rel) ? ' selected' : '');
		item.dataset.rel = f.rel;
		item.setAttribute('role', 'option');
		item.setAttribute('aria-selected', selectedRels.has(f.rel) ? 'true' : 'false');
		item.setAttribute('aria-label', f.name);
		item.setAttribute('draggable', 'true');
		item.tabIndex = 0;
		item.style.width = (thumbSize + 16) + 'px';

		let thumbEl;
		if (f.fm_url) {
			// Show image thumbnail
			thumbEl = document.createElement('img');
			thumbEl.src = f.fm_url;
			thumbEl.alt = f.name;
			thumbEl.width = thumbSize;
			thumbEl.height = thumbSize;
			thumbEl.style.width = thumbSize + 'px';
			thumbEl.style.height = thumbSize + 'px';
		} else {
			// Generic file icon (fallback, shouldn't normally occur — images only)
			thumbEl = document.createElement('div');
			thumbEl.style.cssText = `
				width: ${thumbSize}px;
				height: ${thumbSize}px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: ${Math.max(24, thumbSize * 0.6)}px;
				background: #f5f5f5;
				border: 1px solid #ddd;
				border-radius: 4px;
			`;
			thumbEl.textContent = '📄';
		}
		item.appendChild(thumbEl);

		const name = document.createElement('div');
		name.className = 'fm-item-name';
		name.textContent = f.name;
		name.title = 'Click to rename';
		name.style.cursor = 'text';
		name.addEventListener('click', function(e) {
			e.stopPropagation();
			makeNameEditable(name, f, shell);
		});

		const dip = document.createElement('delete-in-place');
		dip.setAttribute('caption', '&#128465;');
		dip.setAttribute('confirm', 'Delete?');
		dip.dataset.rel = f.rel;
		dip.className = 'fm-item-dip';

		item.appendChild(name);
		item.appendChild(dip);

		// In dialog mode: green "add to content" button bottom-left of thumbnail (opposite from delete)
		if (dialogMode) {
			const addBtn = document.createElement('button');
			addBtn.className = 'fm-item-add-btn';
			addBtn.title = 'Add to content';
			addBtn.setAttribute('aria-label', 'Add ' + f.name + ' to content');
			addBtn.innerHTML = '&#10003;';
			addBtn.addEventListener('click', function(e) {
				e.stopPropagation();
				e.preventDefault();
				confirmSelection([f]);
			});
			item.appendChild(addBtn);
		}

		// Image/thumbnail click = preview (page mode); in dialog mode let it bubble for selection
		thumbEl.addEventListener('click', e => {
			if (dialogMode) return;
			e.stopPropagation();
			if (f.url) openPreview(f.url, f.name);
		});
		item.addEventListener('click', e => {
			if (!dialogMode && e.target === thumbEl) return;
			if (e.target.closest('delete-in-place')) return;
			if (e.target.closest('.fm-item-name') || e.target.closest('.fm-rename-input')) return;
			if (e.shiftKey && lastClickedRel) { selectRange(lastClickedRel, f.rel, shell); }
			else if (e.ctrlKey || e.metaKey)  { toggleOne(f.rel, shell); }
			else                               { selectOnly(f.rel, shell); }
		});
		// Double-click = confirm in dialog mode
		item.addEventListener('dblclick', e => {
			if (e.target.closest('delete-in-place')) return;
			if (dialogMode) confirmSelection([f]);
		});
		item.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				if (dialogMode) confirmSelection([f]);
				else selectOnly(f.rel, shell);
			}
		});

		// Drag
		item.addEventListener('dragstart', e => {
			e.dataTransfer.setData('text/fm-rel', f.rel);
			item.classList.add('fm-drag-source');
		});
		item.addEventListener('dragend', () => item.classList.remove('fm-drag-source'));

		container.appendChild(item);
	}
}

function renderListView(files, container, shell) {
	const tbl = document.createElement('table');
	tbl.className = 'fm-list-table';
	tbl.setAttribute('role', 'table');
	tbl.setAttribute('aria-label', 'Image files');

	const thead = document.createElement('thead');
	thead.innerHTML = `<tr>
		<th class="col-thumb" aria-hidden="true"></th>
		<th class="col-name"  data-col="name"     tabindex="0" role="columnheader" aria-sort="none">Name</th>
		<th class="col-date"  data-col="modified"  tabindex="0" role="columnheader" aria-sort="none">Modified</th>
		<th class="col-size"  data-col="size"      tabindex="0" role="columnheader" aria-sort="none">Size</th>
	</tr>`;

	// Column sort
	thead.querySelectorAll('th[data-col]').forEach(th => {
		if (th.dataset.col === sortCol) {
			th.classList.add('sort-' + sortDir);
			th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
		}
		th.addEventListener('click', () => {
			if (sortCol === th.dataset.col) {
				sortDir = sortDir === 'asc' ? 'desc' : 'asc';
			} else {
				sortCol = th.dataset.col;
				sortDir = 'asc';
			}
			localStorage.setItem('nc_fm_sort_col', sortCol);
			localStorage.setItem('nc_fm_sort_dir', sortDir);
			renderFiles(shell);
		});
	});

	const tbody = document.createElement('tbody');
	for (const f of files) {
		const tr = document.createElement('tr');
		tr.className = 'fm-list-row' + (selectedRels.has(f.rel) ? ' selected' : '');
		tr.dataset.rel = f.rel;
		tr.setAttribute('role', 'row');
		tr.setAttribute('aria-selected', selectedRels.has(f.rel) ? 'true' : 'false');
		tr.setAttribute('draggable', 'true');
		tr.tabIndex = 0;

		const tdThumb = document.createElement('td');
		tdThumb.className = 'col-thumb';

		let thumbEl;
		if (f.fm_url) {
			// Show image thumbnail
			thumbEl = document.createElement('img');
			thumbEl.src = f.fm_url;
			thumbEl.alt = f.name;
			thumbEl.width = 36; thumbEl.height = 36;
		} else {
			// Generic file icon (fallback, shouldn't normally occur — images only)
			thumbEl = document.createElement('div');
			thumbEl.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;font-size:20px;background:#f5f5f5;border:1px solid #ddd;border-radius:2px;';
			thumbEl.textContent = '📄';
		}
		tdThumb.appendChild(thumbEl);

		const tdName = document.createElement('td');
		tdName.className = 'col-name';
		tdName.textContent = f.name;
		tdName.title = 'Click to rename';
		tdName.style.cursor = 'text';
		tdName.addEventListener('click', function(e) {
			e.stopPropagation();
			makeNameEditable(tdName, f, shell);
		});

		const tdDate = document.createElement('td');
		tdDate.className = 'col-date';
		tdDate.textContent = fmtDate(f.modified);

		const tdSize = document.createElement('td');
		tdSize.className = 'col-size';
		tdSize.textContent = fmtSize(f.size);

		tr.appendChild(tdThumb);
		tr.appendChild(tdName);
		tr.appendChild(tdDate);
		tr.appendChild(tdSize);

		// Thumbnail click = preview (page mode); in dialog mode let it bubble for selection
		thumbEl.addEventListener('click', e => {
			if (dialogMode) return;
			e.stopPropagation();
			if (f.url) openPreview(f.url, f.name);
		});
		tr.addEventListener('click', e => {
			if (!dialogMode && e.target === thumbEl) return;
			if (e.target.closest('.col-name') || e.target.closest('.fm-rename-input')) return;
			if (e.shiftKey && lastClickedRel) { selectRange(lastClickedRel, f.rel, shell); }
			else if (e.ctrlKey || e.metaKey)  { toggleOne(f.rel, shell); }
			else                               { selectOnly(f.rel, shell); }
		});
		tr.addEventListener('dblclick', e => {
			if (e.target === thumbEl) return;
			if (dialogMode) confirmSelection([f]);
		});
		tr.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				if (dialogMode) confirmSelection([f]);
				else selectOnly(f.rel, shell);
			}
		});

		tr.addEventListener('dragstart', e => {
			e.dataTransfer.setData('text/fm-rel', f.rel);
			tr.classList.add('fm-drag-source');
		});
		tr.addEventListener('dragend', () => tr.classList.remove('fm-drag-source'));

		tbody.appendChild(tr);
	}

	tbl.appendChild(thead);
	tbl.appendChild(tbody);
	container.appendChild(tbl);
}

// ── Selection ──────────────────────────────────────────────────────────────────
function updateItemsDOM(shell) {
	shell.querySelectorAll('.fm-item-icon, .fm-list-row').forEach(el => {
		const sel = selectedRels.has(el.dataset.rel);
		el.classList.toggle('selected', sel);
		el.setAttribute('aria-selected', String(sel));
	});
}

function selectOnly(rel, shell) {
	selectedRels.clear();
	selectedRels.add(rel);
	lastClickedRel = rel;
	updateItemsDOM(shell);
	updateSelectionBar(shell);
	shell.dispatchEvent(new CustomEvent('fm-selection-changed'));
}

function toggleOne(rel, shell) {
	if (selectedRels.has(rel)) { selectedRels.delete(rel); } else { selectedRels.add(rel); }
	lastClickedRel = rel;
	updateItemsDOM(shell);
	updateSelectionBar(shell);
	shell.dispatchEvent(new CustomEvent('fm-selection-changed'));
}

function selectRange(fromRel, toRel, shell) {
	const sorted = [...currentFiles].sort((a, b) => {
		let av = a[sortCol], bv = b[sortCol];
		if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
		if (av < bv) return sortDir === 'asc' ? -1 : 1;
		if (av > bv) return sortDir === 'asc' ? 1 : -1;
		return 0;
	});
	const fromIdx = sorted.findIndex(f => f.rel === fromRel);
	const toIdx   = sorted.findIndex(f => f.rel === toRel);
	if (fromIdx === -1 || toIdx === -1) { selectOnly(toRel, shell); return; }
	const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
	selectedRels.clear();
	for (let i = lo; i <= hi; i++) selectedRels.add(sorted[i].rel);
	updateItemsDOM(shell);
	updateSelectionBar(shell);
	shell.dispatchEvent(new CustomEvent('fm-selection-changed'));
}

function updateSelectionBar(shell) {
	const bar = shell.querySelector('.fm-selection-bar');
	if (!bar) return;
	const n = selectedRels.size;
	bar.classList.toggle('visible', n > 0);
	const count = bar.querySelector('.fm-selection-count');
	if (count) count.textContent = n + ' selected';
}

// ── Drop to folder (move) ──────────────────────────────────────────────────────
function dropToFolder(rel, targetDir, shell) {
	if (dirname(rel) === targetDir) return; // same folder
	post('move', { rel, target_dir: targetDir }).then(res => {
		if (!res.ok) { handleError(res, null); return; }
		loadFolder(currentFolder, shell);
	});
}

function dirname(rel) {
	const parts = rel.split('/');
	parts.pop();
	return parts.join('/');
}

// ── Drag-drop upload to list pane ─────────────────────────────────────────────
function bindDropZone(shell) {
	const pane = shell.querySelector('#fm-list-pane');
	if (!pane) return;

	pane.addEventListener('dragover', e => {
		// Only show drop hint for file drags, not item drags
		if (e.dataTransfer.types.includes('Files')) {
			e.preventDefault();
			// preventDefault() alone permits the drop, but some browsers still
			// show a "denied" cursor unless dropEffect is also set explicitly.
			e.dataTransfer.dropEffect = 'copy';
			pane.classList.add('fm-dragging-over');
		}
	});
	pane.addEventListener('dragleave', e => {
		if (!pane.contains(e.relatedTarget)) pane.classList.remove('fm-dragging-over');
	});
	pane.addEventListener('drop', e => {
		e.preventDefault();
		pane.classList.remove('fm-dragging-over');
		// Only upload if it's an external file drag (not an internal FM item drag)
		if (e.dataTransfer.files.length && !e.dataTransfer.getData('text/fm-rel')) {
			uploadFiles(Array.from(e.dataTransfer.files), shell);
		}
	});
}

// ── Upload ────────────────────────────────────────────────────────────────────
function bindUpload(shell) {
	const input = shell.querySelector('input[type=file][id^=fm-upload-input]');
	if (!input) return;
	input.addEventListener('change', () => {
		if (input.files.length) uploadFiles(Array.from(input.files), shell);
		input.value = '';
	});
}

async function uploadFiles(files, shell) {
	const prog = shell.querySelector('.fm-upload-progress');
	let uploaded = 0;

	for (const file of files) {
		if (prog) { prog.textContent = 'Uploading ' + (uploaded + 1) + ' of ' + files.length + '…'; prog.classList.add('visible'); }

		const fd = new FormData();
		fd.append('csrf_token', getCsrfToken());
		fd.append('action', 'upload');
		fd.append('folder', currentFolder);
		fd.append('file',   file);

		try {
			const res = await fetch(AJAX, { method: 'POST', body: fd }).then(r => r.json());
			if (!res.ok) {
				const isPerm = /writable|permission/i.test(res.message || '');
				if (isPerm) {
					notifyPerm("Couldn't upload the image. Make sure the img folder and every folder in it is writeable.");
				} else {
					notify(res.message || 'Upload failed.', 'error');
				}
			} else {
				uploaded++;
			}
		} catch (err) {
			notify('Upload failed: ' + err.message, 'error');
		}
	}

	if (prog) prog.classList.remove('visible');
	loadFolder(currentFolder, shell);
	if (uploaded > 0) notify(uploaded + ' image' + (uploaded > 1 ? 's' : '') + ' uploaded.', 'success');
}

// ── Delete ────────────────────────────────────────────────────────────────────
function deleteSelected(shell) {
	if (!selectedRels.size) return;
	const n = selectedRels.size;
	const label = n === 1 ? '1 image' : n + ' images';

	if (window.confirm('Delete ' + label + '? This will permanently remove the image file(s), all size variants, and unlink from any products. This cannot be undone.')) {
		doDelete([...selectedRels], shell);
	}
}

async function doDelete(rels, shell) {
	for (const rel of rels) {
		const item = shell.querySelector('[data-rel="' + CSS.escape(rel) + '"]');
		const res = await post('delete', { rel });
		if (!res.ok) {
			notify(res.message, 'error');
		} else {
			currentFiles = currentFiles.filter(f => f.rel !== rel);
			if (item) await new Promise(function (resolve) { animateDelete(item, function () { item.remove(); resolve(); }); });
		}
	}
	selectedRels.clear();
	updateSelectionBar(shell);
}

// ── Create folder ──────────────────────────────────────────────────────────────
function bindMkdir(shell) {
	const btn     = shell.querySelector('#btn-fm-mkdir');
	const overlay = shell.querySelector('#fm-modal-overlay') || document.getElementById('fm-modal-overlay');
	const input   = document.getElementById('fm-folder-name');
	const confirmBtn = document.getElementById('btn-fm-mkdir-confirm');
	const cancelBtn  = document.getElementById('btn-fm-mkdir-cancel');

	if (!btn || !overlay) return;

	btn.addEventListener('click', () => {
		if (input) input.value = '';
		overlay.style.display = 'flex';
		if (input) input.focus();
	});

	cancelBtn?.addEventListener('click', () => { overlay.style.display = 'none'; });

	if (confirmBtn) debounceBtn(confirmBtn, () => {
		const name = (input?.value || '').trim();
		if (!name) return;
		// Parent = selected tree node rel (subfolder), or '' (root) if root/nothing selected
		const selectedNode = shell.querySelector('.fm-tree-node.fm-tree-selected:not(.fm-tree-root-node)');
		const parent = selectedNode ? (selectedNode.dataset.rel || '') : '';
		post('mkdir', { parent: parent || '', name }).then(res => {
			overlay.style.display = 'none';
			if (!res.ok) { notify(res.message, 'error'); return; }
			loadTree(shell);
		});
	});

	input?.addEventListener('keydown', e => {
		if (e.key === 'Enter') confirmBtn?.click();
		if (e.key === 'Escape') cancelBtn?.click();
	});

	overlay.addEventListener('click', e => {
		if (e.target === overlay) overlay.style.display = 'none';
	});
}

// ── Delete folder ─────────────────────────────────────────────────────────────

function doDeleteFolder(rel, shell) {
	const treeNode = shell.querySelector('.fm-tree-node[data-rel="' + rel + '"]');
	post('rmdir', { rel }).then(res => {
		if (!res.ok) {
			notify(res.message, 'error');
			return;
		}
		if (currentFolder === rel || currentFolder.startsWith(rel + '/')) {
			loadFolder('', shell);
			shell.querySelectorAll('.fm-tree-node').forEach(n => n.classList.remove('fm-tree-selected'));
			shell.querySelector('.fm-tree-root-node')?.classList.add('fm-tree-selected');
		}
		if (treeNode) {
			animateDelete(treeNode, function () { loadTree(shell); });
		} else {
			loadTree(shell);
		}
	});
}

// ── Selection bar (delete button) ──────────────────────────────────────────────
// Injected into shell by initSelectionBar
function initSelectionBar(shell) {
	const bar = document.createElement('div');
	bar.className = 'fm-selection-bar';
	bar.innerHTML = '<span class="fm-selection-count">0 selected</span>' +
		'<button class="btn btn-danger btn-sm" id="btn-fm-delete-sel" aria-label="Delete selected">Delete Selected</button>';
	const listPane = shell.querySelector('#fm-list-pane');
	listPane?.insertBefore(bar, listPane.querySelector('#fm-list-container'));
	const delBtn = bar.querySelector('#btn-fm-delete-sel');
	if (delBtn) debounceBtn(delBtn, () => deleteSelected(shell));
}

// ── Dialog API ────────────────────────────────────────────────────────────────
/**
 * openFilePicker(callback, options)
 * callback: function(selection) where selection = [{name, rel, url, db_path}]
 * options: {dir: 'img/products'} (optional)
 */
window.openFilePicker = function (callback, options) {
	dialogMode     = true;
	dialogCallback = callback;
	selectedRels.clear();
	fmOptions = options || {};

	// Backdrop — clicks close dialog but not the drawer behind it
	const backdrop = document.createElement('div');
	backdrop.className = 'fm-dialog-backdrop';
	backdrop.id = 'fm-dialog-backdrop';
	document.body.appendChild(backdrop);

	// Create wrapper
	const wrap = document.createElement('div');
	wrap.className = 'fm-dialog-wrapper';
	wrap.id = 'fm-dialog';
	wrap.style.cssText = 'width:780px;height:520px;top:80px;left:50%;transform:translateX(-50%)';

	wrap.innerHTML = `
		<div class="fm-dialog-titlebar" id="fm-dialog-bar">
			<span class="fm-dialog-title">&#128247; File Manager</span>
			<button class="fm-dialog-close" id="fm-dialog-close" aria-label="Close file manager">&times;</button>
		</div>
		<div class="fm-dialog-body" id="fm-dialog-body"></div>
		<div class="fm-dialog-foot">
			<img id="fm-dialog-preview" src="" alt="Preview" aria-label="Selected image preview">
			<span class="fm-dialog-selection-label" id="fm-dialog-sel-label">Click an image to select it</span>
			<button class="btn btn-primary" id="btn-fm-select" aria-label="Insert selected images" disabled>Select</button>
			<button class="btn btn-secondary" id="btn-fm-dlg-cancel" aria-label="Cancel">Cancel</button>
		</div>
		<div class="fm-dialog-resize" title="Drag to resize" aria-hidden="true">&#8600;</div>
	`;

	document.body.appendChild(wrap);

	// Inject shell HTML into dialog body
	const body = wrap.querySelector('#fm-dialog-body');
	body.innerHTML = buildShellHTML();
	const shell = body.querySelector('.fm-shell');
	shell.id = 'fm-shell-dialog';
	shell.classList.add('fm-dialog-mode'); // enables CSS click-to-select styling
	initSelectionBar(shell);
	applyView(shell);

	// Wire root node click in dialog (page mode does this in initFileManager)
	const dlgRootNode = shell.querySelector('.fm-tree-root-node');
	if (dlgRootNode) {
		dlgRootNode.addEventListener('click', () => selectTreeNode(dlgRootNode, shell));
		dlgRootNode.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTreeNode(dlgRootNode, shell); }
		});
	}

	loadTree(shell);

	const initialFolder = (options && options.dir) ? '' : (localStorage.getItem('fm_last_folder') ?? 'products');
	loadFolder(initialFolder, shell);
	bindViewToggle(shell);
	bindUpload(shell);
	bindDropZone(shell);
	bindMkdir(shell);
	bindSizeButtons(shell);
	bindDipDelete(shell);

	const selLabel  = wrap.querySelector('#fm-dialog-sel-label');
	const selBtn    = wrap.querySelector('#btn-fm-select');
	const previewEl = wrap.querySelector('#fm-dialog-preview');

	function updateDialogSel() {
		const n = selectedRels.size;
		if (n > 0) {
			selLabel.textContent = n + ' image' + (n > 1 ? 's' : '') + ' selected';
			selBtn.disabled = false;
			// Show preview of last selected
			const last = currentFiles.find(f => selectedRels.has(f.rel));
			if (last && previewEl) {
				previewEl.src = last.url;
				previewEl.style.display = 'block';
			}
		} else {
			selLabel.textContent = 'Click an image to select it';
			selBtn.disabled = true;
			if (previewEl) previewEl.style.display = 'none';
		}
	}

	shell.addEventListener('fm-selection-changed', updateDialogSel);

	selBtn.addEventListener('click', () => {
		const selected = currentFiles.filter(f => selectedRels.has(f.rel));
		confirmSelection(selected);
	});

	function doClose() {
		backdrop.remove();
		closeDialog();
	}

	wrap.querySelector('#btn-fm-dlg-cancel')?.addEventListener('click', doClose);
	wrap.querySelector('#fm-dialog-close')?.addEventListener('click', doClose);

	// Backdrop click closes dialog only — stopPropagation prevents drawer close
	backdrop.addEventListener('click', function(e) {
		e.stopPropagation();
		doClose();
	});

	// Prevent clicks inside dialog from bubbling to backdrop/drawer
	wrap.addEventListener('click', function(e) {
		e.stopPropagation();
	});

	// Draggable
	makeDraggable(wrap, wrap.querySelector('#fm-dialog-bar'));
	// Resizable
	makeResizable(wrap, wrap.querySelector('.fm-dialog-resize'));
};

function buildShellHTML() {
	return `
	<div class="fm-shell">
		<div class="fm-tree-pane">
			<div class="fm-pane-header">
				<button class="btn btn-fm-header" id="btn-fm-mkdir" aria-label="New folder">+ Folder</button>
			</div>
			<div class="fm-tree-root" id="fm-tree" role="tree" aria-label="Image folders">
				<div class="fm-tree-node fm-tree-root-node fm-tree-selected"
				     data-rel="" role="treeitem" aria-expanded="true" aria-selected="true" tabindex="0">
					<span class="fm-tree-icon">&#128193;</span>
					<span class="fm-tree-label">img</span>
				</div>
				<div class="fm-tree-children" id="fm-tree-children-root"></div>
			</div>
		</div>
		<div class="fm-list-pane" id="fm-list-pane">
			<div class="fm-pane-header">
				<span class="fm-breadcrumb" id="fm-breadcrumb">img</span>
				<div class="fm-view-toggles">
					<button class="fm-view-btn" id="btn-fm-size-dec" aria-label="Decrease thumbnail size" title="Smaller">&#8722;</button>
					<button class="fm-view-btn" id="btn-fm-size-inc" aria-label="Increase thumbnail size" title="Larger">&#43;</button>
					<span class="fm-view-sep"></span>
					<button class="fm-view-btn active" id="btn-fm-view-icons" aria-label="Thumbnail view" aria-pressed="true" title="Thumbnail view">&#9638;</button>
					<button class="fm-view-btn" id="btn-fm-view-list" aria-label="List view" aria-pressed="false" title="List view">&#8801;</button>
				</div>
			</div>
			<input type="file" id="fm-upload-input-dlg" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none" aria-label="Upload image files">
			<div class="fm-list-container view-${viewMode}" id="fm-list-container"
			     role="listbox" aria-label="Images" aria-multiselectable="true"></div>
			<div class="fm-drop-hint" id="fm-drop-hint" aria-hidden="true">Drop images here to upload</div>
			<div class="fm-upload-progress"></div>
		</div>
		<div class="fm-modal-overlay" id="fm-modal-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="fm-modal-title">
			<div class="fm-modal">
				<h2 class="fm-modal-title" id="fm-modal-title">New Folder</h2>
				<p class="fm-modal-desc">Folder name (letters, numbers, hyphens, underscores)</p>
				<input type="text" id="fm-folder-name" class="fm-modal-input" maxlength="64" aria-label="Folder name" placeholder="e.g. seasonal">
				<div class="fm-modal-actions">
					<button class="btn btn-primary" id="btn-fm-mkdir-confirm" aria-label="Create folder">Create</button>
					<button class="btn btn-secondary" id="btn-fm-mkdir-cancel" aria-label="Cancel">Cancel</button>
				</div>
			</div>
		</div>
	</div>`;
}


function confirmSelection(items) {
	if (!items.length) return;
	const result = items.map(f => ({
		name:    f.name,
		rel:     f.rel,
		url:     f.url,
		db_path: '/img/' + f.rel,
	}));
	const cb = dialogCallback; // capture before closeDialog nulls it
	closeDialog();
	if (typeof cb === 'function') cb(result);
}

function closeDialog() {
	dialogMode = false;
	dialogCallback = null;
	selectedRels.clear();
	document.getElementById('fm-dialog-backdrop')?.remove();
	const dlg = document.getElementById('fm-dialog');
	if (dlg) dlg.remove();
}

// ── Drag to move dialog ────────────────────────────────────────────────────────
function makeDraggable(el, handle) {
	let ox = 0, oy = 0, mx = 0, my = 0;
	handle.addEventListener('mousedown', e => {
		e.preventDefault();
		el.style.transform = 'none';
		mx = e.clientX; my = e.clientY;
		const rect = el.getBoundingClientRect();
		el.style.left = rect.left + 'px';
		el.style.top  = rect.top  + 'px';
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
	function onMove(e) {
		ox = mx - e.clientX; oy = my - e.clientY;
		mx = e.clientX; my = e.clientY;
		el.style.top  = (el.offsetTop  - oy) + 'px';
		el.style.left = (el.offsetLeft - ox) + 'px';
	}
	function onUp() {
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('mouseup', onUp);
	}
}

function makeResizable(el, handle) {
	handle.addEventListener('mousedown', e => {
		e.preventDefault();
		const startW = el.offsetWidth, startH = el.offsetHeight;
		const startX = e.clientX, startY = e.clientY;
		function onMove(e) {
			el.style.width  = Math.max(400, startW + e.clientX - startX) + 'px';
			el.style.height = Math.max(300, startH + e.clientY - startY) + 'px';
		}
		function onUp() {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		}
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}

// Re-init page mode shell selection bar on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
	const shell = document.getElementById('fm-shell');
	if (shell) initSelectionBar(shell);
});

// ── Move folder ────────────────────────────────────────────────────────────────
function doMoveFolder(rel, targetDir, shell) {
	// Prevent no-op (already at root or same parent)
	const currentParent = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
	if (currentParent === targetDir) return;

	const nodeEl = shell.querySelector('.fm-tree-node[data-rel="' + CSS.escape(rel) + '"]');
	if (nodeEl) { nodeEl.style.transition = 'opacity .25s'; nodeEl.style.opacity = '0'; }

	post('movefolder', { rel, target_dir: targetDir }).then(res => {
		if (!res.ok) {
			if (nodeEl) nodeEl.style.opacity = '1';
			notify(res.message, 'error');
			return;
		}
		// If we were viewing inside the moved folder, navigate to new location
		if (currentFolder === rel || currentFolder.startsWith(rel + '/')) {
			const newFolder = res.new_rel + currentFolder.slice(rel.length);
			setTimeout(() => { loadTree(shell); loadFolder(newFolder, shell); }, 280);
		} else {
			setTimeout(() => { loadTree(shell); loadFolder(currentFolder, shell); }, 280);
		}
	});
}

// ── Delete-in-place handler ───────────────────────────────────────────────────
function bindDipDelete(shell) {
	shell.addEventListener('dip-confirm', async function (e) {
		const el  = e.target;
		const rel = el.dataset.rel;
		if (!rel && rel !== '') return;

		if (el.dataset.type === 'folder') {
			doDeleteFolder(rel, shell);
		} else {
			const item = el.closest('.fm-item-icon');
			const res = await post('delete', { rel });
			if (!res.ok) {
				notify(res.message, 'error');
			} else {
				selectedRels.delete(rel);
				currentFiles = currentFiles.filter(f => f.rel !== rel);
				if (item) {
					animateDelete(item, function () { item.remove(); updateSelectionBar(shell); });
				} else {
					updateSelectionBar(shell);
				}
			}
		}
	});
}

// ── Thumbnail size controls ───────────────────────────────────────────────────
function bindSizeButtons(shell) {
	const dec = shell.querySelector('#btn-fm-size-dec');
	const inc = shell.querySelector('#btn-fm-size-inc');
	if (!dec || !inc) return;

	function updateSizeBtns() {
		dec.disabled = thumbSize <= THUMB_MIN;
		inc.disabled = thumbSize >= THUMB_MAX;
	}

	dec.addEventListener('click', () => {
		if (thumbSize <= THUMB_MIN) return;
		thumbSize = Math.max(THUMB_MIN, thumbSize - 10);
		localStorage.setItem('fm_thumb_size', thumbSize);
		updateSizeBtns();
		renderFiles(shell);
	});

	inc.addEventListener('click', () => {
		if (thumbSize >= THUMB_MAX) return;
		thumbSize = Math.min(THUMB_MAX, thumbSize + 10);
		localStorage.setItem('fm_thumb_size', thumbSize);
		updateSizeBtns();
		renderFiles(shell);
	});

	updateSizeBtns();
}

// ── Image preview lightbox ────────────────────────────────────────────────────
// ── Rename file ───────────────────────────────────────────────────────────────
function makeNameEditable(nameEl, f, shell) {
	if (nameEl.querySelector('input')) return; // already editing
	const orig = f.name;
	const inp = document.createElement('input');
	inp.type = 'text';
	inp.value = orig;
	inp.className = 'fm-rename-input';
	inp.setAttribute('aria-label', 'Rename file');
	inp.addEventListener('click', e => e.stopPropagation());
	inp.addEventListener('keydown', async function(e) {
		if (e.key === 'Enter')  { e.preventDefault(); await commitRename(inp, nameEl, f, shell); }
		if (e.key === 'Escape') { nameEl.textContent = orig; }
	});
	inp.addEventListener('blur', async function() {
		await commitRename(inp, nameEl, f, shell);
	});
	nameEl.textContent = '';
	nameEl.appendChild(inp);
	inp.select();
}

async function commitRename(inp, nameEl, f, shell) {
	const newName = inp.value.trim();
	if (!newName || newName === f.name) { nameEl.textContent = f.name; return; }
	const fd = new FormData();
	fd.append('csrf_token', getCsrfToken());
	fd.append('action', 'rename');
	fd.append('rel', f.rel);
	fd.append('new_name', newName);
	let res;
	try { res = await fetch(AJAX, { method: 'POST', body: fd }).then(r => r.json()); }
	catch(e) { nameEl.textContent = f.name; handleError({ message: 'Network error.' }, null); return; }
	if (!res.ok) {
		nameEl.textContent = f.name;
		handleError(res, null); // uses handleError which checks for SimpleNotification safely
		return;
	}
	// Update local state and display — no notification (change is visible)
	// Reload folder so thumbnail src and all refs update cleanly
	loadFolder(currentFolder, shell);
}

function openPreview(url, name) {
	let overlay = document.getElementById('fm-preview-overlay');
	if (!overlay) {
		overlay = document.createElement('div');
		overlay.id = 'fm-preview-overlay';
		overlay.className = 'fm-preview-overlay';
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-label', 'Image preview');
		document.body.appendChild(overlay);
		overlay.addEventListener('click', closePreview);
		document.addEventListener('keydown', function onKey(e) {
			if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', onKey); }
		});
	}
	overlay.innerHTML = '';
	const img = document.createElement('img');
	img.src = url;
	img.alt = name;
	img.addEventListener('click', function(e) { e.stopPropagation(); }); // don't close on image click
	overlay.appendChild(img);
	// Force reflow before adding visible class for transition
	overlay.style.display = 'flex';
	requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
}

function closePreview() {
	const overlay = document.getElementById('fm-preview-overlay');
	if (!overlay) return;
	overlay.classList.remove('visible');
	setTimeout(() => { overlay.style.display = 'none'; overlay.innerHTML = ''; }, 230);
}

})();
