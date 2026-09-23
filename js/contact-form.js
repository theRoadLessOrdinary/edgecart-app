(function() {
'use strict';

document.addEventListener('submit', function(e) {
	if (!e.target.classList.contains('contact-form')) return;
	e.preventDefault();

	const form = e.target;
	const msgEl = form.querySelector('.cf-msg');
	if (!msgEl) return;

	const fd = new FormData(form);
	fd.append('action', 'submit');
	fd.append('form_id', form.dataset.formId);

	msgEl.textContent = 'Sending...';
	msgEl.className = 'cf-msg';

	fetch('/contact', { method: 'POST', body: fd })
		.then(r => r.text())
		.then(text => {
			try {
				const data = JSON.parse(text);
				if (data && data.ok) {
					form.reset();
					msgEl.className = 'cf-msg cf-msg--success';
					msgEl.textContent = data.message || 'Message sent!';
					const modal = form.closest('dialog');
					if (modal) setTimeout(() => modal.close(), 2000);
				} else {
					msgEl.className = 'cf-msg cf-msg--error';
					msgEl.textContent = data?.message || 'Error sending message.';
				}
			} catch (e) {
				// If response isn't JSON, assume it succeeded (email was sent)
				if (text && !text.includes('error')) {
					form.reset();
					msgEl.className = 'cf-msg cf-msg--success';
					msgEl.textContent = 'Thank you — your message has been sent.';
					const modal = form.closest('dialog');
					if (modal) setTimeout(() => modal.close(), 2000);
				} else {
					msgEl.className = 'cf-msg cf-msg--error';
					msgEl.textContent = 'Error sending message.';
				}
			}
		})
		.catch(err => {
			msgEl.className = 'cf-msg cf-msg--error';
			msgEl.textContent = 'Error: ' + (err?.message || 'Network error');
		});
});

document.addEventListener('click', function(e) {
	if (e.target.classList.contains('cf-modal-open')) {
		const modal = document.getElementById(e.target.dataset.target);
		if (modal) modal.showModal();
	}
	if (e.target.classList.contains('cf-modal-close')) {
		const modal = e.target.closest('dialog');
		if (modal) modal.close();
	}
});

})();
