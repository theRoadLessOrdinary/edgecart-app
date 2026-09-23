'use strict';

// ── Gallery & Lightbox ─────────────────────────────────────────────────────
const mainImg   = document.getElementById('main-image');
const gallery   = document.getElementById('gallery-main');
const thumbs    = document.querySelectorAll('.product-thumb');
const lightbox  = document.getElementById('product-lightbox');
const lbImg     = document.getElementById('lightbox-img');
const lbClose   = document.getElementById('lightbox-close');
const lbPrev    = document.getElementById('lightbox-prev');
const lbNext    = document.getElementById('lightbox-next');

// Normalize any path to an absolute URL so indexOf comparisons match mainImg.src
function toAbsUrl(src) {
	if (!src) return '';
	if (src.indexOf('//') >= 0) return src;
	return location.origin + (src.charAt(0) === '/' ? src : '/' + src);
}

// Collect full-size src list from thumbnails (or main image if no thumbs)
var imageSrcs = [];
if (thumbs.length) {
	thumbs.forEach(function(btn) { imageSrcs.push(toAbsUrl(btn.dataset.src)); });
} else if (mainImg) {
	imageSrcs = [mainImg.src];
}

// Append option images from the first option set that has any
(function () {
	var added = false;
	document.querySelectorAll('.product-option').forEach(function (optDiv) {
		if (added) return;
		var imgs = [];
		optDiv.querySelectorAll('[data-image]').forEach(function (el) {
			var src = toAbsUrl((el.dataset.image || '').trim());
			if (src && imageSrcs.indexOf(src) < 0) imgs.push(src);
		});
		if (imgs.length) { imageSrcs = imageSrcs.concat(imgs); added = true; }
	});
}());

var lbIndex = 0;

function openLightbox(idx) {
	lbIndex = idx;
	lbImg.src = imageSrcs[lbIndex];
	lightbox.classList.add('open');
	document.body.style.overflow = 'hidden';
	updateLbNav();
	lbClose.focus();
}
function closeLightbox() {
	lightbox.classList.remove('open');
	document.body.style.overflow = '';
	lbImg.src = '';
	if (gallery) gallery.focus();
}
function updateLbNav() {
	if (lbPrev) lbPrev.disabled = lbIndex === 0;
	if (lbNext) lbNext.disabled = lbIndex === imageSrcs.length - 1;
}

// Thumbnail swap + track active index
thumbs.forEach(function(btn, i) {
	btn.addEventListener('click', function() {
		if (mainImg) { mainImg.style.opacity = '.5'; mainImg.src = this.dataset.src; mainImg.onload = function() { mainImg.style.opacity = '1'; }; }
		thumbs.forEach(t => t.classList.remove('active'));
		this.classList.add('active');
		lbIndex = i;
		// Option-value thumb: silently select the corresponding option value
		if (!useOptionImages && this.dataset.poId && this.dataset.povId) {
			var poId  = this.dataset.poId;
			var povId = this.dataset.povId;
			var sel = document.querySelector('select[data-po-id="' + poId + '"]');
			if (sel) {
				sel.value = povId;
				sel.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				var radio = document.querySelector('input[type=radio][data-po-id="' + poId + '"][value="' + povId + '"]');
				if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
			}
		}
	});
});

// Open lightbox on main image click
if (gallery) {
	gallery.addEventListener('click', function() {
		var currentSrc = mainImg ? mainImg.src : (imageSrcs[0] || '');
		if (!currentSrc) return;
		var idx = imageSrcs.indexOf(currentSrc);
		if (idx >= 0) {
			openLightbox(idx);
		} else {
			// Option image not in gallery array — show standalone
			lbImg.src = currentSrc;
			lbIndex = 0;
			lightbox.classList.add('open');
			document.body.style.overflow = 'hidden';
			if (lbPrev) lbPrev.disabled = true;
			if (lbNext) lbNext.disabled = true;
			lbClose.focus();
		}
	});
	gallery.addEventListener('keydown', function(e) {
		if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gallery.click(); }
	});
}

