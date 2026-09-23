<?php
/**
 * new-cart admin — plugins ajax handler
 * route=plugins/ajax
 */

require_admin();
header('Content-Type: application/json');

	// Verify CSRF token
	require_csrf_token_json();

// Plugin management can install and run arbitrary code (install.php on upload,
// plugin settings can expose API keys/secrets) — restrict the entire surface to
// full admins, not just any logged-in staff account.
require_access(ACCESS_ADMIN);

require_once DIR_LIB . 'plugin-loader.php';

$action = post('action');

// ── List installed plugins ─────────────────────────────────────────────────────
if ($action === 'list') {
	$plugins    = [];
	$plugin_dir = DIR_ROOT . 'plugins/';

	if (!is_dir($plugin_dir)) {
		ajax_out(true, '', ['plugins' => []]);
	}

	$seen        = [];
	$unlicensed  = array_flip(PluginLoader::unlicensed());
	foreach (scandir($plugin_dir) as $entry) {
		if ($entry === '.' || $entry === '..') continue;
		$disabled = $entry[0] === '.';
		$code     = $disabled ? substr($entry, 1) : $entry;
		$path     = $plugin_dir . $entry;
		if (!is_dir($path)) continue;

		// If both enabled and disabled copies exist, skip the disabled one
		if ($disabled && is_dir($plugin_dir . $code)) continue;

		// Skip duplicate codes (shouldn't happen, but guard against it)
		if (isset($seen[$code])) continue;
		$seen[$code] = true;

		$manifest = PluginLoader::readManifest($path . '/plugin.xml');
		if (!$manifest) continue;

		$licensed = !isset($unlicensed[$code]);
		$plugins[] = [
			'code'         => $code,
			'folder'       => $entry,
			'enabled'      => !$disabled && $licensed,
			'licensed'     => $licensed,
			'name'         => $manifest['name']        ?: $code,
			'version'      => $manifest['version']     ?: '—',
			'author'       => $manifest['author']      ?: '—',
			'link'         => $manifest['link']        ?: '',
			'description'  => $manifest['description'] ?: '',
			'date'         => $manifest['date']        ?: '',
			'type'         => $manifest['type']        ?: 'plugin',
			'icon'         => $manifest['icon']        ?: '',
			// has_settings drives the "Settings" button on this list — it must
			// match exactly what load_plugin_settings (below) will actually
			// render, or the button opens to a dead-end "no configurable
			// settings" message. load_plugin_settings only ever renders
			// manifest-declared keys or admin/settings.php (plus the taxjar-
			// style admin.plugin.settings.{code}.load hook override, which
			// only taxjar uses and which already has manifest keys) — it
			// never uses admin/index.php, so that file's existence must NOT
			// factor into this flag.
			'has_settings' => !empty($manifest['settings']) || file_exists($plugin_dir . $code . '/admin/settings.php'),
			// has_admin: whether the plugin has ANY admin controller (its own
			// full page, usually reached via <admin_menu>, and/or the
			// settings drawer). Kept separate from has_settings since a full
			// admin page is not the same thing as drawer-style settings.
			'has_admin'    => file_exists($plugin_dir . $code . '/admin/index.php') || file_exists($plugin_dir . $code . '/admin/settings.php'),
		];
	}

	usort($plugins, fn($a, $b) => strcasecmp($a['name'], $b['name']));
	ajax_out(true, '', ['plugins' => $plugins]);
}

