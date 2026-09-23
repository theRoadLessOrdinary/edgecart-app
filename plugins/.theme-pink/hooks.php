<?php
Hook::on('theme.head', function($html) {
    $v = filemtime(DIR_ROOT . 'plugins/theme-pink/css/theme.css');
    return $html . '<link rel="stylesheet" href="' . htmlspecialchars(URL_ROOT . 'plugins/theme-pink/css/theme.css?v=' . $v) . '">';
});
