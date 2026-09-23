<?php
session_del('admin_id');
session_del('admin_username');
session_del('admin_login_at');
session_del('admin_last_active');
session_regenerate_id(true);
redirect(URL_ADMIN . '?route=login');