// Lightbox controls
if (lbClose)   lbClose.addEventListener('click', closeLightbox);
if (lightbox)  lightbox.addEventListener('click', function(e) { if (e.target === lightbox) closeLightbox(); });
if (lbPrev)    lbPrev.addEventListener('click', function(e) { e.stopPropagation(); if (lbIndex > 0) { lbIndex--; lbImg.src = imageSrcs[lbIndex]; updateLbNav(); } });
if (lbNext)    lbNext.addEventListener('click', function(e) { e.stopPropagation(); if (lbIndex < imageSrcs.length-1) { lbIndex++; lbImg.src = imageSrcs[lbIndex]; updateLbNav(); } });
document.addEventListener('keydown', function(e) {
	if (!lightbox || !lightbox.classList.contains('open')) return;
	if (e.key === 'Escape')     closeLightbox();
	if (e.key === 'ArrowLeft')  lbPrev?.click();
	if (e.key === 'ArrowRight') lbNext?.click();
});

// ── Option image swap ──────────────────────────────────────────────────────
var initialMainSrc    = mainImg ? mainImg.src : '';
var useOptionImages   = window._ncProd && _ncProd.useOptionImages;
var optImagesPOId     = window._ncProd ? String(_ncProd.optImagesPOId) : '0';

function getOptionImage() {
	var img = '';
	// select
	document.querySelectorAll('#product-options select[data-po-id]').forEach(function (sel) {
		if (!sel.value) return;
		var opt = sel.querySelector('option[value="' + CSS.escape(sel.value) + '"]');
		if (opt && opt.dataset.image) img = opt.dataset.image;
	});
	// radio
	document.querySelectorAll('#product-options input[type=radio][data-po-id]:checked').forEach(function (r) {
		if (r.dataset.image) img = r.dataset.image;
	});
	// checkbox (last checked wins)
	document.querySelectorAll('#product-options input[type=checkbox][data-po-id]:checked').forEach(function (c) {
		if (c.dataset.image) img = c.dataset.image;
	});
	return img;
}

function swapMainImage(src) {
	if (!mainImg) return;
	mainImg.style.opacity = '.5';
	mainImg.src = src || initialMainSrc;
	mainImg.onload = function () { mainImg.style.opacity = '1'; };
}

function syncOptionThumbs() {
	var currentImg = getOptionImage();
	if (!currentImg) return;
	var absImg = toAbsUrl(currentImg);
	thumbs.forEach(function(btn) {
		if (!btn.dataset.poId) return;
		if (toAbsUrl(btn.dataset.src) === absImg) {
			thumbs.forEach(function(t) { t.classList.remove('active'); });
			btn.classList.add('active');
		}
	});
}

function applyModifier(base, adj, prefix, mod) {
	mod = parseFloat(mod) || 0;
	if (prefix === '=') return { base: mod, adj: 0 };
	else if (prefix === '-') return { base: base, adj: adj - mod };
	else return { base: base, adj: adj + mod };
}

function getDisplayPrice() {
	var base = _ncProd.basePrice;
	var adj  = 0;
	document.querySelectorAll('#product-options .product-option').forEach(function (optDiv) {
		var sel = optDiv.querySelector('select[data-po-id]');
		if (sel && sel.value) {
			var opt = sel.querySelector('option[value="' + CSS.escape(sel.value) + '"]');
			if (opt && opt.dataset.priceMod) {
				var result = applyModifier(base, adj, opt.dataset.pricePrefix, opt.dataset.priceMod);
				base = result.base;
				adj = result.adj;
			}
		}
		var radio = optDiv.querySelector('input[type=radio][data-po-id]:checked');
		if (radio && radio.dataset.priceMod) {
			var result = applyModifier(base, adj, radio.dataset.pricePrefix, radio.dataset.priceMod);
			base = result.base;
			adj = result.adj;
		}
		optDiv.querySelectorAll('input[type=checkbox][data-po-id]:checked').forEach(function (cb) {
			if (cb.dataset.priceMod) {
				var result = applyModifier(base, adj, cb.dataset.pricePrefix, cb.dataset.priceMod);
				base = result.base;
				adj = result.adj;
			}
		});
	});
	return base + adj;
}

