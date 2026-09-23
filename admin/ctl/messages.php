<?php
require_access(ACCESS_REPORTS);
$smarty->assign('page',       'messages');
$smarty->assign('page_title', 'Messages');
$smarty->display('messages/list.html');
