/**
 * Stripe Payment Element
 * Included on the checkout page when Stripe is the selected payment method.
 *
 * Expects globals:
 *   STRIPE_PUBLISHABLE_KEY  — set by catalog checkout template
 *   CART_AMOUNT_CENTS       — order total in cents
 *   CART_CURRENCY           — e.g. 'usd'
 *   ORDER_ID                — pending order id
 *   THANKYOU_URL            — redirect on success
 */
(function () {
'use strict';

if (!window.STRIPE_PUBLISHABLE_KEY) return;

const stripe = Stripe(window.STRIPE_PUBLISHABLE_KEY);
let elements, paymentElement;

// ── Create DOM elements if not already in template ────────────────────────
function ensureStripeElements() {
	const section = document.getElementById('section-payment');
	if (!section) return;

	if (!document.getElementById('stripe-payment-element')) {
		const div = document.createElement('div');
		div.id = 'stripe-payment-element';
		const placeBtn = document.getElementById('btn-place-order');
		placeBtn ? section.insertBefore(div, placeBtn) : section.appendChild(div);
	}
	if (!document.getElementById('stripe-error')) {
		const err = document.createElement('div');
		err.id   = 'stripe-error';
		err.setAttribute('role', 'alert');
		const el = document.getElementById('stripe-payment-element');
		el.insertAdjacentElement('afterend', err);
	}
	if (!document.getElementById('btn-pay-stripe')) {
		const payBtn = document.createElement('button');
		payBtn.id        = 'btn-pay-stripe';
		payBtn.type      = 'button';
		payBtn.className = 'btn btn-primary btn-lg';
		payBtn.style.cssText = 'width:100%;display:none;margin-top:1.5rem';
		payBtn.textContent = 'Pay Now';
		// Insert after stripe-error so order is: element → error → pay-btn → place-order
		document.getElementById('stripe-error').insertAdjacentElement('afterend', payBtn);
		debounceBtn(payBtn, submitPayment);
	}
}

// ── Create payment intent and mount Payment Element ────────────────────────
async function initStripe() {
	ensureStripeElements();

	if (!window.CART_AMOUNT_CENTS || window.CART_AMOUNT_CENTS < 50) {
		showError('Order total is missing. Please refresh and try again.');
		return;
	}

	const btn = document.getElementById('btn-pay-stripe');
	if (btn) btn.disabled = true;

	const fd = new FormData();
	fd.append('amount',   window.CART_AMOUNT_CENTS);
	fd.append('currency', window.CART_CURRENCY || 'usd');
	fd.append('order_id', window.ORDER_ID || 0);

	const res  = await fetch('/?route=stripe/intent', { method: 'POST', body: fd });
	const data = await res.json();

	if (!data.ok) {
		showError(data.message || 'Could not initialise payment.');
		if (btn) btn.disabled = false;
		return;
	}

	elements = stripe.elements({ clientSecret: data.client_secret });
	paymentElement = elements.create('payment');
	paymentElement.mount('#stripe-payment-element');

	// Swap buttons: hide Place Order, show Pay Now
	const placeBtn = document.getElementById('btn-place-order');
	const payBtn   = document.getElementById('btn-pay-stripe');
	if (placeBtn) placeBtn.style.display = 'none';
	if (payBtn)   payBtn.style.display   = '';
	if (btn) btn.disabled = false;
}

// ── Submit payment ─────────────────────────────────────────────────────────
async function submitPayment() {
	if (!elements) return;

	const btn = document.getElementById('btn-pay-stripe');
	if (btn) btn.disabled = true;

	const { error } = await stripe.confirmPayment({
		elements,
		confirmParams: {
			return_url: new URL(window.THANKYOU_URL, window.location.href).href,
		},
	});

	// Only reaches here on error — success redirects automatically
	if (error) {
		showError(error.message);
		if (btn) btn.disabled = false;
	}
}

function showError(msg) {
	const el = document.getElementById('stripe-error');
	if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ── Expose initStripe for checkout.js to call after order is created ────
window.initStripe = initStripe;

})();
