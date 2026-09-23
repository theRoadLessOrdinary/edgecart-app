<?php
require_access(ACCESS_EDIT);

$p   = DB_PREFIX;
$pdo = DB::pdo();

// Collect table stats for the info panel
$tables_raw = $pdo->query("SHOW TABLE STATUS")->fetchAll(PDO::FETCH_ASSOC);
$table_count = count($tables_raw);
$row_count   = array_sum(array_column($tables_raw, 'Rows'));
$data_mb     = round(array_sum(array_column($tables_raw, 'Data_length')) / 1048576, 2);

$smarty->assign('table_count', $table_count);
$smarty->assign('row_count',   number_format($row_count));
$smarty->assign('data_mb',     $data_mb);
$smarty->assign('page_title',  'Database Backup');
$smarty->display('db-backup/list.html');
