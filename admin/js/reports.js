(function() {
	'use strict';

	let allReports = [];
	let currentReport = null;
	let currentReportData = null;

	loadReportsList();

	function loadReportsList() {
		const fd = new FormData();
		fd.append('action', 'list_reports');
		fd.append('csrf_token', getCsrfToken());

		fetch(NC.ajaxUrl, { method: 'POST', body: fd })
			.then(r => r.json())
			.then(data => {
				if (data.ok) {
					allReports = data.reports;
					renderAccordion();
				}
			})
			.catch(err => console.error('Error loading reports:', err));
	}

	function renderAccordion() {
		const accordion = document.getElementById('reports-accordion');
		const categories = new Set();
		allReports.forEach(r => categories.add(r.category));

		const html = Array.from(categories).sort().map((cat, idx) => {
			const reportsInCat = allReports.filter(r => r.category === cat);
			return `
				<div class="nav-group">
					<button class="nav-group-head" aria-expanded="false">
						<span class="nav-icon">📊</span>
						<span class="nav-label">${capitalize(cat)}</span>
						<span class="nav-group-arrow">&#8250;</span>
					</button>
					<div class="nav-group-items">
						${reportsInCat.map(r => `
							<a href="#" class="report-link" data-report-id="${r.id}" onclick="return false">
								${r.name}
							</a>
						`).join('')}
					</div>
				</div>
			`;
		}).join('');

		accordion.innerHTML = html;

		const ACCORDION_KEY = 'reports-accordion-group';

		// Helper to open/close groups
		function openGroup(group, save) {
			// Close all
			accordion.querySelectorAll('.nav-group').forEach(g => {
				g.classList.remove('open');
				g.querySelector('.nav-group-head')?.setAttribute('aria-expanded', 'false');
			});
			// Open target if provided
			if (group) {
				group.classList.add('open');
				group.querySelector('.nav-group-head')?.setAttribute('aria-expanded', 'true');
				if (save) localStorage.setItem(ACCORDION_KEY, group.dataset.group || '');
			}
		}

		// Assign data-group to each group
		accordion.querySelectorAll('.nav-group').forEach((g, i) => {
			g.dataset.group = i;
		});

		// Restore MRU group if none already open
		const alreadyOpen = accordion.querySelector('.nav-group.open');
		if (!alreadyOpen) {
			const saved = localStorage.getItem(ACCORDION_KEY);
			if (saved !== null) {
				const target = accordion.querySelector(`.nav-group[data-group="${saved}"]`);
				if (target) openGroup(target, false);
			}
		}

		// Attach expand/collapse handlers
		accordion.querySelectorAll('.nav-group-head').forEach(btn => {
			btn.addEventListener('click', function() {
				const group = btn.closest('.nav-group');
				const isOpen = group.classList.contains('open');
				openGroup(isOpen ? null : group, true);
			});
		});

		// Attach report selection handlers
		accordion.querySelectorAll('.report-link').forEach(link => {
			link.addEventListener('click', function(e) {
				e.preventDefault();
				selectReport(this.dataset.reportId);
			});
		});
	}

	function selectReport(reportId) {
		currentReport = allReports.find(r => r.id === reportId);
		if (!currentReport) return;

		document.querySelectorAll('.report-link').forEach(link => {
			link.classList.remove('active');
		});
		document.querySelector(`.report-link[data-report-id="${reportId}"]`).classList.add('active');

		document.getElementById('report-name').textContent = currentReport.name;
		document.getElementById('report-description').textContent = currentReport.description;
		document.querySelector('.report-header').style.display = 'block';
		document.getElementById('report-empty').style.display = 'none';
		document.getElementById('report-content').innerHTML = '';

		renderReportParams();
	}

	function renderReportParams() {
		const paramsContainer = document.getElementById('report-params');
		const controlsDiv = document.getElementById('report-controls');
		const runBtn = document.getElementById('btn-run-report');

		if (!currentReport.parameters || Object.keys(currentReport.parameters).length === 0) {
			paramsContainer.innerHTML = '';
			// Still show #report-controls so #btn-export-csv (which lives in
			// the same container) stays reachable — a report with no filter
			// params still has real, exportable data. Run Report itself is
			// hidden rather than left visible-but-redundant, since this branch
			// already auto-fetches the data below.
			controlsDiv.style.display = 'flex';
			runBtn.style.display = 'none';
			loadReportData({});
			return;
		}

		runBtn.style.display = '';
		controlsDiv.style.display = 'flex';
		paramsContainer.innerHTML = Object.entries(currentReport.parameters).map(([key, param]) => {
			let input = '';
			if (param.type === 'date') {
				input = `<input type="date" id="param-${key}" value="${param.default || ''}" ${param.required ? 'required' : ''}>`;
			} else if (param.type === 'number') {
				input = `<input type="number" id="param-${key}" value="${param.default || ''}" ${param.required ? 'required' : ''}>`;
			} else {
				input = `<input type="text" id="param-${key}" value="${param.default || ''}" ${param.required ? 'required' : ''}>`;
			}
			return `
				<div class="report-param">
					<label for="param-${key}">${param.label}</label>
					${input}
				</div>
			`;
		}).join('');
	}

	document.getElementById('btn-run-report')?.addEventListener('click', function() {
		if (!currentReport) return;

		const params = {};
		if (currentReport.parameters) {
			Object.keys(currentReport.parameters).forEach(key => {
				const input = document.getElementById(`param-${key}`);
				if (input) params[key] = input.value;
			});
		}
		loadReportData(params);
	});

	function loadReportData(params) {
		if (!currentReport) return;

		// Restore sort state for this report
		reportSortCol = localStorage.getItem('reports-sort-col');
		reportSortDir = parseInt(localStorage.getItem('reports-sort-dir') || '1');

		const reportContent = document.getElementById('report-content');
		document.getElementById('report-loading').style.display = 'flex';
		reportContent.innerHTML = '';

		const fd = new FormData();
		fd.append('action', 'get_report');
		fd.append('csrf_token', getCsrfToken());
		fd.append('report_id', currentReport.id);
		fd.append('params', JSON.stringify(params));

		fetch(NC.ajaxUrl, { method: 'POST', body: fd })
			.then(r => r.json())
			.then(data => {
				document.getElementById('report-loading').style.display = 'none';
				if (data.ok) {
					currentReportData = data;
					renderReportTable(reportContent, data);
				} else {
					reportContent.innerHTML =
						`<div class="error-message">Error: ${data.message}</div>`;
				}
			})
			.catch(err => {
				document.getElementById('report-loading').style.display = 'none';
				reportContent.innerHTML =
					`<div class="error-message">Error loading report: ${err.message}</div>`;
			});
	}

	let reportSortCol = null;
	let reportSortDir = 1;

	function renderReportTable(reportContent, data) {
		if (!data.rows || data.rows.length === 0) {
			reportContent.innerHTML =
				'<div class="report-empty"><p>No data available for this report.</p></div>';
			return;
		}

		const columns = data.columns || [];
		let rows = [...data.rows];

		// Apply sorting
		if (reportSortCol && columns.some(c => c.key === reportSortCol)) {
			rows.sort((a, b) => {
				let aVal = a[reportSortCol];
				let bVal = b[reportSortCol];

				// Handle nulls
				if (aVal == null && bVal == null) return 0;
				if (aVal == null) return reportSortDir > 0 ? 1 : -1;
				if (bVal == null) return reportSortDir > 0 ? -1 : 1;

				// Numeric sort
				if (typeof aVal === 'number' && typeof bVal === 'number') {
					return (aVal - bVal) * reportSortDir;
				}

				// String sort
				return String(aVal).localeCompare(String(bVal)) * reportSortDir;
			});
		}

		const html = `
			<table class="report-table">
				<thead>
					<tr>
						${columns.map(col => `
							<th data-sort="${col.key}">
								${col.label}
								<span class="sort-ind" aria-hidden="true"></span>
							</th>
						`).join('')}
					</tr>
				</thead>
				<tbody>
					${rows.map(row => `
						<tr>
							${columns.map(col => {
								let value = row[col.key];
								if (col.format === 'currency') {
									value = typeof value === 'number' ? '$' + value.toFixed(2) : value;
									return `<td class="currency">${value}</td>`;
								} else if (col.format === 'date') {
									return `<td class="date">${value}</td>`;
								}
								return `<td>${value}</td>`;
							}).join('')}
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
		reportContent.innerHTML = html;

		// Update sort indicator display
		document.querySelectorAll('th[data-sort]').forEach(th => {
			th.classList.remove('sort-asc', 'sort-desc');
			if (th.dataset.sort === reportSortCol) {
				th.classList.add(reportSortDir === 1 ? 'sort-asc' : 'sort-desc');
			}
		});

		// Attach sort handlers
		document.querySelectorAll('th[data-sort]').forEach(th => {
			th.addEventListener('click', function() {
				const col = this.dataset.sort;
				if (reportSortCol === col) {
					reportSortDir = -reportSortDir;
				} else {
					reportSortCol = col;
					reportSortDir = 1;
				}
				localStorage.setItem('reports-sort-col', reportSortCol);
				localStorage.setItem('reports-sort-dir', reportSortDir);
				renderReportTable(reportContent, currentReportData);
			});
		});
	}

	document.getElementById('btn-export-csv')?.addEventListener('click', function() {
		if (!currentReportData || !currentReportData.rows) return;

		const columns = currentReportData.columns || [];
		const rows = currentReportData.rows || [];

		let csv = columns.map(c => `"${c.label}"`).join(',') + '\n';
		csv += rows.map(row =>
			columns.map(col => {
				let value = row[col.key] ?? '';
				if (typeof value === 'string' && value.includes(',')) {
					value = `"${value.replace(/"/g, '""')}"`;
				}
				return value;
			}).join(',')
		).join('\n');

		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${currentReport.id}-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	});

	function capitalize(str) {
		return str.replace(/([A-Z])/g, ' $1').trim().split(' ').map(w =>
			w.charAt(0).toUpperCase() + w.slice(1)
		).join(' ');
	}

})();