// ── Upload and install ────────────────────────────────────────────────────────
if ($action === 'install') {
	if (empty($_FILES['file']['name'])) ajax_out(false, 'No file uploaded.');
	if ($_FILES['file']['error'] !== UPLOAD_ERR_OK) ajax_out(false, 'Upload error.');

	$filename = basename($_FILES['file']['name']);
	if (!str_ends_with(strtolower($filename), '.zip')) {
		ajax_out(false, 'Plugin must be a .zip file.');
	}

	$tmp = $_FILES['file']['tmp_name'];
	$zip = new ZipArchive();
	if ($zip->open($tmp) !== true) ajax_out(false, 'Could not open zip file.');

	// Detect format: single plugin (has plugin.xml) vs bundle (contains .zip files)
	$has_manifest = false;
	$inner_zips   = [];
	for ($i = 0; $i < $zip->numFiles; $i++) {
		$name = $zip->getNameIndex($i);
		if (basename($name) === 'plugin.xml') { $has_manifest = true; break; }
		// Root-level .zip files only (no slash in the name)
		if (!str_contains($name, '/') && str_ends_with(strtolower($name), '.zip')) {
			$inner_zips[] = $name;
		}
	}

	if ($has_manifest) {
		// ── Single plugin ──────────────────────────────────────────────────────
		$zip->close();
		$result = install_plugin_zip($tmp);
		if (!$result['ok']) ajax_out(false, $result['message']);
		ajax_out(true, "'{$result['name']}' installed successfully.");
	}

	if (empty($inner_zips)) {
		ajax_out(false, 'No plugin.xml or installable plugins found in zip.');
	}

	// ── Bundle: install each inner zip ─────────────────────────────────────────
	$installed = [];
	$failed    = [];
	foreach ($inner_zips as $inner_name) {
		$tmp_inner = tempnam(sys_get_temp_dir(), 'ec_plg_');
		file_put_contents($tmp_inner, $zip->getFromName($inner_name));
		$result = install_plugin_zip($tmp_inner);
		@unlink($tmp_inner);
		if ($result['ok']) {
			$installed[] = $result['name'];
		} else {
			$failed[] = basename($inner_name, '.zip') . ': ' . $result['message'];
		}
	}
	$zip->close();

	$count = count($installed);
	$msg   = $count . ' plugin' . ($count !== 1 ? 's' : '') . ' installed';
	if ($installed) $msg .= ': ' . implode(', ', $installed);
	if ($failed)    $msg .= '. Failed — ' . implode('; ', $failed);
	ajax_out($count > 0, $msg);
}

// ── Enable ────────────────────────────────────────────────────────────────────
if ($action === 'enable') {
	$code     = preg_replace('/[^a-z0-9_\-]/i', '', post('code'));
	$disabled = DIR_ROOT . 'plugins/.' . $code;
	$enabled  = DIR_ROOT . 'plugins/'  . $code;

	if (!is_dir($disabled)) ajax_out(false, 'Plugin not found.');
	if (is_dir($enabled))   ajax_out(false, 'An enabled plugin with this code already exists. Remove the duplicate first.');

	// If this is a theme, disable all other active themes first — only one
	// theme may be active at a time. Track which ones so the response can
	// tell the client; without this the Plugins list kept showing the old
	// theme's toggle as ON until the next full reload, and manually
	// switching it off then failed with a confusing "Plugin not found."
	// (admin/js/plugins.js only patched the row that was actually clicked).
	$also_disabled = [];
	$incoming = PluginLoader::readManifest($disabled . '/plugin.xml');
	if (($incoming['type'] ?? '') === 'theme') {
		$plugin_dir = DIR_ROOT . 'plugins/';
		foreach (scandir($plugin_dir) as $entry) {
			if ($entry === '.' || $entry === '..') continue;
			if ($entry[0] === '.') continue;
			$other_path = $plugin_dir . $entry;
			if (!is_dir($other_path)) continue;
			$other = PluginLoader::readManifest($other_path . '/plugin.xml');
			if (($other['type'] ?? '') === 'theme') {
				$dot = $plugin_dir . '.' . $entry;
				if (is_dir($dot)) self_rmdir($dot);
				rename($other_path, $dot);
				$also_disabled[] = $entry;
			}
		}
	}

	if (!rename($disabled, $enabled)) ajax_out(false, 'Could not enable plugin.');
	ajax_out(true, 'Plugin enabled.', ['also_disabled' => $also_disabled]);
}

// ── Disable ───────────────────────────────────────────────────────────────────
if ($action === 'disable') {
	$code    = preg_replace('/[^a-z0-9_\-]/i', '', post('code'));
	$enabled  = DIR_ROOT . 'plugins/'  . $code;
	$disabled = DIR_ROOT . 'plugins/.' . $code;

	// Already disabled (e.g. a theme auto-disabled server-side when a
	// sibling theme was enabled, and the client's view hadn't caught up
	// yet) — the requested end state is already true, so this is a no-op
	// success, not an error. "Plugin not found." here reads as "this plugin
	// is broken/missing" when it's really just already off.
	if (!is_dir($enabled) && is_dir($disabled)) ajax_out(true, 'Plugin already disabled.');
	if (!is_dir($enabled)) ajax_out(false, 'Plugin not found.');
	if (is_dir($disabled)) self_rmdir($disabled);
	if (!rename($enabled, $disabled)) ajax_out(false, 'Could not disable plugin.');

	ajax_out(true, 'Plugin disabled.');
}

