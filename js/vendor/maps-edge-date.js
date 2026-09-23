//--------------------------------------------------------------------------------
// Global registry
const MeDate = {};

//--------------------------------------------------------------------------------
class MeDateElement extends HTMLElement {
	connectedCallback() {
		const nameAttr = this.getAttribute('name') || '';
		const idAttr = this.getAttribute('id') || nameAttr;
		const classAttr = this.getAttribute('class') || '';
		const initialVal = this.getAttribute('value') || '';

		// Build container
		const container = document.createElement('span');
		container.style.display = 'block';

		// Visible date input
		const dateInput = document.createElement('input');
		dateInput.type = 'date';
		if (classAttr) dateInput.className = classAttr;

		// Forward extra attributes (min, max, required, disabled, etc.)
		for (const attr of this.attributes) {
			if (!['name', 'id', 'value', 'class'].includes(attr.name)) {
				dateInput.setAttribute(attr.name, attr.value);
			}
		}

		// Hidden input carries name/id for form submission and jQuery targeting
		const hiddenInput = document.createElement('input');
		hiddenInput.type = 'hidden';
		if (nameAttr) hiddenInput.name = nameAttr;
		if (idAttr) hiddenInput.id = idAttr;

		container.appendChild(dateInput);
		container.appendChild(hiddenInput);

		//-- helpers -------------------------------------------------------------
		function parseYYYYMMDD(str) {
			const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
			if (!m) return null;
			return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
		}

		function parseMMDDYYYY(str) {
			const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
			if (!m) return null;
			const mm = parseInt(m[1]), dd = parseInt(m[2]), yyyy = parseInt(m[3]);
			if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
			return new Date(yyyy, mm - 1, dd);
		}

		function formatMMDDYYYY(date) {
			return String(date.getMonth() + 1).padStart(2, '0') + '/' +
				String(date.getDate()).padStart(2, '0') + '/' +
				date.getFullYear();
		}

		function toISO(date) {
			return date.getFullYear() + '-' +
				String(date.getMonth() + 1).padStart(2, '0') + '-' +
				String(date.getDate()).padStart(2, '0');
		}

		//-- init value ----------------------------------------------------------
		if (initialVal) {
			const d = parseMMDDYYYY(initialVal) || parseYYYYMMDD(initialVal);
			if (d) {
				dateInput.value = toISO(d);
				hiddenInput.value = formatMMDDYYYY(d);
			}
		}

		//-- API -----------------------------------------------------------------
		const api = {
			_handlers: {},

			on(event, fn) {
				if (!this._handlers[event]) this._handlers[event] = [];
				this._handlers[event].push(fn);
				return this;
			},
			focus() {
				dateInput.focus();
				return this;
			},
			blur() {
				dateInput.blur();
				return this;
			},
			click() {
				dateInput.click();
				return this;
			},
			_trigger(event) {
				(this._handlers[event] || []).forEach(fn => fn.call(this));
			},
			val(newVal) {
				if (newVal === undefined) return hiddenInput.value;
				const d = parseMMDDYYYY(newVal) || parseYYYYMMDD(newVal);
				if (d) {
					dateInput.value = toISO(d);
					hiddenInput.value = formatMMDDYYYY(d);
				} else {
					dateInput.value = '';
					hiddenInput.value = '';
				}
				return this;
			},

			attr(name, value) {
				if (value === undefined) return dateInput.getAttribute(name);
				dateInput.setAttribute(name, value);
				return this;
			},

			removeAttr(name) {
				dateInput.removeAttribute(name);
				return this;
			},

			clear() {
				return this.val('');
			}
		};

		//-- sync hidden on change, fire handlers --------------------------------
		dateInput.addEventListener('input', () => {
			const d = parseYYYYMMDD(dateInput.value);
			hiddenInput.value = d ? formatMMDDYYYY(d) : '';
			api._trigger('change');
		});
		dateInput.addEventListener('input', () => api._trigger('change'));
		dateInput.addEventListener('focus', () => api._trigger('focus'));
		dateInput.addEventListener('blur', () => api._trigger('blur'));
		dateInput.addEventListener('click', () => api._trigger('click'));
		//-- register in global registry -----------------------------------------
		if (idAttr) MeDate[idAttr] = api;
		if (nameAttr && nameAttr !== idAttr) MeDate[nameAttr] = api;

		// Replace the custom element with the container
		this.replaceWith(container);
	}
}

customElements.define('me-date', MeDateElement);

//--------------------------------------------------------------------------------
// jQuery plugin (optional — only registered when jQuery is present)
if (typeof $ === 'function' && $.fn) $.fn.meDate = function (action, ...args) {
	const el = this[0];
	const key = el?.getAttribute?.('name') || el?.getAttribute?.('id') || el?.name || el?.id;
	const api = MeDate[key];
	if (!api) return this;

	if (typeof action === 'object' || action === undefined) return this;

	// For 'on', wrap handler so `this` inside the callback is the DOM element
	if (action === 'on') {
		const [event, fn] = args;
		api.on(event, function () {
			fn.call(el);
		});
		return this;
	}

	const result = api[action]?.(...args);
	return (result === api || result === undefined) ? this : result;
};