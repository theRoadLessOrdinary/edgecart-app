<?php
Hook::on('theme.head', function($html) {
    $v = date('YmdHis', @filemtime(DIR_ROOT . 'plugins/theme-sienna/css/theme.css') ?: time());
    return $html . '<link rel="stylesheet" href="' . htmlspecialchars(URL_ROOT . 'plugins/theme-sienna/css/theme.css?v=' . $v) . '">';
});
