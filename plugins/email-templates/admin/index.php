<?php
require_access(ACCESS_EDIT);
$smarty->assign('page',       'email-templates');
$smarty->assign('page_title', 'Email Templates');
$smarty->display('email-templates/list.html');
