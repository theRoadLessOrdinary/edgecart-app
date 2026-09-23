<?php
/**
 * CandyCart DB — thin PDO wrapper
 *
 * Usage:
 *   $rows = DB::rows("SELECT * FROM cc_products WHERE status = ?", [1]);
 *   $row  = DB::row("SELECT * FROM cc_products WHERE id = ?", [$id]);
 *   $val  = DB::val("SELECT COUNT(*) FROM cc_products");
 *   $id   = DB::insert("INSERT INTO cc_products SET name = ?", ['Widget']);
 *   $n    = DB::exec("UPDATE cc_products SET status = ? WHERE id = ?", [1, $id]);
 */
class DB {

	private static ?PDO $pdo = null;

	public static function connect(
		string $host   = DB_HOST,
		string $name   = DB_NAME,
		string $user   = DB_USER,
		string $pass   = DB_PASS,
		string $charset = DB_CHARSET
	): void {
		if (self::$pdo) return;
		$dsn = "mysql:host={$host};dbname={$name};charset={$charset}";
		self::$pdo = new PDO($dsn, $user, $pass, [
			PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
			PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
			PDO::ATTR_EMULATE_PREPARES   => false,
		]);
	}

	public static function pdo(): PDO {
		if (!self::$pdo) self::connect();
		return self::$pdo;
	}

	// Return all rows
	public static function rows(string $sql, array $params = []): array {
		$st = self::pdo()->prepare($sql);
		$st->execute($params);
		return $st->fetchAll();
	}

	// Return single row
	public static function row(string $sql, array $params = []): ?array {
		$st = self::pdo()->prepare($sql);
		$st->execute($params);
		$row = $st->fetch();
		return $row ?: null;
	}

	// Return single value
	public static function val(string $sql, array $params = []): mixed {
		$st = self::pdo()->prepare($sql);
		$st->execute($params);
		$row = $st->fetch(PDO::FETCH_NUM);
		return $row ? $row[0] : null;
	}

	// Execute INSERT, return last insert ID
	public static function insert(string $sql, array $params = []): int {
		$st = self::pdo()->prepare($sql);
		$st->execute($params);
		return (int) self::$pdo->lastInsertId();
	}

	// Execute UPDATE/DELETE, return affected rows
	public static function exec(string $sql, array $params = []): int {
		$st = self::pdo()->prepare($sql);
		$st->execute($params);
		return $st->rowCount();
	}

	// Begin/commit/rollback
	public static function begin():    void { self::pdo()->beginTransaction(); }
	public static function commit():   void { self::pdo()->commit(); }
	public static function rollback(): void { self::pdo()->rollBack(); }

	// Test connectivity without throwing — returns error string or null
	public static function test(string $host, string $name, string $user, string $pass): ?string {
		try {
			$dsn = "mysql:host={$host};dbname={$name};charset=utf8mb4";
			new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
			return null;
		} catch (PDOException $e) {
			return $e->getMessage();
		}
	}
}

// Load all settings into a global array for quick access
$_nc_settings = [];
if (defined('DB_PREFIX')) {
	try {
		$rows = DB::rows("SELECT `key`, `value` FROM `" . DB_PREFIX . "settings`");
		foreach ($rows as $r) $_nc_settings[$r['key']] = $r['value'];
	} catch (Exception $e) {
		// Settings table may not exist yet (fresh install)
	}
}
