<?php
require_access(ACCESS_EDIT);
$p = DB_PREFIX;

// ── AJAX ──────────────────────────────────────────────────────────────────────
if (post('action')) {
    header('Content-Type: application/json');
    require_csrf_token_json();
    $action = post('action');

    if ($action === 'list') {
        $methods = DB::rows(
            "SELECT * FROM `{$p}shipping_methods` ORDER BY sort_order ASC, name ASC"
        );
        foreach ($methods as &$m) {
            $m['active']     = (int)$m['active'];
            $m['rate']       = number_format((float)$m['rate'], 2, '.', '');
            $m['free_above'] = $m['free_above'] !== null ? number_format((float)$m['free_above'], 2, '.', '') : '';
            $m['min_order']  = number_format((float)$m['min_order'], 2, '.', '');
        }
        echo json_encode(['ok' => true, 'methods' => $methods]);
        exit;
    }

    if ($action === 'get') {
        $id = (int)post('id');
        $m  = DB::row("SELECT * FROM `{$p}shipping_methods` WHERE id=?", [$id]);
        if (!$m) { echo json_encode(['ok' => false, 'message' => 'Not found']); exit; }
        $m['active']     = (int)$m['active'];
        $m['rate']       = number_format((float)$m['rate'], 2, '.', '');
        $m['free_above'] = $m['free_above'] !== null ? number_format((float)$m['free_above'], 2, '.', '') : '';
        $m['min_order']  = number_format((float)$m['min_order'], 2, '.', '');
        echo json_encode(['ok' => true, 'method' => $m]);
        exit;
    }

    if ($action === 'save') {
        $id          = (int)post('id', 0);
        $name        = trim(post('name', ''));
        $description = trim(post('description', ''));
        $rate        = (float)post('rate', 0);
        $free_above  = post('free_above', '') !== '' ? (float)post('free_above') : null;
        $min_order   = (float)post('min_order', 0);
        $countries   = trim(post('countries', ''));
        $sort_order  = (int)post('sort_order', 0);
        $active      = (int)post('active', 1);

        if (!$name) {
            echo json_encode(['ok' => false, 'message' => 'Name is required']);
            exit;
        }
        if ($rate < 0) {
            echo json_encode(['ok' => false, 'message' => 'Rate cannot be negative']);
            exit;
        }

        if ($id) {
            DB::exec(
                "UPDATE `{$p}shipping_methods`
                 SET name=?, description=?, rate=?, free_above=?, min_order=?, countries=?, sort_order=?, active=?
                 WHERE id=?",
                [$name, $description, $rate, $free_above, $min_order, $countries, $sort_order, $active, $id]
            );
        } else {
            DB::exec(
                "INSERT INTO `{$p}shipping_methods` (name, description, rate, free_above, min_order, countries, sort_order, active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [$name, $description, $rate, $free_above, $min_order, $countries, $sort_order, $active]
            );
        }

        echo json_encode(['ok' => true, 'message' => 'Saved']);
        exit;
    }

    if ($action === 'delete') {
        $id = (int)post('id');
        DB::exec("DELETE FROM `{$p}shipping_methods` WHERE id=?", [$id]);
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'toggle') {
        $id = (int)post('id');
        DB::exec("UPDATE `{$p}shipping_methods` SET active = IF(active=1,0,1) WHERE id=?", [$id]);
        $active = (int)DB::val("SELECT active FROM `{$p}shipping_methods` WHERE id=?", [$id]);
        echo json_encode(['ok' => true, 'active' => $active]);
        exit;
    }

    echo json_encode(['ok' => false, 'message' => 'Unknown action']);
    exit;
}

$smarty->display('shipping.html');
