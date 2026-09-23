'use strict';

async function cartAjax(data) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) fd.append(k, v);
	const res = await fetch('/?route=cart', { method: 'POST', body: fd });
	return res.json();
}

// Helper to save cart to localStorage
function saveCartToStorage() {
	if (window.CartPersistence) {
		cartAjax({ action: 'get' }).then(function(data) {
			if (data.ok && data.items) {
				window.CartPersistence.save(data.items, data.cart_total);
			}
		});
	}
}

// ── Qty update ─────────────────────────────────────────────────────────────
let qtyTimer = null;
document.querySelectorAll('.cart-qty-input').forEach(function (input) {
	input.addEventListener('change', function () {
		clearTimeout(qtyTimer);
		const index = parseInt(this.dataset.index);
		const qty   = Math.max(1, parseInt(this.value) || 1);
		this.value  = qty;
		qtyTimer = setTimeout(async function () {
			const res = await cartAjax({ action: 'update', index, qty });
			if (res.ok) {
				document.getElementById('cart-subtotal').textContent = res.subtotal;
				res.items.forEach(function (item) {
					const el = document.querySelector('.cart-line-total[data-index="' + item.index + '"]');
					if (el) el.textContent = item.line_total;
				});
				// Update header cart count and subtotal
				const countEl = document.querySelector('.cart-count');
				if (countEl) countEl.textContent = res.count;
				const mastSubEl = document.querySelector('.cart-subtotal');
				if (mastSubEl) mastSubEl.textContent = res.subtotal;
				// Save to localStorage
				saveCartToStorage();
			}
		}, 500);
	});
});

// ── Clear saved cart button ────────────────────────────────────────────────
const btnClearSaved = document.getElementById('btn-clear-saved-cart');
if (btnClearSaved) {
	btnClearSaved.addEventListener('click', function() {
		if (window.CartPersistence) {
			window.CartPersistence.clear();
			this.textContent = 'Saved cart cleared';
			this.disabled = true;
			setTimeout(() => {
				this.textContent = 'Clear Saved Cart';
				this.disabled = false;
			}, 2000);
		}
	});
}

// ── Remove ────────────────────────────────────────────────────────────────
document.addEventListener('dip-confirm', async function (e) {
	const index = parseInt(e.detail.index);
	if (isNaN(index)) return;
	const row = document.querySelector('tr[data-index="' + index + '"]');
	const res = await cartAjax({ action: 'remove', index });
	if (!res.ok) return;
	const countEl = document.querySelector('.cart-count');
	if (countEl) countEl.textContent = res.count;
	const subEl = document.getElementById('cart-subtotal');
	if (subEl) subEl.textContent = res.subtotal;
	const mastSubEl = document.querySelector('.cart-subtotal');
	if (mastSubEl) mastSubEl.textContent = res.subtotal;
	// Save to localStorage
	saveCartToStorage();
	if (row) {
		row.style.outline = '2px solid #ef4444';
		setTimeout(function () {
			row.style.transition = 'opacity .22s';
			row.style.opacity = '0';
			setTimeout(function () {
				row.remove();
				const tbody = document.querySelector('#cart-table tbody');
				if (tbody && !tbody.children.length) location.reload();
			}, 220);
		}, 100);
	}
});

// ── Cart restoration from localStorage ─────────────────────────────────────
// When user loads page without cache (new session), restore from localStorage
document.addEventListener('cartRestored', function(e) {
	const savedItems = e.detail.items;
	if (savedItems && savedItems.length > 0) {
		// Reload page to show the restored cart
		location.reload();
	}
});
