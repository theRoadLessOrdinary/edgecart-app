<?php
$p = DB_PREFIX;
$q = trim(get('q', ''));

catalog_sidebar($smarty);

$products = [];
if ($q !== '') {
	$like = '%' . $q . '%';
	$products = DB::rows(
		"SELECT p.id, p.name, p.slug, p.price, p.list_price,
		        (SELECT filename FROM `{$p}product_images`
		         WHERE product_id=p.id ORDER BY display_order ASC LIMIT 1) AS image
		 FROM `{$p}products` p
		 WHERE p.status > 0
		   AND (p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)
		 ORDER BY p.name ASC",
		[$like, $like, $like]
	);
}

$products = Hook::filter('catalog.product.list', $products, ['context' => 'search', 'q' => $q]);

$smarty->assign('q',        $q);
$smarty->assign('products', $products);
$smarty->assign('page_title', $q ? 'Search results for "' . htmlspecialchars($q) . '"' : 'Search');
$smarty->display('search.html');
