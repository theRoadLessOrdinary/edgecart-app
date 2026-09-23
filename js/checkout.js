'use strict';

const val = id => document.getElementById(id)?.value?.trim() || '';

let selectedRate = null;
let appliedDiscount = null;  // { code, discount_amount, discount_percent }
let calculatedTax = 0;
let taxActive     = null; // null = not yet checked, true = plugin present, false = no tax plugin

// ── Cart persistence to localStorage ───────────────────────────────────────
const CART_STORAGE_KEY = 'trlo_cart_backup';
function saveCartToStorage() {
	try {
		const cart = Array.from(document.querySelectorAll('input[name="qty"]')).map(inp => {
			const row = inp.closest('[data-product-id]');
			return { id: row?.dataset.productId, qty: parseInt(inp.value) || 0 };
		}).filter(item => item.qty > 0);
		if (cart.length > 0) {
			localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ timestamp: Date.now(), items: cart }));
		}
	} catch (e) {
		// localStorage may be disabled or full
	}
}
function restoreCartFromStorage() {
	try {
		const stored = localStorage.getItem(CART_STORAGE_KEY);
		if (stored) {
			const data = JSON.parse(stored);
			if (data.items && data.items.length > 0) {
				console.log('Cart restored from storage:', data.items);
				// Cart items should be restored server-side if session expired
			}
		}
	} catch (e) {
		// Invalid stored data
	}
}
// Save cart every time quantity changes
document.addEventListener('change', function(e) {
	if (e.target.matches('input[name="qty"]')) {
		saveCartToStorage();
	}
}, true);

// ── Password strength indicator ────────────────────────────────────────────
const passwordInput = document.getElementById('co-password');
if (passwordInput) {
	const strengthDiv = document.getElementById('password-strength');
	const strengthFill = document.getElementById('password-strength-fill');
	const strengthText = document.getElementById('password-strength-text');

	function calculateStrength(pwd) {
		let strength = 0;
		if (pwd.length >= 8) strength++;
		if (pwd.length >= 12) strength++;
		if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
		if (/\d/.test(pwd)) strength++;
		if (/[^a-zA-Z\d]/.test(pwd)) strength++;
		return Math.min(3, Math.ceil(strength / 2));
	}

	passwordInput.addEventListener('input', function() {
		const pwd = this.value;
		if (!pwd) {
			strengthDiv.style.display = 'none';
			return;
		}
		strengthDiv.style.display = 'block';
		const strength = calculateStrength(pwd);
		strengthFill.className = 'password-strength-fill';
		if (strength === 0 || pwd.length < 8) {
			strengthFill.classList.add('weak');
			strengthText.textContent = 'Too short';
		} else if (strength === 1) {
			strengthFill.classList.add('weak');
			strengthText.textContent = 'Weak';
		} else if (strength === 2) {
			strengthFill.classList.add('fair');
			strengthText.textContent = 'Fair';
		} else {
			strengthFill.classList.add('good');
			strengthText.textContent = 'Strong';
		}
	});
}