function getDisplayWeight() {
	var base = _ncProd.baseWeight || 0;
	var adj  = 0;
	document.querySelectorAll('#product-options .product-option').forEach(function (optDiv) {
		var sel = optDiv.querySelector('select[data-po-id]');
		if (sel && sel.value) {
			var opt = sel.querySelector('option[value="' + CSS.escape(sel.value) + '"]');
			if (opt && opt.dataset.weightMod) {
				var result = applyModifier(base, adj, opt.dataset.pricePrefix, opt.dataset.weightMod);
				base = result.base;
				adj = result.adj;
			}
		}
		var radio = optDiv.querySelector('input[type=radio][data-po-id]:checked');
		if (radio && radio.dataset.weightMod) {
			var result = applyModifier(base, adj, radio.dataset.pricePrefix, radio.dataset.weightMod);
			base = result.base;
			adj = result.adj;
		}
		optDiv.querySelectorAll('input[type=checkbox][data-po-id]:checked').forEach(function (cb) {
			if (cb.dataset.weightMod) {
				var result = applyModifier(base, adj, cb.dataset.pricePrefix, cb.dataset.weightMod);
				base = result.base;
				adj = result.adj;
			}
		});
	});
	return base + adj;
}

function updatePriceDisplay() {
	var el = document.querySelector('.product-price-block .product-price');
	if (!el) return;
	el.textContent = (_ncProd.currency || '') + getDisplayPrice().toFixed(2);
}

function onOptionChange() {
	var img = getOptionImage();
	if (img) swapMainImage(img);
	else swapMainImage(initialMainSrc);
	if (useOptionImages) syncThumbToOption();
	else syncOptionThumbs();
	updatePriceDisplay();
}

document.querySelectorAll('#product-options select[data-po-id]').forEach(function (s) {
	s.addEventListener('change', onOptionChange);
});
document.querySelectorAll('#product-options input[type=radio][data-po-id], #product-options input[type=checkbox][data-po-id]').forEach(function (i) {
	i.addEventListener('change', onOptionChange);
});
document.addEventListener('ios-toggle', function (e) {
	var src = e.detail && e.detail.source ? e.detail.source : e.target;
	if (src.dataset && src.dataset.poId && src.closest && src.closest('#product-options')) {
		onOptionChange();
	}
});

// Reflect any pre-selected default option value's price on initial load.
updatePriceDisplay();

// ── Thumbnail ↔ option sync (use_option_images mode only) ─────────────────
function syncThumbToOption() {
	var activeVal = '';
	var sel = document.querySelector('select[data-po-id="' + optImagesPOId + '"]');
	if (sel) {
		activeVal = sel.value;
	} else {
		var r = document.querySelector('input[type=radio][data-po-id="' + optImagesPOId + '"]:checked');
		if (r) activeVal = r.value;
	}
	thumbs.forEach(function (btn) {
		btn.classList.toggle('active', String(btn.dataset.povId) === activeVal);
	});
}

if (useOptionImages) {
	thumbs.forEach(function (btn) {
		btn.addEventListener('click', function () {
			var povId = this.dataset.povId;
			if (!povId) return;
			var sel = document.querySelector('select[data-po-id="' + optImagesPOId + '"]');
			if (sel) {
				sel.value = povId;
				sel.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				var radio = document.querySelector('input[type=radio][data-po-id="' + optImagesPOId + '"][value="' + povId + '"]');
				if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
			}
		});
	});
}

// ── Add to cart ────────────────────────────────────────────────────────────
const addBtn = document.getElementById('btn-add-to-cart');
const msgEl  = document.getElementById('add-to-cart-msg');

