<?php
/**
 * new-cart Plugin Loader
 *
 * Discovers enabled plugins (non-dotfile folders in /plugins/)
 * and loads their hooks.php if present.
 *
 * Called once during bootstrap, after DB and config are ready.
 */
class PluginLoader {

	private static array $loaded      = [];
	private static array $manifests   = [];
	private static array $unlicensed  = []; // enabled folders that failed license check

	// ── Load all enabled plugins ───────────────────────────────────────────────
	public static function boot(): void {
		$dir = DIR_ROOT . 'plugins/';
		if (!is_dir($dir)) return;

		foreach (scandir($dir) as $entry) {
			if ($entry === '.' || $entry === '..') continue;
			if ($entry[0] === '.') continue; // disabled (dot-prefixed)
			$path = $dir . $entry;
			if (!is_dir($path)) continue;

			$manifest = self::readManifest($path . '/plugin.xml');
			if (!$manifest) continue;

			self::$manifests[$entry] = $manifest;

			// License check (skipped on localhost / CLI / dev TLDs, via
			// License::checkPlugin()'s own isDevContext() guard).
			//
			// Requiring a license is decided by the manifest's `licensed`
			// flag, NOT by whether license.php happens to exist on disk —
			// checking file_exists() alone was fail-open: deleting the file
			// skipped validation entirely instead of failing it, which fully
			// bypassed licensing for every premium plugin (found 2026-07-14
			// when a domain-mismatched license.php was deleted to "fix" an
			// unrelated error, and the plugin kept working anyway). A
			// missing/unreadable file now falls through to checkPlugin()
			// with empty domain/signature, which fails closed the same way
			// an invalid signature already did.
			$license_file = $path . '/license.php';
			if ($manifest['licensed'] || file_exists($license_file)) {
				$lic_domain = '';
				$lic_sig    = '';
				if (file_exists($license_file)) {
					require_once $license_file;
					$code_upper = strtoupper(str_replace('-', '_', $entry));
					$lic_domain = defined("EC_PLUGIN_DOMAIN_{$code_upper}") ? constant("EC_PLUGIN_DOMAIN_{$code_upper}") : '';
					$lic_sig    = defined("EC_PLUGIN_SIG_{$code_upper}")    ? constant("EC_PLUGIN_SIG_{$code_upper}")    : '';
				}
				if (!License::checkPlugin($entry, $lic_domain, $lic_sig)) {
					self::$unlicensed[] = $entry;
					continue;
				}
			}

			// Load hooks
			$hooks = $path . '/hooks.php';
			if (file_exists($hooks)) {
				require_once $hooks;
			}

			self::$loaded[] = $entry;
		}
	}

	// ── Get all plugin template dirs (for Smarty priority loading) ─────────────
	public static function templateDirs(): array {
		$dirs = [];
		$dir  = DIR_ROOT . 'plugins/';
		foreach (self::$loaded as $code) {
			$tpl = $dir . $code . '/tpl/';
			if (is_dir($tpl)) $dirs[] = $tpl;
		}
		return $dirs;
	}

	// ── Get all plugin admin template dirs ────────────────────────────────────
	public static function adminTemplateDirs(): array {
		$dirs = [];
		$dir  = DIR_ROOT . 'plugins/';
		foreach (self::$loaded as $code) {
			$tpl = $dir . $code . '/admin/tpl/';
			if (is_dir($tpl)) $dirs[] = $tpl;
		}
		return $dirs;
	}

	// ── Get loaded plugin codes ────────────────────────────────────────────────
	public static function loaded(): array {
		return self::$loaded;
	}

	// ── Get codes of enabled plugins that failed license check ────────────────
	public static function unlicensed(): array {
		return self::$unlicensed;
	}

	// ── Get manifest for a plugin ──────────────────────────────────────────────
	public static function manifest(string $code): ?array {
		return self::$manifests[$code] ?? null;
	}

	// ── Get all manifests ──────────────────────────────────────────────────────
	public static function manifests(): array {
		return self::$manifests;
	}

	// ── Get admin menu items for a given sidebar section ───────────────────────
	public static function adminMenuItems(string $section): array {
		$items = [];
		foreach (self::$manifests as $manifest) {
			foreach ($manifest['admin_menu'] as $item) {
				if ($item['section'] === $section) {
					$items[] = $item;
				}
			}
		}
		return $items;
	}

	// ── Get plugin-contributed nav groups, optionally filtered by placement ────
	public static function adminMenuGroups(?string $placement = null, string $active_route = ''): array {
		$groups = [];
		foreach (self::$manifests as $manifest) {
			foreach ($manifest['admin_groups'] as $group) {
				if ($placement !== null && $group['placement'] !== $placement) continue;
				$group['is_active'] = in_array($active_route, array_column($group['items'], 'route'));
				$groups[] = $group;
			}
		}
		return $groups;
	}

