//  PURPOSE: converts a checkbox to a styled iOS toggle
//  USAGE: <ios-toggle id="myid" name="myname" data-recordid="123"></ios-toggle>

class IosToggle extends HTMLElement {

	static get observedAttributes() {
		return ['checked', 'disabled', 'size'];
	}

	connectedCallback() {
		this._render();
		this.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
			this.querySelector('input[type=hidden]').value = e.target.checked ? 1 : 0;
			document.dispatchEvent(new CustomEvent('ios-toggle', {
				detail: {
					checked: e.target.checked,
					value:   e.target.checked ? 1 : 0,
					source:  this,
					data:    { ...this.dataset }
				}
			}));
		});
	}

	attributeChangedCallback() {
		if (this.querySelector('input[type=checkbox]')) this._render();
	}

	get checked() { return this.querySelector('input[type=checkbox]')?.checked ?? this.hasAttribute('checked'); }
	set checked(val) { val ? this.setAttribute('checked', '') : this.removeAttribute('checked'); }
	get value() { return this.checked ? 1 : 0; }

	_sizes() {
		switch (this.getAttribute('size')) {
			case 'xsmall': case 'xsm': return { width: 30, height: 10, thumb: 13, travel: 19 };
			case 'small':  case 'sm':  return { width: 36, height: 15, thumb: 18, travel: 22 };
			case 'medium': case 'med': return { width: 48, height: 21, thumb: 23, travel: 27 };
			default:                   return { width: 58, height: 24, thumb: 27, travel: 34 };
		}
	}

	_render() {
		const { width, height, thumb, travel } = this._sizes();

		const id      = this.getAttribute('id')    || '';
		const name    = this.getAttribute('name')  || '';
		const cls     = this.getAttribute('class') || '';
		const style   = `display:none;${this.getAttribute('style') || ''}`;
		const isChecked = this.querySelector('input[type=checkbox]')?.checked
			?? this.hasAttribute('checked');
		const dataAttrs = [...this.attributes]
			.filter(a => a.name.startsWith('data-'))
			.map(a => `${a.name}="${a.value}"`)
			.join(' ');

		['id', 'name', 'class', 'style'].forEach(a => this.removeAttribute(a));

		this.innerHTML = `
			<style>
				ios-toggle { display: inline-block; -webkit-tap-highlight-color: transparent; }
				ios-toggle label {
					position: relative;
					display: inline-block;
					width: ${width}px;
					height: ${height}px;
					cursor: pointer;
				}
				ios-toggle input[type=checkbox] {
					opacity: 0; width: 0; height: 0; position: absolute;
				}
				ios-toggle .track {
					position: absolute;
					inset: 0;
					background: var(--nc-track-off, #c7c7cc);
					border-radius: ${height}px;
					transition: background 0.25s ease;
				}
				ios-toggle input[type=checkbox]:checked ~ .track {
					background: var(--nc-track-off, #c7c7cc);
				}
				ios-toggle input[type=checkbox]:disabled ~ .track {
					opacity: 0.4; cursor: not-allowed;
				}
				ios-toggle .thumb {
					position: absolute;
					top: -2px;
					left: -2px;
					width: ${thumb}px;
					height: ${thumb}px;
					background: var(--nc-track-off, #c7c7cc);
					border-radius: 50%;
					box-shadow: 0 2px 4px rgba(0,0,0,0.3);
					transition: transform 0.25s ease, background 0.25s ease;
					pointer-events: none;
				}
				ios-toggle input[type=checkbox]:checked ~ .track .thumb {
					transform: translateX(${travel}px);
					background: var(--nc-thumb, #00CF00);
				}
			</style>
			<label${id ? ` id="${id}"` : ''}>
				<input type="checkbox"
					${isChecked ? 'checked' : ''}
					${this.hasAttribute('disabled') ? 'disabled' : ''}>
				<span class="track"><span class="thumb"></span></span>
			</label>
			<input type="hidden"
				${id   ? `id="_nc_${id}"` : ''}
				${name ? `name="${name}"` : ''}
				${cls  ? `class="${cls}"` : ''}
				${style ? `style="${style}"` : ''}
				${dataAttrs}
				value="${isChecked ? 1 : 0}">
			`;
	}
}

customElements.define('ios-toggle', IosToggle);
