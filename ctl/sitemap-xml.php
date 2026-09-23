<?php
// Serve custom sitemap if uploaded, otherwise serve auto-generated, otherwise build on the fly
$custom = DIR_ROOT . 'sitemap-custom.xml';
$auto   = DIR_ROOT . 'sitemap-auto.xml';

header('Content-Type: application/xml; charset=utf-8');

if (file_exists($custom)) {
	readfile($custom);
	exit;
}

if (file_exists($auto)) {
	readfile($auto);
	exit;
}

$p    = DB_PREFIX;
$base = rtrim(absolute_url(URL_ROOT), '/');

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

// Home
echo "<url><loc>{$base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n";

// Pages (public only)
$pages = DB::rows("SELECT slug, created_at FROM `{$p}pages` WHERE status=1 AND slug != 'home' ORDER BY display_order ASC");
foreach ($pages as $pg) {
	$loc = $base . '/page/' . htmlspecialchars($pg['slug'], ENT_XML1);
	echo "<url><loc>{$loc}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n";
}

// Categories
$hide_empty = (int)($_nc_settings['hide_empty_categories'] ?? 1);
if ($hide_empty) {
	$cats = DB::rows(
		"SELECT c.slug FROM `{$p}categories` c
		 INNER JOIN `{$p}categories_products` cp ON cp.category_id = c.id
		 WHERE c.status>0
		 GROUP BY c.id
		 ORDER BY c.display_order ASC"
	);
} else {
	$cats = DB::rows("SELECT slug FROM `{$p}categories` WHERE status>0 ORDER BY display_order ASC");
}
foreach ($cats as $cat) {
	$loc = $base . '/category/' . htmlspecialchars($cat['slug'], ENT_XML1);
	echo "<url><loc>{$loc}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n";
}

// Products
$prods = DB::rows("SELECT slug, created_at FROM `{$p}products` WHERE status>0 ORDER BY id ASC");
foreach ($prods as $prod) {
	$loc = $base . '/product/' . htmlspecialchars($prod['slug'], ENT_XML1);
	$mod = date('Y-m-d', strtotime($prod['created_at']));
	echo "<url><loc>{$loc}</loc><lastmod>{$mod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n";
}

echo '</urlset>';
