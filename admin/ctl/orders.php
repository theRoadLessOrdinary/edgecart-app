<?php
require_access(ACCESS_EDIT);
$smarty->assign('page',       'orders');
$smarty->assign('page_title', 'Orders');
$smarty->display('orders/list.html');
