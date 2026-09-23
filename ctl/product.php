<?php
$p    = DB_PREFIX;
$slug = get('slug', '');

$product = DB::row(
	"SELECT *, description_long FROM `{$p}products` WHERE slug = ? AND status > 0",
	[$slug]
);
if (!$product) {
	require DIR_CTL . '404.php';
	exit;
}

// Let plugins gate product visibility (e.g. customer-exclusive)
if (!Hook::instead('catalog.product.can_view', true, ['product' => $product])) {
	require DIR_CTL . '404.php'; exit;
}

// Check if current user is an admin
$is_admin_user = is_admin();

// Images
$images = DB::rows(
	"SELECT * FROM `{$p}product_images`
	 WHERE product_id = ? ORDER BY display_order ASC",
	[$product['id']]
);

// Options attached to this product
$product_options = DB::rows(
	"SELECT po.*, o.name AS option_name, o.type, o.placeholder
	 FROM `{$p}product_options` po
	 JOIN `{$p}options` o ON o.id = po.option_id
	 WHERE po.product_id = ?
	 ORDER BY po.display_order ASC",
	[$product['id']]
);

// For each product option, get its values
foreach ($product_options as &$po) {
	$po['values'] = DB::rows(
		"SELECT pov.*, ov.text AS value_text, ov.image
		 FROM `{$p}product_option_values` pov
		 JOIN `{$p}option_values` ov ON ov.id = pov.option_value_id
		 WHERE pov.product_option_id = ? AND pov.enabled = 1
		 ORDER BY ov.display_order ASC",
		[$po['id']]
	);
}
unset($po);

// Starting price shown on load must reflect any option value marked as
// the default, not just the bare product price (e.g. Mug Size defaulting
// to 11oz at $20 instead of showing the product's base price).
$display_price = (float)$product['price'];
foreach ($product_options as $po) {
	foreach ($po['values'] as $v) {
		if (empty($v['is_default'])) continue;
		$mod = (float)$v['price_modifier'];
		if ($v['price_prefix'] === '=') {
			$display_price = $mod;
		} elseif ($v['price_prefix'] === '-') {
			$display_price -= $mod;
		} else {
			$display_price += $mod;
		}
		break;
	}
}
$smarty->assign('display_price', $display_price);

// If any option is flagged "use as product images", append its option-value
// images after the product's own uploaded images (product images lead the
// gallery; they're never dropped just because an option supplies images too).
$use_option_images    = false;
$option_images_po_id  = 0;
foreach ($product_options as $po) {
	if (!empty($po['use_as_images'])) {
		$opt_imgs = [];
		foreach ($po['values'] as $v) {
			if (!empty($v['image'])) {
				$opt_imgs[] = [
					'filename'        => $v['image'],
					'is_primary'      => 0,
					'option_value_id' => $v['id'],
				];
			}
		}
		if ($opt_imgs) {
			if ($images) {
				// Real product images have no option_value_id — give them one
				// so the template's data-pov-id lookup never hits a missing key.
				foreach ($images as &$_img) {
					$_img['option_value_id'] = 0;
				}
				unset($_img);
				$images = array_merge($images, $opt_imgs);
			} else {
				$opt_imgs[0]['is_primary'] = 1;
				$images = $opt_imgs;
			}
			$use_option_images   = true;
			$option_images_po_id = (int)$po['id'];
		}
		break;
	}
}

// Sanitise descriptions — guard against "false" stored by Trumbowyg
if ($product['description'] === 'false') $product['description'] = '';
if ($product['description_long'] === 'false') $product['description_long'] = '';

// Related products + image display settings
$_rel_settings    = [];
$_rel_rows        = DB::rows("SELECT `key`, `value` FROM `{$p}settings` WHERE `key` IN ('img_related_size','related_max_items','img_product_width')");
foreach ($_rel_rows as $_r) $_rel_settings[$_r['key']] = $_r['value'];
$rel_thumb_size    = max(80,  (int)($_rel_settings['img_related_size'] ?? 200));
$rel_max_items     = max(0,   (int)($_rel_settings['related_max_items'] ?? 0));
$img_product_width = max(200, (int)($_rel_settings['img_product_width'] ?? 600));

$_rel_limit = $rel_max_items > 0 ? " LIMIT {$rel_max_items}" : '';

$related_products = [];
if (in_array('related-products', PluginLoader::loaded())) {
	$related_products = DB::rows(
		"SELECT p.id, p.name, p.slug, p.price, p.list_price, p.description,
		        (SELECT filename FROM `{$p}product_images`
		         WHERE product_id = p.id AND is_primary = 1
		         ORDER BY display_order ASC LIMIT 1) AS image
		 FROM `{$p}product_related` pr
		 JOIN `{$p}products` p ON p.id = pr.related_product_id
		 WHERE pr.product_id = ? AND p.status > 0
		 ORDER BY pr.display_order ASC, p.name ASC{$_rel_limit}",
		[(int)$product['id']]
	);
}

