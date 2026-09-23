<?php
/**
 * Fulfillment smoke test — goalpost test #1 (see project memory
 * "project-goalpost-saleable" for the full context).
 *
 * Exercises tools/build-lib.php::ec_build_order() directly (no DB, no HTTP,
 * no checkout flow — just the build+sign step) and verifies:
 *   1. A core-only build succeeds and contains a validly-signed core license.
 *   2. A real premium-plugin build succeeds and contains a validly-signed
 *      license.php for that plugin, matching the domain requested.
 *   3. Dev-only files (AUDIT_REPORT.md, instructions.md, edgecart.md,
 *      tests/, tools/) never leak into a customer build.
 *
 * This exists because tools/build-lib.php went missing entirely at some
 * point with the cause unknown, and nothing caught it until it was found by
 * hand. Run this on a schedule (cron) or before/after touching tools/,
 * plugins/ (which changes what's free vs premium), or the licensing code.
 *
 * Usage: php tests/fulfillment-smoke-test.php
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */

$appRoot = realpath(__DIR__ . '/..') . '/';
$buildLib = $appRoot . 'tools/build-lib.php';

$failures = [];
$pass = fn(string $msg) => print("  \033[32mPASS\033[0m  $msg\n");
$fail = function (string $msg) use (&$failures) {
    print("  \033[31mFAIL\033[0m  $msg\n");
    $failures[] = $msg;
};

// ── 0. build-lib.php must exist at all ──────────────────────────────────────
echo "0. build-lib.php present\n";
if (!file_exists($buildLib)) {
    $fail("tools/build-lib.php does not exist at $buildLib — fulfillment is broken.");
    finish($failures);
}
require_once $buildLib;
if (!function_exists('ec_build_order')) {
    $fail('ec_build_order() is not defined after requiring build-lib.php.');
    finish($failures);
}
$pass('tools/build-lib.php exists and defines ec_build_order().');

// ── Public key, derived from the private signing key ────────────────────────
$keyPath = defined('EC_BUILD_KEY_PATH') ? EC_BUILD_KEY_PATH : '/home/william/.edgecart/signing_key.pem';
$privPem = @file_get_contents($keyPath);
if ($privPem === false) {
    $fail("Cannot read signing key at $keyPath.");
    finish($failures);
}
$priv = openssl_pkey_get_private($privPem);
$pub  = openssl_pkey_get_details($priv)['key'];

function verify_license_sig(string $phpSource, string $subject, $pub): bool {
    if (!preg_match("/'([A-Za-z0-9+\/=]{40,})'/s", $phpSource, $m)) return false;
    $sig = base64_decode($m[1]);
    return openssl_verify($subject, $sig, $pub, OPENSSL_ALGO_SHA256) === 1;
}

$tmpDir = sys_get_temp_dir() . '/ec_smoke_' . bin2hex(random_bytes(4));
mkdir($tmpDir, 0700, true);
$testSld = 'smoketest';

// ── 1. Core-only build ───────────────────────────────────────────────────────
echo "\n1. Core-only build (\$plugins_arg = 'core')\n";
$coreZip = $tmpDir . '/core.zip';
$result  = ec_build_order($testSld, 'core', $coreZip);

if (empty($result['ok'])) {
    $fail('ec_build_order("core") returned ok=false: ' . ($result['error'] ?? 'unknown error'));
} else {
    $pass('ec_build_order("core") returned ok=true.');

    $zip = new ZipArchive();
    if ($zip->open($coreZip) !== true) {
        $fail('Could not open the core build output zip.');
    } else {
        $coreLicense = $zip->getFromName('cfg/license.php');
        if ($coreLicense === false) {
            $fail('cfg/license.php missing from core build.');
        } elseif (!verify_license_sig($coreLicense, $testSld, $pub)) {
            $fail('cfg/license.php signature does not validate for domain "' . $testSld . '".');
        } else {
            $pass('cfg/license.php present and signature validates.');
        }

        // Dev-only files must never leak into a customer build.
        $forbidden = ['AUDIT_REPORT.md', 'instructions.md', 'edgecart.md'];
        $leaked = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (in_array($name, $forbidden, true) || str_starts_with($name, 'tests/') || str_starts_with($name, 'tools/')) {
                $leaked[] = $name;
            }
        }
        if ($leaked) {
            $fail('Dev-only files leaked into customer build: ' . implode(', ', $leaked));
        } else {
            $pass('No dev-only files (AUDIT_REPORT.md, instructions.md, edgecart.md, tests/, tools/) in the build.');
        }
        $zip->close();
    }
}

// ── 2. Real premium-plugin build ─────────────────────────────────────────────
echo "\n2. Premium-plugin build (a real plugin, picked dynamically)\n";
$pluginsZipDir = realpath($appRoot . '../edgeCart-plugins') . '/';
$candidates = is_dir($pluginsZipDir) ? glob($pluginsZipDir . '*.zip') : [];

if (!$candidates) {
    $fail("No plugin zips found in $pluginsZipDir — cannot test a real premium-plugin build.");
} else {
    $pluginCode = basename($candidates[0], '.zip');
    echo "   (using plugin: $pluginCode)\n";

    $pluginZipOut = $tmpDir . '/plugin.zip';
    $result = ec_build_order($testSld, $pluginCode, $pluginZipOut);

    if (empty($result['ok'])) {
        $fail("ec_build_order(\"$pluginCode\") returned ok=false: " . ($result['error'] ?? 'unknown error'));
    } else {
        $pass("ec_build_order(\"$pluginCode\") returned ok=true.");

        $zip = new ZipArchive();
        if ($zip->open($pluginZipOut) !== true) {
            $fail('Could not open the plugin build output zip.');
        } else {
            $licPath = "plugins/{$pluginCode}/license.php";
            $license = $zip->getFromName($licPath);
            if ($license === false) {
                $fail("$licPath missing — a purchased premium plugin shipped with no license at all (would load unrestricted).");
            } elseif (!verify_license_sig($license, "{$pluginCode}:{$testSld}", $pub)) {
                $fail("$licPath signature does not validate for \"{$pluginCode}:{$testSld}\".");
            } else {
                $pass("$licPath present and signature validates.");
            }
            $zip->close();
        }
    }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
array_map('unlink', glob($tmpDir . '/*'));
rmdir($tmpDir);

finish($failures);

function finish(array $failures): void {
    echo "\n" . str_repeat('-', 50) . "\n";
    if ($failures) {
        echo "FAILED: " . count($failures) . " check(s) failed.\n";
        exit(1);
    }
    echo "All checks passed.\n";
    exit(0);
}
