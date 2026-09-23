<?php
require_access(ACCESS_EDIT);
$p = DB_PREFIX;
$smarty->assign('discount_limit', Hook::instead('admin.limit.discounts', 3));
$smarty->assign('discount_count', (int)DB::val("SELECT COUNT(*) FROM `{$p}discount_codes`"));
$smarty->assign('ec_upgrade_url', EC_UPGRADE_URL);
$smarty->display('discounts/list.html');
