/**
 * debounceBtn — attaches a debounced click handler to a button.
 */
function debounceBtn(btn, handler, ms) {
	ms = ms || 1000;
	var last = 0;
	if (!btn) return;
	btn.addEventListener('click', function (e) {
		var now = Date.now();
		if (now - last < ms) return;
		last = now;
		handler.call(this, e);
	});
}

function animateDelete(el, cb) {
	el.style.outline = '2px solid #ef4444';
	setTimeout(function () {
		el.style.transition = 'opacity .22s';
		el.style.opacity = '0';
		setTimeout(cb, 220);
	}, 100);
}

/**
 * Get CSRF token from meta tag
 */
function getCsrfToken() {
	return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

/**
 * Add CSRF token to FormData before sending
 */
function addCsrfToFormData(fd) {
	fd.append('csrf_token', getCsrfToken());
	return fd;
}

/* ── Admin Layout — Sidebar, Navigation, and Keyboard Shortcuts ── */
(function () {
	'use strict';

	const sidebar = document.getElementById('sidebar');
	const main    = document.getElementById('main');
	const toggle  = document.getElementById('sidebar-toggle');

	const COLLAPSED_KEY = 'nc_sidebar_collapsed';

	function setCollapsed(on) {
		if (sidebar) sidebar.classList.toggle('collapsed', on);
		if (main)    main.classList.toggle('sidebar-collapsed', on);
		localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0');
	}

	// Restore state
	if (sidebar && localStorage.getItem(COLLAPSED_KEY) === '1') {
		setCollapsed(true);
	}

	if (toggle) {
		toggle.addEventListener('click', function () {
			setCollapsed(!sidebar.classList.contains('collapsed'));
		});
	}

	// ── Accordion — persist open group to localStorage ──────────────────────
	const ACCORDION_KEY = 'nc_nav_group';

	function openGroup(group, save) {
		document.querySelectorAll('.nav-group').forEach(function(g) {
			g.classList.remove('open');
			g.querySelector('.nav-group-head')?.setAttribute('aria-expanded', 'false');
		});
		if (group) {
			group.classList.add('open');
			group.querySelector('.nav-group-head')?.setAttribute('aria-expanded', 'true');
			if (save) localStorage.setItem(ACCORDION_KEY, group.dataset.group || '');
		}
	}

	// Assign data-group to each group for identification
	document.querySelectorAll('.nav-group').forEach(function(g, i) {
		g.dataset.group = i;
	});

	// Restore MRU group — but only if no group is already open (from server-side class)
	const alreadyOpen = document.querySelector('.nav-group.open');
	if (!alreadyOpen) {
		const saved = localStorage.getItem(ACCORDION_KEY);
		if (saved !== null) {
			const target = document.querySelector('.nav-group[data-group="' + saved + '"]');
			if (target) openGroup(target, false);
		}
	}

	document.querySelectorAll('.nav-group-head:not([notrigger])').forEach(function(btn) {
		btn.addEventListener('click', function() {
			const group = btn.closest('.nav-group');
			const isOpen = group.classList.contains('open');

			// If opening (not already open), navigate to first menu item
			if (!isOpen) {
				const firstLink = group.querySelector('.nav-group-items .nav-child');
				if (firstLink && firstLink.href) {
					navigateTo(firstLink.href, true);
					return;
				}
			}

			openGroup(isOpen ? null : group, true);
		});
	});

	// ── Fetch-based routing ───────────────────────────────────────────────────
	const mainEl    = document.getElementById('main');
	const contentEl = document.getElementById('content');

	function isAdminNav(a) {
		if (!a || a.target === '_blank') return false;
		const href = a.getAttribute('href') || '';
		if (!href || href.startsWith('#') || href.startsWith('http')) return false;
		// Don't intercept: logout, login, page-edit (full-page), ajax routes
		if (href.includes('route=logout') || href.includes('route=login')) return false;
		if (href.includes('/ajax')) return false;
		// If currently on page-edit, all nav must be full navigations (page-edit has non-standard DOM)
		if (document.getElementById('pe-canvas')) return false;
		// Only intercept links with a route= param (admin nav)
		return href.includes('route=');
	}

	function setLoading(on) {
		mainEl.classList.toggle('nc-loading', on);
	}

	async function navigateTo(url, push) {
		setLoading(true);
		try {
			const res = await fetch(url, {
				headers: { 'X-NC-Partial': '1' },
				credentials: 'same-origin',
			});
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const html = await res.text();
			// Parse and extract #content-header + #content
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');
			const newHeader  = doc.getElementById('content-header');
			const newContent = doc.getElementById('content');
			const newMain    = doc.getElementById('main');
			if (newContent) {
				// Update main class (page-X)
				if (newMain) mainEl.className = newMain.className;
				// Replace content-header
				const existingHeader = document.getElementById('content-header');
				if (existingHeader && newHeader) existingHeader.replaceWith(newHeader);
				// Replace content
				document.getElementById('content')?.replaceWith(newContent);
				// Inject any CSS links from partial head block that aren't already loaded
				const loadedHrefs = new Set(
					Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(l => l.href)
				);
				doc.querySelectorAll('link[rel=stylesheet]').forEach(function(l) {
					const abs = new URL(l.href, location.origin).href;
					if (!loadedHrefs.has(abs)) {
						const nl = document.createElement('link');
						nl.rel = 'stylesheet'; nl.href = l.href;
						document.head.appendChild(nl);
					}
				});
				// Swap inline page styles
				document.querySelectorAll('style[data-page-style]').forEach(s => s.remove());
				doc.querySelectorAll('head style').forEach(function(s) {
					const ns = document.createElement('style');
					ns.textContent = s.textContent;
					ns.dataset.pageStyle = '1';
					document.head.appendChild(ns);
				});
				// Re-run page scripts from #page-scripts-wrap (skip already-loaded vendor scripts)
				const loadedSrcs = new Set(
					Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
				);
				const scriptsWrap = doc.getElementById('page-scripts-wrap');
				// Remove old page-scripts-wrap from DOM
				document.getElementById('page-scripts-wrap')?.remove();
				if (scriptsWrap) {
					// Snapshot and strip the original (inert, parser-created) <script> tags before
					// inserting the wrapper — left in place, they'd sit in the DOM alongside the
					// freshly-created clones below (the only ones that actually execute), silently
					// doubling every script[src] lookup — including navigateTo's own loadedSrcs dedup.
					const originalScripts = Array.from(scriptsWrap.querySelectorAll('script'));
					originalScripts.forEach(s => s.remove());
					document.body.appendChild(scriptsWrap);
					originalScripts.forEach(function (s) {
						// Vendor scripts persist in body and are safe to skip if already
						// loaded — they're page-independent utilities (jQuery, SortableJS,
						// etc.). Page scripts live in scriptsWrap and MUST always re-run:
						// #content was just replaced wholesale above, so whatever DOM
						// elements a page script binds its listeners to (e.g.
						// #img-drop-zone) are brand-new nodes with zero listeners, even
						// when the script's own file — and thus its filemtime-cache-busted
						// URL — hasn't changed since the last visit. Skipping re-execution
						// here left those elements permanently unbound after the first
						// visit to a page within the same SPA session (drag-and-drop drop
						// zones going silently dead being the concrete symptom that
						// surfaced this).
						const isVendor = s.src && new URL(s.src, location.origin).pathname.includes('/vendor/');
						if (isVendor && loadedSrcs.has(new URL(s.src, location.origin).href)) return;
						const ns = document.createElement('script');
						if (s.src) { ns.src = s.src; } else { ns.textContent = s.textContent; }
						(isVendor ? document.body : scriptsWrap).appendChild(ns);
					});
				}
				// Update document title
				const newTitle = doc.querySelector('title');
				if (newTitle) document.title = newTitle.textContent;
				// Update active nav link
				const urlObj = new URL(url, location.origin);
				const newRoute = urlObj.searchParams.get('route') || 'dashboard';
				document.querySelectorAll('#sidebar .nav-link, #sidebar .nav-child').forEach(function(a) {
					const aRoute = new URL(a.href, location.origin).searchParams.get('route') || '';
					a.classList.toggle('active', aRoute === newRoute);
				});
				if (push) history.pushState({ url }, '', url);
				window.dispatchEvent(new CustomEvent('nc:navigate', { detail: { url } }));
				// Open accordion group containing active link
				const activeLink = document.querySelector('#sidebar .active');
				if (activeLink) {
					const group = activeLink.closest('.nav-group');
					if (group) openGroup(group, true);
				}
				window.scrollTo(0, 0);
			} else {
				// Fallback: hard navigate
				location.href = url;
			}
		} catch(err) {
			console.error('Nav error:', err);
			location.href = url;
		} finally {
			setLoading(false);
		}
	}

	// Intercept nav clicks
	document.getElementById('sidebar')?.addEventListener('click', function(e) {
		const a = e.target.closest('a');
		if (!isAdminNav(a)) return;
		e.preventDefault();
		navigatesTo(a.href, true);
	});

	// Topbar links (Visit Store, logout excluded above)
	document.getElementById('topbar')?.addEventListener('click', function(e) {
		const a = e.target.closest('a');
		if (!isAdminNav(a)) return;
		e.preventDefault();
		navigatesTo(a.href, true);
	});

	// Browser back/forward
	window.addEventListener('popstate', function(e) {
		const url = (e.state && e.state.url) || location.href;
		navigatesTo(url, false);
	});

	function navigatesTo(url, push) { navigateTo(url, push); }
	window.adminNav = navigatesTo;

	// ── Ctrl+S / Cmd+S save shortcut ─────────────────────────────────────────
	document.addEventListener('keydown', function(e) {
		if (!(e.key === 's' && (e.ctrlKey || e.metaKey))) return;
		e.preventDefault();

		function isClickable(el) {
			if (!el) return false;
			const inner = el.tagName === 'SAVE-BUTTON' ? el.querySelector('.save-button-inner') : el;
			if (!inner || inner.disabled) return false;
			const r = inner.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		}

		function doClick(el) {
			if (!el) return;
			const inner = el.tagName === 'SAVE-BUTTON' ? el.querySelector('.save-button-inner') : el;
			if (inner) inner.click();
		}

		const openDrawer = document.querySelector('me-drawer.open, edge-drawer.open');

		if (openDrawer) {
			// Prefer "save" over "save and close"
			const saveBtn = ['#btn-drawer-save', '#btn-save-item', '#plugin-drawer-save', '#os-drawer-save']
				.map(function(sel) { return document.querySelector(sel); })
				.find(isClickable);
			if (saveBtn) { doClick(saveBtn); return; }
			const saveClose = document.querySelector('#btn-drawer-save-close');
			if (isClickable(saveClose)) { doClick(saveClose); return; }
		} else {
			const pageSave = ['#pe-save-btn', '#btn-save-all', '#btn-save-menu']
				.map(function(sel) { return document.querySelector(sel); })
				.find(isClickable);
			if (pageSave) { doClick(pageSave); return; }
			// Fallback: first visible btn-primary whose text contains "save"
			const fallback = Array.from(document.querySelectorAll('button.btn-primary'))
				.find(function(btn) { return isClickable(btn) && /save/i.test(btn.textContent); });
			if (fallback) fallback.click();
		}
	});

	// ── Clear Cache button ────────────────────────────────────────────────────
	document.getElementById('btn-clear-cache')?.addEventListener('click', async function () {
		const btn = this;
		const label = btn.querySelector('.nav-label');
		const orig  = label ? label.textContent : '';
		if (label) label.textContent = 'Clearing…';
		btn.disabled = true;
		try {
			const fd = new FormData();
			fd.append('action', 'clear_cache');
			fd.append('csrf_token', getCsrfToken());
			const r    = await fetch(NC.adminUrl + '?route=clear-cache', { method: 'POST', body: fd });
			const data = await r.json();
			if (label) label.textContent = data.ok ? 'Cleared!' : 'Error';
		} catch (e) {
			if (label) label.textContent = 'Error';
		}
		setTimeout(function () {
			if (label) label.textContent = orig;
			btn.disabled = false;
		}, 1800);
	});
})();
