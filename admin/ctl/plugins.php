<?php
require_access(ACCESS_ADMIN);
$smarty->assign('page',       'plugins');
$smarty->assign('page_title', 'Plugins');
$smarty->display('plugins/list.html');
