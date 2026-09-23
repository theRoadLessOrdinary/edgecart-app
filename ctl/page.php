<?php
$p    = DB_PREFIX;
$slug = get('slug', '');

// Determine the designated homepage ID (set via page properties in the editor)
$home_page_id = (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='home_page_id'") ?? 0);

// Load page — homepage bypasses status check, all others require status > 0
if ($slug) {
	$page = DB::row("SELECT * FROM `{$p}pages` WHERE slug=?", [$slug]);
	if ($page && (int)$page['id'] !== $home_page_id && (int)$page['status'] <= 0) {
		$page = null; // not published and not the homepage
	}
} else {
	$page = null;
}

if (!$page) {
	require DIR_CTL . '404.php';
	exit;
}

// Check if current user is an admin
$is_admin_user = is_admin();

$blocks = DB::rows(
	"SELECT * FROM `{$p}page_blocks` WHERE page_id=? AND enabled=1 ORDER BY display_order ASC",
	[$page['id']]
);

$rel_thumb_size = max(80, (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='img_related_size'") ?: 200));

// Hydrate each block with the data it needs
foreach ($blocks as &$b) {
	$s = $b['settings'] ? json_decode($b['settings'], true) : [];

	switch ($b['block_type']) {
		case 'slideshow':
			if (!empty($s['slideshow_id'])) {
				$b['slideshow'] = DB::row("SELECT * FROM `{$p}slideshows` WHERE id=?", [(int)$s['slideshow_id']]);
				if ($b['slideshow']) {
					$b['slides'] = DB::rows(
						"SELECT * FROM `{$p}slideshow_slides` WHERE slideshow_id=? AND enabled=1 ORDER BY display_order ASC",
						[$b['slideshow']['id']]
					);
				}
			}
			break;

		case 'featured_products':
			$count = (int)($s['count'] ?? 6);
			$b['products'] = DB::rows(
				"SELECT p.*, pi.filename AS image
				 FROM `{$p}products` p
				 LEFT JOIN `{$p}product_images` pi ON pi.product_id=p.id AND pi.display_order=(SELECT MIN(display_order) FROM `{$p}product_images` WHERE product_id=p.id)
				 WHERE p.status>0 AND p.featured=1
				 ORDER BY p.featured_order ASC LIMIT ?",
				[$count]
			);
			$b['heading']    = $s['heading'] ?? 'Featured Products';
			$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_thumb_size;
			break;

		case 'best_sellers':
			$count = (int)($s['count'] ?? 6);
			$b['products'] = DB::rows(
				"SELECT p.*,
				        (SELECT filename FROM `{$p}product_images` WHERE product_id=p.id ORDER BY display_order ASC LIMIT 1) AS image,
				        COUNT(oi.id) AS sold
				 FROM `{$p}products` p
				 LEFT JOIN `{$p}order_items` oi ON oi.product_id=p.id
				 WHERE p.status>0
				 GROUP BY p.id ORDER BY sold DESC, p.name ASC LIMIT ?",
				[$count]
			);
			$b['heading']    = $s['heading'] ?? 'Best Sellers';
			$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_thumb_size;
			break;

		case 'best_sellers_category':
			$count    = (int)($s['count'] ?? 6);
			$cat_id   = (int)($s['category_id'] ?? 0);
			$category = $cat_id ? DB::row("SELECT * FROM `{$p}categories` WHERE id=?", [$cat_id]) : null;
			if ($category) {
				$b['products'] = DB::rows(
					"SELECT p.*,
					        (SELECT filename FROM `{$p}product_images` WHERE product_id=p.id ORDER BY display_order ASC LIMIT 1) AS image,
					        COUNT(oi.id) AS sold
					 FROM `{$p}products` p
					 JOIN `{$p}categories_products` cp ON cp.product_id=p.id AND cp.category_id=?
					 LEFT JOIN `{$p}order_items` oi ON oi.product_id=p.id
					 WHERE p.status>0
					 GROUP BY p.id ORDER BY sold DESC LIMIT ?",
					[$cat_id, $count]
				);
			} else {
				$b['products'] = [];
			}
			$b['heading']    = $s['heading'] ?? ($category ? $category['name'] : 'Best Sellers');
			$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_thumb_size;
			break;

		case 'new_arrivals':
			$count = (int)($s['count'] ?? 6);
			$b['products'] = DB::rows(
				"SELECT p.*, pi.filename AS image
				 FROM `{$p}products` p
				 LEFT JOIN `{$p}product_images` pi ON pi.product_id=p.id AND pi.display_order=(SELECT MIN(display_order) FROM `{$p}product_images` WHERE product_id=p.id)
				 WHERE p.status>0
				 ORDER BY p.id DESC LIMIT ?",
				[$count]
			);
			$b['heading']    = $s['heading'] ?? 'New Arrivals';
			$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_thumb_size;
			break;

		case 'random_products':
			$count = (int)($s['count'] ?? 6);
			$b['products'] = DB::rows(
				"SELECT p.*, pi.filename AS image
				 FROM `{$p}products` p
				 LEFT JOIN `{$p}product_images` pi ON pi.product_id=p.id AND pi.display_order=(SELECT MIN(display_order) FROM `{$p}product_images` WHERE product_id=p.id)
				 WHERE p.status>0
				 ORDER BY RAND() LIMIT ?",
				[$count]
			);
			$b['heading']    = $s['heading'] ?? 'Random Products';
			$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_thumb_size;
			break;

		case 'menu':
			if (!empty($s['menu_id'])) {
				$items = load_menu((int)$s['menu_id'], $p);
				if (!empty($s['max_items']) && (int)$s['max_items'] > 0) {
					$items = array_slice($items, 0, (int)$s['max_items']);
				}
				$b['menu_items'] = $items;
			}
			break;
		case 'related_products':
			$b['heading']  = $s['heading'] ?? 'Related Products';
			$b['products'] = []; // requires product-page context; empty on generic pages
			break;

		case 'sitemap':
			// Use generated HTML if present, otherwise empty placeholder
			$b['generated_html'] = $s['generated_html'] ?? null;
			$b['generated_at']   = $s['generated_at']   ?? null;
			break;

		case 'contact_form':
			if (!empty($s['form_id'])) {
				$form = DB::row("SELECT * FROM `{$p}contact_forms` WHERE id=?", [(int)$s['form_id']]);
				if ($form) {
					$form['fields'] = $form['fields'] ? json_decode($form['fields'], true) : [];
					$b['form'] = $form;
				}
			}
			break;

	}
	$b['settings'] = $s;
}
unset($b);

normalize_block_grid($blocks);

// Split blocks by column
$sidebar_blocks = [];
$main_blocks = [];
foreach ($blocks as $block) {
	if ((int)($block['col_start'] ?? 2) == 1) {
		$sidebar_blocks[] = $block;
	} else {
		$main_blocks[] = $block;
	}
}

$sidebar_position = $page['sidebar_position'] ?? 'left';

catalog_sidebar($smarty);
$smarty->assign('rel_thumb_size', $rel_thumb_size);
$smarty->assign('page',              $page);
$_functional_types = ['home', 'account', 'cart', 'checkout', 'product', 'about', 'contact', 'privacy', 'returns', 'terms'];
$_is_functional    = in_array($page['page_type'] ?? '', $_functional_types);
if ($_is_functional) {
	$_surround = sys_page_content((int)$page['id']);
} else {
	$_surround = ['before' => '', 'after' => ''];
}
$smarty->assign('content_before',      $_surround['before']);
$smarty->assign('content_after',       $_surround['after']);
$smarty->assign('page_simple_content', (!$_is_functional && empty($blocks)) ? Shortcode::render($page['content'] ?? '') : '');
$smarty->assign('blocks',            $main_blocks);
$smarty->assign('sidebar_blocks',    $sidebar_blocks);
$smarty->assign('sidebar_position',  $sidebar_position);
$smarty->assign('is_admin_user',     $is_admin_user);
$smarty->assign('page_type',         'page');
$smarty->assign('meta_description',  $page['seo_description'] ?? '');
$smarty->assign('meta_keywords',     $page['seo_keywords']    ?? '');
// A product-list block (especially Random) must never be served from the
// page cache — see blocks_need_fresh_render()'s own comment for why.
if (blocks_need_fresh_render($blocks)) {
	$smarty->caching = Smarty::CACHING_OFF;
}
$smarty->display('page.html');