	// ── Parse plugin.xml manifest ──────────────────────────────────────────────
	public static function readManifest(string $path): ?array {
		if (!file_exists($path)) return null;

		libxml_use_internal_errors(true);
		$xml = simplexml_load_file($path);
		if (!$xml) return null;

		$manifest = [
			'name'        => (string)($xml->n           ?? $xml->name ?? ''),
			'code'        => (string)($xml->code        ?? ''),
			'version'     => (string)($xml->version     ?? ''),
			'author'      => (string)($xml->author      ?? ''),
			'link'        => (string)($xml->link        ?? ''),
			'description' => (string)($xml->description ?? ''),
			'date'        => (string)($xml->date        ?? ''),
			'type'        => (string)($xml->type        ?? 'plugin'),
			'icon'        => (string)($xml->icon        ?? ''),
			// Declared independently of whether license.php actually exists on
			// disk, so a plugin that's supposed to be licensed can't be made
			// free just by deleting that one file — see boot()'s fail-closed
			// check below.
			'licensed'    => ((string)($xml['licensed'] ?? '')) === 'true',
			'tables'      => [],
			'settings'    => [],
		];

		// Parse settings key declarations
		if (isset($xml->settings->key)) {
			foreach ($xml->settings->key as $key) {
				$manifest['settings'][] = (string)$key;
			}
			// Read origin attribute from settings element
			if (isset($xml->settings['origin'])) {
				$manifest['settings_origin'] = (string)$xml->settings['origin'];
			}
		}

		// Parse admin menu declarations
		$manifest['admin_menu']   = [];
		$manifest['admin_groups'] = [];
		if (isset($xml->admin_menu)) {
			$default_section = (string)($xml->admin_menu['section'] ?? '');

			// <item> directly under <admin_menu> → adds to an existing sidebar section
			foreach ($xml->admin_menu->item as $item) {
				$manifest['admin_menu'][] = [
					'section' => (string)($item['section'] ?? $default_section ?: 'setup'),
					'label'   => (string)$item['label'],
					'route'   => (string)$item['route'],
				];
			}

			// <group> under <admin_menu> → creates a new sidebar nav group
			foreach ($xml->admin_menu->group as $group) {
				$code      = $manifest['code'];
				$label     = (string)($group['label']     ?? '');
				$icon      = (string)($group['icon']      ?? '⚙');
				$placement = (string)($group['placement'] ?? 'after');
				$slug      = preg_replace('/[^a-z0-9]+/', '-', strtolower($label));
				$section   = $code . '-' . trim($slug, '-');

				$items = [];
				foreach ($group->item as $item) {
					$items[] = [
						'label' => (string)$item['label'],
						'route' => (string)$item['route'],
					];
				}

				$manifest['admin_groups'][] = [
					'code'      => $code,
					'label'     => $label,
					'icon'      => $icon,
					'placement' => $placement === 'before' ? 'before' : 'after',
					'section'   => $section,
					'items'     => $items,
				];
			}
		}

		// Parse table declarations
		if (isset($xml->tables->table)) {
			foreach ($xml->tables->table as $table) {
				$tbl = [
					'name'   => (string)$table['name'],
					'fields' => [],
					'indexes'=> [],
				];
				foreach ($table->field as $field) {
					$tbl['fields'][] = [
						'name'           => (string)$field['name'],
						'type'           => (string)$field['type'],
						'null'           => ((string)$field['null']) !== 'false',
						'default'        => isset($field['default']) ? (string)$field['default'] : null,
						'auto_increment' => ((string)$field['auto_increment']) === 'true',
						'primary'        => ((string)$field['primary'])        === 'true',
					];
				}
				foreach ($table->index as $index) {
					$tbl['indexes'][] = [
						'columns' => explode(',', (string)$index['columns']),
						'unique'  => ((string)$index['unique']) === 'true',
					];
				}
				$manifest['tables'][] = $tbl;
			}
		}

		return $manifest;
	}

	// ── Generate and execute CREATE TABLE from manifest ────────────────────────
	public static function createTables(array $manifest): void {
		foreach ($manifest['tables'] as $tbl) {
			$sql = self::buildCreateTable($tbl);
			DB::exec($sql);
		}
	}

	// ── Drop tables declared in manifest ──────────────────────────────────────
	public static function dropTables(array $manifest): void {
		foreach ($manifest['tables'] as $tbl) {
			DB::exec("DROP TABLE IF EXISTS `{$tbl['name']}`");
		}
	}

	// ── Build CREATE TABLE SQL from manifest table definition ──────────────────
	private static function buildCreateTable(array $tbl): string {
		$cols    = [];
		$primary = null;

		foreach ($tbl['fields'] as $f) {
			$col = "`{$f['name']}` {$f['type']}";
			if (!$f['null']) $col .= ' NOT NULL';
			if ($f['auto_increment']) $col .= ' AUTO_INCREMENT';
			if ($f['default'] !== null) {
				$col .= " DEFAULT " . ($f['default'] === 'CURRENT_TIMESTAMP'
					? 'CURRENT_TIMESTAMP'
					: "'" . addslashes($f['default']) . "'");
			}
			$cols[] = $col;
			if ($f['primary']) $primary = $f['name'];
		}

		if ($primary) {
			$cols[] = "PRIMARY KEY (`{$primary}`)";
		}

		foreach ($tbl['indexes'] as $idx) {
			$idxCols = implode('`, `', $idx['columns']);
			$type    = $idx['unique'] ? 'UNIQUE KEY' : 'KEY';
			$name    = implode('_', $idx['columns']);
			$cols[]  = "{$type} `{$name}` (`{$idxCols}`)";
		}

		$colSql = implode(",\n\t\t\t", $cols);
		return "CREATE TABLE IF NOT EXISTS `{$tbl['name']}` (\n\t\t\t{$colSql}\n\t\t) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
	}
}
