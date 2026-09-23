<?php
require_access(ACCESS_EDIT);
$p = DB_PREFIX;
$weight_unit = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='weight_unit'") ?: 'lbs';
$smarty->assign('page',       'options');
$smarty->assign('page_title', 'Options');
$smarty->assign('weight_unit', $weight_unit);
$smarty->display('options/list.html');
