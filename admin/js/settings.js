/* global SimpleNotification */
(function () {
	'use strict';

	const AJAX    = NC.adminUrl + '?route=settings/ajax';
	const FM_AJAX = NC.adminUrl + '?route=filemanager/ajax';

	const ACCESS_LABELS = { '254': 'Admin', '234': 'Super Editor', '10': 'Editor', '0': 'User' };

	// ── Pending files (not yet submitted) ─────────────────────────────────────
	let pendingAvatarFile   = null;
	let pendingAvatarDelete = false;

	// ── Ajax ──────────────────────────────────────────────────────────────────
	async function ajax(data) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		return r.json();
	}

	async function ajaxForm(data, files) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		if (files) Object.entries(files).forEach(([k, v]) => { if (v) fd.append(k, v); });
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(AJAX, { method: 'POST', body: fd });
		return r.json();
	}

	function notifyOk(msg)  { SimpleNotification.success({ text: msg }); }
	function notifyErr(msg) { SimpleNotification.error({ text: msg }); }
	function val(id)  { return (document.getElementById(id)?.value ?? '').trim(); }
	// ios-toggle: label has id, hidden input has _nc_{id}
	function togEl(id) {
		return document.getElementById(id); // finds the label
	}
	function tog(id) {
		// Try hidden input first, fall back to finding ios-toggle by name
		const hidden = document.getElementById('_nc_' + id);
		if (hidden) return parseInt(hidden.value || 0) ? 1 : 0;
		const toggle = document.querySelector('ios-toggle[name="' + id + '"]');
		if (toggle) {
			const cb = toggle.querySelector('input[type=checkbox]');
			return cb && cb.checked ? 1 : 0;
		}
		return 0;
	}
	function setTog(id, v) {
		const label = document.getElementById(id);
		if (!label) return;
		const toggle = label.closest('ios-toggle') || label.parentElement?.closest('ios-toggle');
		if (!toggle) return;
		const cb     = toggle.querySelector('input[type=checkbox]');
		const hidden = toggle.querySelector('input[type=hidden]');
		const on     = !!parseInt(v);
		if (cb)     cb.checked  = on;
		if (hidden) hidden.value = on ? 1 : 0;
	}
	function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
	function getBool(id) {
		const el = document.getElementById(id);
		if (!el) return false;
		if (typeof el.checked === 'boolean') return el.checked;
		return el.getAttribute('checked') !== null;
	}
	function setBool(id, v) {
		const el = document.getElementById(id);
		if (!el) return;
		if (v) { el.setAttribute('checked', ''); el.checked = true; }
		else   { el.removeAttribute('checked'); el.checked = false; }
	}

	// ── Tabs ──────────────────────────────────────────────────────────────────
	const settingsTabs = NcTabs.init(document.querySelector('[data-nc-tabs]'));

	function tabError(tabName, on) {
		if (settingsTabs) settingsTabs.setError('tab-' + tabName, on);
	}

	function clearTabErrors() {
		if (settingsTabs) settingsTabs.clearErrors();
	}

	// ── Options sub-tabs ──────────────────────────────────────────────────────
	document.querySelectorAll('.sub-tab').forEach(function (btn) {
		btn.addEventListener('click', function () {
			const parent = this.closest('.tab-panel');
			parent.querySelectorAll('.sub-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
			parent.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
			this.classList.add('active');
			this.setAttribute('aria-selected', 'true');
			parent.querySelector('#sub-' + this.dataset.sub).classList.add('active');
		});
	});

	// ── Phone masking ─────────────────────────────────────────────────────────
	document.querySelectorAll('[data-mask="phone"]').forEach(function (el) {
		el.addEventListener('input', function () {
			let raw = this.value.replace(/\D/g, '');
			if (!raw) return;
			if (raw[0] !== '1') raw = '1' + raw;
			raw = raw.slice(0, 11);
			let f = '1+';
			if (raw.length > 1) f += raw.slice(1, 4);
			if (raw.length > 4) f += '-' + raw.slice(4, 7);
			if (raw.length > 7) f += '-' + raw.slice(7, 11);
			this.value = f;
		});
	});

	// ── Image preview (logo/favicon) ──────────────────────────────────────────
	function bindImagePreview(btnId, inputId, previewId) {
		const btn     = document.getElementById(btnId);
		const input   = document.getElementById(inputId);
		const preview = document.getElementById(previewId);
		if (!btn || !input) return;
		btn.addEventListener('click', () => input.click());
		input.addEventListener('change', function () {
			const file = this.files[0];
			if (!file || !preview) return;
			preview.src = URL.createObjectURL(file);
			preview.classList.add('show');
		});
	}
	bindImagePreview('btn-upload-logo',    'input-logo',    'preview-logo');

	// ── Avatar: drag/drop + click + hover delete ──────────────────────────────
	const avatarZone    = document.getElementById('avatar-drop-zone');
	const avatarInput   = document.getElementById('input-avatar');
	const avatarPreview = document.getElementById('preview-avatar');
	const avatarPH      = document.getElementById('avatar-placeholder');
	const avatarDel     = document.getElementById('btn-delete-avatar');

	function setAvatarPreview(url) {
		if (url) {
			avatarPreview.src = url;
			avatarPreview.classList.add('show');
			avatarPH.style.display     = 'none';
			avatarDel.classList.add('has-image');
		} else {
			avatarPreview.src = '';
			avatarPreview.classList.remove('show');
			avatarPH.style.display     = '';
			avatarDel.classList.remove('has-image');
		}
	}

	avatarZone.addEventListener('click', function (e) {
		if (e.target === avatarDel || avatarDel.contains(e.target)) return;
		avatarInput.click();
	});

	avatarInput.addEventListener('change', function () {
		const file = this.files[0];
		if (!file) return;
		pendingAvatarFile   = file;
		pendingAvatarDelete = false;
		setAvatarPreview(URL.createObjectURL(file));
	});

	// Drag and drop
	let dragCount = 0;
	avatarZone.addEventListener('dragenter', function (e) {
		e.preventDefault(); dragCount++;
		this.classList.add('drag-over');
	});
	avatarZone.addEventListener('dragleave', function () {
		dragCount--;
		if (dragCount <= 0) { dragCount = 0; this.classList.remove('drag-over'); }
	});
	avatarZone.addEventListener('dragover', e => e.preventDefault());
	avatarZone.addEventListener('drop', function (e) {
		e.preventDefault(); dragCount = 0;
		this.classList.remove('drag-over');
		const file = e.dataTransfer.files[0];
		if (!file) return;
		pendingAvatarFile   = file;
		pendingAvatarDelete = false;
		setAvatarPreview(URL.createObjectURL(file));
	});

	// Hover delete
	avatarDel.addEventListener('click', function (e) {
		e.stopPropagation();
		pendingAvatarFile   = null;
		pendingAvatarDelete = true;
		setAvatarPreview(null);
		avatarInput.value = '';
	});

	// ── Load all settings ─────────────────────────────────────────────────────
	// ── Debounce ──────────────────────────────────────────────────────────────
	function debounce(fn, ms) {
		var t;
		return function () {
			var a = arguments;
			clearTimeout(t);
			t = setTimeout(function () { fn.apply(null, a); }, ms);
		};
	}

	var debouncedSave = debounce(function () {
		var btn = document.getElementById('btn-save-all');
		if (btn) btn.click();
	}, 1000);

	// Auto-save on ios-toggle changes outside the user drawer
	document.addEventListener('ios-toggle', function (e) {
		const src = e.detail.source;
		// Only auto-save settings toggles, not user-drawer or table toggles
		if (src.dataset.action === 'status') return; // user table toggle handled separately
		if (src.closest('#user-drawer'))     return; // user drawer toggle
		debouncedSave();
	});

	async function load() {
		const res = await ajax({ action: 'load' });
		if (!res.ok) { notifyErr(res.message); return; }

		const s = res.settings || {};

		setVal('s_site_name',               s.site_name               || '');
		setVal('s_site_email',              s.site_email              || '');
		setVal('s_store_phone',             s.store_phone             || '');
		setVal('s_store_logo_url',          s.store_logo_url          || '');
		setVal('s_store_logo_link',         s.store_logo_link         || '');
		setTog('s_img_retain_names',        s.img_retain_names        || 0);
		setTog('s_img_resize_on_upload',    s.img_resize_on_upload !== undefined ? s.img_resize_on_upload : 1);
		setVal('s_img_orig_max',            s.img_orig_max            || '600');
		setVal('s_img_admin_size',          s.img_admin_size          || '160');
		setVal('s_img_admin_quality',       s.img_admin_quality       || '75');
		setVal('s_img_fm_size',             s.img_fm_size             || '50');
		setVal('s_img_fm_quality',          s.img_fm_quality          || '60');
		setVal('s_img_product_width',       s.img_product_width       || '600');
		setVal('s_img_product_quality',     s.img_product_quality     || '80');
		setVal('s_img_cart_size',           s.img_cart_size           || '100');
		setVal('s_img_related_size',        s.img_related_size        || '200');
		setVal('s_img_second_level_size',   s.img_second_level_size   || '200');
		setVal('s_img_sidebar_size',        s.img_sidebar_size        || '120');
		setVal('s_related_max_items',       s.related_max_items       || '0');
		// Load robots.txt content separately
		const robotsEl = document.getElementById('s_robots_txt');
		if (robotsEl && res.robots_txt !== undefined) robotsEl.value = res.robots_txt;
		// Load llms.txt content separately
		const llmsEl = document.getElementById('s_llms_txt');
		if (llmsEl && res.llms_txt !== undefined) llmsEl.value = res.llms_txt;
		setVal('s_site_currency',           s.site_currency           || '$');
		setVal('s_seo_title_default',       s.seo_title_default       || '');
		setVal('s_seo_description_default', s.seo_description_default || '');
		setVal('s_seo_keywords_default',    s.seo_keywords_default    || '');

		if (s.site_logo)       { const p = document.getElementById('preview-logo');        if (p) { p.src = s.site_logo;       p.classList.add('show'); } }
		setVal('s_site_favicon', s.site_favicon || '');
		if (s.site_favicon)    { const p = document.getElementById('preview-favicon');     if (p) { p.src = s.site_favicon;    p.classList.add('show'); } }
		setVal('s_favicon_svg_url', s.favicon_svg_url || '');
		if (s.favicon_svg_url) { const p = document.getElementById('preview-favicon-svg'); if (p) { p.src = s.favicon_svg_url; p.classList.add('show'); } }

		setVal('s_address',           s.address           || '');
		setVal('s_phone',             s.phone             || '');
		setVal('s_timezone',          s.timezone          || 'America/New_York');
		setVal('s_date_format',       s.date_format       || 'm/d/Y');
		setVal('s_currency_position', s.currency_position || 'before');
		setVal('s_weight_unit',       s.weight_unit       || 'lbs');

		setVal('s_smtp_host',      s.smtp_host      || '');
		setVal('s_smtp_user',      s.smtp_user      || '');
		setVal('s_smtp_pass',      s.smtp_pass      || '');
		setVal('s_smtp_port',      s.smtp_port      || '587');
		setVal('s_mail_from',      s.mail_from      || '');
		setVal('s_mail_alert',     s.mail_alert     || '');
		setVal('s_mail_api_key',      s.mail_api_key      || '');
		setVal('s_mail_api_endpoint', s.mail_api_endpoint || '');

		setTog('s_maintenance_mode',  s.maintenance_mode  || 0);
		setTog('s_use_seo_urls',      s.use_seo_urls !== undefined ? s.use_seo_urls : 1);
		setTog('s_enable_check_payment', s.enable_check_payment !== undefined ? s.enable_check_payment : 1);
		setVal('s_admin_path',        s.admin_path        || '');
		setVal('s_pw_min_length',     s.pw_min_length     || '8');
		setTog('s_pw_require_upper',  s.pw_require_upper  || 0);
		setTog('s_pw_require_number', s.pw_require_number || 0);
		setTog('s_pw_require_symbol', s.pw_require_symbol || 0);
		setTog('s_display_errors',    s.display_errors    || 0);
		setTog('s_log_errors',        s.log_errors !== undefined ? s.log_errors : 1);
		setTog('s_smarty_debug',      s.smarty_debug      || 0);
		setTog('s_smarty_force_compile', s.smarty_force_compile !== undefined ? s.smarty_force_compile : 1);
		setTog('s_smarty_caching',    s.smarty_caching    || 0);

		// Options tab (Catalog)
		setTog('s_hide_empty_categories', s.hide_empty_categories !== undefined ? s.hide_empty_categories : 1);

		// Options tab (Reviews)
		setTog('s_reviews_auto_approve', s.reviews_auto_approve || 0);
		setTog('s_reviews_verified_only', s.reviews_verified_only !== undefined ? s.reviews_verified_only : 1);

		// Options tab
		setVal('s_img_orig_max',      s.img_orig_max      || '600');
		setVal('s_img_admin_size',    s.img_admin_size    || '160');
		setVal('s_img_admin_quality', s.img_admin_quality || '75');
		setVal('s_img_fm_size',       s.img_fm_size       || '50');
		setVal('s_img_fm_quality',    s.img_fm_quality    || '60');
		setVal('s_deepai_key',          s.deepai_key          || '');
		setVal('s_ga4_measurement_id',  s.ga4_measurement_id  || '');
		setVal('error-log', res.log_content || '');
		renderUsers(res.users || []);
	}

	// ── One Save button for all tabs ──────────────────────────────────────────
	document.getElementById('btn-save-all').addEventListener('save', async function () {
		const saveBtn = this;
		this.setLoading();
		clearTabErrors();

		let errors = [];

		// Validate store
		const nameEl = document.getElementById('s_site_name');
		if (!nameEl.value.trim()) {
			nameEl.classList.add('field-error');
			tabError('store', true);
			errors.push('Store name is required.');
		} else {
			nameEl.classList.remove('field-error');
		}

		if (errors.length) {
			saveBtn.reset();
			errors.forEach(notifyErr);
			if (settingsTabs) settingsTabs.activateFirstError();
			return;
		}

		// Single save_all call with all fields
		const res = await ajaxForm({
			action:                  'save_all',
			// Store
			site_name:               val('s_site_name'),
			site_email:              val('s_site_email'),
			store_phone:             val('s_store_phone'),
			store_logo_url:          val('s_store_logo_url'),
			store_logo_link:         val('s_store_logo_link'),
			favicon_svg_url:         val('s_favicon_svg_url'),
			img_retain_names:        tog('s_img_retain_names'),
			img_resize_on_upload:    tog('s_img_resize_on_upload'),
			img_orig_max:            val('s_img_orig_max'),
			img_admin_size:          val('s_img_admin_size'),
			img_admin_quality:       val('s_img_admin_quality'),
			img_fm_size:             val('s_img_fm_size'),
			img_fm_quality:          val('s_img_fm_quality'),
			img_product_width:       val('s_img_product_width'),
			img_product_quality:     val('s_img_product_quality'),
			img_cart_size:           val('s_img_cart_size'),
			img_related_size:        val('s_img_related_size'),
			img_second_level_size:   val('s_img_second_level_size'),
			img_sidebar_size:        val('s_img_sidebar_size'),
			related_max_items:       val('s_related_max_items'),
			site_currency:           val('s_site_currency'),
			seo_title_default:       val('s_seo_title_default'),
			seo_description_default: val('s_seo_description_default'),
			seo_keywords_default:    val('s_seo_keywords_default'),
			// Local
			address:                 val('s_address'),
			phone:                   val('s_phone'),
			timezone:                val('s_timezone'),
			date_format:             val('s_date_format'),
			currency_position:       val('s_currency_position'),
			weight_unit:             val('s_weight_unit'),
			// Mail
			smtp_host:               val('s_smtp_host'),
			smtp_user:               val('s_smtp_user'),
			smtp_pass:               document.getElementById('s_smtp_pass')?.value || '',
			smtp_port:               val('s_smtp_port'),
			mail_from:               val('s_mail_from'),
			mail_alert:              val('s_mail_alert'),
			mail_api_key:            document.getElementById('s_mail_api_key')?.value      || '',
			mail_api_endpoint:       document.getElementById('s_mail_api_endpoint')?.value || '',
			// Server
			admin_path:              val('s_admin_path'),
			maintenance_mode:        tog('s_maintenance_mode'),
			use_seo_urls:            tog('s_use_seo_urls'),
			enable_check_payment:    tog('s_enable_check_payment'),
			pw_min_length:           val('s_pw_min_length'),
			pw_require_upper:        tog('s_pw_require_upper'),
			pw_require_number:       tog('s_pw_require_number'),
			pw_require_symbol:       tog('s_pw_require_symbol'),
			display_errors:          tog('s_display_errors'),
			log_errors:              tog('s_log_errors'),
			smarty_debug:            tog('s_smarty_debug'),
			smarty_force_compile:    tog('s_smarty_force_compile'),
			smarty_caching:          tog('s_smarty_caching'),
			// Options
			img_orig_max:            val('s_img_orig_max'),
			img_admin_size:          val('s_img_admin_size'),
			img_admin_quality:       val('s_img_admin_quality'),
			img_fm_size:             val('s_img_fm_size'),
			img_fm_quality:          val('s_img_fm_quality'),
			img_related_size:        val('s_img_related_size'),
			img_second_level_size:   val('s_img_second_level_size'),
			img_sidebar_size:        val('s_img_sidebar_size'),
			related_max_items:       val('s_related_max_items'),
			deepai_key:              val('s_deepai_key'),
			hide_empty_categories:   tog('s_hide_empty_categories'),
			reviews_auto_approve:    tog('s_reviews_auto_approve'),
			reviews_verified_only:   tog('s_reviews_verified_only'),
			ga4_measurement_id:      val('s_ga4_measurement_id'),
			robots_txt:              document.getElementById('s_robots_txt')?.value ?? '',
			llms_txt:                document.getElementById('s_llms_txt')?.value ?? '',
			site_favicon:            val('s_site_favicon'),
		}, {
			logo: document.getElementById('input-logo')?.files[0],
		});

		if (!res.ok) {
			saveBtn.reset();
			notifyErr(res.message);
			return;
		}

		if (res.site_name) {
			const topbar = document.getElementById('topbar-store-name');
			if (topbar) topbar.textContent = res.site_name;
		}

		localStorage.removeItem('fm_thumb_size');
		saveBtn.showSuccess();
	});

	// ── Error log ─────────────────────────────────────────────────────────────
	document.getElementById('btn-clear-log').addEventListener('click', async function () {
		const res = await ajax({ action: 'clear_log' });
		if (!res.ok) { notifyErr(res.message); return; }
		setVal('error-log', '');
	});

	document.getElementById('btn-download-log').addEventListener('click', function () {
		window.location.href = AJAX + '&action=download_log';
	});

	// ── Users ─────────────────────────────────────────────────────────────────
	const userTbody = document.getElementById('user-tbody');
	const drawer    = document.getElementById('user-drawer');
	const overlay   = document.getElementById('drawer-overlay');

	function renderUsers(users) {
		userTbody.innerHTML = '';
		if (!users.length) {
			userTbody.innerHTML = '<tr><td colspan="5"><div class="nc-empty">No users found.</div></td></tr>';
			return;
		}
		users.forEach(u => userTbody.appendChild(buildUserRow(u)));
	}

	function accessLabel(level) { return ACCESS_LABELS[String(level)] || 'Custom'; }
	function initials(name) { return String(name || '').slice(0, 2).toUpperCase(); }

	function buildUserRow(u) {
		const tr      = document.createElement('tr');
		tr.dataset.id = u.id;
		const isAdmin  = u.access_level == 254;
		const inactive = u.status == 0;
		const av = u.avatar
			? '<img src="' + esc(u.avatar) + '" class="user-avatar-sm" alt="">'
			: '<span class="user-initials-sm">' + esc(initials(u.username)) + '</span>';

		tr.innerHTML =
			'<td style="display:flex;align-items:center">' +
				av +
				'<button class="user-name-link" data-id="' + u.id + '">' + esc(u.username) + '</button>' +
			'</td>' +
			'<td>' + esc(u.email) + '</td>' +
			'<td><span class="access-badge' + (isAdmin ? ' is-admin' : '') + '">' + accessLabel(u.access_level) + '</span></td>' +
			'<td class="col-toggle">' +
				'<ios-toggle ' + (u.status == 1 ? 'checked' : '') + ' size="sm" data-id="' + u.id + '" data-action="status"></ios-toggle>' +
			'</td>' +
			'<td class="delete-col">' +
				(inactive
					? '<span class="delete-fade show" id="del-' + u.id + '">' +
					  '<delete-in-place caption="&#128465;" confirm="Delete user?" data-id="' + u.id + '"></delete-in-place>' +
					  '</span>'
					: '<span class="delete-disabled-hint" id="del-' + u.id + '" title="Deactivate this user first, then you can delete them.">&#128465;</span>'
				) +
			'</td>';
		return tr;
	}

	// ── Drawer ────────────────────────────────────────────────────────────────
	function openDrawer(title) {
		document.getElementById('drawer-title').textContent = title;
		drawer.classList.add('open');
		overlay.classList.add('show');
	}

	function closeDrawer() {
		drawer.classList.remove('open');
		overlay.classList.remove('show');
	}

	function resetDrawer() {
		setVal('u_id', '');
		setVal('u_username', '');
		setVal('u_email', '');
		document.getElementById('u_password').value = '';
		document.getElementById('u_password').placeholder = 'Required for new users';
		setVal('u_access_level', '254');
		const stReset = togEl('u_status');
		if (stReset) stReset && setTog('u_status', 1);
		pendingAvatarFile   = null;
		pendingAvatarDelete = false;
		setAvatarPreview(null);
		avatarInput.value = '';
	}

	document.getElementById('btn-add-user').addEventListener('click', function () {
		resetDrawer();
		openDrawer('Add User');
		document.getElementById('u_username').focus();
	});

	// ── Click username to edit ────────────────────────────────────────────────
	userTbody.addEventListener('click', function (e) {
		const btn = e.target.closest('.user-name-link');
		if (!btn) return;
		const id = btn.dataset.id;
		const tr = userTbody.querySelector('tr[data-id="' + id + '"]');
		if (!tr) return;

		const cells    = tr.querySelectorAll('td');
		const toggle   = tr.querySelector('ios-toggle');
		const badge    = tr.querySelector('.access-badge');
		const badgeText = badge?.textContent.trim() || 'Admin';
		const lvl = Object.entries(ACCESS_LABELS).find(([, v]) => v === badgeText)?.[0] || '254';

		setVal('u_id',           id);
		setVal('u_username',     btn.textContent.trim());
		setVal('u_email',        cells[1]?.textContent.trim() || '');
		document.getElementById('u_password').value       = '';
		document.getElementById('u_password').placeholder = 'Leave blank to keep current';
		setVal('u_access_level', lvl);
		const stEdit = togEl('u_status');
		if (stEdit) stEdit && setTog('u_status', toggle?.checked ? 1 : 0);

		// Avatar preview
		const av = tr.querySelector('.user-avatar-sm');
		pendingAvatarFile   = null;
		pendingAvatarDelete = false;
		avatarInput.value   = '';
		setAvatarPreview(av ? av.src : null);

		openDrawer('Edit User');
	});

	// ── Save user ─────────────────────────────────────────────────────────────
	document.getElementById('btn-drawer-save').addEventListener('save', async function () {
		const uEl = document.getElementById('u_username');
		const eEl = document.getElementById('u_email');
		if (!uEl.reportValidity() || !eEl.reportValidity()) return;

		this.setLoading();
		const id = val('u_id');

		const res = await ajaxForm({
			action:        'save_user',
			id:            id,
			username:      val('u_username'),
			email:         val('u_email'),
			password:      document.getElementById('u_password').value,
			access_level:  val('u_access_level'),
			status:        tog('u_status'),
			delete_avatar: pendingAvatarDelete ? 1 : 0,
		}, pendingAvatarFile ? { avatar: pendingAvatarFile } : null);

		if (!res.ok) { notifyErr(res.message); this.reset(); return; }

		const existing = userTbody.querySelector('tr[data-id="' + res.user.id + '"]');
		const newRow   = buildUserRow(res.user);
		if (existing) userTbody.replaceChild(newRow, existing);
		else          userTbody.appendChild(newRow);
		this.showSuccess();
		setTimeout(() => closeDrawer(), 1500);
	});

	document.getElementById('drawer-close').addEventListener('click', closeDrawer);
	document.getElementById('btn-drawer-cancel').addEventListener('click', closeDrawer);
	overlay.addEventListener('click', closeDrawer);

	// ── Toggle active — show/hide delete ─────────────────────────────────────
	document.addEventListener('ios-toggle', async function (e) {
		const src = e.detail.source;
		if (src.dataset.action !== 'status') return;
		const id      = src.dataset.id;
		const delSpan = document.getElementById('del-' + id);
		if (delSpan) delSpan.classList.toggle('show', !e.detail.checked);

		const tr  = userTbody.querySelector('tr[data-id="' + id + '"]');
		const lvl = tr?.querySelector('.access-badge')?.textContent.trim() || '';
		const level = Object.entries(ACCESS_LABELS).find(([, v]) => v === lvl)?.[0] || '254';

		const res = await ajax({
			action:       'save_user',
			id:           id,
			username:     tr?.querySelector('.user-name-link')?.textContent.trim() || '',
			email:        tr?.querySelectorAll('td')[1]?.textContent.trim() || '',
			access_level: level,
			status:       e.detail.checked ? 1 : 0,
		});
		if (!res.ok) notifyErr(res.message);
	});

	// ── Delete user ───────────────────────────────────────────────────────────
	userTbody.addEventListener('dip-confirm', async function (e) {
		const id  = e.detail.id;
		const res = await ajax({ action: 'delete_user', id });
		if (!res.ok) { notifyErr(res.message); return; }
		const tr = userTbody.querySelector('tr[data-id="' + id + '"]');
		if (tr) {
			animateDelete(tr, function () {
				tr.remove();
				if (!userTbody.querySelector('tr[data-id]')) {
					userTbody.innerHTML = '<tr><td colspan="5"><div class="nc-empty">No users found.</div></td></tr>';
				}
			});
		}
	});

	function esc(str) {
		return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
	}

	// ── Navigate to hash target on load (e.g. #sub-integrations) ─────────────
	(function () {
		const hash = window.location.hash;
		if (!hash) return;
		const subId = hash.replace('#', '');
		const panel = document.getElementById(subId);
		if (!panel || !panel.classList.contains('sub-panel')) return;

		// Activate the Options main tab first
		if (settingsTabs) settingsTabs.activateById('tab-options');

		// Activate the sub-tab
		const parent = panel.closest('#tab-options');
		if (parent) {
			parent.querySelectorAll('.sub-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
			parent.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
			const subBtn = parent.querySelector('.sub-tab[data-sub="' + subId.replace('sub-', '') + '"]');
			if (subBtn) { subBtn.classList.add('active'); subBtn.setAttribute('aria-selected', 'true'); }
			panel.classList.add('active');
		}

		// Scroll into view
		setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
	}());

	// ── Upload file via FM ────────────────────────────────────────────────────
	async function uploadToFM(file, folder) {
		const fd = new FormData();
		fd.append('action', 'upload');
		fd.append('folder', folder);
		fd.append('file', file);
		fd.append('csrf_token', getCsrfToken());
		const r = await fetch(FM_AJAX, { method: 'POST', body: fd });
		return r.json();
	}

	// ── Generic drop zone binder ──────────────────────────────────────────────
	function bindDropZone(zoneId, onFile) {
		const zone = document.getElementById(zoneId);
		if (!zone) return;
		zone.addEventListener('dragenter', function (e) {
			if (e.dataTransfer.types.includes('Files')) zone.classList.add('drag-over');
		});
		zone.addEventListener('dragover', function (e) {
			if (e.dataTransfer.types.includes('Files')) e.preventDefault();
		});
		zone.addEventListener('dragleave', function (e) {
			if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
		});
		zone.addEventListener('drop', function (e) {
			zone.classList.remove('drag-over');
			const file = e.dataTransfer.files[0];
			if (!file) return;
			e.preventDefault();
			onFile(file);
		});
	}

	// ── Logo file picker + live preview ──────────────────────────────────────
	function setLogoPreview(url) {
		const p = document.getElementById('preview-logo');
		if (!p) return;
		if (url) { p.src = url; p.classList.add('show'); }
		else     { p.src = ''; p.classList.remove('show'); }
	}

	document.getElementById('s_store_logo_url')?.addEventListener('input', function () {
		setLogoPreview(this.value.trim());
	});

	document.getElementById('btn-logo-pick')?.addEventListener('click', function() {
		if (!window.openFilePicker) return;
		openFilePicker(function(items) {
			if (!items.length) return;
			const url = items[0].url;
			document.getElementById('s_store_logo_url').value = url;
			setLogoPreview(url);
		});
	});

	bindDropZone('logo-drop-zone', async function (file) {
		const res = await uploadToFM(file, 'uploads');
		if (!res.ok) { notifyErr(res.message || 'Upload failed.'); return; }
		const url = res.file.db_path;
		document.getElementById('s_store_logo_url').value = url;
		setLogoPreview(url);
	});

	// ── SVG favicon picker + live preview ─────────────────────────────────────
	function setFaviconSvgPreview(url) {
		const p = document.getElementById('preview-favicon-svg');
		if (!p) return;
		if (url) { p.src = url; p.classList.add('show'); }
		else     { p.src = ''; p.classList.remove('show'); }
	}

	document.getElementById('btn-favicon-svg-pick')?.addEventListener('click', function() {
		if (!window.openFilePicker) return;
		openFilePicker(function(items) {
			if (!items.length) return;
			const url = items[0].url;
			document.getElementById('s_favicon_svg_url').value = url;
			setFaviconSvgPreview(url);
		});
	});

	document.getElementById('s_favicon_svg_url')?.addEventListener('input', function() {
		setFaviconSvgPreview(this.value.trim());
	});

	bindDropZone('favicon-svg-drop-zone', async function (file) {
		const res = await uploadToFM(file, 'uploads');
		if (!res.ok) { notifyErr(res.message || 'Upload failed.'); return; }
		const url = res.file.db_path;
		document.getElementById('s_favicon_svg_url').value = url;
		setFaviconSvgPreview(url);
	});

	// ── PNG favicon FM picker ─────────────────────────────────────────────────
	document.getElementById('btn-favicon-png-pick')?.addEventListener('click', function () {
		if (!window.openFilePicker) return;
		openFilePicker(function (items) {
			if (!items.length) return;
			const url = items[0].url;
			document.getElementById('s_site_favicon').value = url;
			const p = document.getElementById('preview-favicon');
			if (p) { p.src = url; p.classList.add('show'); }
		});
	});

	// ── PNG favicon drop zone ─────────────────────────────────────────────────
	bindDropZone('favicon-png-drop-zone', async function (file) {
		const res = await uploadToFM(file, 'uploads');
		if (!res.ok) { notifyErr(res.message || 'Upload failed.'); return; }
		const url = res.file.db_path;
		document.getElementById('s_site_favicon').value = url;
		const p = document.getElementById('preview-favicon');
		if (p) { p.src = url; p.classList.add('show'); }
	});

	load();

})();