if (addBtn) {
	debounceBtn(addBtn, async function () {
		const productId = this.dataset.productId;
		const qty       = parseInt(document.getElementById('qty')?.value || '1', 10);

		// Collect option selections
		const options = {};
		document.querySelectorAll('#product-options [data-po-id]').forEach(function (el) {
			const poId = el.dataset.poId;
			if (!poId) return;
			if (el.tagName === 'SELECT' && el.value) {
				options[poId] = el.value;
			} else if (el.type === 'radio' && el.checked) {
				options[poId] = el.value;
			} else if (el.tagName === 'IOS-TOGGLE' && el.checked) {
				options[poId] = el.value;
			}
		});

		// Validate required options
		let valid = true;
		document.querySelectorAll('.product-option').forEach(function (div) {
			const poId    = div.dataset.poId;
			const label   = div.querySelector('label');
			const isReq   = div.querySelector('[required]') !== null;
			const hasSel  = div.querySelector('select')?.value ||
			                div.querySelector('input[type=radio]:checked') ||
			                div.querySelector('input[type=text]')?.value;
			if (isReq && !hasSel && !options[poId]) {
				div.querySelector('select,input,textarea')?.focus();
				valid = false;
			}
		});
		if (!valid) {
			msgEl.textContent = 'Please select all required options.';
			msgEl.style.color = '#dc2626';
			return;
		}

		const fd = new FormData();
		fd.append('action',     'add');
		fd.append('product_id', productId);
		fd.append('qty',        qty);
		for (const [k, v] of Object.entries(options)) {
			fd.append('options[' + k + ']', v);
		}

		// Instant feedback the moment a valid click is accepted — the button
		// itself is already disabled by debounceBtn, this just makes that
		// state visually unambiguous rather than relying on dimming alone.
		// Targets the inner .atc-label span specifically, not the button's
		// own textContent — the success path below appends a sibling
		// .atc-check overlay span, which a textContent swap on the button
		// itself would silently delete.
		const labelEl = addBtn.querySelector('.atc-label');
		const originalLabel = labelEl.textContent;
		labelEl.textContent = 'Adding…';

		try {
			const res  = await fetch('/?route=cart', { method: 'POST', body: fd });
			const data = await res.json();

			if (data.ok) {
				msgEl.textContent = '';
				if (typeof window.updateCartLabel === 'function') {
					window.updateCartLabel(data.cart_count, data.cart_subtotal);
				}
				// Green checkmark overlay: fade in, hold 1s, fade out
				const check = document.createElement('span');
				check.className = 'atc-check';
				check.setAttribute('aria-hidden', 'true');
				check.textContent = '✓';
				addBtn.appendChild(check);
				requestAnimationFrame(() => requestAnimationFrame(() => { check.style.opacity = '1'; }));
				setTimeout(() => {
					check.style.opacity = '0';
					check.addEventListener('transitionend', () => check.remove(), { once: true });
				}, 1200);
			} else {
				msgEl.textContent = data.message || 'Could not add to cart.';
				msgEl.style.color = '#dc2626';
			}
		} finally {
			labelEl.textContent = originalLabel;
		}
	});
}

// ── Page blocks: slideshows ────────────────────────────────────────────────
document.querySelectorAll('.slideshow').forEach(function(ss) {
	const slides = ss.querySelectorAll('.slideshow-slide');
	const dots   = ss.querySelectorAll('.slideshow-dot');
	const prev   = ss.querySelector('.slideshow-prev');
	const next   = ss.querySelector('.slideshow-next');
	const interval = parseInt(ss.dataset.interval) || 5000;
	ss.classList.add('trans-' + (ss.dataset.transition || 'fade'));
	let cur = 0, timer = null;
	function goTo(n) {
		slides[cur].classList.remove('active'); dots[cur]?.classList.remove('active');
		cur = (n + slides.length) % slides.length;
		slides[cur].classList.add('active'); dots[cur]?.classList.add('active');
	}
	function start() { if (slides.length > 1) timer = setInterval(() => goTo(cur + 1), interval); }
	function stop()  { clearInterval(timer); timer = null; }
	if (prev) prev.addEventListener('click', function() { stop(); goTo(cur - 1); });
	if (next) next.addEventListener('click', function() { stop(); goTo(cur + 1); });
	dots.forEach((d, i) => d.addEventListener('click', function() { stop(); goTo(i); }));
	ss.addEventListener('mouseenter', stop); ss.addEventListener('mouseleave', start);
	let tx = 0;
	ss.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, {passive:true});
	ss.addEventListener('touchend', e => { const d = tx - e.changedTouches[0].clientX; if (Math.abs(d) > 40) { stop(); goTo(cur + (d > 0 ? 1 : -1)); } }, {passive:true});
	start();
});

