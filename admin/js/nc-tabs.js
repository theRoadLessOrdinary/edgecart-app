/**
 * NcTabs — lightweight tab widget, jQuery UI tabs-compatible HTML structure.
 *
 * HTML contract:
 *   <div data-nc-tabs>
 *     <ul>
 *       <li><a href="#panel-id">Label</a></li>
 *     </ul>
 *     <div id="panel-id">…</div>
 *   </div>
 *
 * Multiple and nested tab widgets are supported; each instance is scoped
 * to its direct children via :scope selectors.
 *
 * Callers are responsible for invoking NcTabs.init(el) after the widget
 * is in the DOM. There is no automatic init — call it explicitly.
 *
 * API:
 *   var tabs = NcTabs.init(el | '#selector');
 *   tabs.activate(index)            activate by 0-based index
 *   tabs.activateById('panel-id')   activate by panel element id
 *   tabs.setError('panel-id', bool) toggle error indicator on the tab
 *   tabs.clearErrors()
 *   tabs.activateFirstError()       activate first tab bearing an error
 */
var NcTabs = (function () {
	'use strict';

	function init(el) {
		if (typeof el === 'string') el = document.querySelector(el);
		if (!el) return null;

		var ul    = el.querySelector(':scope > ul');
		var items = ul ? Array.from(ul.querySelectorAll(':scope > li')) : [];

		// Direct-child divs only — keeps nested tab widgets isolated
		var panels = Array.from(el.querySelectorAll(':scope > div'));

		function panelForItem(item) {
			var a    = item.querySelector('a');
			var href = a ? a.getAttribute('href') : '';
			if (!href || href.charAt(0) !== '#') return null;
			return document.getElementById(href.slice(1));
		}

		function activate(item) {
			items.forEach(function (i) { i.classList.remove('active'); });
			panels.forEach(function (p) { p.classList.remove('active'); });
			item.classList.add('active');
			var panel = panelForItem(item);
			if (panel) panel.classList.add('active');
		}

		items.forEach(function (item) {
			var a = item.querySelector('a');
			if (!a) return;
			a.addEventListener('click', function (e) {
				e.preventDefault();
				activate(item);
			});
		});

		// Activate first tab by default
		if (items.length) activate(items[0]);

		return {
			activate: function (index) {
				if (items[index]) activate(items[index]);
			},

			activateById: function (id) {
				var found = items.find(function (i) {
					var a = i.querySelector('a');
					return a && a.getAttribute('href') === '#' + id;
				});
				if (found) activate(found);
			},

			setError: function (id, on) {
				var found = items.find(function (i) {
					var a = i.querySelector('a');
					return a && a.getAttribute('href') === '#' + id;
				});
				if (found) found.classList.toggle('has-error', on);
			},

			clearErrors: function () {
				items.forEach(function (i) { i.classList.remove('has-error'); });
			},

			activateFirstError: function () {
				var err = items.find(function (i) { return i.classList.contains('has-error'); });
				if (err) activate(err);
			},
		};
	}

	return { init: init };
})();
