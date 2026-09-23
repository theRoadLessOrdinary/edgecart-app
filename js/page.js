// ── Slideshows ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.slideshow').forEach(function(ss) {
	const slides   = ss.querySelectorAll('.slideshow-slide');
	const dots     = ss.querySelectorAll('.slideshow-dot');
	const prevBtn  = ss.querySelector('.slideshow-prev');
	const nextBtn  = ss.querySelector('.slideshow-next');
	const interval = parseInt(ss.dataset.interval) || 5000;
	const trans    = ss.dataset.transition || 'fade';
	let current    = 0;
	let timer      = null;

	ss.classList.add('trans-' + trans);

	function goTo(n) {
		slides[current].classList.remove('active');
		dots[current]?.classList.remove('active');
		dots[current]?.setAttribute('aria-selected','false');
		current = (n + slides.length) % slides.length;
		slides[current].classList.add('active');
		dots[current]?.classList.add('active');
		dots[current]?.setAttribute('aria-selected','true');
	}

	function startAuto() {
		if (slides.length <= 1) return;
		timer = setInterval(() => goTo(current + 1), interval);
	}

	function stopAuto() { clearInterval(timer); timer = null; }

	if (prevBtn) prevBtn.addEventListener('click', function() { stopAuto(); goTo(current - 1); });
	if (nextBtn) nextBtn.addEventListener('click', function() { stopAuto(); goTo(current + 1); });

	dots.forEach(function(dot, i) {
		dot.addEventListener('click', function() { stopAuto(); goTo(i); });
	});

	ss.addEventListener('mouseenter', stopAuto);
	ss.addEventListener('mouseleave', startAuto);

	// Touch swipe
	let touchX = 0;
	ss.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, {passive:true});
	ss.addEventListener('touchend', e => {
		const diff = touchX - e.changedTouches[0].clientX;
		if (Math.abs(diff) > 40) { stopAuto(); goTo(current + (diff > 0 ? 1 : -1)); }
	}, {passive:true});

	startAuto();
});

// ── Contact forms ──────────────────────────────────────────────────────────────
document.querySelectorAll('.contact-form').forEach(function(form) {
	form.addEventListener('submit', async function(e) {
		e.preventDefault();
		const msg    = form.querySelector('.cf-msg');
		const btn    = form.querySelector('[type=submit]');
		const formId = form.dataset.formId;
		const fd     = new FormData(form);
		fd.append('action',  'submit');
		fd.append('form_id', formId);

		btn.disabled = true;
		const res = await fetch('/?route=contact', { method:'POST', body:fd }).then(r=>r.json());
		btn.disabled = false;

		if (res.ok) {
			msg.textContent  = res.message || 'Message sent. Thank you!';
			msg.style.color  = '#16a34a';
			form.reset();
		} else {
			msg.textContent = res.message || 'Could not send message.';
			msg.style.color = '#dc2626';
		}
	});
});

// ── Contact form modals ────────────────────────────────────────────────────────
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
