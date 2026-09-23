<?php
$action = post('action', get('action', ''));

// ── Add to cart (AJAX POST) ────────────────────────────────────────────────────
if ($action === 'add') {
	header('Content-Type: application/json');
	$product_id = (int)post('product_id');
	$qty        = max(1, (int)post('qty', 1));

	$options = [];
	$raw_opts = post('options', []);
	if (is_array($raw_opts)) {
		foreach ($raw_opts as $po_id => $pov_id) {
			$options[(int)$po_id] = (int)$pov_id;
		}
	}

	$p = DB_PREFIX;
	$product = DB::row("SELECT id FROM `{$p}products` WHERE id = ? AND status > 0", [$product_id]);
	if (!$product) {
		echo json_encode(['ok' => false, 'message' => 'Product not found.']);
		exit;
	}
	if (!Hook::instead('catalog.product.can_view', true, ['product' => $product])) {
		echo json_encode(['ok' => false, 'message' => 'Product not available.']);
		exit;
	}

	Cart::add($product_id, $qty, $options);
	echo json_encode([
		'ok'           => true,
		'cart_count'   => Cart::count(),
		'cart_subtotal'=> Cart::subtotal(),
	]);
	exit;
}

// ── Update qty (AJAX POST) ────────────────────────────────────────────────────
if ($action === 'update') {
	header('Content-Type: application/json');
	$index = (int)post('index');
	$qty   = (int)post('qty');
	Cart::update($index, $qty);
	$items    = Cart::get();
	$subtotal = Cart::subtotal();
	echo json_encode([
		'ok'       => true,
		'count'    => Cart::count(),
		'subtotal' => money($subtotal),
		'items'    => array_map(fn($i) => [
			'index'      => array_search($i, $items),
			'line_total' => money($i['line_total']),
		], $items),
	]);
	exit;
}

// ── Remove (AJAX POST) ────────────────────────────────────────────────────────
if ($action === 'remove') {
	header('Content-Type: application/json');
	Cart::remove((int)post('index'));
	echo json_encode(['ok' => true, 'count' => Cart::count(), 'subtotal' => money(Cart::subtotal())]);
	exit;
}


// ── Get cart (AJAX GET) ────────────────────────────────────────────────────
if ($action === 'get') {
	header('Content-Type: application/json');
	$items = Cart::get();
	$cart_items = [];
	foreach ($items as $item) {
		$cart_items[] = [
			'product_id' => (int)$item['id'],
			'qty'        => (int)$item['qty'],
			'options'    => isset($item['options']) ? $item['options'] : [],
		];
	}
	echo json_encode([
		'ok'         => true,
		'items'      => $cart_items,
		'cart_total' => (float)Cart::subtotal(),
	]);
	exit;
}
// ── View cart page ─────────────────────────────────────────────────────────────
$p = DB_PREFIX;

// Track all cart items as displayed BEFORE hydrating blocks (for deduplication in featured products)
$cart_items = Cart::get();
foreach ($cart_items as $item) {
	track_displayed_product((int)$item['product_id']);
}

$cart_page = DB::row("SELECT * FROM `{$p}pages` WHERE slug='cart'");
$blocks    = $cart_page ? hydrate_page_blocks($cart_page['id'], $p, $smarty) : [];

catalog_sidebar($smarty);

$img_cart_size = max(40, (int)(DB::val("SELECT `value` FROM `{$p}settings` WHERE `key`='img_cart_size'") ?: 100));

$sys_content = $cart_page ? sys_page_content((int)$cart_page['id']) : ['before'=>'','after'=>''];

$smarty->assign('items',          $cart_items);
$smarty->assign('subtotal',       money(Cart::subtotal()));
$smarty->assign('page',           $cart_page);
$smarty->assign('blocks',         $blocks);
$smarty->assign('page_type',      'cart');
$smarty->assign('content_before', $sys_content['before']);
$smarty->assign('content_after',  $sys_content['after']);
$smarty->assign('img_cart_size',  $img_cart_size);
$smarty->display('cart.html');
