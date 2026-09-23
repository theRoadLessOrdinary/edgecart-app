<?php
$p = DB_PREFIX;
$smarty->assign('page',              'categories');
$smarty->assign('page_title',        'Categories');
$smarty->assign('url_admin',         URL_ADMIN);
$smarty->assign('incomplete_cat_ids', reminder_ids('category'));
$smarty->assign('deepai_key',        DB::val("SELECT `value` FROM `{$p}settings` WHERE `key` = 'deepai_key'") ?: '');
$_cat_limit = Hook::instead('admin.limit.categories', 3);
$smarty->assign('cat_limit',         $_cat_limit);
$smarty->assign('subcats_enabled',   $_cat_limit >= PHP_INT_MAX);
$smarty->assign('cat_count',         (int)DB::val("SELECT COUNT(*) FROM `{$p}categories`"));
$smarty->assign('ec_upgrade_url',    EC_UPGRADE_URL);
$smarty->display('categories/list.html');