// ── Remove ────────────────────────────────────────────────────────────────────
if ($action === 'remove') {
	$code     = preg_replace('/[^a-z0-9_\-]/i', '', post('code'));
	$path     = DIR_ROOT . 'plugins/'  . $code;
	$disabled = DIR_ROOT . 'plugins/.' . $code;
	$primary  = is_dir($path) ? $path : (is_dir($disabled) ? $disabled : null);

	if (!$primary) ajax_out(false, 'Plugin not found.');

	// Read manifest and run cleanup from the primary (enabled) copy
	$manifest = PluginLoader::readManifest($primary . '/plugin.xml');
	if ($manifest) PluginLoader::dropTables($manifest);

	$uninstall = $primary . '/uninstall.php';
	if (file_exists($uninstall)) {
		try { require $uninstall; } catch (Exception $e) { /* non-fatal */ }
	}

	// Remove both enabled and disabled copies so no orphan remains
	if (is_dir($path))     self_rmdir($path);
	if (is_dir($disabled)) self_rmdir($disabled);

	ajax_out(true, 'Plugin removed.');
}

// ── Load plugin settings form ──────────────────────────────────────────────────
if ($action === 'load_plugin_settings') {
	$code       = preg_replace('/[^a-z0-9_\-]/i', '', post('code'));
	$plugin_dir = DIR_ROOT . 'plugins/' . $code;

	if (!$code || !is_dir($plugin_dir)) ajax_out(false, 'Plugin not found or not enabled.');

	$manifest = PluginLoader::readManifest($plugin_dir . '/plugin.xml');
	if (!$manifest) ajax_out(false, 'Plugin manifest not found.');

	// Hook: admin.plugin.settings.{code}.load — return HTML to override the default form.
	$html = Hook::filter('admin.plugin.settings.' . $code . '.load', null);

	if ($html === null) {
		$settings_file = $plugin_dir . '/admin/settings.php';
		if (file_exists($settings_file)) {
			// Provide current values to the settings template
			$settings = [];
			if (!empty($manifest['settings'])) {
				$pf   = DB_PREFIX;
				$keys = $manifest['settings'];
				$rows = DB::rows(
					"SELECT `key`, `value` FROM `{$pf}settings`
					 WHERE `key` IN (" . implode(',', array_fill(0, count($keys), '?')) . ")",
					$keys
				);
				$settings = array_column($rows, 'value', 'key');
			}
			ob_start();
			include $settings_file;
			$html = ob_get_clean();
		} elseif (!empty($manifest['settings'])) {
			// Auto-generate a simple form from manifest-declared keys
			$pf   = DB_PREFIX;
			$keys = $manifest['settings'];
			$rows = DB::rows(
				"SELECT `key`, `value` FROM `{$pf}settings`
				 WHERE `key` IN (" . implode(',', array_fill(0, count($keys), '?')) . ")",
				$keys
			);
			$values = array_column($rows, 'value', 'key');
			$html   = '';
			foreach ($keys as $key) {
				$val   = htmlspecialchars($values[$key] ?? '', ENT_QUOTES, 'UTF-8');
				$label = htmlspecialchars(ucwords(str_replace(['_', '-'], ' ', $key)), ENT_QUOTES, 'UTF-8');
				$safe  = htmlspecialchars($key, ENT_QUOTES, 'UTF-8');
				$html .= '<div class="df">';
				$html .= '<label for="ps_' . $safe . '">' . $label . '</label>';
				$html .= '<input type="text" id="ps_' . $safe . '" name="' . $safe . '" value="' . $val . '" maxlength="1000">';
				$html .= '</div>';
			}
		} else {
			$html = '<p style="color:var(--nc-text-dim)">This plugin has no configurable settings.</p>';
		}
	}

	ajax_out(true, '', ['html' => $html]);
}

// ── Save plugin settings ───────────────────────────────────────────────────────
if ($action === 'save_plugin_settings') {
	$code       = preg_replace('/[^a-z0-9_\-]/i', '', post('code'));
	$plugin_dir = DIR_ROOT . 'plugins/' . $code;

	if (!$code || !is_dir($plugin_dir)) ajax_out(false, 'Plugin not found or not enabled.');

	$manifest = PluginLoader::readManifest($plugin_dir . '/plugin.xml');
	if (!$manifest) ajax_out(false, 'Plugin manifest not found.');

	$allowed = $manifest['settings'];
	if (empty($allowed)) ajax_out(false, 'This plugin has no configurable settings.');

	// origin records which plugin owns each settings row — read back by
	// plugins/api-keys/admin/index.php to group its "all API keys" view.
	// Previously written here without the column existing in the installer
	// schema at all (fixed in install/ajax.php's settings CREATE TABLE),
	// which made every plugin's settings save throw a fatal 500 — found via
	// this same Playwright suite. Restored now that the column is real.
	$origin = $manifest['settings_origin'] ?? $code;
	$pf = DB_PREFIX;
	foreach ($allowed as $key) {
		DB::exec(
			"INSERT INTO `{$pf}settings` (`key`, `value`, `origin`) VALUES (?, ?, ?)
			 ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `origin` = VALUES(`origin`)",
			[$key, trim((string)post($key)), $origin]
		);
	}

	// Hook: admin.plugin.settings.{code}.save — receives ['code'=>..., 'keys'=>[...]]
	$data = ['code' => $code, 'keys' => $allowed];
	Hook::fire('admin.plugin.settings.' . $code . '.save', $data);

	ajax_out(true, 'Settings saved.');
}

