#!/usr/bin/env php
<?php
/**
 * EdgeCart order build tool — CLI
 *
 * Usage:
 *   php build-order.php <sld> [bundle|core|plugin1,plugin2] <output.zip>
 *
 * Exit codes: 0 = success, 1 = error (message on STDERR)
 */

require_once __DIR__ . '/build-lib.php';

$sld         = $argv[1] ?? '';
$plugins_arg = $argv[2] ?? 'core';
$output_path = $argv[3] ?? '';

if (!$sld || !$output_path) {
    fwrite(STDERR, "Usage: php build-order.php <sld> <bundle|core|plugins> <output.zip>\n");
    exit(1);
}

$result = ec_build_order($sld, $plugins_arg, $output_path);

if (!$result['ok']) {
    fwrite(STDERR, $result['error'] . "\n");
    exit(1);
}

echo $result['path'] . "\n";
exit(0);
