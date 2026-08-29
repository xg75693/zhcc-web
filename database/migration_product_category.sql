-- ============================================================
-- 迁移：商品分类管理
-- 日期: 2026-08-29
--
-- 1. 新建 zhcc_product_category（按客户隔离，每个客户一条不可删的「默认分类」）
-- 2. zhcc_product 增加 category_id
-- 3. 存量商品全部归入所属客户的默认分类
--
-- 注意：ALTER TABLE ADD COLUMN 非幂等，本脚本只执行一次。
-- ============================================================

USE `zhcc_warehouse`;

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
-- 2. 商品表增加类别外键列
-- ============================================================
ALTER TABLE zhcc_product
  ADD COLUMN category_id INT DEFAULT NULL COMMENT '商品类别ID，指向 zhcc_product_category' AFTER spec,
  ADD KEY idx_category_id (category_id);

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
