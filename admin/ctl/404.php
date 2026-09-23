<?php
http_response_code(404);
$smarty->assign('page',       '404');
$smarty->assign('page_title', 'Not Found');
$smarty->display('layout.html');
