/**
 * new-cart catalog — shared utilities
 */

// Debounced button: disables immediately on click for instant feedback, and
// blocks further clicks until the handler's own async work actually settles
// (not a fixed time guess) — a slow request no longer opens a window for a
// duplicate click to fire a second real request.
function debounceBtn(btn, handler) {
	btn.addEventListener('click', function (e) {
		if (btn.disabled) return;
		btn.disabled = true;
		Promise.resolve(handler.call(this, e)).finally(function () {
			btn.disabled = false;
		});
	});
}
