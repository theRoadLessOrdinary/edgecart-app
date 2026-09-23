<?php
/**
 * EdgeCart order build library — included by both CLI and plugin.
 *
 * ec_build_order(string $sld, string $plugins, string $output_path): array
 *   $sld         Second-level domain (e.g. "mystore" from mystore.com)
 *   $plugins     Comma-separated plugin codes | "bundle" | "core"
 *   $output_path Absolute path for the output zip
 *   Returns ['ok'=>true,'path'=>$output_path] or ['ok'=>false,'error'=>'...']
 *
 * Plugin resolution rules:
 *   Free (always signed, always included): plugins in edgeCart-app without license.php
 *   Premium-in-app: plugins in edgeCart-app WITH license.php
 *   Premium-external: zips in edgeCart-plugins/
 *
 * "bundle" includes and signs every premium plugin.
 * "core"   signs only the core license and free plugin licenses.
 * "stripe,goshippo" signs those specific premium plugin licenses.
 *
 * All external plugin zips are expected to have the plugin code as root dir:
 *   reviews/hooks.php → plugins/reviews/hooks.php in the output zip
 */

define('EC_BUILD_APP_ROOT',     realpath(__DIR__ . '/..') . '/');
define('EC_BUILD_PLUGINS_ZIPS', realpath(__DIR__ . '/../../edgeCart-plugins') . '/');
define('EC_BUILD_KEY_PATH',     '/media/william/8TB-DRIVE/www/sites/edgeCart/store/storage/keys/signing_key.pem');

/**
 * Seasonal theme plugins, and license-limit "unlock" plugins (categories-
 * products, discounts — their entire purpose is registering an
 * admin.limit.*.instead hook to raise/remove a tier cap), must install
 * disabled by default — "disabled" is purely a directory-naming convention
 * (a leading dot on the plugins/ folder, per lib/plugin-loader.php), which
 * only actually holds if whoever packaged that plugin's zip remembered to
 * apply it. In practice some haven't: found via a real customer install
 * where every seasonal theme came in enabled except the two — theme-greens,
 * theme-pink — that happen to already live dot-prefixed in edgeCart-app's
 * own source tree; then found again for categories-products/discounts via a
 * Playwright E2E bulk-import test on a fresh install, which created 10
 * categories straight through the free-tier cap of 3 because
 * categories-products.zip's root dir was never dot-prefixed either — every
 * fresh install was silently shipping with the category and discount tier
 * caps already unlocked for free. Rather than trust each individual plugin
 * zip to have gotten this right, enforce it here, once, for every plugin
 * this builder ever outputs that must default to off, regardless of which
 * of the three source paths (free in-app, premium in-app, external zip) it
 * came from.
 */
function ec_output_plugin_code(string $code): string {
    if ($code === 'theme-sienna') return $code;
    if (str_starts_with($code, 'theme-') && !str_starts_with($code, 'theme-editor') && !str_starts_with($code, 'theme-scheduler')) {
        return '.' . $code;
    }
    if (in_array($code, ['categories-products', 'discounts'], true)) {
        return '.' . $code;
    }
    return $code;
}

