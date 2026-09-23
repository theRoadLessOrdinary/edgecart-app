<?php
/* storefront — discount code validation */
header('Content-Type: application/json');

$action = post('action', '');

if ($action === 'validate_code') {
	require_once DIR_LIB . 'rate-limit.php';

	$ip = RateLimit::getClientIp();
	if (!RateLimit::check('discount:' . $ip, 5, 60)) {
		echo json_encode(['ok' => false, 'message' => 'Too many validation attempts. Please try again in a moment.']);
		exit;
	}

	$code     = strtoupper(trim(post('code')));
	$subtotal = (float)post('subtotal', 0);

	if (!$code) {
		echo json_encode(['ok' => false, 'message' => 'Please enter a discount code.']);
		exit;
	}
	if ($subtotal <= 0) {
		echo json_encode(['ok' => false, 'message' => 'Invalid order amount.']);
		exit;
	}

	$result = checkout_validate_discount($code, $subtotal);
	if ($result['error']) {
		echo json_encode(['ok' => false, 'message' => $result['error']]);
		exit;
	}

	echo json_encode([
		'ok'               => true,
		'code'             => $code,
		'discount_amount'  => $result['amount'],
		'discount_percent' => null,
	]);
	exit;
}

echo json_encode(['ok' => false, 'message' => 'Invalid action.']);