// ── Sidebar items + plugin groups ─────────────────────────────────────────────
if ($action === 'sidebar_items') {
	$section = preg_replace('/[^a-z0-9_\-]/i', '', post('section') ?: 'setup');
	ajax_out(true, '', [
		'items'  => PluginLoader::adminMenuItems($section),
		'groups' => PluginLoader::adminMenuGroups(),
	]);
}

ajax_out(false, 'Unknown action.');

// ── Helper: install one plugin from a zip file path ──────────────────────────
// Returns ['ok' => bool, 'name' => string, 'message' => string]
function install_plugin_zip(string $zip_path): array {
	$zip = new ZipArchive();
	if ($zip->open($zip_path) !== true) {
		return ['ok' => false, 'name' => '', 'message' => 'Could not open zip.'];
	}

	// Find plugin.xml
	$manifest_raw = null;
	$zip_root     = '';
	for ($i = 0; $i < $zip->numFiles; $i++) {
		$name = $zip->getNameIndex($i);
		if (basename($name) === 'plugin.xml') {
			$manifest_raw = $zip->getFromIndex($i);
			$zip_root     = dirname($name);
			if ($zip_root === '.') $zip_root = '';
			break;
		}
	}

	if (!$manifest_raw) {
		$zip->close();
		return ['ok' => false, 'name' => '', 'message' => 'plugin.xml not found.'];
	}

	libxml_use_internal_errors(true);
	$xml = simplexml_load_string($manifest_raw);
	if (!$xml) {
		$zip->close();
		return ['ok' => false, 'name' => '', 'message' => 'plugin.xml is invalid.'];
	}

	$code = preg_replace('/[^a-z0-9_\-]/i', '', (string)($xml->code ?? ''));
	if (!$code) {
		$zip->close();
		return ['ok' => false, 'name' => '', 'message' => 'Plugin manifest missing <code>.'];
	}

	$plugin_dir = DIR_ROOT . 'plugins/' . $code;
	$disabled   = DIR_ROOT . 'plugins/.' . $code;

	if (is_dir($plugin_dir)) self_rmdir($plugin_dir);
	if (is_dir($disabled))   self_rmdir($disabled);

	$dest = DIR_ROOT . 'plugins/';
	if (!is_dir($dest)) mkdir($dest, 0755, true);

	for ($i = 0; $i < $zip->numFiles; $i++) {
		$entry    = $zip->getNameIndex($i);
		$relative = $zip_root ? substr($entry, strlen($zip_root) + 1) : $entry;
		if (!$relative) continue;

		$parts    = explode('/', str_replace('\\', '/', $relative));
		$safe     = array_filter($parts, fn($p) => $p !== '..' && $p !== '.' && $p !== '');
		$relative = implode('/', $safe);
		if (!$relative) continue;

		$target = $dest . $code . '/' . $relative;
		if (str_ends_with($entry, '/')) {
			@mkdir($target, 0755, true);
		} else {
			@mkdir(dirname($target), 0755, true);
			file_put_contents($target, $zip->getFromIndex($i));
		}
	}
	$zip->close();

	$manifest = PluginLoader::readManifest($plugin_dir . '/plugin.xml');
	if (!$manifest) {
		return ['ok' => false, 'name' => $code, 'message' => 'Could not read extracted plugin.xml.'];
	}

	try {
		PluginLoader::createTables($manifest);
	} catch (Exception $e) {
		return ['ok' => false, 'name' => $manifest['name'], 'message' => 'Table creation failed: ' . $e->getMessage()];
	}

	$install_script = $plugin_dir . '/install.php';
	if (file_exists($install_script)) {
		try {
			require $install_script;
			rename($install_script, $plugin_dir . '/install.php.done');
		} catch (Exception $e) {
			return ['ok' => false, 'name' => $manifest['name'], 'message' => 'install.php failed: ' . $e->getMessage()];
		}
	}

	return ['ok' => true, 'name' => $manifest['name'], 'message' => ''];
}

// ── Helper: recursive directory removal ───────────────────────────────────────
function self_rmdir(string $dir): void {
	if (!is_dir($dir)) return;
	$items = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
		RecursiveIteratorIterator::CHILD_FIRST
	);
	foreach ($items as $item) {
		$item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
	}
	rmdir($dir);
}
