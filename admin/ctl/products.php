<?php
require_access(ACCESS_EDIT);
$smarty->assign('page',           'products');
$smarty->assign('page_title',     'Products');
$smarty->assign('deepai_key',     DB::val("SELECT `value` FROM `" . DB_PREFIX . "settings` WHERE `key` = 'deepai_key'") ?: '');
$p = DB_PREFIX;
$smarty->assign('cat_limit',              Hook::instead('admin.limit.categories',          3));
$smarty->assign('cat_count',             (int)DB::val("SELECT COUNT(*) FROM `{$p}categories`"));
$smarty->assign('prod_per_cat_limit',      Hook::instead('admin.limit.products_per_cat',    5));
$smarty->assign('product_cat_limit',      Hook::instead('admin.limit.product_categories',  1));
$smarty->assign('options_per_prod_limit', Hook::instead('admin.limit.options_per_product', 2));
$smarty->assign('images_per_prod_limit',  Hook::instead('admin.limit.images_per_product',  2));
$smarty->assign('weight_class',           DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='weight_class'") ?: 'lb');
$smarty->display('products/list.html');
