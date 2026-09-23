/**
 * <password-field> — text input that starts masked with a reveal toggle.
 *
 * Usage:
 *   <password-field id="my-pass" name="password" placeholder="Enter password"></password-field>
 *
 * Attributes forwarded to inner <input>: id, name, placeholder, value,
 *   autocomplete, minlength, maxlength, required, aria-label, aria-describedby
 *
 * The toggle button sits inside the right edge of the field.
 * Eye-closed SVG = masked. Eye-open SVG = visible.
 *
 * Exposes .value get/set and .focus() to behave like a real input.
 */

class PasswordField extends HTMLElement {

	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;

		const FORWARD = ['name','placeholder','value','autocomplete',
		                 'minlength','maxlength','required','aria-label','aria-describedby'];

		const wrap = document.createElement('div');
		wrap.className = 'pf-wrap';
		wrap.style.cssText = 'position:relative;display:flex;align-items:center;';

		const input = document.createElement('input');
		input.type  = 'password';
		input.style.cssText = 'flex:1;padding-right:2.4rem;';

		// Forward attributes
		FORWARD.forEach(attr => {
			if (this.hasAttribute(attr)) input.setAttribute(attr, this.getAttribute(attr));
		});
		// Forward id to input, remove from host to avoid duplicate
		if (this.hasAttribute('id')) {
			input.id = this.getAttribute('id');
			this.removeAttribute('id');
		}
		// Forward class
		if (this.className) { input.className = this.className; this.className = ''; }

		const btn = document.createElement('button');
		btn.type  = 'button';
		btn.setAttribute('aria-label', 'Show password');
		btn.style.cssText = [
			'position:absolute',
			'right:.5rem',
			'background:none',
			'border:none',
			'cursor:pointer',
			'padding:.2rem',
			'color:var(--nc-text-dim,#888)',
			'display:flex',
			'align-items:center',
			'line-height:1',
		].join(';');

		btn.innerHTML = this._eyeIcon(false);

		btn.addEventListener('click', () => {
			const show = input.type === 'password';
			input.type = show ? 'text' : 'password';
			btn.innerHTML = this._eyeIcon(show);
			btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
			input.focus();
		});

		wrap.appendChild(input);
		wrap.appendChild(btn);

		// Clear children and append wrap
		this.innerHTML = '';
		this.appendChild(wrap);

		this._input = input;
	}

	_eyeIcon(open) {
		if (open) {
			// Eye open — password visible
			return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
			     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
			     aria-hidden="true">
				<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
				<circle cx="12" cy="12" r="3"/>
			</svg>`;
		}
		// Eye closed — password masked
		return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
		     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
		     aria-hidden="true">
			<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
			<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
			<line x1="1" y1="1" x2="23" y2="23"/>
		</svg>`;
	}

	get value()  { return this._input?.value ?? ''; }
	set value(v) { if (this._input) this._input.value = v; }
	focus()      { this._input?.focus(); }

	static get observedAttributes() { return ['value']; }
	attributeChangedCallback(name, oldVal, newVal) {
		if (name === 'value' && this._input) this._input.value = newVal;
	}
}

customElements.define('password-field', PasswordField);
