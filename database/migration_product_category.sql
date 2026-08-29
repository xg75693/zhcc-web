-- ============================================================
-- 迁移：商品分类管理
-- 日期: 2026-08-29（2026-08-30 改为幂等版，修复生产回填未生效）
--
-- 1. 新建 zhcc_product_category（按客户隔离，每个客户一条不可删的「默认分类」）
-- 2. zhcc_product 增加 category_id
-- 3. 存量商品全部归入所属客户的默认分类
-- 4. 补录缺失的期初结存备份（新建商品手填的初始库存）
--
-- ⚠ 执行方式：不要在脚本里写死库名，各环境库名不同
--     本地：mysql -h127.0.0.1 -uroot -p -D zhcc_warehouse < migration_product_category.sql
--     生产：mysql -h172.30.243.21 -uhitech_user -p -D hitech < migration_product_category.sql
--
-- 本脚本幂等，可重复执行：每一步都先检查现状，已完成的会跳过。
-- ============================================================

-- ============================================================
-- 1. 商品类别表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_product_category (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  customer_code   VARCHAR(50)  NOT NULL      COMMENT '所属客户编号（类别按客户隔离）',
  category_name   VARCHAR(100) NOT NULL      COMMENT '类别名称',
  is_default      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否默认分类：每客户恰好一条，不可删除',
  -- 审计字段
  create_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  UNIQUE KEY uk_customer_category (customer_code, category_name),
  KEY idx_customer_code (customer_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品类别表';

-- ============================================================
-- 2. 商品表增加类别列（ADD COLUMN 非幂等，先查 information_schema）
-- ============================================================
SET @has_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zhcc_product' AND COLUMN_NAME = 'category_id'
);
SET @sql = IF(@has_col = 0,
  'ALTER TABLE zhcc_product ADD COLUMN category_id INT DEFAULT NULL COMMENT ''商品类别ID，指向 zhcc_product_category'' AFTER spec',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zhcc_product' AND INDEX_NAME = 'idx_category_id'
);
SET @sql = IF(@has_idx = 0,
  'ALTER TABLE zhcc_product ADD KEY idx_category_id (category_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 3. 为每个客户建默认分类
--    客户表里的客户 ∪ 商品表里出现过的 customer_code（含客户表缺失的孤儿编号）
-- ============================================================
INSERT INTO zhcc_product_category (customer_code, category_name, is_default, create_time, update_time)
SELECT customer_code, '默认分类', 1, NOW(3), NOW(3)
FROM (
  SELECT customer_code FROM zhcc_customer WHERE customer_code <> ''
  UNION
  SELECT customer_code FROM zhcc_product  WHERE customer_code <> ''
) AS all_customers
ON DUPLICATE KEY UPDATE is_default = 1;

-- ============================================================
-- 4. 存量商品归入所属客户的默认分类
-- ============================================================
UPDATE zhcc_product p
  JOIN zhcc_product_category c
    ON c.customer_code = p.customer_code AND c.is_default = 1
SET p.category_id = c.id
WHERE p.category_id IS NULL;

-- ============================================================
-- 5. 补录缺失的期初结存备份
--    进出库明细的期初结存列只认 zhcc_product_backup，而这张表原先只在
--    「一键备份/发货」时写入。上线前建的商品、以及建档时未写备份的商品，
--    在表里没有任何记录，导出时期初结存为空、整行结存链算下来全为 0，
--    手填的库存在报表上完全不体现。
--    这里按商品当前 stock_qty 补一条建档期初（仅限从无备份记录的商品，
--    不动已有记录，避免覆盖历史发货快照）。
-- ============================================================
INSERT INTO zhcc_product_backup
  (backup_date, product_id, warehouse_code, customer_code, customer_product_code,
   product_name, spec, stock_qty, frozen_qty, remark, create_time)
SELECT p.create_time, p.id, p.warehouse_code, p.customer_code, p.customer_product_code,
       p.product_name, p.spec, p.stock_qty, 0, '建档期初(补录)', NOW(3)
FROM zhcc_product p
LEFT JOIN zhcc_product_backup b ON b.product_id = p.id
WHERE b.product_id IS NULL AND p.stock_qty > 0;

-- ============================================================
-- 6. 校验：三项都应为 0
-- ============================================================
SELECT
  (SELECT COUNT(*) FROM zhcc_product WHERE category_id IS NULL)            AS 未归类商品数,
  (SELECT COUNT(*) FROM zhcc_product p LEFT JOIN zhcc_product_category c
     ON c.id = p.category_id WHERE c.id IS NULL)                           AS 类别失效商品数,
  (SELECT COUNT(*) FROM zhcc_product p LEFT JOIN zhcc_product_backup b
     ON b.product_id = p.id WHERE b.product_id IS NULL AND p.stock_qty > 0) AS 缺期初备份商品数;
