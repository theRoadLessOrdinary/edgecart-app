<?php
require_access(ACCESS_REPORTS);

// Allow plugins to register custom reports
Hook::fire('admin.reports.register');

if (post('action')) {
	header('Content-Type: application/json');
	require_csrf_token_json();

	if (post('action') === 'list_reports') {
		$reports = [];
		$access_level = $_SESSION['admin_access'] ?? 0;
		foreach (ReportRegistry::all() as $report) {
			if ($report->permission <= $access_level) {
				$reports[] = [
					'id' => $report->id,
					'name' => $report->name,
					'description' => $report->description,
					'category' => $report->category,
					'parameters' => $report->parameters
				];
			}
		}

		echo json_encode([
			'ok' => true,
			'reports' => $reports
		]);
		exit;
	}

	if (post('action') === 'get_report') {
		$report_id = post('report_id');
		$report = ReportRegistry::get($report_id);
		$access_level = $_SESSION['admin_access'] ?? 0;

		if (!$report || $report->permission > $access_level) {
			echo json_encode(['ok' => false, 'message' => 'Report not found']);
			exit;
		}

		$params = post('params', []);
		if (is_string($params)) $params = json_decode($params, true) ?? [];

		try {
			$data = $report->getData($params);
			echo json_encode([
				'ok' => true,
				'report' => $report_id,
				'columns' => $data['columns'],
				'rows' => $data['rows']
			]);
		} catch (Exception $e) {
			echo json_encode(['ok' => false, 'message' => $e->getMessage()]);
		}
		exit;
	}

	echo json_encode(['ok' => false, 'message' => 'Unknown action']);
	exit;
}

$smarty->display('reports.html');
