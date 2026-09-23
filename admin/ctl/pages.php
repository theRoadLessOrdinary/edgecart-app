<?php
require_access(ACCESS_EDIT);
$smarty->assign('page',                 'pages');
$smarty->assign('page_title',           'Pages');
$smarty->assign('block_editor_enabled', in_array('page-blocks', PluginLoader::loaded()));
$smarty->assign('slideshows_enabled',   in_array('slideshows',  PluginLoader::loaded()));
$smarty->display('pages/list.html');