// ── Page blocks: contact forms ─────────────────────────────────────────────
document.querySelectorAll('.contact-form').forEach(function(form) {
	form.addEventListener('submit', async function(e) {
		e.preventDefault();
		const msg = form.querySelector('.cf-msg'), btn = form.querySelector('[type=submit]');
		const fd = new FormData(form);
		fd.append('action', 'submit'); fd.append('form_id', form.dataset.formId);
		btn.disabled = true;
		const res = await fetch('/?route=contact', { method:'POST', body:fd }).then(r=>r.json());
		btn.disabled = false;
		msg.textContent = res.ok ? (res.message || 'Message sent. Thank you!') : (res.message || 'Could not send message.');
		msg.style.color = res.ok ? '#16a34a' : '#dc2626';
		if (res.ok) form.reset();
	});
});

// ── Contact form modals ────────────────────────────────────────────────────
document.querySelectorAll('.cf-modal-open').forEach(function(btn) {
	btn.addEventListener('click', function() {
		var dialog = document.getElementById(btn.dataset.target);
		if (dialog) dialog.showModal();
	});
});
document.querySelectorAll('.cf-modal').forEach(function(dialog) {
	dialog.querySelector('.cf-modal-close')?.addEventListener('click', function() { dialog.close(); });
	dialog.addEventListener('click', function(e) { if (e.target === dialog) dialog.close(); });
});

