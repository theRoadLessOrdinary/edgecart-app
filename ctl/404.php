<?php
http_response_code(404);
catalog_sidebar($smarty);
$smarty->assign('page_title', 'Page Not Found');
$smarty->display('404.html');
