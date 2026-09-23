<?php
/**
 * page_block_helper.php
 * Shared utilities for block-page rendering.
 */

/**
 * Normalise block col_start to 1 (sidebar) or 2 (main content).
 * Mutates the blocks array in place.
 */
function normalize_block_grid(array &$blocks): void {
	foreach ($blocks as &$b) {
		$b['col_start'] = (int)($b['col_start'] ?? 2) >= 2 ? 2 : 1;
	}
	unset($b);
}

/**
 * Load and hydrate all blocks for a page, including grid position normalisation.
 * Returns the processed blocks array ready for Smarty assignment.
 */
function hydrate_page_blocks(int $page_id, string $p, $smarty, int $exclude_product_id = 0): array {
	$blocks = DB::rows(
		"SELECT * FROM `{$p}page_blocks` WHERE page_id=? AND enabled=1 ORDER BY display_order ASC",
		[$page_id]
	);

	$rel_size_default = null;

	foreach ($blocks as &$b) {
		$s = $b['settings'] ? json_decode($b['settings'], true) : [];
		$b['is_core'] = !empty($s['is_core']);

		switch ($b['block_type']) {
			case 'product_view':
			case 'cart_contents':
			case 'checkout_form':
				// Core system blocks — rendered directly by their respective templates
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
				if ($rel_size_default === null) {
					$rel_size_default = max(80, (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='img_related_size'") ?: 200));
				}
				$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_size_default;
				break;
			case 'featured_products':
			case 'best_sellers':
			case 'new_arrivals':
			case 'random_products':
				$count = (int)($s['count'] ?? 6);
				$b['heading']  = $s['heading'] ?? ucwords(str_replace('_', ' ', $b['block_type']));
				$orderBy       = $b['block_type'] === 'new_arrivals' ? 'p.id DESC'
				               : ($b['block_type'] === 'featured_products' ? 'p.featured_order ASC, p.name ASC'
				               : ($b['block_type'] === 'random_products' ? 'RAND()' : 'p.display_order ASC, p.name ASC'));
				$featuredWhere = $b['block_type'] === 'featured_products' ? ' AND p.featured=1' : '';

				// Build exclusion clause for already-displayed products
				$displayedProducts = get_displayed_products();
				$excludeIds = array_filter([$exclude_product_id, ...$displayedProducts]);
				$excludeWhere = '';
				$params = [];

				if (!empty($excludeIds)) {
					$placeholders = implode(',', array_fill(0, count($excludeIds), '?'));
					$excludeWhere = " AND p.id NOT IN ($placeholders)";
					$params = array_values($excludeIds);
				}
				$params[] = $count;

				$b['products'] = DB::rows(
					"SELECT p.*, (SELECT filename FROM `{$p}product_images`
					  WHERE product_id=p.id ORDER BY display_order ASC LIMIT 1) AS image
					 FROM `{$p}products` p WHERE p.status>0{$featuredWhere}{$excludeWhere}
					 ORDER BY {$orderBy} LIMIT ?",
					$params
				);
				foreach ($b['products'] as &$prod) {
					if ($prod['description'] === 'false') $prod['description'] = '';
					if ($prod['description_long'] === 'false') $prod['description_long'] = '';
				}
				unset($prod);
				if ($rel_size_default === null) {
					$rel_size_default = max(80, (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='img_related_size'") ?: 200));
				}
				$b['thumb_size'] = !empty($s['thumb_size']) && (int)$s['thumb_size'] >= 40 ? (int)$s['thumb_size'] : $rel_size_default;
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
		}
		$b['settings'] = $s;
	}
	unset($b);

	normalize_block_grid($blocks);

	return $blocks;
}

/**
 * True if any of these blocks lists live products (featured, best sellers,
 * new arrivals, a category, or random). A page containing one must not be
 * served from Smarty's page cache — random especially would stop being
 * random for the life of the cache, and the others can go stale on stock or
 * a newly added/removed product for the same window. Smarty's {nocache}
 * fragment tag was tried first and found unreliable here: the product list
 * lives inside a {foreach} loop variable, not a template-assigned var, and
 * Smarty's nocache re-execution on a cached page can't resolve that on
 * subsequent loads — it rendered as a blank sidebar. Disabling caching for
 * the whole response is the reliable fix; call this and set
 * $smarty->caching = Smarty::CACHING_OFF when it returns true, before the
 * final $smarty->display() call.
 */
function blocks_need_fresh_render(array $blocks): bool {
	static $types = ['featured_products', 'best_sellers', 'best_sellers_category', 'new_arrivals', 'random_products'];
	foreach ($blocks as $b) {
		if (in_array($b['block_type'] ?? '', $types, true)) return true;
	}
	return false;
}
