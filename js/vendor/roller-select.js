/**
 * <roller-select> — vanilla JS cycling selector
 *
 * Usage:
 *   <roller-select name="status" value="1">
 *     <rs-item value="0">Not Active</rs-item>
 *     <rs-item value="1">Active</rs-item>
 *     <rs-item value="2">Browse Only</rs-item>
 *   </roller-select>
 *
 * Fires a 'roller-change' event on document with detail: { value, label, source }
 * Carries a hidden input with name/id for form use.
 * data-* attributes are forwarded to the hidden input.
 */

class RollerSelect extends HTMLElement {

	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;

		// Collect items before replacing innerHTML
		this._items = Array.from(this.querySelectorAll('rs-item')).map(el => ({
			value: el.getAttribute('value') ?? el.textContent.trim(),
			label: el.textContent.trim(),
		}));

		if (!this._items.length) return;

		const name     = this.getAttribute('name') || '';
		const id       = this.getAttribute('id')   || name;
		const initVal  = this.getAttribute('value') ?? this._items[0].value;
		this._pointer  = this._items.findIndex(i => String(i.value) === String(initVal));
		if (this._pointer < 0) this._pointer = 0;

		// Forward data-* attributes to hidden input
		const dataAttrs = Array.from(this.attributes)
			.filter(a => a.name.startsWith('data-'))
			.map(a => `${a.name}="${a.value}"`)
			.join(' ');

		this.innerHTML = `
			<style>
				roller-select {
					display: inline-block;
					position: relative;
					vertical-align: middle;
				}
				roller-select .rs-track {
					display: inline-block;
					position: relative;
					height: 1.8rem;
					min-width: 150px;
					overflow: hidden;
					cursor: pointer;
					background: var(--nc-bg, #fff);
					border: 1px solid var(--nc-border, #9ca3af);
					border-radius: .3rem;
					padding: .15rem .5rem;
					font-size: .85rem;
					font-weight: 600;
					font-family: Helvetica, 'Open Sans', sans-serif;
					color: var(--nc-text, #1a1a1a);
					user-select: none;
					vertical-align: middle;
				}
				roller-select .rs-track:hover {
					border-color: var(--nc-primary, #2563eb);
				}
				roller-select .rs-label {
					position: absolute;
					white-space: nowrap;
				}
				roller-select .rs-label.rs-in {
					animation: rs-in .4s ease forwards;
				}
				roller-select .rs-label.rs-out {
					animation: rs-out .4s ease forwards;
				}
				@keyframes rs-in {
					from { opacity: 0; transform: translateY(5px); }
					to   { opacity: 1; transform: translateY(0); }
				}
				@keyframes rs-out {
					from { opacity: 1; transform: translateY(0); }
					to   { opacity: 0; transform: translateY(-5px); }
				}
			</style>
			<input type="hidden"
				${id   ? `id="${id}"`     : ''}
				${name ? `name="${name}"` : ''}
				${dataAttrs}
				value="${this._esc(String(this._items[this._pointer].value))}">
			<div class="rs-track" title="Click to change">
				<span class="rs-label rs-in">${this._esc(this._items[this._pointer].label)}</span>
			</div>`;

		this._hidden = this.querySelector('input[type=hidden]');
		this._track  = this.querySelector('.rs-track');

		this._track.addEventListener('click', () => this._cycle());
	}

	_cycle() {
		const oldLabel = this._track.querySelector('.rs-label');

		// Animate out current
		if (oldLabel) {
			oldLabel.classList.remove('rs-in');
			oldLabel.classList.add('rs-out');
			setTimeout(() => oldLabel.remove(), 200);
		}

		// Advance pointer
		this._pointer = (this._pointer + 1) % this._items.length;
		const item = this._items[this._pointer];

		// Animate in next
		const newLabel = document.createElement('span');
		newLabel.className   = 'rs-label rs-in';
		newLabel.textContent = item.label;
		this._track.appendChild(newLabel);

		// Update hidden input
		this._hidden.value = item.value;

		// Fire event
		document.dispatchEvent(new CustomEvent('roller-change', {
			detail: {
				value:  item.value,
				label:  item.label,
				source: this,
				data:   { ...this.dataset },
			}
		}));
	}

	// Programmatic value setter
	set value(val) {
		const idx = this._items?.findIndex(i => String(i.value) === String(val));
		if (idx === undefined || idx < 0) return;
		this._pointer = idx;
		if (this._hidden) this._hidden.value = val;
		const lbl = this._track?.querySelector('.rs-label');
		if (lbl) lbl.textContent = this._items[idx].label;
	}

	get value() {
		return this._hidden?.value ?? this._items?.[this._pointer]?.value;
	}

	_esc(str) {
		return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
	}
}

customElements.define('roller-select', RollerSelect);