$can_review = Hook::instead('catalog.product.can_review', false, [
	'product_id'  => (int)$product['id'],
	'customer_id' => is_logged_in() ? $_SESSION['customer_id'] : null,
]);

// Load blocks from the Product system page (rendered below the product view).
require_once DIR_LIB . 'page_block_helper.php';
$_prod_sys    = DB::row("SELECT id, sidebar_position FROM `{$p}pages` WHERE slug='product' AND page_type='product' LIMIT 1");
$sidebar_blocks = [];
$below_blocks   = [];
$sidebar_position = $_prod_sys['sidebar_position'] ?? 'left';
if ($_prod_sys) {
	foreach (hydrate_page_blocks((int)$_prod_sys['id'], $p, $smarty, (int)$product['id']) as $_b) {
		if ($_b['block_type'] === 'product_view') continue;
		if ((int)($_b['col_start'] ?? 2) === 1) {
			$sidebar_blocks[] = $_b;
		} else {
			$below_blocks[] = $_b;
		}
	}
}

// Add related products to sidebar if sidebar has content
if ($sidebar_blocks && $related_products) {
	$sidebar_blocks[] = [
		'block_type' => 'related_products',
		'heading' => 'Related Products',
		'products' => $related_products,
		'thumb_size' => $rel_thumb_size
	];
}

// Build the JSON-LD Product schema as real data + json_encode(), not
// hand-escaped-per-field template markup — the old approach applied
// Smarty's HTML |escape (turns a real " into &quot;) to values going
// straight into a JSON string, which needs \" instead: any product name
// containing a quote or apostrophe rendered as literal "&quot;...&quot;"
// in the structured data, not an actual quote character. Also fixed here:
// priceCurrency was the "$" display symbol, not a valid ISO 4217 code
// (schema.org requires e.g. "USD"); the offer url was root-relative and
// used the non-SEO-friendly ?route=product&id= form, but schema.org wants
// an absolute URL; and availability used `stock > 0` for InStock, which
// reads stock=-1 (this app's "unlimited, don't track" sentinel —
// admin/tpl/products/list.html: "-1 disables stock check") as OutOfStock.
$_og_image = $images ? absolute_url($images[0]['filename']) : absolute_url('/img/placeholder.png');
$_currency_code = strtoupper((string)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='site_currency_code'") ?: 'USD'));
$product_json_ld = json_encode([
	'@context'    => 'https://schema.org/',
	'@type'       => 'Product',
	'name'        => $product['name'],
	'description' => trim(html_entity_decode(strip_tags((string)($product['seo_description'] ?: $product['description'])), ENT_QUOTES)),
	'sku'         => $product['sku'],
	'image'       => $_og_image,
	'brand'       => ['@type' => 'Brand', 'name' => $_nc_site_settings['site_name'] ?? SITE_NAME],
	'offers'      => [
		'@type'         => 'Offer',
		'url'           => absolute_url(URL_ROOT . 'product/' . $product['slug']),
		'priceCurrency' => $_currency_code,
		'price'         => number_format((float)$product['price'], 2, '.', ''),
		'availability'  => ((int)$product['stock'] === 0) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
	],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

$smarty->assign('product',             $product);
$smarty->assign('product_json_ld',     $product_json_ld);
$smarty->assign('can_review',          $can_review);
$smarty->assign('is_admin_user',       $is_admin_user);
$smarty->assign('images',             $images);
$smarty->assign('product_options',    $product_options);
$smarty->assign('use_option_images',  $use_option_images);
$smarty->assign('option_images_po_id',$option_images_po_id);
$smarty->assign('related_products',  $related_products);
$smarty->assign('og_image', $_og_image);
$smarty->assign('rel_thumb_size',    $rel_thumb_size);
$smarty->assign('sidebar_position',   $sidebar_position);
$smarty->assign('img_product_width', $img_product_width);
$smarty->assign('sidebar_blocks',    $sidebar_blocks);
$smarty->assign('below_blocks',      $below_blocks);
$smarty->assign('page_type',        'product');
$_prod_surround = $_prod_sys ? sys_page_content((int)$_prod_sys['id']) : ['before'=>'','after'=>''];
$smarty->assign('content_before', $_prod_surround['before']);
$smarty->assign('content_after',  $_prod_surround['after']);

$product_meta_desc = $product['seo_description'] ?? trim(strip_tags($product['description'] ?? ''));
$smarty->assign('meta_description', mb_substr($product_meta_desc, 0, 200));
$smarty->assign('meta_keywords',    $product['seo_keywords'] ?? '');

catalog_sidebar($smarty);

// A product-list block (especially Random) must never be served from the
// page cache — see blocks_need_fresh_render()'s own comment for why.
if (blocks_need_fresh_render(array_merge($sidebar_blocks, $below_blocks))) {
	$smarty->caching = Smarty::CACHING_OFF;
}

$smarty->display('product.html');
