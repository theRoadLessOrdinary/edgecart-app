<?php
require_access(ACCESS_EDIT);
$smarty->assign('page',       'customers');
$smarty->assign('page_title', 'Customers');
$smarty->display('customers/list.html');
