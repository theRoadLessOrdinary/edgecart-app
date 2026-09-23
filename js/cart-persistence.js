// Cart persistence with localStorage (30-day TTL)

(function() {
	'use strict';

	const STORAGE_KEY = 'nc_cart';
	const TTL_DAYS = 30;

	const CartPersistence = {
		// Save cart to localStorage with expiration
		save(items, cartTotal) {
			try {
				const expiresAt = new Date();
				expiresAt.setDate(expiresAt.getDate() + TTL_DAYS);

				const data = {
					version: 1,
					expires_at: expiresAt.toISOString(),
					items: items,
					cart_total: cartTotal
				};

				localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
			} catch (e) {
				console.warn('Failed to save cart to localStorage:', e);
			}
		},

		// Load cart from localStorage if valid
		load() {
			try {
				const stored = localStorage.getItem(STORAGE_KEY);
				if (!stored) return null;

				const data = JSON.parse(stored);

				// Check expiration
				const expiresAt = new Date(data.expires_at);
				if (expiresAt < new Date()) {
					localStorage.removeItem(STORAGE_KEY);
					return null;
				}

				// Validate structure
				if (data.version !== 1 || !Array.isArray(data.items)) {
					return null;
				}

				// Validate items (must have numeric product_id)
				for (const item of data.items) {
					if (!item.product_id || isNaN(parseInt(item.product_id))) {
						return null;
					}
				}

				return data;
			} catch (e) {
				console.warn('Failed to load cart from localStorage:', e);
				return null;
			}
		},

		// Clear cart from localStorage
		clear() {
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch (e) {
				console.warn('Failed to clear cart from localStorage:', e);
			}
		},

		// Watch cart changes and auto-save
		watchCart(getCartData) {
			// This function should be called whenever the cart updates
			// It expects getCartData to be a function that returns { items, cart_total }
			const data = getCartData();
			if (data && data.items) {
				this.save(data.items, data.cart_total);
			}
		}
	};

	// Expose globally
	window.CartPersistence = CartPersistence;

	// On page load, try to restore cart
	document.addEventListener('DOMContentLoaded', function() {
		const savedCart = CartPersistence.load();
		if (savedCart && savedCart.items && savedCart.items.length > 0) {
			// Dispatch event so the cart module can act on the restored data
			const event = new CustomEvent('cartRestored', {
				detail: {
					items: savedCart.items,
					cartTotal: savedCart.cart_total
				}
			});
			document.dispatchEvent(event);
		}
	});
})();
