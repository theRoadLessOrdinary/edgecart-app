<?php
$p = DB_PREFIX;

// Use page builder only when a home page has been explicitly designated
$home_page_id = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='home_page_id'") ?? 0);
if ($home_page_id) {
    $homePage = DB::row("SELECT id, slug FROM `{$p}pages` WHERE id=?", [$home_page_id]);
    if ($homePage) {
        $_GET['slug'] = $homePage['slug'];
        require DIR_CTL . 'page.php';
        exit;
    }
}

// Redirect to homepage_default category if one is set
$_default_cat = DB::row(
    "SELECT slug FROM `{$p}categories` WHERE homepage_default = 1 AND status > 0 LIMIT 1"
);
if ($_default_cat) {
    header('Location: ' . URL_ROOT . 'category/' . rawurlencode($_default_cat['slug']));
    exit;
}

// Fall back to plain product grid
catalog_sidebar($smarty);

$products = DB::rows(
    "SELECT p.id, p.name, p.slug, p.price, p.list_price,
            pi.filename AS image
     FROM `{$p}products` p
     LEFT JOIN `{$p}product_images` pi
       ON pi.product_id = p.id AND pi.display_order = (
          SELECT MIN(display_order) FROM `{$p}product_images` WHERE product_id = p.id
       )
     WHERE p.status > 0
     ORDER BY p.display_order ASC, p.name ASC
     LIMIT 12"
);

$products = Hook::filter('catalog.product.list', $products, ['context' => 'home']);

$homepage_title = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='homepage_seo_title'");
$homepage_desc  = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='homepage_seo_description'");
// tpl/layout.html already supports a meta_keywords block ({if isset(
// $meta_keywords) && $meta_keywords}) — it was never assigned a value on
// any page, homepage included, so the <meta name="keywords"> tag never
// actually rendered anywhere despite the template being ready for it.
$homepage_keywords = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='homepage_seo_keywords'");

// Hero images — stored as newline-separated paths in settings, or use defaults
$_hero_raw = DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='homepage_hero_images'");
if ($_hero_raw) {
    $hero_images = array_values(array_filter(array_map(fn($l) => ['src' => trim($l), 'label' => ''], explode("\n", $_hero_raw))));
} else {
    $hero_images = [
        ['src' => '/img/homepage/lifestyle-cafe-couple.webp',  'label' => ''],
        ['src' => '/img/homepage/lifestyle-street-women.webp', 'label' => ''],
        ['src' => '/img/homepage/lifestyle-urban-women.webp',  'label' => ''],
    ];
}

$categories = DB::rows(
    "SELECT id, name, slug, image FROM `{$p}categories` WHERE parent_id=0 AND status=1 ORDER BY display_order ASC, name ASC"
);

$smarty->assign('hero_images',     $hero_images);
$smarty->assign('categories',      $categories);
$smarty->assign('products',        $products);
$smarty->assign('homepage_title',  $homepage_title ?? '');
$smarty->assign('meta_description', $homepage_desc ?? '');
$smarty->assign('meta_keywords',   $homepage_keywords ?? '');
$smarty->assign('page_type',       'home');
$smarty->display('home.html');
