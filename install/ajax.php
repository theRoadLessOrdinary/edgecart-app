<?php
/**
 * new-cart install wizard — ajax handler
 */

header('Content-Type: application/json');

function out(bool $ok, string $message = '', array $extra = []): never {
	echo json_encode(['ok' => $ok, 'message' => $message] + $extra);
	exit;
}

// EdgeCart's own database-user password policy - checked here before ever
// attempting CREATE USER, and mirrored exactly by passwordPolicyCheck() in
// index.php's client-side JS. Deliberately NOT dependent on whatever
// validate_password policy (if any) the target MySQL server happens to have
// configured - that varies silently by host, so relying on it meant the real
// requirement was invisible until a raw driver error appeared at submit time.
function password_meets_edgecart_policy(string $pass): bool {
	if (strlen($pass) < 10) return false;
	$classes = 0;
	if (preg_match('/[A-Z]/', $pass))       $classes++;
	if (preg_match('/[a-z]/', $pass))       $classes++;
	if (preg_match('/[0-9]/', $pass))       $classes++;
	if (preg_match('/[^A-Za-z0-9]/', $pass)) $classes++;
	return $classes >= 3;
}

const EC_PASSWORD_POLICY_MESSAGE =
	'That password needs at least 10 characters and 3 of: uppercase letters, lowercase letters, numbers, symbols. ' .
	'Click the ⚡ button to generate one that qualifies.';

// Admin account password policy - a different, stricter-in-a-different-way rule
// than the database password above (every class required, not 3-of-4), mirrored
// exactly by adminPasswordPolicyCheck() in index.php's client-side JS.
function password_meets_admin_policy(string $pass): bool {
	return strlen($pass) >= 8
		&& preg_match('/[A-Z]/', $pass)
		&& preg_match('/[0-9]/', $pass)
		&& preg_match('/[^A-Za-z0-9]/', $pass);
}

// Recursively delete a directory's contents, keeping the directory itself
// (cache dirs must stay writable and present for Smarty to use).
function ec_clear_dir_contents(string $dir): void {
	if (!is_dir($dir)) return;
	$items = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
		RecursiveIteratorIterator::CHILD_FIRST
	);
	foreach ($items as $item) {
		$item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
	}
}

if (file_exists(__DIR__ . '/.installed')) {
	http_response_code(403);
	out(false, 'Already installed.');
}

