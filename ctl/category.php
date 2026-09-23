<?php
$p    = DB_PREFIX;
$slug = get('slug', '');

$category = DB::row(
	"SELECT * FROM `{$p}categories` WHERE slug = ? AND status > 0",
	[$slug]
);
if (!$category) {
	require DIR_CTL . '404.php';
	exit;
}

catalog_sidebar($smarty);
$smarty->assign('current_category',      $category);
$smarty->assign('current_category_slug', $category['slug']);

$hide_empty = (int)($_nc_settings['hide_empty_categories'] ?? 1);
if ($hide_empty) {
	$smarty->assign('cat_subnav', DB::rows(
		"SELECT c.id, c.name, c.slug FROM `{$p}categories` c
		 INNER JOIN `{$p}categories_products` cp ON cp.category_id = c.id
		 WHERE c.parent_id=? AND c.status=1
		 GROUP BY c.id
		 ORDER BY c.display_order ASC, c.name ASC",
		[$category['id']]
	));
} else {
	$smarty->assign('cat_subnav', DB::rows(
		"SELECT id, name, slug FROM `{$p}categories` WHERE parent_id=? AND status=1 ORDER BY display_order ASC, name ASC",
		[$category['id']]
	));
}

$products = DB::rows(
	"SELECT p.id, p.name, p.slug, p.price, p.list_price,
	        pi.filename AS image
	 FROM `{$p}products` p
	 JOIN `{$p}categories_products` cp ON cp.product_id = p.id
	 LEFT JOIN `{$p}product_images` pi
	   ON pi.product_id = p.id AND pi.display_order = (
	      SELECT MIN(display_order) FROM `{$p}product_images` WHERE product_id = p.id
	   )
	 WHERE cp.category_id = ? AND p.status > 0
	 ORDER BY p.display_order ASC, p.name ASC",
	[$category['id']]
);

$products = Hook::filter('catalog.product.list', $products, ['context' => 'category', 'category' => $category]);

$smarty->assign('category', $category);
$smarty->assign('products', $products);
$smarty->assign('page_type', 'category');

$category_meta_desc = $category['seo_description'] ?? trim(strip_tags($category['description'] ?? ''));
$smarty->assign('meta_description', mb_substr($category_meta_desc, 0, 200));

$smarty->display('category.html');
