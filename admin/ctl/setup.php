<?php
require_access(ACCESS_ADMIN);
$smarty->assign('page',       'setup');
$smarty->assign('page_title', 'Setup & Utilities');
$smarty->display('settings/list.html');
