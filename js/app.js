/**
 * CandyCart — core JS
 */

'use strict';

// ── Selectors ──────────────────────────────────────────────────────────────────
const $  = s => document.querySelectorAll(s);
const $1 = s => document.querySelector(s);

// ── Fetch helpers ──────────────────────────────────────────────────────────────
const http = {
	async post(url, data = {}) {
		const fd = new FormData();
		Object.entries(data).forEach(([k, v]) => fd.append(k, v));
		const r = await fetch(url, { method: 'POST', body: fd });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const ct = r.headers.get('content-type') || '';
		return ct.includes('application/json') ? r.json() : r.text();
	},
	async get(url, params = {}) {
		const qs = new URLSearchParams(params).toString();
		const r = await fetch(qs ? `${url}?${qs}` : url);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const ct = r.headers.get('content-type') || '';
		return ct.includes('application/json') ? r.json() : r.text();
	}
};

// ── Simple fade helpers ────────────────────────────────────────────────────────
function fadeOut(el, ms = 250, cb) {
	el.style.transition = `opacity ${ms}ms`;
	el.style.opacity = '0';
	setTimeout(() => {
		el.style.display = 'none';
		el.style.transition = '';
		if (cb) cb();
	}, ms);
}

function fadeIn(el, ms = 250, display = 'inline') {
	el.style.display = display;
	el.style.opacity = '0';
	el.style.transition = `opacity ${ms}ms`;
	requestAnimationFrame(() => {
		requestAnimationFrame(() => { el.style.opacity = '1'; });
	});
	setTimeout(() => { el.style.transition = ''; }, ms);
}

// ── delete-in-place (vanilla rewrite) ─────────────────────────────────────────
class DeleteInPlace extends HTMLElement {
	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;

		const caption = this.getAttribute('caption') || 'delete';
		const confirm = this.getAttribute('confirm') || 'are you sure?';

		const params = {};
		for (const attr of this.attributes) {
			if (!['caption', 'confirm', 'class'].includes(attr.name)) {
				params[attr.name] = attr.value;
			}
		}

		this.innerHTML = `
			<span style="position:relative;display:inline-block;">
				<a class="dip-delete" style="cursor:pointer;">${caption}</a>
				<a class="dip-confirm" style="color:green;cursor:pointer;display:none;">${confirm}</a>
			</span>`;

		this._timer  = null;
		this._delEl  = this.querySelector('.dip-delete');
		this._conEl  = this.querySelector('.dip-confirm');

		this._delEl.addEventListener('click', () => {
			fadeOut(this._delEl, 250, () => fadeIn(this._conEl, 250));
			this._timer = setTimeout(() => this._reset(), 5000);
		});

		this._conEl.addEventListener('click', () => {
			clearTimeout(this._timer);
			this.dispatchEvent(new CustomEvent('dip-confirm', { bubbles: true, detail: params }));
			this._reset();
		});
	}

	_reset() {
		clearTimeout(this._timer);
		fadeOut(this._conEl, 250, () => fadeIn(this._delEl, 250));
	}
}
customElements.define('delete-in-place', DeleteInPlace);

// ── me-drawer (vanilla rewrite) ───────────────────────────────────────────────
class MeDrawer extends HTMLElement {

	static #overlay = null;

	static #getOverlay() {
		if (!MeDrawer.#overlay) {
			const el = document.createElement('div');
			el.style.cssText = 'display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.4);transition:opacity 0.25s;';
			document.body.appendChild(el);
			MeDrawer.#overlay = el;
		}
		return MeDrawer.#overlay;
	}

	connectedCallback() {
		this._head    = this.querySelector('drawer-head')    || this._slot('drawer-head');
		this._content = this.querySelector('drawer-content') || this._slot('drawer-content');
		this._foot    = this.querySelector('drawer-foot')    || this._slot('drawer-foot');

		this._transIn  = this.getAttribute('transition-in')  || 'slideInRight';
		this._transOut = this.getAttribute('transition-out') || 'slideOutRight';

		if (this.hasAttribute('close-button')) {
			const btn = document.createElement('button');
			btn.textContent = this.getAttribute('close-button') || 'Close';
			btn.addEventListener('click', () => this.close());
			this._foot.appendChild(btn);
		}

		const content = this.getAttribute('content');
		if (content) this.setContent(content);

		this._overlayHandler = (e) => {
			if (e.target === MeDrawer.#getOverlay()) this.close();
		};
		MeDrawer.#getOverlay().addEventListener('click', this._overlayHandler);
	}

	disconnectedCallback() {
		MeDrawer.#getOverlay().removeEventListener('click', this._overlayHandler);
	}

	_slot(tag) {
		const el = document.createElement(tag);
		this.appendChild(el);
		return el;
	}

	open(url) {
		const ov = MeDrawer.#getOverlay();
		fadeIn(ov, 250, 'block');
		this.classList.add('open', this._transIn);
		if (url) {
			setTimeout(() => {
				this._content.innerHTML = '';
				fetch(url).then(r => r.text()).then(html => { this._content.innerHTML = html; });
			}, 300);
		}
		this.dispatchEvent(new CustomEvent('me-drawer:open', { bubbles: true }));
		return this;
	}

	close() {
		this.classList.remove(this._transIn);
		this.classList.add(this._transOut);
		setTimeout(() => {
			fadeOut(MeDrawer.#getOverlay(), 250);
			this.classList.remove('open', this._transOut);
			this._content.innerHTML = '';
			this.dispatchEvent(new CustomEvent('me-drawer:close', { bubbles: true }));
		}, 400);
		return this;
	}

	setHead(content)    { return this._fill(this._head, content); }
	setContent(content) {
		if (typeof content === 'string' && /^(https?:\/\/|\/|\.\/)/.test(content)) {
			this._content.innerHTML = '';
			fetch(content).then(r => r.text()).then(html => { this._content.innerHTML = html; });
		} else {
			this._fill(this._content, content);
		}
		return this;
	}
	setFoot(content)    { return this._fill(this._foot, content); }

	_fill(slot, content) {
		slot.innerHTML = '';
		if (typeof content === 'string') slot.innerHTML = content;
		else slot.appendChild(content);
		return this;
	}
}
customElements.define('me-drawer', MeDrawer);

// ── SimpleNotification convenience wrapper ─────────────────────────────────────
// Assumes SimpleNotification is loaded separately.
const notify = {
	success(msg) { SimpleNotification.success({ text: msg }); },
	error(msg)   { SimpleNotification.error({ text: msg }); },
	info(msg)    { SimpleNotification.info({ text: msg }); },
	warning(msg) { SimpleNotification.warning({ text: msg }); },
};
