<?php
/**
 * lib/license-limits.php — single source of truth for this store's tier
 * limits: categories, products-per-category, categories-per-product,
 * options-per-product, images-per-product, and discount codes.
 *
 * Every code path that creates one of these rows — the manual admin forms
 * AND the Catalog Importer's bulk writes — must call the matching function
 * here instead of inlining its own Hook::instead('admin.limit.*', ...) +
 * COUNT(*) check. The importer originally didn't do either, and silently
 * bypassed every one of these caps on a bulk import (found via a Playwright
 * E2E run, fixed alongside this file). A shared checkpoint like this is what
 * stops the next new bulk-write path from repeating that mistake — a
 * reviewer (or Claude) only has to ask "did this call the shared limit
 * check?" instead of re-deriving the right Hook key and message each time.
 *
 * Each check_*() function only reports whether room exists; it never calls
 * ajax_out() itself; a manual-form endpoint that must reject the whole
 * request and a bulk importer that should skip just the offending row and
 * keep going need different responses to the same "no room" answer, so
 * that decision stays with the caller.
 */

function license_limit(string $key, int $default): int {
	return (int)Hook::instead('admin.limit.' . $key, $default);
}

function check_category_limit(string $p): array {
	$limit = license_limit('categories', 3);
	$count = (int)DB::val("SELECT COUNT(*) FROM `{$p}categories`");
	return [
		'ok'      => $count < $limit,
		'limit'   => $limit,
		'count'   => $count,
		'message' => 'Category limit reached (' . $limit . '). Upgrade to add more.',
	];
}

function check_products_per_cat_limit(string $p, int $categoryId): array {
	$limit   = license_limit('products_per_cat', 5);
	$count   = (int)DB::val("SELECT COUNT(*) FROM `{$p}categories_products` WHERE category_id = ?", [$categoryId]);
	$catName = DB::val("SELECT name FROM `{$p}categories` WHERE id = ?", [$categoryId]);
	return [
		'ok'      => $count < $limit,
		'limit'   => $limit,
		'count'   => $count,
		'message' => 'Product limit reached for category "' . ($catName ?: $categoryId) . '" (' . $limit . ' products max). Upgrade to add more.',
	];
}

/**
 * Not a pass/fail check — per-product category count is trimmed rather than
 * rejected outright everywhere it's enforced today (admin/js/products.js's
 * own client-side behavior matches this), so this returns the clamped id
 * list directly instead of an ok/message pair.
 */
function clamp_product_categories(array $categoryIds): array {
	$limit = license_limit('product_categories', 1);
	return [
		'limit' => $limit,
		'ids'   => count($categoryIds) > $limit ? array_slice($categoryIds, 0, $limit) : $categoryIds,
	];
}

function check_options_per_product_limit(string $p, int $productId): array {
	$limit = license_limit('options_per_product', 2);
	$count = (int)DB::val("SELECT COUNT(*) FROM `{$p}product_options` WHERE product_id = ?", [$productId]);
	return [
		'ok'      => $count < $limit,
		'limit'   => $limit,
		'count'   => $count,
		'message' => 'Option limit reached (' . $limit . ' per product). Upgrade to add more.',
	];
}

/**
 * Reusing an image already linked to this product is free — only a genuinely
 * new insertion should count against the cap. Callers that support reuse
 * (e.g. picking an existing file-manager image already on the product) must
 * check that themselves before consulting this; it only answers "is room
 * left for one more image right now."
 */
function check_images_per_product_limit(string $p, int $productId): array {
	$limit = license_limit('images_per_product', 2);
	$count = (int)DB::val("SELECT COUNT(*) FROM `{$p}product_images` WHERE product_id = ?", [$productId]);
	return [
		'ok'      => $count < $limit,
		'limit'   => $limit,
		'count'   => $count,
		'message' => 'Image limit reached (' . $limit . ' per product). Upgrade to add more.',
	];
}

function check_discount_limit(string $p): array {
	$limit = license_limit('discounts', 3);
	$count = (int)DB::val("SELECT COUNT(*) FROM `{$p}discount_codes`");
	return [
		'ok'      => $count < $limit,
		'limit'   => $limit,
		'count'   => $count,
		'message' => 'Discount code limit reached (' . $limit . '). Upgrade to add more.',
	];
}
