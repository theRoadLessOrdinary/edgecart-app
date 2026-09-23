-- Minimal OpenCart-shaped sample database for testing the Catalog Importer's
-- OpenCart adapter (plugins/catalog-importer/lib/adapters/opencart.php).
--
-- Table/column names are real OpenCart 3.x/4.x schema (open-source, public —
-- see OpenCart's own install/opencart.sql in github.com/opencart/opencart),
-- trimmed to only the tables and columns the adapter actually queries. A
-- real OpenCart install carries many more tables/columns than this; this
-- fixture is deliberately not a full clone, just enough for
-- ci_opencart_extract_categories/_products/_customers to have something
-- real to read.
--
-- Usage: loaded automatically by admin-catalog-importer-sources.spec.ts's
-- beforeAll via `mysql ... < opencart-sample.sql` against a throwaway
-- database (see that file's OC_* env vars).

DROP TABLE IF EXISTS `oc_product_option_value`;
DROP TABLE IF EXISTS `oc_option_value_description`;
DROP TABLE IF EXISTS `oc_product_option`;
DROP TABLE IF EXISTS `oc_option_description`;
DROP TABLE IF EXISTS `oc_option`;
DROP TABLE IF EXISTS `oc_product_to_category`;
DROP TABLE IF EXISTS `oc_product_image`;
DROP TABLE IF EXISTS `oc_product_description`;
DROP TABLE IF EXISTS `oc_product`;
DROP TABLE IF EXISTS `oc_category_description`;
DROP TABLE IF EXISTS `oc_category`;
DROP TABLE IF EXISTS `oc_address`;
DROP TABLE IF EXISTS `oc_customer`;
DROP TABLE IF EXISTS `oc_zone`;
DROP TABLE IF EXISTS `oc_country`;

CREATE TABLE `oc_category` (
  `category_id` INT PRIMARY KEY,
  `parent_id`   INT NOT NULL DEFAULT 0,
  `sort_order`  INT NOT NULL DEFAULT 0,
  `image`       VARCHAR(255) DEFAULT '',
  `status`      TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE `oc_category_description` (
  `category_id`  INT NOT NULL,
  `language_id`  INT NOT NULL,
  `name`         VARCHAR(255) NOT NULL,
  `description`  TEXT
);

CREATE TABLE `oc_product` (
  `product_id` INT PRIMARY KEY,
  `sku`        VARCHAR(64) DEFAULT '',
  `price`      DECIMAL(10,2) NOT NULL DEFAULT 0,
  `quantity`   INT NOT NULL DEFAULT 0,
  `weight`     DECIMAL(8,3) NOT NULL DEFAULT 0,
  `status`     TINYINT NOT NULL DEFAULT 1,
  `image`      VARCHAR(255) DEFAULT ''
);

CREATE TABLE `oc_product_description` (
  `product_id`   INT NOT NULL,
  `language_id`  INT NOT NULL,
  `name`         VARCHAR(255) NOT NULL,
  `description`  TEXT
);

CREATE TABLE `oc_product_image` (
  `product_id` INT NOT NULL,
  `image`      VARCHAR(255) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0
);

CREATE TABLE `oc_product_to_category` (
  `product_id`  INT NOT NULL,
  `category_id` INT NOT NULL
);

CREATE TABLE `oc_option` (
  `option_id` INT PRIMARY KEY
);

CREATE TABLE `oc_option_description` (
  `option_id`   INT NOT NULL,
  `language_id` INT NOT NULL,
  `name`        VARCHAR(255) NOT NULL
);

CREATE TABLE `oc_product_option` (
  `product_option_id` INT PRIMARY KEY,
  `product_id`         INT NOT NULL,
  `option_id`          INT NOT NULL,
  `required`           TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE `oc_product_option_value` (
  `product_option_value_id` INT PRIMARY KEY,
  `product_option_id`       INT NOT NULL,
  `option_value_id`         INT NOT NULL,
  `price`                   DECIMAL(10,2) NOT NULL DEFAULT 0,
  `price_prefix`            VARCHAR(1) NOT NULL DEFAULT '+',
  `quantity`                INT NOT NULL DEFAULT 0
);

CREATE TABLE `oc_option_value_description` (
  `option_value_id` INT NOT NULL,
  `language_id`      INT NOT NULL,
  `name`             VARCHAR(255) NOT NULL
);

CREATE TABLE `oc_customer` (
  `customer_id` INT PRIMARY KEY,
  `firstname`   VARCHAR(64) DEFAULT '',
  `lastname`    VARCHAR(64) DEFAULT '',
  `email`       VARCHAR(255) NOT NULL,
  `status`      TINYINT NOT NULL DEFAULT 1
);

CREATE TABLE `oc_address` (
  `address_id`  INT PRIMARY KEY,
  `customer_id` INT NOT NULL,
  `address_1`   VARCHAR(255) DEFAULT '',
  `address_2`   VARCHAR(255) DEFAULT '',
  `city`        VARCHAR(255) DEFAULT '',
  `postcode`    VARCHAR(20) DEFAULT '',
  `country_id`  INT DEFAULT 0,
  `zone_id`     INT DEFAULT 0,
  `default`     TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE `oc_country` (
  `country_id`   INT PRIMARY KEY,
  `iso_code_2`   CHAR(2) NOT NULL
);

CREATE TABLE `oc_zone` (
  `zone_id` INT PRIMARY KEY,
  `code`    VARCHAR(32) DEFAULT ''
);

-- ── Sample data ──────────────────────────────────────────────────────────────

-- One shared category only: the store's free-tier category cap is 3
-- store-wide (admin.limit.categories, enforced in staging.php), and this
-- fixture's import runs alongside the Shopify and Etsy fixtures in the same
-- test run/database (each contributing one category of their own) — three
-- source-specific imports averaging one new category apiece stays exactly
-- at, not over, that cap.
INSERT INTO `oc_category` (`category_id`, `parent_id`, `sort_order`, `image`, `status`) VALUES
  (1, 0, 0, '', 1);

INSERT INTO `oc_category_description` (`category_id`, `language_id`, `name`, `description`) VALUES
  (1, 1, 'OpenCart Import', 'Imported from a sample OpenCart database.');

INSERT INTO `oc_product` (`product_id`, `sku`, `price`, `quantity`, `weight`, `status`, `image`) VALUES
  (101, 'OC-JKT-01', 89.00, 8, 1.2, 1, 'catalog/oc-jacket-main.webp'),
  (102, 'OC-BAG-01', 27.50, 20, 0.5, 1, 'catalog/oc-bag-main.webp');

INSERT INTO `oc_product_description` (`product_id`, `language_id`, `name`, `description`) VALUES
  (101, 1, 'Canvas Field Jacket (OpenCart Import)', 'A durable canvas jacket with corduroy collar.'),
  (102, 1, 'Woven Shoulder Bag (OpenCart Import)', 'A everyday woven shoulder bag.');

INSERT INTO `oc_product_image` (`product_id`, `image`, `sort_order`) VALUES
  (101, 'catalog/oc-jacket-alt1.webp', 1),
  (102, 'catalog/oc-bag-alt1.webp', 1);

INSERT INTO `oc_product_to_category` (`product_id`, `category_id`) VALUES
  (101, 1),
  (102, 1);

INSERT INTO `oc_option` (`option_id`) VALUES (201);

INSERT INTO `oc_option_description` (`option_id`, `language_id`, `name`) VALUES
  (201, 1, 'Size');

INSERT INTO `oc_product_option` (`product_option_id`, `product_id`, `option_id`, `required`) VALUES
  (301, 101, 201, 1);

INSERT INTO `oc_product_option_value` (`product_option_value_id`, `product_option_id`, `option_value_id`, `price`, `price_prefix`, `quantity`) VALUES
  (401, 301, 501, 0.00, '+', 4),
  (402, 301, 502, 5.00, '+', 4);

INSERT INTO `oc_option_value_description` (`option_value_id`, `language_id`, `name`) VALUES
  (501, 1, 'Medium'),
  (502, 1, 'Large');

INSERT INTO `oc_customer` (`customer_id`, `firstname`, `lastname`, `email`, `status`) VALUES
  (601, 'Alex', 'Chen', 'oc.customer1@playwright-test.example', 1),
  (602, 'Sam', 'Patel', 'oc.customer2@playwright-test.example', 1);

INSERT INTO `oc_country` (`country_id`, `iso_code_2`) VALUES (222, 'US');
INSERT INTO `oc_zone` (`zone_id`, `code`) VALUES (3617, 'CA');

INSERT INTO `oc_address` (`address_id`, `customer_id`, `address_1`, `address_2`, `city`, `postcode`, `country_id`, `zone_id`, `default`) VALUES
  (701, 601, '789 Canvas St', '', 'San Diego', '92101', 222, 3617, 1),
  (702, 602, '321 Loom Rd', 'Unit 4', 'Sacramento', '95814', 222, 3617, 1);