// ── Discount code ──────────────────────────────────────────────────────────
// The Discount Code section only renders when the discounts plugin is active
// (not the case on store.edgecart.io) — this was previously unguarded and
// threw at page load on any site without it, halting every event listener
// registration below it in the whole file, including Place Order.
if (document.getElementById('btn-apply-discount')) {
document.getElementById('btn-apply-discount').addEventListener('click', async function () {
	const code = document.getElementById('co-discount-code').value.trim().toUpperCase();
	const messageEl = document.getElementById('discount-message');

	if (!code) {
		messageEl.style.display = 'none';
		appliedDiscount = null;
		updateOrderTotal();
		return;
	}

	const fd = new FormData();
	fd.append('action',   'validate_code');
	fd.append('csrf_token', document.querySelector('input[name="csrf_token"]').value);
	fd.append('code',     code);
	fd.append('subtotal', CART_SUBTOTAL);

	try {
		const res = await fetch('/?route=discounts/ajax', { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) {
			messageEl.style.color = 'var(--nc-danger)';
			messageEl.textContent = data.message || 'Invalid discount code.';
			messageEl.style.display = '';
			appliedDiscount = null;
		} else {
			appliedDiscount = data;
			messageEl.style.color = 'var(--nc-success)';
			messageEl.textContent = 'Discount applied!';
			messageEl.style.display = '';
		}
	} catch (err) {
		messageEl.style.color = 'var(--nc-danger)';
		messageEl.textContent = 'Error validating code.';
		messageEl.style.display = '';
		appliedDiscount = null;
	}

	updateOrderTotal();
});
}

// ── Get shipping rates ─────────────────────────────────────────────────────
// This storefront is digital-only — no "Get Shipping Rates" button exists in
// the DOM, so this whole block is inert. Guarded rather than deleted in case
// a future physical-goods checkout variant re-adds the button.
if (document.getElementById('btn-get-rates')) {
debounceBtn(document.getElementById('btn-get-rates'), async function () {
	if (!val('co-email') || !val('co-first') || !val('co-addr1') || !val('co-zip')) {
		SimpleNotification.error({ text: 'Please fill in your contact and address details first.' });
		return;
	}

	const btn = document.getElementById('btn-get-rates');
	btn.classList.add('loading');
	btn.disabled = true;

	const fd = new FormData();
	fd.append('action',     'shipping_rates');
	fd.append('csrf_token', document.querySelector('input[name="csrf_token"]').value);
	fd.append('email',      val('co-email'));
	fd.append('first_name', val('co-first'));
	fd.append('last_name',  val('co-last'));
	fd.append('address1',   val('co-addr1'));
	fd.append('address2',   val('co-addr2'));
	fd.append('city',       val('co-city'));
	fd.append('state',      val('co-state'));
	fd.append('zip',        val('co-zip'));
	fd.append('country',    val('co-country'));

	try {
		const res  = await fetch('/?route=checkout', { method: 'POST', body: fd });
		const data = await res.json();
		if (!data.ok) { SimpleNotification.error({ text: data.message || 'Could not fetch rates.' }); return; }

		renderRates(data.rates);

		// Reset to show rates (hide summary/payment if this is a re-fetch)
		const wrap = document.getElementById('shipping-rates-wrap');
		const summary = document.getElementById('shipping-selected-summary');
		const payment = document.getElementById('section-payment');
		const useBtn = document.getElementById('btn-use-rate');
		summary.style.display = 'none';
		payment.style.display = 'none';

		// Hide Get Rates button (not the field, just the button)
		btn.style.display = 'none';

		// Show wrap and animate height from 0 to content height
		wrap.style.display = '';
		wrap.classList.remove('open');
		wrap.style.height = '0';

		// Force reflow and then animate to content height
		void wrap.offsetHeight;
		const contentHeight = wrap.scrollHeight;
		wrap.style.height = contentHeight + 'px';

		// Ensure Use button is visible (in case this is a re-fetch)
		if (useBtn) useBtn.style.display = '';

		// Once animation completes, set to auto for flexibility
		setTimeout(function() {
			wrap.style.height = 'auto';
			wrap.classList.add('open');
		}, 1000);
	} finally {
		btn.classList.remove('loading');
		btn.disabled = false;
	}
});
}

// ── Use selected shipping method ───────────────────────────────────────────
if (document.getElementById('btn-use-rate')) {
document.getElementById('btn-use-rate').addEventListener('click', function () {
	if (!selectedRate) return;
	const label = (selectedRate.carrier ? selectedRate.carrier + ' — ' : '') + selectedRate.service;
	const price = selectedRate.rate > 0 ? ' — ' + (window.CART_CURRENCY_SYMBOL || '$') + selectedRate.rate.toFixed(2) : ' — Free';
	document.getElementById('shipping-selected-label').textContent = label + price;

	// Animate rates wrap height closing
	const btn = this;
	const wrap = document.getElementById('shipping-rates-wrap');

	btn.style.transition = 'opacity .2s';
	btn.style.opacity = '0';

	// Get current height and animate to 0
	wrap.style.height = wrap.scrollHeight + 'px';
	void wrap.offsetHeight; // reflow
	wrap.style.height = '0';
	wrap.classList.remove('open');

	setTimeout(function () {
		wrap.style.display = 'none';
		btn.style.display = 'none';
		const summary = document.getElementById('shipping-selected-summary');
		summary.style.display = '';
		summary.classList.remove('co-section-in');
		void summary.offsetWidth;
		summary.classList.add('co-section-in');
		document.getElementById('section-payment').style.display = '';
		document.getElementById('section-payment').classList.remove('co-section-in');
		void document.getElementById('section-payment').offsetWidth;
		document.getElementById('section-payment').classList.add('co-section-in');
	}, 1000);
});
}

// ── Change shipping method ─────────────────────────────────────────────────
if (document.getElementById('btn-change-rate')) {
document.getElementById('btn-change-rate').addEventListener('click', function () {
	document.getElementById('shipping-selected-summary').style.display = 'none';
	document.getElementById('section-payment').style.display           = 'none';
	const wrap = document.getElementById('shipping-rates-wrap');
	const useBtn = document.getElementById('btn-use-rate');

	wrap.style.display = '';
	wrap.classList.remove('open');
	wrap.style.height = '0';

	// Reset button visibility and opacity
	if (useBtn) {
		useBtn.style.display = '';
		useBtn.style.opacity = '1';
		useBtn.style.transition = '';
	}

	// Force reflow and then animate to content height
	void wrap.offsetHeight;
	const contentHeight = wrap.scrollHeight;
	wrap.style.height = contentHeight + 'px';

	// Once animation completes, set to auto for flexibility
	setTimeout(function() {
		wrap.style.height = 'auto';
		wrap.classList.add('open');
	}, 1000);
});
}

// --------------------------------------------------------------------------------
function renderRates(rates) {
	const list = document.getElementById('shipping-rates-list');
	const wrap = document.getElementById('shipping-rates-wrap');
	const btn = document.getElementById('btn-get-rates');

	list.innerHTML = '';

	// Check if rates are empty
	if (!rates || rates.length === 0) {
		const error = document.createElement('div');
		error.style.cssText = 'padding: 1rem; background: #fee; color: #c33; border: 1px solid #fcc; border-radius: 4px; text-align: center;';
		error.innerHTML = '<strong>Unable to ship to this address</strong><br>We cannot calculate shipping for the address you entered. Please verify your address and try again, or contact us for assistance.';
		list.appendChild(error);

		// Show wrap and button, allow retry
		wrap.style.display = '';
		btn.style.display = '';
		btn.classList.remove('loading');
		btn.disabled = false;

		// Clear selectedRate to prevent checkout
		selectedRate = null;
		updateOrderSummary();
		return;
	}

	const PRICE_LIMIT = 15;
	// If every available rate is "expensive", hiding them all behind a toggle
	// leaves the customer with zero visibly-selectable shipping options on
	// page load — a checkout dead end unless they notice and click a small
	// "show more" link. Only collapse expensive rates when there's at least
	// one cheaper option already visible to fall back to.
	const allExpensive = rates.every(r => (r.rate || 0) >= PRICE_LIMIT);
	const hasExpensive = !allExpensive && rates.some(r => (r.rate || 0) >= PRICE_LIMIT);

	// Create single table with all rates
	const table = document.createElement('table');
	table.className = 'shipping-rates-table';

	// Create table header
	const thead = document.createElement('thead');
	thead.innerHTML = `
	<tr>
		<th>&nbsp;</th>
		<th>Name</th>
		<th title="Estimated time of arrival">ETA</th>
		<th>Price</th>
	</tr>`;
	table.appendChild(thead);

	// Create table body with all rates
	const tbody = document.createElement('tbody');
	let cheapestRate = null;
	let cheapestPrice = Infinity;

	rates.forEach(function (r, i) {
		const price = r.rate || 0;
		const isExpensive = price >= PRICE_LIMIT && !allExpensive;
		const tr = createRateRow(r, i);

		if (isExpensive) {
			tr.style.display = 'none';
			tr.classList.add('expensive-rate');
		}

		// Track cheapest rate overall
		if (price < cheapestPrice) {
			cheapestPrice = price;
			cheapestRate = r;
		}

		tbody.appendChild(tr);
	});

	table.appendChild(tbody);
	list.appendChild(table);

	// Add toggle for expensive options if they exist
	if (hasExpensive) {
		const toggle = document.createElement('div');
		toggle.style.cssText = 'padding: 1rem 0; border-top: 1px solid #e5e7eb; text-align: center;';
		toggle.id = 'expensive-toggle';

		const link = document.createElement('a');
		link.href = '#';
		link.textContent = 'Show other, more expensive options…';
		link.style.cssText = 'color: var(--nc-link); text-decoration: underline; cursor: pointer;';

		toggle.appendChild(link);
		list.appendChild(toggle);

		// Toggle handler
		link.addEventListener('click', function(e) {
			e.preventDefault();
			const wrap = document.getElementById('shipping-rates-wrap');
			const expensiveRows = tbody.querySelectorAll('.expensive-rate');
			const showing = expensiveRows[0].style.display !== 'none';

			// Get current height (handle 'auto' case)
			const currentHeight = wrap.style.height === 'auto' ? wrap.scrollHeight : parseFloat(wrap.style.height);
			wrap.style.height = currentHeight + 'px';

			// Force reflow
			void wrap.offsetHeight;

			// Toggle rows visibility
			expensiveRows.forEach(row => {
				row.style.display = showing ? 'none' : '';
			});

			link.textContent = showing ? 'Show other, more expensive options…' : 'Hide more expensive options…';

			// Measure new height after toggle
			void wrap.offsetHeight; // reflow again
			const newHeight = wrap.scrollHeight;
			wrap.style.height = newHeight + 'px';

			// Reset to auto after animation completes
			setTimeout(function() {
				wrap.style.height = 'auto';
			}, 1000);
		});
	}

	// Select cheapest rate by default
	if (cheapestRate) {
		// Find and check the radio button for the cheapest rate
		const cheapestIndex = rates.indexOf(cheapestRate);
		const radios = document.querySelectorAll('input[name="shipping_rate"]');
		radios.forEach(radio => {
			if (parseInt(radio.value) === cheapestIndex) {
				radio.checked = true;
			}
		});
		selectRate(cheapestRate);
		document.getElementById('btn-use-rate').style.display = 'block';
	}
}

function createRateRow(r, index) {
	const tr = document.createElement('tr');

	// Radio button cell
	const tdRadio = document.createElement('td');
	const radio = document.createElement('input');
	radio.type = 'radio';
	radio.name = 'shipping_rate';
	radio.value = index;
	radio.addEventListener('change', function () {
		selectRate(r);
	});
	tdRadio.appendChild(radio);
	tr.appendChild(tdRadio);

	// Name cell
	const tdName = document.createElement('td');
	tdName.innerHTML = esc(r.carrier ? r.carrier + ' — ' + r.service : r.service);
	tr.appendChild(tdName);

	// Estimated days cell
	const tdDays = document.createElement('td');
	tdDays.textContent = r.days ? 'Est. ' + r.days + ' day(s)' : '';
	tr.appendChild(tdDays);

	// Price cell
	const tdPrice = document.createElement('td');
	tdPrice.textContent = r.rate > 0 ? (window.CART_CURRENCY_SYMBOL || '$') + r.rate.toFixed(2) : 'Free';
	tr.appendChild(tdPrice);

	return tr;
}

async function selectRate(r) {
	selectedRate = r;
	await calculateTax();
	updateOrderTotal();
}

async function calculateTax() {
	const state = val('co-state');
	const country = val('co-country') || 'US';
	const shipping = selectedRate ? (selectedRate.rate || 0) : 0;

	if (!state) {
		calculatedTax = 0;
		return;
	}

	try {
		const fd = new FormData();
		fd.append('action', 'tax_calculation');
		fd.append('csrf_token', document.querySelector('input[name="csrf_token"]').value);
		fd.append('state', state);
		fd.append('country', country);
		fd.append('shipping', shipping);

		const res = await fetch('/?route=checkout', { method: 'POST', body: fd });
		const data = await res.json();
		if (data.ok) {
			taxActive     = data.tax_active ?? true;
			calculatedTax = data.tax || 0;
		} else {
			calculatedTax = 0;
		}
	} catch (err) {
		console.error('Tax calculation error:', err);
		calculatedTax = 0;
	}
}

function updateOrderTotal() {
	const shipping = selectedRate ? (selectedRate.rate || 0) : 0;
	let discount = appliedDiscount ? (appliedDiscount.discount_amount || 0) : 0;
	const total = Math.max(0, CART_SUBTOTAL + shipping + calculatedTax - discount);
	CART_AMOUNT_CENTS = Math.round(total * 100);

	const shippingRow   = document.getElementById('summary-shipping');
	const shippingPrice = document.getElementById('summary-shipping-price');
	const taxRow        = document.getElementById('summary-tax');
	const taxLabel      = document.getElementById('summary-tax-label');
	const taxPrice      = document.getElementById('summary-tax-price');
	const discountRow   = document.getElementById('summary-discount');
	const discountPrice = document.getElementById('summary-discount-price');
	const totalEl       = document.getElementById('summary-total');

	// Only show shipping row if a shipping method is selected
	if (shippingRow) {
		if (selectedRate) {
			shippingRow.style.display = '';
			if (shippingPrice) shippingPrice.textContent = shipping > 0 ? (window.CART_CURRENCY_SYMBOL || '$') + shipping.toFixed(2) : 'Free';
		} else {
			shippingRow.style.display = 'none';
		}
	}

	if (taxRow) {
		if (taxActive === false) {
			taxRow.style.display = '';
			if (taxLabel) taxLabel.textContent = 'Tax';
			if (taxPrice) taxPrice.textContent = 'Not included';
		} else if (calculatedTax > 0) {
			taxRow.style.display = '';
			if (taxLabel) {
				const taxRate = CART_SUBTOTAL > 0 ? ((calculatedTax / CART_SUBTOTAL) * 100).toFixed(1) : '0.0';
				taxLabel.textContent = 'Sales Tax (' + taxRate + '%)';
			}
			if (taxPrice) taxPrice.textContent = (window.CART_CURRENCY_SYMBOL || '$') + calculatedTax.toFixed(2);
		} else {
			taxRow.style.display = 'none';
		}
	}

	if (discountRow && appliedDiscount) {
		discountRow.style.display = '';
		if (discountPrice) discountPrice.textContent = '-' + (window.CART_CURRENCY_SYMBOL || '$') + discount.toFixed(2);
	} else if (discountRow) {
		discountRow.style.display = 'none';
	}

	if (totalEl) totalEl.textContent = (window.CART_CURRENCY_SYMBOL || '$') + total.toFixed(2);
}

// ── Place order ────────────────────────────────────────────────────────────
debounceBtn(document.getElementById('btn-place-order'), async function () {
	if (document.getElementById('section-shipping') && !selectedRate) {
		SimpleNotification.error({ text: 'Please select a shipping method.' });
		return;
	}

	// Validate plugin-injected required fields (e.g. store domain)
	const missingField = Array.from(document.querySelectorAll('[data-checkout-field][required]'))
		.find(function(el) { return !el.value.trim(); });
	if (missingField) {
		missingField.focus();
		SimpleNotification.error({ text: missingField.dataset.errorMsg || 'Please complete all required fields.' });
		return;
	}

	// A hidden input carries the method when only one is available (never
	// matches :checked, since that only applies to radios/checkboxes) — check
	// both rather than guessing a fallback id that may not be the real one.
	const pmField = document.querySelector('input[name=payment_method]:checked, input[name=payment_method][type=hidden]');
	if (!pmField) {
		SimpleNotification.error({ text: 'No payment method is available. Please contact the store.' });
		return;
	}
	const pmSelected = pmField.value;

	const fd = new FormData();
	fd.append('action',       'place_order');
	fd.append('csrf_token',   document.querySelector('input[name="csrf_token"]').value);
	fd.append('payment_method', pmSelected);
	fd.append('email',        val('co-email'));
	fd.append('phone',        val('co-phone'));
	fd.append('first_name',   val('co-first'));
	fd.append('last_name',    val('co-last'));
	fd.append('address1',     val('co-addr1'));
	fd.append('address2',     val('co-addr2'));
	fd.append('city',         val('co-city'));
	fd.append('state',        val('co-state'));
	fd.append('zip',          val('co-zip'));
	fd.append('country',      val('co-country'));
	fd.append('ship_rate_id', selectedRate?.id || '');
	fd.append('ship_price',   selectedRate?.rate || 0);
	fd.append('ship_label',   selectedRate?.service || '');
	fd.append('shippo_token', selectedRate?.shippo_token || '');
	fd.append('tax',          calculatedTax);
	fd.append('password',     document.getElementById('co-password')?.value || '');
	if (appliedDiscount) {
		fd.append('discount_code', appliedDiscount.code || '');
		fd.append('discount_amount', appliedDiscount.discount_amount || 0);
	}

	// Plugin-injected fields (e.g. store_domain from ec-fulfillment)
	document.querySelectorAll('[data-checkout-field]').forEach(function(el) {
		fd.append(el.dataset.checkoutField, el.value.trim() || '');
	});

	const res  = await fetch('/?route=checkout', { method: 'POST', body: fd });
	const data = await res.json();
	if (!data.ok) { SimpleNotification.error({ text: data.message || 'Could not place order.' }); return; }

	ORDER_ID           = data.order_id;
	CART_AMOUNT_CENTS  = data.total_cents;
	THANKYOU_URL       = data.thankyou_url;
	console.log('[checkout] order_id=' + data.order_id + ' total_cents=' + data.total_cents + ' CART_SUBTOTAL=' + CART_SUBTOTAL);

	// Dispatch to payment plugin if it exposed an init function (e.g. initStripe, initPaypal).
	// "check" (and the legacy "cod" fallback) intentionally have none — they fall through
	// to the thank-you page directly, since there's no payment SDK step for either.
	const initFn = window['init' + pmSelected.charAt(0).toUpperCase() + pmSelected.slice(1)];
	if (typeof initFn === 'function') {
		initFn();
	} else {
		window.location.href = THANKYOU_URL;
	}
});

// ── Payment UI reset ───────────────────────────────────────────────────────
// Removes any payment-plugin-injected elements and restores the Place Order button.
// Called when the user switches payment method radios, or when a plugin's cancel/error fires.
function resetPaymentUI() {
	['stripe-payment-element', 'stripe-error', 'btn-pay-stripe', 'paypal-button-container'].forEach(function(id) {
		const el = document.getElementById(id);
		if (el) el.remove();
	});
	const placeBtn = document.getElementById('btn-place-order');
	if (placeBtn) placeBtn.style.display = '';
	ORDER_ID = 0;
}
window.resetPaymentUI = resetPaymentUI;

// Reset whenever the user picks a different payment method
document.querySelectorAll('input[name=payment_method]').forEach(function(radio) {
	radio.addEventListener('change', resetPaymentUI);
});

function esc(str) {
	return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Convert address fields to uppercase
['co-first', 'co-last', 'co-addr1', 'co-addr2', 'co-city', 'co-state', 'co-zip'].forEach(function(id) {
	var el = document.getElementById(id);
	if (el) {
		el.addEventListener('input', function() {
			this.value = this.value.toUpperCase();
		});
	}
});
