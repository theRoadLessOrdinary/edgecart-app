<?php
// Order details page — displays a specific order with items and totals

if (!is_logged_in()) {
	$_SESSION['login_redirect'] = URL_ROOT . 'order-details/' . get('id', '');
	redirect(URL_ROOT . '?route=login');
}

$order_id = (int)get('id', 0);
$customer_id = (int)$_SESSION['customer_id'];
$p = DB_PREFIX;

// Fetch order and verify customer ownership
$order = DB::row(
	"SELECT * FROM `{$p}orders` WHERE id = ? AND customer_id = ?",
	[$order_id, $customer_id]
);

if (!$order) {
	http_response_code(404);
	echo 'Order not found.';
	exit;
}

// Fetch order items
$items = DB::rows(
	"SELECT * FROM `{$p}order_items` WHERE order_id = ?",
	[$order_id]
);

catalog_sidebar($smarty);
$smarty->assign('order',      $order);
$smarty->assign('items',      $items);
$smarty->assign('page_type',  'order-details');
$smarty->display('order-details.html');
