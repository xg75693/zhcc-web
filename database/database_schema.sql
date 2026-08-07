-- ============================================================
-- 中辉物料仓储管理系统 - 数据库表结构全量定义
-- 数据库: zhcc_warehouse
-- 字符集: utf8mb4, 排序规则: utf8mb4_unicode_ci
-- 生成日期: 2026-08-07
-- ============================================================

CREATE DATABASE IF NOT EXISTS `zhcc_warehouse`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `zhcc_warehouse`;

-- ============================================================
-- 1. zhcc_customer - 客户表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_customer (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  customer_code   VARCHAR(50)  NOT NULL UNIQUE  COMMENT '客户编号',
  customer_name   VARCHAR(255) DEFAULT NULL      COMMENT '客户名称',
  -- 审计字段
  create_user_id  CHAR(36)     DEFAULT NULL      COMMENT '创建者ID',
  create_fullname VARCHAR(255) DEFAULT NULL      COMMENT '创建者姓名',
  create_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id  CHAR(36)     DEFAULT NULL      COMMENT '修改者ID',
  update_fullname VARCHAR(255) DEFAULT NULL      COMMENT '修改者姓名',
  update_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户表';


-- ============================================================
-- 2. zhcc_downstream_customer - 收货单位表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_downstream_customer (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  customer_code       VARCHAR(50)  NOT NULL      COMMENT '所属客户编号',
  downstream_name     VARCHAR(255) NOT NULL      COMMENT '收货单位名称',
  downstream_contact  VARCHAR(100) DEFAULT NULL  COMMENT '联系人',
  downstream_phone    VARCHAR(50)  DEFAULT NULL  COMMENT '联系电话',
  -- 审计字段
  create_user_id      CHAR(36)     DEFAULT NULL  COMMENT '创建者ID',
  create_fullname     VARCHAR(255) DEFAULT NULL  COMMENT '创建者姓名',
  create_time         DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id      CHAR(36)     DEFAULT NULL  COMMENT '修改者ID',
  update_fullname     VARCHAR(255) DEFAULT NULL  COMMENT '修改者姓名',
  update_time         DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  KEY idx_customer_code (customer_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收货单位表';


-- ============================================================
-- 3. zhcc_product - 仓储商品表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_product (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_code         VARCHAR(50)  NOT NULL  COMMENT '仓储商品号',
  customer_code          VARCHAR(50)  NOT NULL  COMMENT '客户编号',
  customer_product_code  VARCHAR(50)  DEFAULT NULL COMMENT '客户商品编号',
  product_name           VARCHAR(255) DEFAULT NULL COMMENT '商品名称',
  spec                   VARCHAR(100) DEFAULT NULL COMMENT '规格',
  stock_qty              INT          DEFAULT 0    COMMENT '当前库存数量（结存数量）',
  -- 审计字段
  create_user_id         CHAR(36)     DEFAULT NULL COMMENT '创建者ID',
  create_fullname        VARCHAR(255) DEFAULT NULL COMMENT '创建者姓名',
  create_time            DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id         CHAR(36)     DEFAULT NULL COMMENT '修改者ID',
  update_fullname        VARCHAR(255) DEFAULT NULL COMMENT '修改者姓名',
  update_time            DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  UNIQUE KEY uk_warehouse_code (warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓储商品表';


-- ============================================================
-- 4. zhcc_inquiry_record - 咨询记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_inquiry_record (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  batch_id                  VARCHAR(36)  DEFAULT NULL  COMMENT '咨询批次号（同一批次多个商品共享）',
  customer_code             VARCHAR(50)  NOT NULL      COMMENT '客户编号',
  downstream_customer_id    INT          DEFAULT NULL  COMMENT '收货单位ID',
  downstream_customer_name  VARCHAR(255) DEFAULT NULL  COMMENT '收货单位名称',
  product_id                INT          DEFAULT NULL  COMMENT '商品ID',
  warehouse_code            VARCHAR(50)  NOT NULL      COMMENT '仓储商品号',
  customer_product_code     VARCHAR(50)  DEFAULT NULL  COMMENT '客户商品编号',
  product_name              VARCHAR(255) DEFAULT NULL  COMMENT '商品名称',
  request_qty               INT          NOT NULL      COMMENT '订货数量',
  stock_qty                 INT          DEFAULT 0     COMMENT '咨询时库存数量',
  frozen_qty                INT          DEFAULT 0     COMMENT '咨询时已冻结数量',
  available_qty             INT          DEFAULT 0     COMMENT '咨询时可用结余（库存-冻结）',
  result                    VARCHAR(20)  NOT NULL      COMMENT '商品级判断结果: approved/rejected',
  batch_result              VARCHAR(20)  NOT NULL      COMMENT '批次整体结果: approved/rejected',
  inquiry_date              DATE         NOT NULL      COMMENT '咨询日期',
  -- 审计字段
  create_user_id            CHAR(36)     DEFAULT NULL  COMMENT '创建者ID',
  create_fullname           VARCHAR(255) DEFAULT NULL  COMMENT '创建者姓名',
  create_time               DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id            CHAR(36)     DEFAULT NULL  COMMENT '修改者ID',
  update_fullname           VARCHAR(255) DEFAULT NULL  COMMENT '修改者姓名',
  update_time               DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='咨询记录表';


-- ============================================================
-- 5. zhcc_stock_freeze - 库存冻结表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_stock_freeze (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  product_id      INT          NOT NULL      COMMENT '商品ID',
  warehouse_code  VARCHAR(50)  NOT NULL      COMMENT '仓储商品号',
  customer_code   VARCHAR(50)  NOT NULL      COMMENT '客户编号',
  freeze_qty      INT          NOT NULL      COMMENT '冻结数量',
  inquiry_id      INT          DEFAULT NULL  COMMENT '关联咨询记录ID',
  batch_id        VARCHAR(36)  DEFAULT NULL  COMMENT '咨询批次号',
  freeze_date     DATE         NOT NULL      COMMENT '冻结日期',
  status          VARCHAR(20)  DEFAULT 'active' COMMENT '状态: active(活跃)/shipped(已发货)/released(已释放)/completed(已完成)/cancelled(已取消)',
  -- 审计字段
  create_user_id  CHAR(36)     DEFAULT NULL  COMMENT '创建者ID',
  create_fullname VARCHAR(255) DEFAULT NULL  COMMENT '创建者姓名',
  create_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id  CHAR(36)     DEFAULT NULL  COMMENT '修改者ID',
  update_fullname VARCHAR(255) DEFAULT NULL  COMMENT '修改者姓名',
  update_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='库存冻结表';


-- ============================================================
-- 6. zhcc_excel_parse_rule - Excel解析规则表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_excel_parse_rule (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  customer_code               VARCHAR(50)  NOT NULL      COMMENT '客户编号',
  rule_name                   VARCHAR(100) DEFAULT NULL   COMMENT '规则名称',
  sheet_index                 INT          DEFAULT 0     COMMENT '工作表索引（从0开始）',
  downstream_name_cell        VARCHAR(20)  NOT NULL      COMMENT '收货单位名称单元格，如 D1',
  downstream_name_extra_cells VARCHAR(255) DEFAULT NULL  COMMENT '辅助客户信息单元格，逗号分隔，如 D2,D3',
  product_code_start_cell     VARCHAR(20)  NOT NULL      COMMENT '商品编号起始单元格，如 H11',
  quantity_column_offset      INT          DEFAULT 1     COMMENT '数量列相对商品编号列的偏移（1=右侧第1列）',
  end_marker                  VARCHAR(50)  DEFAULT '合计' COMMENT '结束标记（读到该行停止）',
  empty_value_treat_as_zero   TINYINT      DEFAULT 1     COMMENT '空数量是否视为0',
  is_default                  TINYINT      DEFAULT 0     COMMENT '是否为该客户默认规则',
  -- 审计字段
  create_user_id              CHAR(36)     DEFAULT NULL  COMMENT '创建者ID',
  create_fullname             VARCHAR(255) DEFAULT NULL  COMMENT '创建者姓名',
  create_time                 DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id              CHAR(36)     DEFAULT NULL  COMMENT '修改者ID',
  update_fullname             VARCHAR(255) DEFAULT NULL  COMMENT '修改者姓名',
  update_time                 DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  KEY idx_customer_code (customer_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Excel解析规则表';


-- ============================================================
-- 7. zhcc_stock_in - 入库记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_stock_in (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  customer_code   VARCHAR(50)  NOT NULL      COMMENT '客户编号',
  product_id      INT          NOT NULL      COMMENT '商品ID',
  warehouse_code  VARCHAR(50)  NOT NULL      COMMENT '仓储商品号',
  stock_in_date   DATE         NOT NULL      COMMENT '入库日期',
  stock_in_qty    INT          NOT NULL      COMMENT '入库数量',
  defective_qty   INT          DEFAULT 0     COMMENT '不良品数量',
  actual_qty      INT          NOT NULL      COMMENT '实际入库数量（入库数量 - 不良品数量）',
  status          VARCHAR(20)  DEFAULT 'confirmed' COMMENT '状态: confirmed(已确认)',
  remark          VARCHAR(255) DEFAULT NULL  COMMENT '备注',
  create_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_time     DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
  KEY idx_customer_code (customer_code),
  KEY idx_product_id (product_id),
  KEY idx_stock_in_date (stock_in_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='入库记录表';


-- ============================================================
-- 8. zhcc_product_backup - 商品备份表
-- ============================================================
CREATE TABLE IF NOT EXISTS zhcc_product_backup (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  backup_date            DATETIME(3)  NOT NULL      COMMENT '备份日期',
  product_id             INT          NOT NULL      COMMENT '原商品ID',
  warehouse_code         VARCHAR(50)  NOT NULL      COMMENT '仓储商品号',
  customer_code          VARCHAR(50)  NOT NULL      COMMENT '客户编号',
  customer_product_code  VARCHAR(50)  DEFAULT NULL  COMMENT '客户商品编号',
  product_name           VARCHAR(255) DEFAULT NULL  COMMENT '商品名称',
  spec                   VARCHAR(100) DEFAULT NULL  COMMENT '规格',
  stock_qty              INT          DEFAULT 0     COMMENT '备份时结存数量（已扣除冻结）',
  frozen_qty             INT          DEFAULT 0     COMMENT '备份时已冻结（已发货）数量',
  remark                 VARCHAR(255) DEFAULT NULL  COMMENT '备注',
  create_time            DATETIME(3)  DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  KEY idx_backup_date (backup_date),
  KEY idx_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品备份表';