// ── Reviews ────────────────────────────────────────────────────────────────
(function() {
	'use strict';
	const productId = window._ncProd && _ncProd.productId ? _ncProd.productId : 0;
	const canReview = window._ncProd && _ncProd.canReview ? _ncProd.canReview : false;
	const reviewForm = document.getElementById('review-form');
	const reviewMsg = document.getElementById('review-msg');
	const ratingInput = document.getElementById('rating-input');
	const reviewsList = document.getElementById('reviews-list');
	const statsDiv = document.getElementById('reviews-stats');

	// Star rating: handle clicks and hover (only if review form exists)
	const stars = ratingInput ? ratingInput.querySelectorAll('.star') : [];
	const inputs = ratingInput ? ratingInput.querySelectorAll('input[type=radio]') : [];

	// Click on star to select it
	stars.forEach((star, index) => {
		star.addEventListener('click', function(e) {
			e.preventDefault();
			const rating = index + 1;
			const input = inputs[index];
			if (input) {
				input.checked = true;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
	});

	// Hover effect
	stars.forEach(star => {
		star.addEventListener('mouseenter', function() {
			const rating = parseInt(this.dataset.rating);
			stars.forEach((s, i) => {
				s.classList.toggle('hover', i < rating);
			});
		});
	});

	if (ratingInput) {
		ratingInput.addEventListener('mouseleave', function() {
			const checked = ratingInput.querySelector('input:checked');
			stars.forEach((s, i) => {
				s.classList.toggle('active', checked && i < parseInt(checked.value));
			});
		});
	}

	// Update active state when radio button changes
	inputs.forEach(input => {
		input.addEventListener('change', function() {
			const rating = parseInt(this.value);
			stars.forEach((s, i) => {
				s.classList.toggle('active', i < rating);
			});
		});
	});

	// Helper: Create SVG star rating display with half-star support
	function createStarSvg(rating, size = 20) {
		const fullStars = Math.floor(rating);
		const hasHalf = rating % 1 >= 0.25 && rating % 1 < 0.75;
		const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
		const starPath = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

		let html = '';
		// Full stars
		for (let i = 0; i < fullStars; i++) {
			html += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#f59e0b" style="display:inline-block;vertical-align:middle;margin:0 1px;"><path d="${starPath}"/></svg>`;
		}
		// Half star (left half gold, right half gray)
		if (hasHalf) {
			html += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:inline-block;vertical-align:middle;margin:0 1px;"><path d="${starPath}" fill="#f59e0b"/><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77v-15.77z" fill="#d1d5db"/></svg>`;
		}
		// Empty stars
		for (let i = 0; i < emptyStars; i++) {
			html += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#d1d5db" style="display:inline-block;vertical-align:middle;margin:0 1px;"><path d="${starPath}"/></svg>`;
		}
		return html;
	}

	// Load reviews
	async function loadReviews() {
		if (!productId) {
			console.error('productId not set');
			return;
		}

		let data;
		try {
			const url = '/?route=reviews&action=get&product_id=' + productId;
			const res = await fetch(url);
			if (!res.ok) {
				console.error('API response not ok:', res.status, res.statusText);
				reviewsList.innerHTML = '<div class="reviews-empty">Error loading reviews.</div>';
				return;
			}
			data = await res.json();

			if (!data.ok) {
				reviewsList.innerHTML = '<div class="reviews-empty">No reviews yet.</div>';
				document.getElementById('review-summary-content').innerHTML = '';
				return;
			}
		} catch (err) {
			console.error('Error loading reviews:', err);
			reviewsList.innerHTML = '<div class="reviews-empty">Error loading reviews.</div>';
			return;
		}

		// Update summary section
		const avgRating = data.avg_rating || 0;
		const count = data.count || 0;
		const summaryEl = document.getElementById('review-summary-content');

		if (count === 0) {
			if (canReview) {
				summaryEl.innerHTML = `
					<a href="#review-form" onclick="document.getElementById('review-name').focus(); return false;" style="color: #2563eb; text-decoration: none; font-weight: 500;">
						Be the first to review this product
					</a>
				`;
			}
			reviewsList.innerHTML = '<div class="reviews-empty">No reviews yet.</div>';
			return;
		}

		summaryEl.innerHTML = `
			<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;">
				<div style="line-height: 1; display: flex; gap: 0.25rem; align-items: center;">
					${createStarSvg(avgRating, 18)}
					<span style="font-weight: 600; color: #374151;">${avgRating.toFixed(1)}</span>
				</div>
				<a href="#reviews-list" style="color: #2563eb; text-decoration: none; cursor: pointer;">
					(${count} review${count === 1 ? '' : 's'})
				</a>
			</div>
		`;

		// Update review stats at top of reviews section
		const avgRatingEl = document.getElementById('avg-rating');
		const reviewCountEl = document.getElementById('review-count');
		if (avgRatingEl) {
			avgRatingEl.innerHTML = `<div style="line-height: 1;">${createStarSvg(avgRating, 24)}</div><div style="font-weight: 600; color: #374151;">${avgRating.toFixed(1)}</div>`;
		}
		if (reviewCountEl) {
			reviewCountEl.textContent = `(${count} review${count === 1 ? '' : 's'})`;
		}

		// Render reviews
		if (!data.reviews || data.reviews.length === 0) {
			reviewsList.innerHTML = '<div class="reviews-empty">No reviews yet.</div>';
			return;
		}

		const reviewsHtml = data.reviews.map(r => {
			const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
			const date = new Date(r.created_at).toLocaleDateString();

			// Build author info: name and location
			let authorHtml = escapeHtml(r.name);
			if (r.country) {
				// For US: show "State, United States"
				// For others: show just the country
				let location = r.country;
				if (r.country === 'United States' && r.state) {
					location = escapeHtml(r.state) + ', United States';
				}
				authorHtml += `<br><span style="font-size: 0.85rem; color: #6b7280;">${escapeHtml(location)}</span>`;
			}

			return `
				<div class="review-item">
					<div class="review-header">
						<div class="review-author">${authorHtml}</div>
						<div class="review-date">${date}</div>
					</div>
					<div class="review-rating">${stars} <span class="rating-text">${r.rating}/5</span></div>
					${r.title ? '<div class="review-title">' + escapeHtml(r.title) + '</div>' : ''}
					<div class="review-body">${escapeHtml(r.body)}</div>
				</div>
			`;
		}).join('');

		reviewsList.innerHTML = reviewsHtml;
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	// Submit review
	if (reviewForm) {
		reviewForm.addEventListener('submit', async function(e) {
			e.preventDefault();

			const formData = new FormData(reviewForm);
			formData.append('action', 'submit');
			formData.append('product_id', productId);

			const btn = reviewForm.querySelector('[type=submit]');
			btn.disabled = true;

			const res = await fetch('/?route=reviews', { method: 'POST', body: formData });
			const data = await res.json();

			btn.disabled = false;

			reviewMsg.textContent = data.message || (data.ok ? 'Review submitted!' : 'Error submitting review.');
			reviewMsg.style.color = data.ok ? '#16a34a' : '#dc2626';

			if (data.ok) {
				reviewForm.reset();
				stars.forEach(s => s.classList.remove('active', 'hover'));
				setTimeout(loadReviews, 500);
			}
		});
	}

	// Load on page load
	loadReviews();
})();
