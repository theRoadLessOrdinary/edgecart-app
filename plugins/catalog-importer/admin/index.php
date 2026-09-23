<?php
require_access(ACCESS_EDIT);
require_once __DIR__ . '/../lib/staging.php';
require_once __DIR__ . '/../lib/adapters/opencart.php';
require_once __DIR__ . '/../lib/adapters/shopify.php';
require_once __DIR__ . '/../lib/adapters/etsy.php';

$result = null;
$error  = '';

function ci_uploaded_file(string $field): ?string {
	if (!isset($_FILES[$field]) || $_FILES[$field]['error'] === UPLOAD_ERR_NO_FILE) return null;
	if ($_FILES[$field]['error'] !== UPLOAD_ERR_OK) {
		throw new RuntimeException("Upload of \"{$field}\" failed (error code {$_FILES[$field]['error']}).");
	}
	return $_FILES[$field]['tmp_name'];
}

if (is_post() && post('action') === 'import_json') {
	require_csrf_token();

	$json = trim((string)post('staging_json'));
	$staged = json_decode($json, true);

	if ($json === '') {
		$error = 'Paste staging-format JSON before running the import.';
	} elseif (json_last_error() !== JSON_ERROR_NONE) {
		$error = 'That isn\'t valid JSON: ' . json_last_error_msg();
	} elseif (!is_array($staged)) {
		$error = 'The staging JSON must be an object with categories/products/customers.';
	} else {
		try {
			$result = ci_run_import($staged);
		} catch (Throwable $e) {
			$error = 'Import failed: ' . $e->getMessage();
		}
	}
}

if (is_post() && post('action') === 'import_opencart') {
	require_csrf_token();

	$host = trim((string)post('oc_host'));
	$name = trim((string)post('oc_name'));
	$user = trim((string)post('oc_user'));
	$pass = (string)post('oc_pass');
	$prefix = trim((string)post('oc_prefix')) ?: 'oc_';

	if ($host === '' || $name === '' || $user === '') {
		$error = 'Host, database name, and username are required to connect to OpenCart.';
	} else {
		try {
			$oc = ci_opencart_connect($host, $name, $user, $pass);
			$staged = ci_opencart_extract($oc, $prefix);
			$result = ci_run_import($staged);
		} catch (Throwable $e) {
			$error = 'OpenCart import failed: ' . $e->getMessage();
		}
	}
}

if (is_post() && post('action') === 'import_shopify') {
	require_csrf_token();

	try {
		$products_file = ci_uploaded_file('shopify_products_csv');
		if ($products_file === null) {
			$error = 'Choose your Shopify products CSV export (Products > Export in Shopify admin).';
		} else {
			$staged = ci_shopify_extract_products_csv($products_file);

			$customers_file = ci_uploaded_file('shopify_customers_csv');
			if ($customers_file !== null) {
				$staged['customers'] = ci_shopify_extract_customers_csv($customers_file);
			}

			$result = ci_run_import($staged);
		}
	} catch (Throwable $e) {
		$error = 'Shopify import failed: ' . $e->getMessage();
	}
}

if (is_post() && post('action') === 'import_etsy') {
	require_csrf_token();

	try {
		$listings_file = ci_uploaded_file('etsy_listings_csv');
		if ($listings_file === null) {
			$error = 'Choose your Etsy listings CSV export.';
		} else {
			$staged = ci_etsy_extract_products_csv($listings_file);
			$result = ci_run_import($staged);
		}
	} catch (Throwable $e) {
		$error = 'Etsy import failed: ' . $e->getMessage();
	}
}

$smarty->assign('result', $result);
$smarty->assign('error',  $error);
$smarty->assign('page_title', 'Catalog Importer');
$smarty->display('catalog-importer/list.html');
