<?php
require_access(ACCESS_EDIT);
$p = DB_PREFIX;
$smarty->assign('stub_title', 'Themes');
$smarty->display('stub.html');
