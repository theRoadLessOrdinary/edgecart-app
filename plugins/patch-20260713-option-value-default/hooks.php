<?php
/**
 * Patch: adds `is_default` to product_option_values so an admin can mark
 * one value per product option as pre-selected on page load.
 *
 * Idempotent: fresh installs already get this column via install/ajax.php's
 * CREATE TABLE, so this checks for the column before altering rather than
 * assuming it's missing (existing customer installs upgrading in place are
 * the actual target here).
 */

Hook::on('app.boot', function () {

    $code    = 'patch-20260713-option-value-default';
    $pf      = DB_PREFIX;
    $db_key  = 'patch_applied_' . $code;

    $dir      = DIR_ROOT . 'plugins/' . $code;
    $disabled = DIR_ROOT . 'plugins/.' . $code;

    $already = DB::val("SELECT `value` FROM `{$pf}settings` WHERE `key` = ?", [$db_key]);
    if ($already !== null) {
        if (is_dir($dir)) rename($dir, $disabled);
        return;
    }

    // ── Apply the patch ──────────────────────────────────────────────────────
    $has_column = DB::val(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'is_default'",
        ["{$pf}product_option_values"]
    );
    if (!$has_column) {
        DB::exec("ALTER TABLE `{$pf}product_option_values`
            ADD COLUMN `is_default` TINYINT(1) NOT NULL DEFAULT 0 AFTER `enabled`");
    }

    // ── Write DB marker ──────────────────────────────────────────────────────
    DB::exec(
        "INSERT INTO `{$pf}settings` (`key`, `value`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE `value` = `value`",
        [$db_key, date('c')]
    );

    // ── Self-disable ──────────────────────────────────────────────────────────
    if (is_dir($dir)) {
        if (is_dir($disabled)) {
            $items = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($disabled, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($items as $item) {
                $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
            }
            rmdir($disabled);
        }
        if (!rename($dir, $disabled)) {
            error_log("[patch] Could not rename $dir → $disabled. DB marker is set; patch will not re-run.");
        }
    }
});