require_once __DIR__ . '/../lib/license.php';
if (file_exists(__DIR__ . '/../cfg/license.php')) {
	require_once __DIR__ . '/../cfg/license.php';
}
if (!License::checkCore()) {
	http_response_code(403);
	out(false, 'This copy of EdgeCart is signed for a different domain. Reload this page for details.');
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── Check directory permissions ────────────────────────────────────────────────
if ($action === 'check_permissions') {
	$base = realpath(dirname(__DIR__));
	if (!$base) {
		out(false, 'Could not resolve base directory from: ' . dirname(__DIR__));
	}
	$base .= '/';

	$dirs = [
		'cfg'                => $base . 'cfg',
		'cache/tpl'          => $base . 'cache/tpl',
		'cache/tpl/admin'    => $base . 'cache/tpl/admin',
		'cache/smarty'       => $base . 'cache/smarty',
		'cache/smarty/admin' => $base . 'cache/smarty/admin',
		'logs'               => $base . 'logs',
		'img/avatars'        => $base . 'img/avatars',
		'img/products'       => $base . 'img/products',
		'img/products/.admin'       => $base . 'img/products/.admin',
		'img/products/.fm' => $base . 'img/products/.fm',
		'img/options'        => $base . 'img/options',
		'install'            => $base . 'install',
	];

	// Look up the owner of a path (falls back to a bare uid if posix_* isn't
	// available, which is common on some hosts).
	$ownerOf = function (string $path) {
		$uid = @fileowner($path);
		if ($uid === false) return null;
		if (function_exists('posix_getpwuid')) {
			$pw = posix_getpwuid($uid);
			if ($pw) return $pw['name'];
		}
		return "uid {$uid}";
	};
	$whoami = function_exists('posix_getpwuid')
		? (posix_getpwuid(posix_geteuid())['name'] ?? 'the web server user')
		: 'the web server user';

	$failed  = [];
	$details = [];
	foreach ($dirs as $label => $path) {
		if (!is_dir($path)) {
			$made = @mkdir($path, 0755, true);
			$details[] = $label . ': mkdir ' . ($made ? 'OK' : 'FAILED');
		}
		// Use actual write test — is_writable() can lie about effective user
		$testFile = $path . '/.nc_write_test';
		$wrote = @file_put_contents($testFile, '1');
		if ($wrote === false) {
			$failed[]  = $label . '/';
			$owner = $ownerOf($path);
			$ownerNote = $owner ? " - owned by '{$owner}', running as '{$whoami}'" : '';
			$details[] = $label . ': NOT writable (path: ' . $path . ')' . $ownerNote;
		} else {
			@unlink($testFile);
			$details[] = $label . ': OK';
		}
	}

	// Directory-level write tests above only prove *new* files can be created —
	// they don't prove an *existing* file with different ownership can be
	// overwritten. .htaccess is exactly that case: a stale copy from an earlier
	// partial install, a zip extracted as a different user, or a host default
	// can sit there root/other-owned while the directory itself is writable.
	// Round-trip its own content rather than truncating it, so this check never
	// loses data even if it fails partway.
	$htaccessPath = $base . '.htaccess';
	if (file_exists($htaccessPath)) {
		$orig     = @file_get_contents($htaccessPath);
		$canWrite = $orig !== false && @file_put_contents($htaccessPath, $orig) !== false;
		if (!$canWrite) {
			$failed[] = '.htaccess';
			$owner = $ownerOf($htaccessPath);
			$ownerNote = $owner ? " - owned by '{$owner}', running as '{$whoami}'" : '';
			$details[] = '.htaccess: NOT writable (path: ' . $htaccessPath . ')' . $ownerNote;
		} else {
			$details[] = '.htaccess: OK';
		}
	}

	if ($failed) {
		$list = implode(', ', $failed);
		$targets = "{$base}cfg {$base}cache {$base}logs {$base}img {$base}install";
		out(false,
			"Not writable: {$list}\n" .
			"Try: find {$targets} -type d -exec chmod 755 {} + && find {$targets} -type f -exec chmod 644 {} + && chmod 644 {$base}.htaccess\n" .
			"If that doesn't fix it, these files are likely owned by a different user than your hosting account can control — contact your web host's support and ask them to correct file ownership for this directory.",
			['details' => $details, 'base' => $base]
		);
	}

	out(true, 'All required directories are writable.', ['details' => $details]);
}

// ── Test root credentials ──────────────────────────────────────────────────────
if ($action === 'test_root') {
	$host   = trim($_POST['db_host']  ?? 'localhost');
	$root   = trim($_POST['db_root']  ?? '');
	$rootpw = $_POST['db_rootpw']     ?? '';

	if (!$host || !$root) out(false, 'Host and root username are required.');

	try {
		new PDO("mysql:host={$host};charset=utf8mb4", $root, $rootpw, [
			PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
		]);
		out(true, 'Root credentials verified.');
	} catch (PDOException $e) {
		out(false, $e->getMessage());
	}
}

// ── Create database ────────────────────────────────────────────────────────────
if ($action === 'create_db') {
	$host   = trim($_POST['db_host']  ?? 'localhost');
	$name   = trim($_POST['db_name']  ?? '');
	$root   = trim($_POST['db_root']  ?? '');
	$rootpw = $_POST['db_rootpw']     ?? '';

	if (!$host || !$name || !$root) {
		out(false, 'Host, database name and root username are required.');
	}

	try {
		$pdo  = new PDO("mysql:host={$host};charset=utf8mb4", $root, $rootpw, [
			PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
		]);
		$safe = str_replace('`', '', $name);
		$pdo->exec("CREATE DATABASE IF NOT EXISTS `{$safe}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
		out(true, "Database '{$name}' created (or already exists).");
	} catch (PDOException $e) {
		out(false, $e->getMessage());
	}
}

// ── Create database user ───────────────────────────────────────────────────────
if ($action === 'create_user') {
	$host    = trim($_POST['db_host']   ?? 'localhost');
	$db_name = trim($_POST['db_name']   ?? '');
	$root    = trim($_POST['db_root']   ?? '');
	$rootpw  = $_POST['db_rootpw']      ?? '';
	$newuser = trim($_POST['db_user']   ?? '');
	$newpass = $_POST['db_pass']        ?? '';
	$prefix  = preg_replace('/[^a-z0-9_]/i', '', trim($_POST['db_prefix'] ?? 'nc_'));

	if (!$root || !$newuser || !$newpass || !$db_name) {
		out(false, 'Root credentials, username, password and database name are all required.');
	}
	if (!password_meets_edgecart_policy($newpass)) {
		out(false, EC_PASSWORD_POLICY_MESSAGE);
	}

	try {
		$pdo = new PDO("mysql:host={$host};charset=utf8mb4", $root, $rootpw, [
			PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
		]);

		$safeDb = str_replace('`', '', $db_name);

		// PDO::quote() escapes for a SQL string literal without altering the
		// value itself — unlike stripping quote characters out, which silently
		// changes the password to something other than what was typed and
		// verification below would then fail to authenticate with the (unaltered)
		// original password.
		$userSql = $pdo->quote($newuser);
		$passSql = $pdo->quote($newpass);
		// Grant on whatever host was actually entered — hardcoding 'localhost'
		// here would silently mismatch a customer-entered '127.0.0.1' (or any
		// other host), and MySQL treats those as different grant scopes even
		// though PHP connects to both the same way.
		$hostSql = $pdo->quote($host);

		// CREATE USER IF NOT EXISTS is a no-op when the account already exists
		// (e.g. a prior install attempt against this same DB user) — it would
		// silently leave that older password in place while this run's
		// verification tries the password just submitted. ALTER USER always
		// sets the password, whether the account was just created here or
		// already existed, so re-running install is idempotent regardless of
		// what password an earlier attempt used.
		$pdo->exec("CREATE USER IF NOT EXISTS {$userSql}@{$hostSql} IDENTIFIED BY {$passSql}");
		$pdo->exec("ALTER USER {$userSql}@{$hostSql} IDENTIFIED BY {$passSql}");
		$pdo->exec("GRANT ALL PRIVILEGES ON `{$safeDb}`.* TO {$userSql}@{$hostSql}");
		$pdo->exec("FLUSH PRIVILEGES");

		// Verify the new user can actually connect. Root's CREATE USER/GRANT
		// above have already succeeded by this point — a failure here is a
		// separate, subsequent problem (e.g. a host-scope mismatch), not a
		// sign that user creation itself used the wrong credentials. Catch it
		// separately so the message doesn't read as "creation used the new
		// user" when creation via root already worked.
		try {
			$dsn    = "mysql:host={$host};dbname={$safeDb};charset=utf8mb4";
			$appPdo = new PDO($dsn, $newuser, $newpass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
		} catch (PDOException $e) {
			out(false,
				"User '{$newuser}' was created, but connecting as that user failed: {$e->getMessage()}\n" .
				"This usually means the grant host ('{$host}') doesn't match how MySQL sees this connection — try 'localhost' or '127.0.0.1' for the DB host."
			);
		}

		// Check if prefix is already in use
		$safePrefix  = str_replace('`', '', $prefix);
		$tableCheck  = $appPdo->query(
			"SELECT COUNT(*) FROM information_schema.tables
			 WHERE table_schema = DATABASE()
			 AND table_name LIKE '{$safePrefix}%'"
		)->fetchColumn();

		if ((int)$tableCheck > 0) {
			out(false,
				"The table prefix '{$prefix}' is already in use in this database " .
				"({$tableCheck} table(s) found). Choose a different prefix to avoid conflicts.",
				['prefix_conflict' => true]
			);
		}

		out(true, "User '{$newuser}' created and connection verified.");
	} catch (PDOException $e) {
		// password_meets_edgecart_policy() above is the real defense and runs before
		// this is ever reached - this is only a fallback for the rare production host
		// whose own MySQL policy is stricter than ours (e.g. requires 12+ characters).
		// Same "generic SQLSTATE, match on message text" reasoning as before: HY000
		// covers many unrelated errors, so the message content is what actually
		// identifies this one.
		if (str_contains($e->getMessage(), 'password does not satisfy')) {
			out(false, EC_PASSWORD_POLICY_MESSAGE . " (This particular server's own MySQL policy is even stricter than EdgeCart's default - " . $e->getMessage() . ')');
		}
		out(false, "Could not create database user (using root): {$e->getMessage()}");
	}
}

// ── Verify an already-created database + user ───────────────────────────────────
// Some hosts (most shared/cPanel-style hosting) provision the database and its
// user themselves and never hand out a true MySQL root account — the "root"
// they give a customer is really just that one database's own scoped user,
// which typically lacks CREATE USER/CREATE DATABASE privileges entirely (and
// doesn't need them, since the host already did that part). create_db/
// create_user above fail outright on that kind of host. This path skips
// creation entirely and just confirms the credentials the customer already has
// actually work against the database they already have.
if ($action === 'test_existing_db') {
	$host    = trim($_POST['db_host']   ?? 'localhost');
	$db_name = trim($_POST['db_name']   ?? '');
	$newuser = trim($_POST['db_user']   ?? '');
	$newpass = $_POST['db_pass']        ?? '';
	$prefix  = preg_replace('/[^a-z0-9_]/i', '', trim($_POST['db_prefix'] ?? 'nc_'));

	if (!$host || !$db_name || !$newuser || !$newpass) {
		out(false, 'Host, database name, username and password are all required.');
	}

	$safeDb = str_replace('`', '', $db_name);

	try {
		$dsn    = "mysql:host={$host};dbname={$safeDb};charset=utf8mb4";
		$appPdo = new PDO($dsn, $newuser, $newpass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
	} catch (PDOException $e) {
		out(false,
			"Could not connect to '{$db_name}' as '{$newuser}': {$e->getMessage()}\n" .
			"Double-check these are exactly the database name, username, and password your host gave you — this install path never attempts to create or change them."
		);
	}

	$safePrefix = str_replace('`', '', $prefix);
	$tableCheck = $appPdo->query(
		"SELECT COUNT(*) FROM information_schema.tables
		 WHERE table_schema = DATABASE()
		 AND table_name LIKE '{$safePrefix}%'"
	)->fetchColumn();

	if ((int)$tableCheck > 0) {
		out(false,
			"The table prefix '{$prefix}' is already in use in this database " .
			"({$tableCheck} table(s) found). Choose a different prefix to avoid conflicts.",
			['prefix_conflict' => true]
		);
	}

	out(true, "Connected to '{$db_name}' as '{$newuser}'.");
}

// ── Validate admin account ─────────────────────────────────────────────────────
if ($action === 'validate_admin') {
	$username = trim($_POST['admin_user']  ?? '');
	$email    = trim($_POST['admin_email'] ?? '');
	$pass     = $_POST['admin_pass']       ?? '';
	$confirm  = $_POST['admin_confirm']    ?? '';

	if (strlen($username) < 3)                        out(false, 'Username must be at least 3 characters.');
	if (!filter_var($email, FILTER_VALIDATE_EMAIL))   out(false, 'Invalid email address.');
	if (!password_meets_admin_policy($pass))          out(false, 'Password must be at least 8 characters, with a capital letter, a number, and a special character.');
	if ($pass !== $confirm)                           out(false, 'Passwords do not match.');

	out(true, 'Admin details look good.');
}

// ── Full install ───────────────────────────────────────────────────────────────
// ── Sample inventory seed ─────────────────────────────────────────────────────
function seed_sample_inventory(PDO $pdo, string $p, string $base): void {
	// Global options
	$pdo->exec("INSERT IGNORE INTO `{$p}options` (id, name, type, display_order) VALUES (1,'Size','select',0),(2,'Color','select',1)");
	$pdo->exec("INSERT IGNORE INTO `{$p}option_values` (id, option_id, text, display_order) VALUES
		(1,1,'XS',0),(2,1,'S',1),(3,1,'M',2),(4,1,'L',3),(5,1,'XL',4),
		(6,2,'Black',0),(7,2,'White',1),(8,2,'Navy',2),(9,2,'Gray',3)");

	// Categories — [id, name, slug, image, banner, homepage_default]
	// Both categories have real seeded products. Kept to 2, one under the
	// free-tier category limit (admin.limit.categories default is 3), so a
	// fresh eval install with sample data has room to actually try adding a
	// category before hitting the upgrade wall. Landing on exactly the limit
	// still hides the Add button on first load (count >= limit), which is as
	// bad a first impression as starting over it.
	$cats = [
		[1, "Men's Basics",   'mens-basics',   '/img/categories/mens-basics.webp',  '/img/categories/mens-basics.webp',   0],
		[2, "Women's Basics", 'womens-basics',  '/img/categories/womens-basics.webp', '/img/categories/womens-basics.webp', 1],
	];
	$sc = $pdo->prepare("INSERT IGNORE INTO `{$p}categories` (id, name, slug, image, banner, homepage_default, status, display_order) VALUES (?,?,?,?,?,?,1,?)");
	foreach ($cats as $i => $c) { $sc->execute([$c[0], $c[1], $c[2], $c[3], $c[4], $c[5], $i]); }

	// Products — [id, cat_id, name, slug, price, list_price, desc, img1, img2]
	// Four per category, for neatness. "Lace-Trim V-Neck Tee" (id 9) references a
	// photo that doesn't exist on disk yet — the merchant supplies it separately.
	$products = [
		// Men's Basics
		[1, 1, 'Baseball Shirt',      'mens-baseball-shirt',    32.00, 38.00, 'A classic two-tone baseball shirt with contrast sleeves. Comfortable everyday wear.',         '/img/products/mens-baseball-shirt-front.webp',  '/img/products/mens-baseball-shirt-back.webp'],
		[2, 1, '3/4 Sleeve Tee',      'mens-3-4-sleeve-tee',    28.00,  0.00, 'Relaxed fit 3/4 sleeve tee in soft cotton. Perfect between-season layering piece.',          '/img/products/mens-3-4-sleeve-tee.webp',         ''],
		[4, 1, 'Classic Tee — Gray',   'mens-classic-tee-gray',  22.00,  0.00, 'Essential heather gray crew-neck tee. Everyday staple in soft ringspun cotton.',            '/img/products/mens-tshirt-gray-front.webp',      ''],
		[5, 1, 'Classic Tee — Green',  'mens-classic-tee-green', 22.00,  0.00, 'Washed olive crew-neck tee with a lived-in feel. Pairs with everything.',                   '/img/products/mens-tshirt-green-front.webp',     '/img/products/mens-tshirt-green-back.webp'],
		// Women's Basics
		[6, 2, 'Tank Top',             'womens-tank-top',         20.00,  0.00, 'Soft ribbed tank top with a flattering fit. A wardrobe essential.',                        '/img/products/womens-tanktop-front.webp',        '/img/products/womens-tanktop-back.webp'],
		[7, 2, 'Long Sleeve',          'womens-long-sleeve',      28.00, 34.00, 'Violet long sleeve top in a relaxed fit. Ultra-soft fabric with a clean minimalist look.', '/img/products/womans-long-sleeve-violet.webp',   ''],
		[8, 2, 'Classic Tee — Blue',   'womens-classic-tee-blue', 22.00,  0.00, 'Relaxed crew-neck tee in a soft cornflower blue. Easy to wear, easy to love.',            '/img/products/womens-tee-blue-front.webp',       '/img/products/womens-tee.webp'],
		[9, 2, 'Lace-Trim V-Neck Tee', 'womens-lace-vneck-tee',   26.00,  0.00, 'Soft v-neck tee finished with delicate lace trim at the neckline. Effortlessly feminine, easy everyday fit.', '/img/products/womens-vneck-lace-tee-front.webp', ''],
	];

	$sp  = $pdo->prepare("INSERT IGNORE INTO `{$p}products` (id, name, slug, description, price, list_price, stock, status, featured, display_order) VALUES (?,?,?,?,?,?,99,1,?,?)");
	$scp = $pdo->prepare("INSERT IGNORE INTO `{$p}categories_products` (category_id, product_id) VALUES (?,?)");
	$spo = $pdo->prepare("INSERT INTO `{$p}product_options` (product_id, option_id, label, required, display_order) VALUES (?,?,?,1,?)");
	$spov = $pdo->prepare("INSERT INTO `{$p}product_option_values` (product_option_id, option_value_id) VALUES (?,?)");
	$si  = $pdo->prepare("INSERT INTO `{$p}product_images` (product_id, filename, is_primary, display_order) VALUES (?,?,?,?)");

	foreach ($products as $ord => $prod) {
		[$id, $cat_id, $name, $slug, $price, $list_price, $desc, $img1, $img2] = $prod;
		$featured = ($id === 1 || $id === 6) ? 1 : 0;
		$sp->execute([$id, $name, $slug, $desc, $price, $list_price, $featured, $ord]);
		$scp->execute([$cat_id, $id]);

		// Product already existed (INSERT IGNORE was a no-op) — its options and images
		// were seeded on the first run. product_options/product_option_values/
		// product_images have no unique key of their own, so re-running these inserts
		// would silently duplicate rows on every re-seed against the same DB.
		if ($sp->rowCount() === 0) continue;

		// Size option on all products
		$spo->execute([$id, 1, 'Size', 0]);
		$po_size_id = (int)$pdo->lastInsertId();
		foreach ([1,2,3,4,5] as $vid) { $spov->execute([$po_size_id, $vid]); }

		// Images
		foreach (array_values(array_filter([$img1, $img2])) as $i => $img) {
			$si->execute([$id, $img, $i === 0 ? 1 : 0, $i]);
		}
	}

	// Store logo
	$pdo->exec("INSERT INTO `{$p}settings` (`key`, `value`) VALUES ('store_logo_url', '/img/homepage/logo-dk.webp')
		ON DUPLICATE KEY UPDATE `value` = '/img/homepage/logo-dk.webp'");

	// Show the filler categories in the top nav too — hide_empty_categories
	// defaults to on, which would otherwise make them invisible everywhere
	// except the homepage's category shelf.
	$pdo->exec("INSERT INTO `{$p}settings` (`key`, `value`) VALUES ('hide_empty_categories', '0')
		ON DUPLICATE KEY UPDATE `value` = '0'");
}

// ── Sample customers + orders seed ────────────────────────────────────────────
function seed_sample_customers(PDO $pdo, string $p): void {
	$customers = [
		[1, 'alex.morgan@example.com',   'Alex',   'Morgan',  'INDEPENDENCE',   'MO', '64055', 'US'],
		[2, 'jordan.lee@example.com',    'Jordan', 'Lee',     'BONNER SPRINGS', 'KS', '66012', 'US'],
		[3, 'taylor.brooks@example.com', 'Taylor', 'Brooks',  'KANSAS CITY',    'MO', '64108', 'US'],
		[4, 'jamie.chen@example.com',    'Jamie',  'Chen',    'OVERLAND PARK',  'KS', '66214', 'US'],
		[5, 'casey.rivera@example.com',  'Casey',  'Rivera',  'LENEXA',         'KS', '66215', 'US'],
	];
	$hash = password_hash('Sample123!', PASSWORD_BCRYPT);
	$sc = $pdo->prepare("INSERT IGNORE INTO `{$p}customers` (id, email, password, first_name, last_name, status) VALUES (?,?,?,?,?,1)");
	foreach ($customers as $c) { $sc->execute([$c[0], $c[1], $hash, $c[2], $c[3]]); }

	// Alex is a repeat customer (2 orders); everyone else has 1
	$order_data = [
		// [cust_id, ship_first, ship_last, city, state, zip, country, items => [[product_id, name, price, qty]]]
		[1,'Alex',   'Morgan',  'INDEPENDENCE',   'MO','64055','US', [[1,'Baseball Shirt',     32.00,1],[5,'Classic Tee — Green',22.00,2]]],
		[1,'Alex',   'Morgan',  'INDEPENDENCE',   'MO','64055','US', [[2,'3/4 Sleeve Tee',     28.00,1],[6,'Tank Top',           20.00,1]]],
		[2,'Jordan', 'Lee',     'BONNER SPRINGS', 'KS','66012','US', [[2,'3/4 Sleeve Tee',     28.00,1],[8,'Classic Tee — Blue', 22.00,1]]],
		[3,'Taylor', 'Brooks',  'KANSAS CITY',    'MO','64108','US', [[4,'Classic Tee — Gray', 22.00,2],[7,'Long Sleeve',        28.00,1]]],
		[4,'Jamie',  'Chen',    'OVERLAND PARK',  'KS','66214','US', [[8,'Classic Tee — Blue',22.00,1],[5,'Classic Tee — Green',22.00,1]]],
		[5,'Casey',  'Rivera',  'LENEXA',         'KS','66215','US', [[1,'Baseball Shirt',     32.00,1],[6,'Tank Top',           20.00,2]]],
	];

	$statuses = ['shipped','paid','shipped','paid','paid','shipped'];
	$so = $pdo->prepare("INSERT INTO `{$p}orders`
		(customer_id, status, subtotal, total, shipping, ship_firstname, ship_lastname,
		 ship_city, ship_state, ship_zip, ship_country, ship_method, created_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,'Ground Advantage', DATE_SUB(NOW(), INTERVAL ? DAY))");
	$si = $pdo->prepare("INSERT INTO `{$p}order_items` (order_id, product_id, name, price, qty) VALUES (?,?,?,?,?)");

	foreach ($order_data as $i => $od) {
		[$cust_id, $sfirst, $slast, $city, $state, $zip, $country, $items] = $od;
		$subtotal = array_sum(array_map(fn($it) => $it[2] * $it[3], $items));
		$shipping = 7.99;
		$total    = $subtotal + $shipping;
		$days_ago = 5 + ($i * 12);
		$so->execute([$cust_id, $statuses[$i], $subtotal, $total, $shipping, $sfirst, $slast, $city, $state, $zip, $country, $days_ago]);
		$oid = (int)$pdo->lastInsertId();
		foreach ($items as $it) { $si->execute([$oid, $it[0], $it[1], $it[2], $it[3]]); }
	}
}

if ($action === 'install') {
	// A re-install into the same directory (a failed first attempt, a
	// redeployed zip, etc.) can leave behind compiled Smarty templates from
	// a previous run whose plugin/template-dir configuration no longer
	// matches — Smarty's {extends} inheritance bakes a resolved parent-
	// template path into the COMPILED php cache file at compile time, and a
	// stale one can reference a relative path that's no longer valid,
	// producing "Unable to load template 'file:../layout.html'"-style
	// fatal errors for any page rendered through that stale cache (found
	// via a real reinstall on a shared host, plugins/slideshows/admin/
	// index.php). A fresh install must always start with an empty compile
	// cache regardless of what was here before.
	ec_clear_dir_contents(dirname(__DIR__) . '/cache/tpl');
	ec_clear_dir_contents(dirname(__DIR__) . '/cache/smarty');

	$host      = trim($_POST['db_host']      ?? '');
	$name      = trim($_POST['db_name']      ?? '');
	$user      = trim($_POST['db_user']      ?? '');
	$pass      = $_POST['db_pass']           ?? '';
	$prefix    = preg_replace('/[^a-z0-9_]/i', '', trim($_POST['db_prefix'] ?? 'nc_'));

	$admin_user  = trim($_POST['admin_user']  ?? '');
	$admin_email = trim($_POST['admin_email'] ?? '');
	$admin_pass  = $_POST['admin_pass']       ?? '';

	$site_name        = trim($_POST['site_name']        ?? 'My Store');
	$site_currency    = trim($_POST['site_currency']    ?? '$');
	$site_email       = trim($_POST['site_email']       ?? '');
	$admin_path       = preg_replace('/[^a-z0-9_\-]/i', '', trim($_POST['admin_path'] ?? 'admin'));
	$sample_inventory = true;
	$sample_customers = true;

	if (!$host || !$name || !$user) out(false, 'Missing database credentials.');
	if (!$admin_user || !$admin_email || !$admin_pass) out(false, 'Missing admin details.');
	// Re-check here too, not just in validate_admin above - this endpoint is
	// reachable on its own, so it shouldn't trust that the earlier step ran.
	if (!password_meets_admin_policy($admin_pass)) {
		out(false, 'Password must be at least 8 characters, with a capital letter, a number, and a special character.');
	}

	// Connect as app user
	try {
		$dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
		$pdo = new PDO($dsn, $user, $pass, [
			PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
			PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
		]);
	} catch (PDOException $e) {
		out(false, 'DB connection failed: ' . $e->getMessage());
	}

	// Create tables
	$p      = $prefix;
	$tables = [
		"CREATE TABLE IF NOT EXISTS `{$p}admin` (
			`id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`username`     VARCHAR(64)  NOT NULL,
			`email`        VARCHAR(128) NOT NULL,
			`password`     VARCHAR(255) NOT NULL,
			`access_level` SMALLINT UNSIGNED NOT NULL DEFAULT 254,
			`avatar`       VARCHAR(255) NOT NULL DEFAULT '',
			`status`       TINYINT(1)   NOT NULL DEFAULT 1,
			`created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			UNIQUE KEY `username` (`username`),
			UNIQUE KEY `email` (`email`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}settings` (
			`key`    VARCHAR(128) NOT NULL,
			`value`  TEXT,
			`origin` VARCHAR(64) DEFAULT NULL,
			PRIMARY KEY (`key`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}categories` (
			`id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`parent_id`       INT UNSIGNED NOT NULL DEFAULT 0,
			`name`            VARCHAR(255) NOT NULL,
			`description`     TEXT,
			`image`           VARCHAR(255) NOT NULL DEFAULT '',
			`banner`          VARCHAR(255) NOT NULL DEFAULT '',
			`slug`            VARCHAR(255) NOT NULL,
			`seo_title`       VARCHAR(300) NOT NULL DEFAULT '',
			`seo_keywords`    VARCHAR(500) NOT NULL DEFAULT '',
			`seo_description` VARCHAR(500) NOT NULL DEFAULT '',
			`html_short`      TEXT,
			`html_long`       MEDIUMTEXT,
			`featured`          TINYINT(1)   NOT NULL DEFAULT 0,
			`homepage_default`  TINYINT(1)   NOT NULL DEFAULT 0,
			`status`            TINYINT(1)   NOT NULL DEFAULT 1,
			`display_order`   INT UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`),
			KEY `parent_id` (`parent_id`),
			KEY `slug` (`slug`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}products` (
			`id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`name`             VARCHAR(255)  NOT NULL,
			`slug`             VARCHAR(255)  NOT NULL,
			`sku`              VARCHAR(128)  NOT NULL DEFAULT '',
			`description`      TEXT,
			`description_long` MEDIUMTEXT,
			`seo_title`        VARCHAR(300) NOT NULL DEFAULT '',
			`seo_keywords`     VARCHAR(500) NOT NULL DEFAULT '',
			`seo_description`  VARCHAR(500) NOT NULL DEFAULT '',
			`price`            DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			`list_price`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			`stock`            INT           NOT NULL DEFAULT 0,
			`status`           TINYINT(1)    NOT NULL DEFAULT 1,
			`featured`         TINYINT(1)    NOT NULL DEFAULT 0,
			`free_shipping`    TINYINT(1)    NOT NULL DEFAULT 0,
			`requires_shipping` TINYINT(1)   NOT NULL DEFAULT 1,
			`weight`           DECIMAL(8,3)  NOT NULL DEFAULT 0,
			`taxable`          TINYINT(1)    NOT NULL DEFAULT 1,
			`google_ads_title` VARCHAR(150)  NOT NULL DEFAULT '',
			`display_order`    INT UNSIGNED  NOT NULL DEFAULT 0,
			`featured_order`   INT UNSIGNED  NOT NULL DEFAULT 0,
			`created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			KEY `slug` (`slug`),
			KEY `sku` (`sku`),
			KEY `status` (`status`),
			KEY `featured` (`featured`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}product_images` (
			`id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`product_id`    INT UNSIGNED NOT NULL,
			`filename`      VARCHAR(255) NOT NULL,
			`is_primary`    TINYINT(1)   NOT NULL DEFAULT 0,
			`display_order` INT UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`),
			KEY `product_id` (`product_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}categories_products` (
			`category_id` INT UNSIGNED NOT NULL,
			`product_id`  INT UNSIGNED NOT NULL,
			PRIMARY KEY (`category_id`, `product_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}product_related` (
			`product_id`         INT UNSIGNED NOT NULL,
			`related_product_id` INT UNSIGNED NOT NULL,
			`display_order`      INT UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY (`product_id`, `related_product_id`),
			KEY `related_product_id` (`related_product_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}customers` (
			`id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`email`      VARCHAR(128)  NOT NULL,
			`password`   VARCHAR(255)  NOT NULL DEFAULT '',
			`google_id`  VARCHAR(128)  DEFAULT NULL,
			`first_name` VARCHAR(64),
			`last_name`  VARCHAR(64),
			`status`     TINYINT(1)    NOT NULL DEFAULT 1,
			`address1`   VARCHAR(255)  NOT NULL DEFAULT '',
			`address2`   VARCHAR(255)  NOT NULL DEFAULT '',
			`city`       VARCHAR(100)  NOT NULL DEFAULT '',
			`state`      VARCHAR(64)   NOT NULL DEFAULT '',
			`zip`        VARCHAR(20)   NOT NULL DEFAULT '',
			`country`    VARCHAR(2)    NOT NULL DEFAULT 'US',
			`notes`      TEXT,
			`created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			UNIQUE KEY `email` (`email`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}orders` (
			`id`                 INT UNSIGNED   NOT NULL AUTO_INCREMENT,
			`customer_id`        INT UNSIGNED,
			`status`             VARCHAR(32)    NOT NULL DEFAULT 'pending',
			`subtotal`           DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`total`              DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`shipping`           DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`tax`                DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`ship_email`         VARCHAR(255)   NOT NULL DEFAULT '',
			`ship_phone`         VARCHAR(32)    NOT NULL DEFAULT '',
			`ship_firstname`     VARCHAR(200)   NOT NULL DEFAULT '',
			`ship_lastname`      VARCHAR(200)   NOT NULL DEFAULT '',
			`ship_address1`      VARCHAR(255),
			`ship_address2`      VARCHAR(255),
			`ship_city`          VARCHAR(128),
			`ship_state`         VARCHAR(64),
			`ship_zip`           VARCHAR(20),
			`ship_country`       VARCHAR(64),
			`ship_method`        VARCHAR(128)   NOT NULL DEFAULT '',
			`shippo_rate_token`  VARCHAR(255)   NOT NULL DEFAULT '',
			`payment_ref`        VARCHAR(255)   NOT NULL DEFAULT '',
			`payment_method`     VARCHAR(64)    NOT NULL DEFAULT '',
			`tracking_number`    VARCHAR(128)   NOT NULL DEFAULT '',
			`tracking_url`       VARCHAR(512)   NOT NULL DEFAULT '',
			`label_url`          VARCHAR(512)   NOT NULL DEFAULT '',
			`discount_code`      VARCHAR(20),
			`discount_amount`    DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`created_at`         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			KEY `customer_id` (`customer_id`),
			KEY `status` (`status`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}order_items` (
			`id`              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`order_id`        INT UNSIGNED  NOT NULL,
			`product_id`      INT UNSIGNED  NOT NULL,
			`name`            VARCHAR(255)  NOT NULL,
			`price`           DECIMAL(10,2) NOT NULL,
			`qty`             INT UNSIGNED  NOT NULL DEFAULT 1,
			`options`         TEXT,
			`options_summary` TEXT,
			PRIMARY KEY (`id`),
			KEY `order_id` (`order_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}order_statuses` (
			`id`              INT UNSIGNED   NOT NULL AUTO_INCREMENT,
			`slug`            VARCHAR(32)    NOT NULL,
			`label`           VARCHAR(64)    NOT NULL,
			`color`           VARCHAR(16)    NOT NULL DEFAULT '#6b7280',
			`sort_order`      TINYINT UNSIGNED NOT NULL DEFAULT 0,
			`is_cancellation` TINYINT(1)    NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`),
			UNIQUE KEY `uq_slug` (`slug`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}incomplete` (
			`id`         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`entity`     VARCHAR(64)   NOT NULL,
			`entity_id`  INT UNSIGNED  NOT NULL,
			`label`      VARCHAR(255)  NOT NULL,
			`message`    VARCHAR(500)  NOT NULL,
			`created_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			UNIQUE KEY `entity_item` (`entity`, `entity_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}options` (
			`id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`name`          VARCHAR(255)  NOT NULL,
			`type`          VARCHAR(32)   NOT NULL DEFAULT 'select',
			`placeholder`   VARCHAR(255)  NOT NULL DEFAULT '',
			`display_order` INT UNSIGNED  NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}option_values` (
			`id`                    INT UNSIGNED   NOT NULL AUTO_INCREMENT,
			`option_id`             INT UNSIGNED   NOT NULL,
			`text`                  VARCHAR(255)   NOT NULL,
			`image`                 VARCHAR(255)   NOT NULL DEFAULT '',
			`price_prefix`          VARCHAR(1)     DEFAULT '+',
			`price_modifier`        DECIMAL(10,2)  DEFAULT NULL,
			`weight_modifier`       DECIMAL(10,2)  DEFAULT NULL,
			`apply_only_with_value` TINYINT(1)     DEFAULT 0,
			`display_order`         INT UNSIGNED   NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`),
			KEY `option_id` (`option_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}product_options` (
			`id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`product_id`    INT UNSIGNED  NOT NULL,
			`option_id`     INT UNSIGNED  NOT NULL,
			`label`         VARCHAR(255)  NOT NULL DEFAULT '',
			`required`      TINYINT(1)    NOT NULL DEFAULT 0,
			`use_as_images` TINYINT(1)    NOT NULL DEFAULT 0,
			`display_order` INT UNSIGNED  NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`),
			KEY `product_id` (`product_id`),
			KEY `option_id`  (`option_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}product_option_values` (
			`id`                INT UNSIGNED   NOT NULL AUTO_INCREMENT,
			`product_option_id` INT UNSIGNED   NOT NULL,
			`option_value_id`   INT UNSIGNED   NOT NULL,
			`label`             VARCHAR(255)   NOT NULL DEFAULT '',
			`price_modifier`    DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`price_prefix`      CHAR(1)        NOT NULL DEFAULT '+',
			`weight_modifier`   DECIMAL(10,4)  NOT NULL DEFAULT 0.0000,
			`weight_prefix`     CHAR(1)        NOT NULL DEFAULT '+',
			`stock`             INT            NOT NULL DEFAULT 0,
			`subtract_stock`    TINYINT(1)     NOT NULL DEFAULT 0,
			`enabled`           TINYINT(1)     NOT NULL DEFAULT 1,
			`is_default`        TINYINT(1)     NOT NULL DEFAULT 0,
			PRIMARY KEY (`id`),
			KEY `product_option_id` (`product_option_id`),
			KEY `option_value_id`   (`option_value_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		// ── Pages ──────────────────────────────────────────────────────────────
		"CREATE TABLE IF NOT EXISTS `{$p}pages` (
			`id`              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`title`           VARCHAR(255)  NOT NULL,
			`slug`            VARCHAR(255)  NOT NULL,
			`page_type`       VARCHAR(32)   NOT NULL DEFAULT 'page',
			`status`          TINYINT(1)    NOT NULL DEFAULT 1,
			`seo_title`       VARCHAR(300)  NOT NULL DEFAULT '',
			`seo_keywords`    VARCHAR(500)  NOT NULL DEFAULT '',
			`seo_description`  VARCHAR(500)  NOT NULL DEFAULT '',
			`content`          TEXT,
			`sidebar_position` VARCHAR(16)   NOT NULL DEFAULT 'left',
			`display_order`    INT UNSIGNED  NOT NULL DEFAULT 0,
			`created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			UNIQUE KEY `slug` (`slug`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}page_blocks` (
			`id`            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`page_id`       INT UNSIGNED  NOT NULL,
			`block_type`    VARCHAR(64)   NOT NULL,
			`settings`      JSON,
			`display_order` INT UNSIGNED  NOT NULL DEFAULT 0,
			`enabled`       TINYINT(1)    NOT NULL DEFAULT 1,
			`cols`          TINYINT(1)    NOT NULL DEFAULT 4,
			`col_start`     TINYINT(1)    NOT NULL DEFAULT 1,
			`col_span`      TINYINT(1)    NOT NULL DEFAULT 4,
			`row`           SMALLINT      NOT NULL DEFAULT 0,
			`row_span`      TINYINT(1)    NOT NULL DEFAULT 1,
			`name`          VARCHAR(255)  NOT NULL DEFAULT '',
			PRIMARY KEY (`id`),
			KEY `page_id` (`page_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		// ── Block library ──────────────────────────────────────────────────────
		"CREATE TABLE IF NOT EXISTS `{$p}block_library` (
			`id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`block_id`   INT UNSIGNED NOT NULL,
			`name`       VARCHAR(255) NOT NULL,
			`created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			KEY `block_id` (`block_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		// ── Tax System ─────────────────────────────────────────────────────────────
		"CREATE TABLE IF NOT EXISTS `{$p}tax_zones` (
			`zone_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`zone_name` VARCHAR(100) NOT NULL,
			`country_code` CHAR(2) NOT NULL,
			`state_code` CHAR(10),
			`zip_from` VARCHAR(10),
			`zip_to` VARCHAR(10),
			`priority` INT NOT NULL DEFAULT 0,
			`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`zone_id`),
			KEY `country_state` (`country_code`, `state_code`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}tax_rates` (
			`rate_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`zone_id` INT UNSIGNED NOT NULL,
			`rate_name` VARCHAR(100) NOT NULL,
			`rate` DECIMAL(6,4) NOT NULL,
			`applies_to_shipping` TINYINT(1) NOT NULL DEFAULT 0,
			`active` TINYINT(1) NOT NULL DEFAULT 1,
			`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`rate_id`),
			FOREIGN KEY (`zone_id`) REFERENCES `{$p}tax_zones` (`zone_id`) ON DELETE CASCADE,
			KEY `zone_id` (`zone_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}discount_codes` (
			`id`               INT UNSIGNED   NOT NULL AUTO_INCREMENT,
			`code`             VARCHAR(20)    NOT NULL UNIQUE,
			`type`             VARCHAR(10)    NOT NULL DEFAULT 'percent',
			`amount`           DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
			`single_use`       TINYINT(1)     NOT NULL DEFAULT 0,
			`usage_limit`      INT UNSIGNED   DEFAULT 1,
			`used_count`       INT UNSIGNED   NOT NULL DEFAULT 0,
			`min_order_amount` DECIMAL(10,2),
			`active_from`      DATE           NOT NULL,
			`active_until`     DATE,
			`status`           TINYINT(1)     NOT NULL DEFAULT 1,
			`created_at`       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			KEY `status` (`status`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}menus` (
			`id`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`name`      VARCHAR(255) NOT NULL,
			`menu_role` VARCHAR(32)  NOT NULL DEFAULT '',
			`menu_type` VARCHAR(32)  NOT NULL DEFAULT 'links_pages',
			PRIMARY KEY (`id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}menu_items` (
			`id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`menu_id`      INT UNSIGNED NOT NULL,
			`parent_id`    INT UNSIGNED NOT NULL DEFAULT 0,
			`label`        VARCHAR(255) NOT NULL DEFAULT '',
			`item_type`    VARCHAR(32)  NOT NULL DEFAULT 'url',
			`url`          VARCHAR(500) NOT NULL DEFAULT '',
			`page_id`      INT UNSIGNED DEFAULT NULL,
			`category_id`  INT UNSIGNED DEFAULT NULL,
			`submenu_id`   INT UNSIGNED DEFAULT NULL,
			`show_count`   TINYINT(1)   NOT NULL DEFAULT 0,
			`target`       VARCHAR(16)  NOT NULL DEFAULT '',
			`js_code`      TEXT,
			`settings`     JSON         DEFAULT NULL,
			`display_order` INT UNSIGNED NOT NULL DEFAULT 0,
			`enabled`      TINYINT(1)   NOT NULL DEFAULT 1,
			PRIMARY KEY (`id`),
			KEY `menu_id` (`menu_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}slideshows` (
			`id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`name`       VARCHAR(255) NOT NULL,
			`transition` VARCHAR(16)  NOT NULL DEFAULT 'fade',
			`interval`   INT UNSIGNED NOT NULL DEFAULT 5000,
			`status`     TINYINT(1)   NOT NULL DEFAULT 1,
			`height`     SMALLINT UNSIGNED NOT NULL DEFAULT 400,
			`max_width`  SMALLINT UNSIGNED DEFAULT NULL,
			`heading`    VARCHAR(255) DEFAULT NULL,
			`subtext`    VARCHAR(500) DEFAULT NULL,
			`btn_label`  VARCHAR(100) DEFAULT NULL,
			`btn_url`    VARCHAR(500) DEFAULT NULL,
			PRIMARY KEY (`id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}slideshow_slides` (
			`id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`slideshow_id`  INT UNSIGNED NOT NULL,
			`image`         VARCHAR(255) NOT NULL DEFAULT '',
			`heading`       VARCHAR(255) NOT NULL DEFAULT '',
			`subtext`       TEXT,
			`btn_label`     VARCHAR(100) NOT NULL DEFAULT '',
			`btn_url`       VARCHAR(500) NOT NULL DEFAULT '',
			`display_order` INT UNSIGNED NOT NULL DEFAULT 0,
			`enabled`       TINYINT(1)   NOT NULL DEFAULT 1,
			PRIMARY KEY (`id`),
			KEY `slideshow_id` (`slideshow_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}contact_forms` (
			`id`       INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`name`     VARCHAR(255) NOT NULL,
			`fields`   JSON         DEFAULT NULL,
			`email_to` VARCHAR(255) NOT NULL DEFAULT '',
			PRIMARY KEY (`id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}messages` (
			`id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`form_id`    INT UNSIGNED DEFAULT NULL,
			`data`       JSON         DEFAULT NULL,
			`ip`         VARCHAR(45)  NOT NULL DEFAULT '',
			`read_at`    DATETIME     DEFAULT NULL,
			`created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			KEY `form_id` (`form_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}shipping_methods` (
			`id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
			`name`        VARCHAR(128)  NOT NULL,
			`description` VARCHAR(255)  NOT NULL DEFAULT '',
			`rate`        DECIMAL(10,2) NOT NULL DEFAULT '0.00',
			`free_above`  DECIMAL(10,2)           DEFAULT NULL,
			`min_order`   DECIMAL(10,2) NOT NULL DEFAULT '0.00',
			`countries`   VARCHAR(500)  NOT NULL DEFAULT '',
			`sort_order`  INT           NOT NULL DEFAULT '0',
			`active`      TINYINT(1)    NOT NULL DEFAULT '1',
			PRIMARY KEY (`id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}password_reset_tokens` (
			`id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`customer_id` INT UNSIGNED NOT NULL,
			`token`       VARCHAR(64)  NOT NULL,
			`created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			UNIQUE KEY `token` (`token`),
			KEY `customer_id` (`customer_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

		"CREATE TABLE IF NOT EXISTS `{$p}admin_password_reset_tokens` (
			`id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
			`admin_id`    INT UNSIGNED NOT NULL,
			`token`       VARCHAR(64)  NOT NULL,
			`created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (`id`),
			UNIQUE KEY `token` (`token`),
			KEY `admin_id` (`admin_id`)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
	];

	try {
		foreach ($tables as $sql) {
			$pdo->exec($sql);
		}
	} catch (PDOException $e) {
		out(false, 'Failed to create tables: ' . $e->getMessage());
	}

	// Insert admin user
	try {
		$hash = password_hash($admin_pass, PASSWORD_BCRYPT);
		$st   = $pdo->prepare("INSERT INTO `{$p}admin` (username, email, password) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE password = VALUES(password)");
		$st->execute([$admin_user, $admin_email, $hash]);
	} catch (PDOException $e) {
		out(false, 'Failed to create admin account: ' . $e->getMessage());
	}

	// Insert site settings
	try {
		$st = $pdo->prepare("INSERT INTO `{$p}settings` (`key`, `value`) VALUES (?, ?)
			ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)");
		foreach ([
			'site_name'           => $site_name,
			'site_currency'       => $site_currency,
			'site_email'          => $site_email,
			'admin_path'          => $admin_path,
			'store_phone'         => '',
			'store_logo_url'      => '',
			'site_favicon'        => '/img/avatars/favicon.webp',
			'favicon_svg_url'     => '/img/uploads/waves.svg',
			'img_retain_names'    => '0',
			'img_resize_on_upload'=> '1',
			'img_orig_max'        => '600',
			'img_admin_size'      => '160',
			'img_admin_quality'   => '75',
			'img_fm_size'         => '50',
			'img_fm_quality'      => '60',
			'img_product_width'   => '600',
			'img_product_quality' => '80',
			'img_orig_max'        => '600',
			'img_admin_size'      => '160',
			'img_admin_quality'   => '75',
			'img_fm_size'         => '50',
			'img_fm_quality'      => '60',
			'deepai_key'          => '',
			'img_related_size'    => '200',
			'related_max_items'   => '0',
			'stripe_mode'         => 'test',
			'taxjar_api_key'      => '',
			'taxjar_last_sync'    => '',
		] as $k => $v) {
			$st->execute([$k, $v]);
		}
	} catch (PDOException $e) {
		out(false, 'Failed to save settings: ' . $e->getMessage());
	}

	// Seed empty API-key rows, with their owning plugin as origin, so the
	// API Keys Manager plugin (plugins/api-keys/admin/index.php — groups its
	// "all API keys" view by `origin`, LIKE '%_key') shows every
	// payment/shipping credential from install time, not just whichever
	// plugin's own settings drawer happens to have been saved at least once.
	// Without an origin here these would still show up (it selects on the
	// key pattern, not origin), just dumped under "Unknown" instead of
	// grouped under their real plugin — origin gets corrected for real the
	// moment a plugin's own drawer is saved, since that flow always writes
	// it, but there's no reason to leave a wrong label in the meantime.
	try {
		$stOrigin = $pdo->prepare("INSERT INTO `{$p}settings` (`key`, `value`, `origin`) VALUES (?, '', ?)
			ON DUPLICATE KEY UPDATE `origin` = VALUES(`origin`)");
		foreach ([
			'stripe_test_publishable_key' => 'stripe',
			'stripe_test_secret_key'      => 'stripe',
			'stripe_test_webhook_secret'  => 'stripe',
			'stripe_publishable_key'      => 'stripe',
			'stripe_secret_key'           => 'stripe',
			'stripe_webhook_secret'       => 'stripe',
			'paypal_sandbox_secret_key'   => 'paypal',
			'paypal_live_secret_key'      => 'paypal',
			'shippo_test_api_key'         => 'goshippo',
			'shippo_live_api_key'         => 'goshippo',
			'taxjar_api_key'              => 'taxjar',
		] as $k => $origin) {
			$stOrigin->execute([$k, $origin]);
		}
	} catch (PDOException $e) {
		out(false, 'Failed to seed API key origins: ' . $e->getMessage());
	}

	// Seed default pages
	try {
		$pages = [
			['home',            'Home',             'home',           1],
			['about-us',        'About Us',         'page',           1],
			['contact-us',      'Contact Us',       'page',           1],
			['returns',         'Returns',          'page',           1],
			['privacy-policy',  'Privacy Policy',   'page',           1],
			['terms',           'Terms & Conditions','page',          1],
			['sitemap',         'Site Map',         'page',           1],
			['my-account',      'My Account',       'account',        1],
			['cart',            'Cart',             'cart',           1],
			['checkout',        'Checkout',         'checkout',       1],
			['product',         'Product',          'product',        1],
		];
		$sp = $pdo->prepare(
			"INSERT IGNORE INTO `{$p}pages` (slug, title, page_type, status, display_order)
			 VALUES (?, ?, ?, ?, ?)"
		);
		foreach ($pages as $i => $pg) {
			$sp->execute([$pg[0], $pg[1], $pg[2], $pg[3], $i]);
		}

		// Seed sitemap block on sitemap page
		$sm_id = $pdo->query("SELECT id FROM `{$p}pages` WHERE slug='sitemap' LIMIT 1")->fetchColumn();
		if ($sm_id) {
			$pdo->prepare(
				"INSERT IGNORE INTO `{$p}page_blocks` (page_id, block_type, settings, display_order, enabled)
				 VALUES (?, 'sitemap', '{}', 0, 1)"
			)->execute([$sm_id]);
		}

		// Seed the default contact form (core — always available regardless of
		// the Forms plugin, which only adds the ability to create/manage more)
		$default_form_fields = json_encode([
			['name' => 'name',    'label' => 'Name',    'type' => 'text',     'required' => true],
			['name' => 'email',   'label' => 'Email',   'type' => 'email',    'required' => true],
			['name' => 'message', 'label' => 'Message',  'type' => 'textarea', 'required' => true],
		]);
		$pdo->prepare(
			"INSERT IGNORE INTO `{$p}contact_forms` (id, name, fields, email_to) VALUES (1, 'Contact Us', ?, '')"
		)->execute([$default_form_fields]);
		$contact_id = $pdo->query("SELECT id FROM `{$p}pages` WHERE slug='contact-us' LIMIT 1")->fetchColumn();
		if ($contact_id) {
			$pdo->prepare(
				"INSERT IGNORE INTO `{$p}page_blocks` (page_id, block_type, settings, display_order, enabled)
				 VALUES (?, 'contact_form', '{\"form_id\":1}', 0, 1)"
			)->execute([$contact_id]);
		}

		// Seed core blocks for cart, checkout, and product pages
		$core_settings = json_encode(['is_core' => true]);
		$cart_id = $pdo->query("SELECT id FROM `{$p}pages` WHERE slug='cart' LIMIT 1")->fetchColumn();
		if ($cart_id) {
			$pdo->prepare(
				"INSERT IGNORE INTO `{$p}page_blocks`
				 (page_id, block_type, settings, display_order, enabled, cols, col_start, col_span, `row`, row_span)
				 VALUES (?, 'cart_contents', ?, 1, 1, 4, 1, 4, 0, 1)"
			)->execute([$cart_id, $core_settings]);
		}
		$checkout_id = $pdo->query("SELECT id FROM `{$p}pages` WHERE slug='checkout' LIMIT 1")->fetchColumn();
		if ($checkout_id) {
			$pdo->prepare(
				"INSERT IGNORE INTO `{$p}page_blocks`
				 (page_id, block_type, settings, display_order, enabled, cols, col_start, col_span, `row`, row_span)
				 VALUES (?, 'checkout_form', ?, 1, 1, 4, 1, 4, 0, 1)"
			)->execute([$checkout_id, $core_settings]);
		}
		$product_id = $pdo->query("SELECT id FROM `{$p}pages` WHERE slug='product' LIMIT 1")->fetchColumn();
		if ($product_id) {
			$pdo->prepare(
				"INSERT IGNORE INTO `{$p}page_blocks`
				 (page_id, block_type, settings, display_order, enabled, cols, col_start, col_span, `row`, row_span)
				 VALUES (?, 'product_view', ?, 1, 1, 4, 1, 4, 0, 1)"
			)->execute([$product_id, $core_settings]);
		}

		// Seed order statuses
		$pdo->exec("INSERT IGNORE INTO `{$p}order_statuses` (slug, label, color, sort_order, is_cancellation) VALUES
			('pending',    'Pending',    '#f59e0b', 0, 0),
			('paid',       'Paid',       '#3b82f6', 1, 0),
			('shipped',    'Shipped',    '#8b5cf6', 2, 0),
			('completed',  'Completed',  '#10b981', 3, 0),
			('cancelled',  'Cancelled',  '#ef4444', 4, 1),
			('refunded',   'Refunded',   '#6b7280', 5, 1)
		");

		// Seed default menus.
		// menu_role='menu1' is what tpl/layout.html actually renders in the
		// footer; menu_role='menu2' isn't a general nav placement at all —
		// load_menu() only surfaces it on product pages via $product_id.
		// Names below match that real behavior (previously named backwards:
		// 'Main Navigation' on the footer role, 'Footer' on the product-only
		// role — see edgecart_open_decisions memory, 2026-09-10).
		$pdo->exec("INSERT IGNORE INTO `{$p}menus` (id, name, menu_role, menu_type) VALUES
			(1, 'Footer Links',      'menu1', 'links_pages'),
			(2, 'Product Page Menu', 'menu2', 'links_pages')
		");

	} catch (PDOException $e) {
		// Non-fatal — pages can be created manually
	}

	// Write config.php
	$config_path = dirname(__DIR__) . '/cfg/config.php';
	$ts     = date('Y-m-d H:i:s');
	$config = <<<PHP
<?php
/**
 * EdgeCart Configuration
 * Generated by install wizard on {$ts}.
 */

// Database
define('DB_HOST',    '{$host}');
define('DB_NAME',    '{$name}');
define('DB_USER',    '{$user}');
define('DB_PASS',    '{$pass}');
define('DB_PREFIX',  '{$prefix}');
define('DB_CHARSET', 'utf8mb4');

// Paths
define('DIR_ROOT',     __DIR__ . '/../');
define('DIR_CTL',      DIR_ROOT . 'ctl/');
define('DIR_TPL',      DIR_ROOT . 'tpl/');
define('DIR_LIB',      DIR_ROOT . 'lib/');
define('DIR_CACHE',    DIR_ROOT . 'cache/');
define('DIR_IMG',      DIR_ROOT . 'img/');
define('DIR_UPLOADS', DIR_ROOT . 'img/uploads/');
define('DIR_ADMIN',    DIR_ROOT . 'admin/');
define('DIR_INSTALL',  DIR_ROOT . 'install/');

// Digital-download source files live one level above the docroot (a sibling
// of the site folder itself) so they're never reachable by any URL, static
// or otherwise — the download_tokens table (expiring, count-limited, logged
// in plugins/digital-download/) is the only real gate customers pass through.
define('DIR_DOWNLOADS_PRIVATE', dirname(rtrim(realpath(DIR_ROOT), '/')) . '/private-downloads/');

// URLs
define('URL_ROOT',       '/');
define('URL_ADMIN',      '/{$admin_path}/');
define('URL_ADMIN_REAL', '/admin/');
define('URL_IMG',        '/img/');

// Admin path (public-facing URL segment)
define('ADMIN_PATH', '{$admin_path}');

// Site
define('SITE_NAME',     '{$site_name}');
define('SITE_CURRENCY', '{$site_currency}');
define('SITE_EMAIL',    '{$site_email}');

// Error handling
define('DISPLAY_ERRORS', false);
define('LOG_ERRORS',     true);
define('ERROR_LOG',      DIR_ROOT . 'logs/error.log');

// Session (12h absolute cap enforced in lib/functions.php::is_admin(); this is just
// the PHP session-file GC bound, kept in sync with that cap)
define('SESSION_NAME',     'edgecart');
define('SESSION_LIFETIME', 43200);

// Smarty
define('SMARTY_FORCE_COMPILE', false);
define('SMARTY_CACHING',       false);

// EdgeCart
define('EC_NAME',        'EdgeCart');
define('EC_VERSION',     '1.8.43');
define('EC_COMPANY',     "Map's Edge Creative");
define('EC_COMPANY_URL', 'https://edgecart.io');
define('EC_UPGRADE_URL', 'https://store.edgecart.io/#premium-plugins');
PHP;

	if (@file_put_contents($config_path, $config) === false) {
		out(false, 'Could not write cfg/config.php - check directory permissions.');
	}

	// Write .htaccess
	$htaccess_path = dirname(__DIR__) . '/.htaccess';
	$htaccess = <<<HTACCESS
Options -Indexes
DirectoryIndex index.php

RewriteEngine On

# Block direct browser access to admin/ — except its own static assets
# (js/css), which the admin page itself must load directly as the browser,
# and admin/tpl/*/row.html files specifically — plain {{placeholder}} markup
# partials (no Smarty, no server data) that admin JS (e.g. products.js's
# fetchRowTemplate()) fetches directly via AJAX to build table rows
# client-side. Real Smarty .html templates elsewhere under admin/tpl/ stay
# blocked; this exception is scoped to the row.html naming convention only.
RewriteCond %{REQUEST_URI} ^/admin(/|$) [NC]
RewriteCond %{REQUEST_URI} !\.(js|css)$ [NC]
RewriteCond %{REQUEST_URI} !/tpl/[^/]+/row\.html$ [NC]
RewriteRule ^ - [F,L]

# Map public admin path to admin/index.php. [END] (not just [L]) is required
# here now that the admin-blocking rule above exists: mod_rewrite restarts
# matching from the top of the ruleset after any substitution unless [END]
# is used, so a plain [L] here would let the newly-rewritten /admin/index.php
# URI immediately re-match and get blocked by the rule above it.
RewriteRule ^{$admin_path}/?$ /admin/index.php [END,QSA]
RewriteRule ^{$admin_path}/(.*)$ /admin/index.php [END,QSA]

# Route everything else through index.php (skip real files/dirs)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ /index.php [L,QSA]
HTACCESS;

	if (@file_put_contents($htaccess_path, $htaccess) === false) {
		out(false, 'Could not write .htaccess - check directory permissions.');
	}

	// Seed sample data
	$base = dirname(__DIR__) . '/';
	if ($sample_inventory) {
		try { seed_sample_inventory($pdo, $p, $base); } catch (Throwable $e) { /* non-fatal */ }
	}
	if ($sample_customers) {
		try { seed_sample_customers($pdo, $p); } catch (Throwable $e) { /* non-fatal */ }
	}

	@file_put_contents(__DIR__ . '/.installed', date('Y-m-d H:i:s'));

	// Lock the installer down now that setup is done — must not ship pre-baked in
	// the distributed zip, or a fresh install could never reach this wizard at all.
	@file_put_contents(__DIR__ . '/.htaccess', "Require all denied\n");

	out(true, 'Installation complete.', ['redirect' => '/' . $admin_path . '/']);
}

out(false, 'Unknown action.');
