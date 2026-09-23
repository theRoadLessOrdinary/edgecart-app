<?php
require_access(ACCESS_EDIT);
$smarty->assign('page',        'filemanager');
$smarty->assign('page_title',  'File Manager');
$p = DB_PREFIX;
$smarty->assign('fm_thumb_size', (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='img_fm_size'") ?: 50));
$smarty->display('filemanager/list.html');
