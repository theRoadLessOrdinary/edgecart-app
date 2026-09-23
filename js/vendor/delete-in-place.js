class DeleteInPlace extends HTMLElement {
	connectedCallback() {
		if (this._initialized) return;
		this._initialized = true;
		const caption = this.getAttribute('caption') || 'delete';
		const confirm = this.getAttribute('confirm') || 'are you sure?';
		// build params object from all attributes except caption/confirm
		const params = {};
		for (const attr of this.attributes) {
			if (attr.name !== 'caption' && attr.name !== 'confirm' && attr.name !== 'class') {
				params[attr.name] = attr.value;
			}
		}
		this.innerHTML = `
            <span style="position:relative; display:inline-block;">
                <a class="dip-delete" style="cursor:pointer;">${caption}</a>
                <a class="dip-confirm" style="color: green; cursor:pointer; display:none;">${confirm}</a>
            </span>
        `;
	
		this._timer = null;
		this._delEl = this.querySelector('.dip-delete');
		this._conEl = this.querySelector('.dip-confirm');

		this._delEl.addEventListener('click', () => {
			$(this._delEl).fadeOut(250, () => {
				$(this._conEl).fadeIn(250);
			});
			this._timer = setTimeout(() => this._reset(), 5000);
		});

		this._conEl.addEventListener('click', () => {
			clearTimeout(this._timer);
			this.dispatchEvent(new CustomEvent('dip-confirm', {
				bubbles: true,
				detail: params
			}));
			this._reset();
		});
	}

	_reset() {
		clearTimeout(this._timer);
		$(this._conEl).fadeOut(250, () => {
			$(this._delEl).fadeIn(250);
		});
	}
}

customElements.define('delete-in-place', DeleteInPlace);