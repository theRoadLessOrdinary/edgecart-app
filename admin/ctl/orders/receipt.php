<?php
/**
 * new-cart admin — order receipt / print view
 * route=orders/receipt
 */

require_admin();

$p  = DB_PREFIX;
$id = (int)($_GET['id'] ?? 0);
if (!$id) { http_response_code(404); exit('Order not found.'); }

$order = DB::row("
	SELECT o.*,
	       DATE_FORMAT(o.created_at, '%b %e, %Y') AS date_fmt,
	       TRIM(CONCAT(COALESCE(c.first_name, o.ship_firstname, ''), ' ', COALESCE(c.last_name, o.ship_lastname, ''))) AS customer_name,
	       COALESCE(c.email, o.ship_email, '') AS customer_email
	FROM `{$p}orders` o
	LEFT JOIN `{$p}customers` c ON c.id = o.customer_id
	WHERE o.id = ?
", [$id]);
if (!$order) { http_response_code(404); exit('Order not found.'); }

$items = DB::rows(
	"SELECT * FROM `{$p}order_items` WHERE order_id = ? ORDER BY id",
	[$id]
);

$smarty->assign('order', $order);
$smarty->assign('items', $items);
$smarty->display('orders/receipt.html');
