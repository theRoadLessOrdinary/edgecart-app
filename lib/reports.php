<?php

class Report {
	public $id;
	public $name;
	public $description;
	public $category = 'general';
	public $permission = ACCESS_REPORTS;
	public $parameters = [];

	public function __construct($id, $name, $description = '') {
		$this->id = $id;
		$this->name = $name;
		$this->description = $description;
	}

	public function setCategory($cat) {
		$this->category = $cat;
		return $this;
	}

	public function setPermission($perm) {
		$this->permission = $perm;
		return $this;
	}

	public function addParameter($key, $label, $type = 'text', $required = false, $default = null) {
		$this->parameters[$key] = [
			'label' => $label,
			'type' => $type,
			'required' => $required,
			'default' => $default
		];
		return $this;
	}

	public function getData($params) {
		return [
			'columns' => [],
			'rows' => []
		];
	}
}

class ReportRegistry {
	private static $reports = [];

	public static function register(Report $report) {
		self::$reports[$report->id] = $report;
	}

	public static function get($id) {
		return self::$reports[$id] ?? null;
	}

	public static function all() {
		return self::$reports;
	}

	public static function byCategory($cat) {
		return array_filter(self::$reports, fn($r) => $r->category === $cat);
	}
}