function ec_build_order(string $sld, string $plugins_arg, string $output_path): array
{
    // Validate SLD
    $sld = preg_replace('/[^a-z0-9\-]/', '', strtolower($sld));
    if (!$sld) {
        return ['ok' => false, 'error' => 'Invalid domain SLD.'];
    }

    // Load private key
    $pem = @file_get_contents(EC_BUILD_KEY_PATH);
    if (!$pem) {
        return ['ok' => false, 'error' => 'Cannot read signing key at: ' . EC_BUILD_KEY_PATH];
    }
    $privKey = openssl_pkey_get_private($pem);
    if (!$privKey) {
        return ['ok' => false, 'error' => 'Invalid private key.'];
    }

    // Classify plugins in edgeCart-app
    $premium_in_app = [];  // code => dir path
    $free_in_app    = [];  // code => dir path

    $pluginsDir = EC_BUILD_APP_ROOT . 'plugins/';
    foreach (scandir($pluginsDir) as $entry) {
        if ($entry[0] === '.') continue;
        $dir = $pluginsDir . $entry;
        if (!is_dir($dir)) continue;
        if (file_exists($dir . '/license.php')) {
            $premium_in_app[$entry] = $dir;
        } else {
            $free_in_app[$entry] = $dir;
        }
    }

    // Enumerate external plugin zips
    $external_zips = [];  // code => zip path
    if (is_dir(EC_BUILD_PLUGINS_ZIPS)) {
        foreach (glob(EC_BUILD_PLUGINS_ZIPS . '*.zip') as $zip) {
            $code = basename($zip, '.zip');
            $external_zips[$code] = $zip;
        }
    }

    // Determine which premium plugins to sign / which external to include
    if ($plugins_arg === 'bundle' || $plugins_arg === 'all') {
        $sign_in_app    = array_keys($premium_in_app);
        $include_ext    = $external_zips;
    } elseif ($plugins_arg === '' || $plugins_arg === 'core') {
        $sign_in_app    = [];
        $include_ext    = [];
    } else {
        $requested      = array_filter(array_map('trim', explode(',', $plugins_arg)));
        $sign_in_app    = array_intersect(array_keys($premium_in_app), $requested);
        $include_ext    = array_intersect_key($external_zips, array_flip($requested));
    }

    // Build the zip
    $zip = new ZipArchive();
    $result = $zip->open($output_path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    if ($result !== true) {
        return ['ok' => false, 'error' => 'Cannot create zip at: ' . $output_path . ' (error ' . $result . ')'];
    }

    // ── Add all edgeCart-app files, skipping premium plugin dirs + old licenses ──
    $skipDirs     = array_keys($premium_in_app);
    $appRoot      = EC_BUILD_APP_ROOT;

    $iter = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($appRoot, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iter as $file) {
        $real    = $file->getRealPath();
        $relPath = substr($real, strlen($appRoot));

        // Skip .git, tools/, and dev-only files that shouldn't reach a customer
        if (str_starts_with($relPath, '.git')) continue;
        if (str_starts_with($relPath, 'tools/') || $relPath === 'tools') continue;
        if (str_starts_with($relPath, 'tests/') || $relPath === 'tests') continue;
        if (in_array($relPath, ['AUDIT_REPORT.md', 'edgecart.md', 'instructions.md'], true)) continue;

        // Skip premium plugin dirs (always — add back signed ones below)
        $skip = false;
        foreach ($skipDirs as $code) {
            if ($relPath === 'plugins/' . $code || str_starts_with($relPath, 'plugins/' . $code . '/')) {
                $skip = true;
                break;
            }
        }
        if ($skip) continue;

        // Skip existing license files (we write fresh signed ones)
        if ($relPath === 'cfg/license.php') continue;
        foreach (array_keys($free_in_app) as $code) {
            if ($relPath === 'plugins/' . $code . '/license.php') continue 2;
        }

        if ($file->isDir()) {
            $zip->addEmptyDir($relPath);
        } else {
            $zip->addFile($real, $relPath);
        }
    }

    // ── Signed core license ───────────────────────────────────────────────────
    openssl_sign($sld, $coreSig, $privKey, OPENSSL_ALGO_SHA256);
    $zip->addFromString('cfg/license.php', _ec_core_license_php($sld, base64_encode($coreSig)));

    // ── Signed free plugin licenses (for those that happen to have one) ───────
    foreach ($free_in_app as $code => $dir) {
        if (file_exists($dir . '/license.php')) {
            openssl_sign($code . ':' . $sld, $sig, $privKey, OPENSSL_ALGO_SHA256);
            $zip->addFromString("plugins/{$code}/license.php",
                _ec_plugin_license_php($code, $sld, base64_encode($sig)));
        }
    }

    // ── Premium in-app plugins requested in this order ────────────────────────
    foreach ($sign_in_app as $code) {
        $outCode = ec_output_plugin_code($code);
        $dir  = $premium_in_app[$code];
        $pfx  = $dir . '/';
        $iter2 = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($iter2 as $file) {
            $rel2 = 'plugins/' . $outCode . '/' . substr($file->getRealPath(), strlen($pfx));
            if ($rel2 === "plugins/{$outCode}/license.php") continue;
            if ($file->isDir()) {
                $zip->addEmptyDir($rel2);
            } else {
                $zip->addFile($file->getRealPath(), $rel2);
            }
        }
        openssl_sign($code . ':' . $sld, $sig, $privKey, OPENSSL_ALGO_SHA256);
        $zip->addFromString("plugins/{$outCode}/license.php",
            _ec_plugin_license_php($code, $sld, base64_encode($sig)));
    }

    // ── External plugin zips requested in this order ──────────────────────────
    foreach ($include_ext as $code => $zipPath) {
        $outCode = ec_output_plugin_code($code);
        $pzip = new ZipArchive();
        if ($pzip->open($zipPath) !== true) {
            error_log("ec_build_order: cannot open plugin zip $zipPath");
            continue;
        }
        // The zip's own internal root dir is expected to be "{code}/" per
        // this function's doc comment, but at least one plugin (found via a
        // real build: theme-christmas.zip and its seasonal siblings) instead
        // packages it dot-prefixed as ".{code}/" — its own attempt at the
        // disabled-by-default convention, done at the wrong layer. Stripping
        // only ever matched "{code}/" exactly, so a dot-prefixed root never
        // matched at all and got kept as part of every inner path, nesting
        // the whole plugin one directory too deep — invisible to
        // PluginLoader, which only looks directly inside plugins/{name}/.
        // Detect whichever form is actually present instead of assuming.
        $prefix = $code . '/';
        if ($pzip->numFiles > 0 && !str_starts_with($pzip->getNameIndex(0), $prefix)) {
            $altPrefix = '.' . $code . '/';
            if (str_starts_with($pzip->getNameIndex(0), $altPrefix)) {
                $prefix = $altPrefix;
            }
        }
        for ($i = 0; $i < $pzip->numFiles; $i++) {
            $name = $pzip->getNameIndex($i);
            // Strip leading "{code}/" (or ".{code}/") directory
            $inner = str_starts_with($name, $prefix) ? substr($name, strlen($prefix)) : $name;
            if ($inner === '' || $inner === 'license.php') continue;
            if (str_ends_with($inner, '/')) {
                $zip->addEmptyDir("plugins/{$outCode}/{$inner}");
            } else {
                $zip->addFromString("plugins/{$outCode}/{$inner}", $pzip->getFromIndex($i));
            }
        }
        $pzip->close();
        openssl_sign($code . ':' . $sld, $sig, $privKey, OPENSSL_ALGO_SHA256);
        $zip->addFromString("plugins/{$outCode}/license.php",
            _ec_plugin_license_php($code, $sld, base64_encode($sig)));
    }

    $zip->close();

    return ['ok' => true, 'path' => $output_path];
}

/**
 * Every premium plugin code that currently exists — in-app (has license.php)
 * plus external (has a zip in edgeCart-plugins/). This is what "bundle" means
 * at any given moment; used both by ec_build_order() itself and by callers
 * (e.g. ec-fulfillment) that need to expand a bundle purchase into individual
 * entitlement records without duplicating this enumeration.
 */
function ec_enumerate_premium_plugins(): array
{
    $codes = [];

    $pluginsDir = EC_BUILD_APP_ROOT . 'plugins/';
    if (is_dir($pluginsDir)) {
        foreach (scandir($pluginsDir) as $entry) {
            if ($entry[0] === '.') continue;
            $dir = $pluginsDir . $entry;
            if (is_dir($dir) && file_exists($dir . '/license.php')) {
                $codes[] = $entry;
            }
        }
    }

    if (is_dir(EC_BUILD_PLUGINS_ZIPS)) {
        foreach (glob(EC_BUILD_PLUGINS_ZIPS . '*.zip') as $zip) {
            $codes[] = basename($zip, '.zip');
        }
    }

    return array_values(array_unique($codes));
}

function _ec_sld_from_domain(string $domain): string
{
    $domain = strtolower(trim($domain));
    $domain = preg_replace('/^https?:\/\//', '', $domain);
    $domain = trim($domain, '/');
    $domain = explode('/', $domain)[0]; // strip any path
    $domain = preg_replace('/:\d+$/', '', $domain); // strip port
    $parts  = explode('.', $domain);
    return count($parts) >= 2 ? $parts[count($parts) - 2] : $domain;
}

function _ec_core_license_php(string $domain, string $sig): string
{
    return "<?php\n"
         . "define('EC_LICENSED_DOMAIN', '{$domain}');\n"
         . "define('EC_LICENSE_SIG',\n"
         . "    '{$sig}');\n";
}

function _ec_plugin_license_php(string $code, string $domain, string $sig): string
{
    $upper = strtoupper(str_replace('-', '_', $code));
    return "<?php\n"
         . "define('EC_PLUGIN_DOMAIN_{$upper}', '{$domain}');\n"
         . "define('EC_PLUGIN_SIG_{$upper}',\n"
         . "    '{$sig}');\n";
}
