<?php
require_access(ACCESS_EDIT);

$pdo      = DB::pdo();
$filename = 'backup-' . date('Y-m-d-His') . '.sql';

header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Cache-Control: no-cache, no-store');
header('Pragma: no-cache');

// Disable output buffering to allow streaming
while (ob_get_level()) ob_end_clean();

function dump_line($s) { echo $s . "\n"; }

dump_line('-- EdgeCart Database Backup');
dump_line('-- Generated: ' . date('Y-m-d H:i:s'));
dump_line('-- ');
dump_line('');
dump_line('SET FOREIGN_KEY_CHECKS=0;');
dump_line('SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";');
dump_line('SET NAMES utf8mb4;');
dump_line('');

$tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

foreach ($tables as $table) {
    dump_line('-- --------------------------------------------------------');
    dump_line('-- Table: `' . $table . '`');
    dump_line('-- --------------------------------------------------------');
    dump_line('');

    // DROP + CREATE
    $create = $pdo->query("SHOW CREATE TABLE `{$table}`")->fetch(PDO::FETCH_NUM);
    dump_line('DROP TABLE IF EXISTS `' . $table . '`;');
    dump_line($create[1] . ';');
    dump_line('');

    // Rows
    $stmt = $pdo->query("SELECT * FROM `{$table}`");
    $cols = null;
    $batch = [];
    $batch_size = 100;

    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        if ($cols === null) {
            $cols = array_keys($row);
            $col_list = '`' . implode('`, `', $cols) . '`';
        }
        $values = array_map(function($v) use ($pdo) {
            if ($v === null) return 'NULL';
            return $pdo->quote($v);
        }, array_values($row));
        $batch[] = '(' . implode(', ', $values) . ')';

        if (count($batch) >= $batch_size) {
            dump_line("INSERT INTO `{$table}` ({$col_list}) VALUES");
            dump_line(implode(",\n", $batch) . ';');
            dump_line('');
            $batch = [];
        }
    }

    if ($batch && $cols !== null) {
        $col_list = '`' . implode('`, `', $cols) . '`';
        dump_line("INSERT INTO `{$table}` ({$col_list}) VALUES");
        dump_line(implode(",\n", $batch) . ';');
        dump_line('');
    }
}

dump_line('SET FOREIGN_KEY_CHECKS=1;');
dump_line('');
dump_line('-- End of backup');
exit;
