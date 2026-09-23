<?php
session_del('customer_id');
session_destroy();
header('Location: ' . URL_ROOT);
exit;
