<?php
require_access(ACCESS_EDIT);
$p          = DB_PREFIX;
$id         = (int)get('id');
$page       = $id ? DB::row("SELECT * FROM `{$p}pages` WHERE id=?", [$id]) : null;
$slideshows = DB::rows("SELECT id, name FROM `{$p}slideshows` ORDER BY name ASC");
$categories = DB::rows("SELECT id, name FROM `{$p}categories` WHERE status>0 ORDER BY name ASC");
$menus      = DB::rows("SELECT id, name FROM `{$p}menus` ORDER BY name ASC");
$forms      = DB::rows("SELECT id, name FROM `{$p}contact_forms` ORDER BY name ASC");
$all_pages  = DB::rows("SELECT id, title FROM `{$p}pages` ORDER BY title ASC");
$has_forms  = count($forms) > 0;

$home_page_id = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='home_page_id'") ?? 0);

$smarty->assign('edit_page',        $page);
$smarty->assign('edit_page_id',     $id);
$smarty->assign('sidebar_position', $page['sidebar_position'] ?? 'left');
$smarty->assign('slideshows',       $slideshows);
$smarty->assign('categories',       $categories);
$smarty->assign('menus',            $menus);
$smarty->assign('forms',            $forms);
$smarty->assign('all_pages',        $all_pages);
$smarty->assign('has_forms',        $has_forms);
$smarty->assign('home_page_id',     $home_page_id);
$core_labels = [
    'cart'     => 'Shopping Cart',
    'checkout' => 'Checkout',
    'wishlist' => 'Wish List',
    'account'  => 'Customer Account',
    'login'    => 'Login / Register',
    'search'   => 'Search Results',
    'order'    => 'Order Confirmation',
];
$page_type  = $page['page_type'] ?? 'page';
$is_system  = !empty($page_type) && $page_type !== 'page';
$core_label = $is_system ? ($core_labels[$page_type] ?? ucfirst($page_type)) : 'Page Content';
$content_before = '';
$content_after  = '';
if ($id) {
    $prefix         = $is_system ? 'sys_page' : 'page';
    $content_before = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`=?", ["{$prefix}_before_{$id}"]) ?? '';
    $content_after  = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`=?", ["{$prefix}_after_{$id}"])  ?? '';
}
$smarty->assign('is_system',      $is_system);
$smarty->assign('core_label',     $core_label);
$smarty->assign('content_before', $content_before);
$smarty->assign('content_after',  $content_after);

$smarty->assign('editor_head',        Hook::filter('admin.page.editor.head', '', ['route' => 'page-edit']));
$smarty->assign('admin_page_scripts', Hook::filter('admin.page.head',        '', ['route' => 'page-edit']));
$smarty->assign('editor_html',        Hook::filter('admin.page.editor',      null, ['page' => $page, 'page_id' => $id]));
$smarty->display('page-edit.html');
