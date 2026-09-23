class SaveButton extends HTMLElement {

	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;

		// Check for data-label attribute first (explicit label)
		let label = this.getAttribute('data-label');
		if (label) {
			this._init(label);
			return;
		}

		// Try reading text from DOM as fallback
		label = this.textContent.trim();
		if (label) {
			this._init(label);
		} else {
			// If text not available yet, wait for DOM to settle
			requestAnimationFrame(() => {
				label = this.textContent.trim();
				this._init(label);
			});
		}
	}

	_init(label) {
		if (!label) label = this.textContent.trim();

		const cls = this.getAttribute('class') || '';
		const type = this.getAttribute('type') || 'button';
		const title = this.getAttribute('title') || '';
		const checkmark = this.getAttribute('checkmark') || '✓';

		// Separate styling classes (btn, btn-*) from utility classes (save-group-keys, etc)
		const classes = cls.split(' ').filter(c => c);
		const stylingClasses = classes.filter(c => c.startsWith('btn')).join(' ');
		const utilityClasses = classes.filter(c => !c.startsWith('btn')).join(' ');

		// Inner button gets styling classes + save-button-inner
		const btnClasses = ['save-button-inner', stylingClasses].filter(c => c).join(' ');

		// Build button HTML
		const btnHtml = `<button type="button" class="${btnClasses}" ${this.hasAttribute('disabled') ? 'disabled' : ''} ${title ? `title="${title}"` : ''}>${label}</button><span class="save-button-checkmark">${checkmark}</span>`;

		// Replace entire content
		this.innerHTML = btnHtml;

		// Keep only utility classes on wrapper (like save-group-keys for selectors)
		if (utilityClasses) {
			this.setAttribute('class', utilityClasses);
		} else {
			this.removeAttribute('class');
		}
		this.removeAttribute('type');
		this.removeAttribute('title');

		// Cache references
		this._btn = this.querySelector('.save-button-inner');
		this._checkmark = this.querySelector('.save-button-checkmark');

		// Attach event listener
		this._btn.addEventListener('click', () => {
			this.dispatchEvent(new Event('save', { bubbles: true, cancelable: true }));
		});
	}

	showSuccess() {
		const duration = parseInt(this.getAttribute('duration') || '1500', 10);
		this._btn.classList.add('save-button-hiding');
		this._checkmark.classList.add('save-button-visible');

		setTimeout(() => {
			this._checkmark.classList.remove('save-button-visible');
			this._btn.classList.remove('save-button-hiding');
			this._btn.disabled = false;
		}, duration);
	}

	setLoading() {
		this._btn.disabled = true;
		this._btn.classList.add('save-button-hiding');
	}

	reset() {
		this._btn.disabled = false;
		this._btn.classList.remove('save-button-hiding');
		this._checkmark.classList.remove('save-button-visible');
	}

	setLabel(text) {
		if (this._btn) this._btn.textContent = text;
	}
}

if (!customElements.get('save-button')) customElements.define('save-button', SaveButton);
