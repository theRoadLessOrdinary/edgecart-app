/**
 * PayPal Checkout
 * Loaded on the checkout page when PayPal is enabled and configured.
 *
 * Expects globals set by checkout.js after place_order:
 *   ORDER_ID     — EdgeCart pending order id
 *   THANKYOU_URL — redirect on success
 *   CSRF_TOKEN   — set by checkout.js from meta tag
 */
(function () {
'use strict';

if (!window.PAYPAL_CLIENT_ID) return;

async function initPaypal() {
	if (typeof paypal === 'undefined') {
		SimpleNotification.error({ text: 'PayPal did not load. Please refresh and try again.' });
		return;
	}

	// Hide Place Order button while PayPal renders
	const placeBtn = document.getElementById('btn-place-order');
	if (placeBtn) placeBtn.style.display = 'none';

	// Create button container if not already present
	const section = document.getElementById('section-payment');
	let container = document.getElementById('paypal-button-container');
	if (!container) {
		container = document.createElement('div');
		container.id = 'paypal-button-container';
		container.style.marginTop = '1.5rem';
		if (placeBtn && section) {
			section.insertBefore(container, placeBtn);
		} else if (section) {
			section.appendChild(container);
		}
	}

	paypal.Buttons({
		style: {
			layout: 'vertical',
			color:  'gold',
			shape:  'rect',
			label:  'paypal',
		},

		createOrder: async function () {
			const fd = new FormData();
			fd.append('csrf_token', getCsrfToken());
			fd.append('order_id',   window.ORDER_ID || 0);

			const res  = await fetch('/?route=paypal/create-order', { method: 'POST', body: fd });
			const data = await res.json();

			if (!data.ok) {
				SimpleNotification.error({ text: data.message || 'Could not create PayPal order.' });
				throw new Error(data.message);
			}
			return data.paypal_order_id;
		},

		onApprove: async function (data) {
			const fd = new FormData();
			fd.append('csrf_token',      getCsrfToken());
			fd.append('order_id',        window.ORDER_ID || 0);
			fd.append('paypal_order_id', data.orderID);

			const res  = await fetch('/?route=paypal/capture-order', { method: 'POST', body: fd });
			const resp = await res.json();

			if (!resp.ok) {
				SimpleNotification.error({ text: resp.message || 'Payment capture failed.' });
				return;
			}
			window.location.href = resp.redirect_url || window.THANKYOU_URL;
		},

		onCancel: function () {
			window.resetPaymentUI?.();
		},

		onError: function (err) {
			console.error('[paypal]', err);
			SimpleNotification.error({ text: 'PayPal encountered an error. Please try again.' });
			window.resetPaymentUI?.();
		},

	}).render('#paypal-button-container');
}

// Expose for checkout.js to call after place_order succeeds
window.initPaypal = initPaypal;

})();
