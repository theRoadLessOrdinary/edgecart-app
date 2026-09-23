<?php
if (!class_exists('Report')) return;

class SalesByProductReport extends Report {
    public function __construct() {
        parent::__construct('sales_by_product', 'Sales by Product', 'Revenue and units sold per product');
        $this->setCategory('sales')
            ->addParameter('date_from', 'From Date', 'date', false, date('Y-m-01'))
            ->addParameter('date_to', 'To Date', 'date', false, date('Y-m-d'));
    }
    public function getData($params) {
        $p = DB_PREFIX; $from = $params['date_from'] ?? date('Y-m-01'); $to = $params['date_to'] ?? date('Y-m-d');
        $rows = DB::rows("SELECT p.id, p.name, COUNT(oi.id) as units, ROUND(SUM(oi.price * oi.qty), 2) as revenue FROM `{$p}products` p LEFT JOIN `{$p}order_items` oi ON p.id = oi.product_id LEFT JOIN `{$p}orders` o ON oi.order_id = o.id WHERE o.id IS NULL OR (o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)) GROUP BY p.id, p.name ORDER BY revenue DESC", [$from, $to]);
        return ['columns' => [['key'=>'name','label'=>'Product'],['key'=>'units','label'=>'Units Sold'],['key'=>'revenue','label'=>'Revenue','format'=>'currency']], 'rows' => $rows];
    }
}

class SalesByCategoryReport extends Report {
    public function __construct() {
        parent::__construct('sales_by_category', 'Sales by Category', 'Revenue breakdown by product category');
        $this->setCategory('sales')
            ->addParameter('date_from', 'From Date', 'date', false, date('Y-m-01'))
            ->addParameter('date_to', 'To Date', 'date', false, date('Y-m-d'));
    }
    public function getData($params) {
        $p = DB_PREFIX; $from = $params['date_from'] ?? date('Y-m-01'); $to = $params['date_to'] ?? date('Y-m-d');
        $rows = DB::rows("SELECT c.id, c.name, COUNT(oi.id) as units, ROUND(SUM(oi.price * oi.qty), 2) as revenue FROM `{$p}categories` c LEFT JOIN `{$p}categories_products` cp ON c.id = cp.category_id LEFT JOIN `{$p}products` p ON cp.product_id = p.id LEFT JOIN `{$p}order_items` oi ON p.id = oi.product_id LEFT JOIN `{$p}orders` o ON oi.order_id = o.id WHERE o.id IS NULL OR (o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)) GROUP BY c.id, c.name ORDER BY revenue DESC", [$from, $to]);
        return ['columns' => [['key'=>'name','label'=>'Category'],['key'=>'units','label'=>'Units Sold'],['key'=>'revenue','label'=>'Revenue','format'=>'currency']], 'rows' => $rows];
    }
}

class SalesByStateReport extends Report {
    public function __construct() {
        parent::__construct('sales_by_state', 'Sales by State', 'Revenue and tax collected by state');
        $this->setCategory('sales')
            ->addParameter('date_from', 'From Date', 'date', false, date('Y-m-01'))
            ->addParameter('date_to', 'To Date', 'date', false, date('Y-m-d'));
    }
    public function getData($params) {
        $p = DB_PREFIX; $from = $params['date_from'] ?? date('Y-m-01'); $to = $params['date_to'] ?? date('Y-m-d');
        $rows = DB::rows("SELECT o.ship_state as state, COUNT(o.id) as orders, ROUND(SUM(o.subtotal),2) as subtotal, ROUND(SUM(o.tax),2) as tax, ROUND(SUM(o.total),2) as revenue FROM `{$p}orders` o WHERE o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY o.ship_state ORDER BY revenue DESC", [$from, $to]);
        return ['columns' => [['key'=>'state','label'=>'State'],['key'=>'orders','label'=>'Orders'],['key'=>'subtotal','label'=>'Subtotal','format'=>'currency'],['key'=>'tax','label'=>'Tax Collected','format'=>'currency'],['key'=>'revenue','label'=>'Total Revenue','format'=>'currency']], 'rows' => $rows];
    }
}

class OrderStatusPipelineReport extends Report {
    public function __construct() {
        parent::__construct('order_status_pipeline', 'Order Status Pipeline', 'Orders grouped by fulfillment status');
        $this->setCategory('operations');
    }
    public function getData($params) {
        $p = DB_PREFIX;
        $rows = DB::rows("SELECT o.status, COUNT(o.id) as count, SUM(o.total) as revenue FROM `{$p}orders` o GROUP BY o.status ORDER BY count DESC");
        return ['columns' => [['key'=>'status','label'=>'Status'],['key'=>'count','label'=>'Order Count'],['key'=>'revenue','label'=>'Revenue','format'=>'currency']], 'rows' => $rows];
    }
}

Hook::on('admin.reports.register', function() {
    ReportRegistry::register(new SalesByProductReport());
    ReportRegistry::register(new SalesByCategoryReport());
    ReportRegistry::register(new SalesByStateReport());
    ReportRegistry::register(new OrderStatusPipelineReport());
});
