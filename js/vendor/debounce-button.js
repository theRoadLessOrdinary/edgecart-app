/**
 * <debounce-button> — drop-in replacement for <button> with built-in debounce.
 *
 * Usage:
 *   <debounce-button class="btn btn-primary" ms="1000">Save</debounce-button>
 *
 * Behaves exactly like a <button> for styling and accessibility.
 * Click events within `ms` milliseconds of the previous click are silently dropped.
 * No disable/re-enable needed.
 *
 * Attributes:
 *   ms        — debounce interval in ms (default 1000)
 *   type      — forwarded to inner button (default "button")
 *   disabled  — forwarded to inner button
 *
 * The component renders a real <button> internally so it participates in forms
 * and receives CSS class styling normally.
 */

class DebounceButton extends HTMLElement {

	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;
		this._last = 0;

		// Move children/text into an inner button
		const btn = document.createElement('button');
		btn.type = this.getAttribute('type') || 'button';
		if (this.hasAttribute('disabled')) btn.disabled = true;

		// Copy classes and other attributes to inner button
		if (this.className) { btn.className = this.className; this.className = ''; }
		for (const attr of [...this.attributes]) {
			if (['ms','type','disabled','class'].includes(attr.name)) continue;
			btn.setAttribute(attr.name, attr.value);
		}

		// Move existing child nodes into button
		while (this.firstChild) btn.appendChild(this.firstChild);
		this.appendChild(btn);

		this._btn = btn;

		btn.addEventListener('click', (e) => {
			const now = Date.now();
			const ms  = parseInt(this.getAttribute('ms') || '1000', 10);
			if (now - this._last < ms) {
				e.stopImmediatePropagation();
				return;
			}
			this._last = now;
			// Event bubbles naturally — no re-dispatch needed
		});
	}

	// Reflect disabled to inner button
	static get observedAttributes() { return ['disabled']; }
	attributeChangedCallback(name, oldVal, newVal) {
		if (!this._btn) return;
		if (name === 'disabled') {
			this._btn.disabled = newVal !== null;
		}
	}

	get disabled() { return this._btn?.disabled ?? false; }
	set disabled(v) { if (this._btn) this._btn.disabled = !!v; }
}

customElements.define('debounce-button', DebounceButton);
