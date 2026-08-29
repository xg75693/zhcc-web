import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

// 审计字段通用定义
const AUDIT_FIELDS = `
  create_user_id CHAR(36) DEFAULT NULL COMMENT '创建者ID',
  create_fullname VARCHAR(255) DEFAULT NULL COMMENT '创建者姓名',
  create_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  update_user_id CHAR(36) DEFAULT NULL COMMENT '修改者ID',
  update_fullname VARCHAR(255) DEFAULT NULL COMMENT '修改者姓名',
  update_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间'
`;

async function initDatabase() {
  const DB_HOST = process.env.DB_HOST || 'localhost';
  const DB_PORT = parseInt(process.env.DB_PORT || '3306');
  const DB_USER = process.env.DB_USER || 'root';
  const DB_PASSWORD = process.env.DB_PASSWORD || '';
  const DB_NAME = process.env.DB_NAME || 'zhcc_warehouse';

  // 先连接无数据库的MySQL，创建数据库
  const conn = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`[OK] 数据库 ${DB_NAME} 已创建/已存在`);
  await conn.end();

  // 连接到目标数据库，创建表
  const pool = await mysql.createPool({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME
  });

  // 1. 客户表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_customer (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(50) NOT NULL UNIQUE COMMENT '客户编号',
      customer_name VARCHAR(255) DEFAULT NULL COMMENT '客户名称',
      ${AUDIT_FIELDS}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户表'
  `);
  console.log('[OK] 表 zhcc_customer 已创建');

  // 2. 收货单位表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_downstream_customer (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(50) NOT NULL COMMENT '所属客户编号',
      downstream_name VARCHAR(255) NOT NULL COMMENT '收货单位名称',
      downstream_contact VARCHAR(100) DEFAULT NULL COMMENT '联系人',
      downstream_phone VARCHAR(50) DEFAULT NULL COMMENT '联系电话',
      ${AUDIT_FIELDS},
      KEY idx_customer_code (customer_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收货单位表'
  `);
  console.log('[OK] 表 zhcc_downstream_customer 已创建');

  // 3. 仓储商品表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_product (
      id INT AUTO_INCREMENT PRIMARY KEY,
      warehouse_code VARCHAR(50) NOT NULL COMMENT '仓储商品号',
      customer_code VARCHAR(50) NOT NULL COMMENT '客户编号',
      customer_product_code VARCHAR(50) DEFAULT NULL COMMENT '客户商品编号',
      product_name VARCHAR(255) DEFAULT NULL COMMENT '商品名称',
      spec VARCHAR(100) DEFAULT NULL COMMENT '规格',
      category_id INT DEFAULT NULL COMMENT '商品类别ID，指向 zhcc_product_category',
      stock_qty INT DEFAULT 0 COMMENT '当前库存数量',
      ${AUDIT_FIELDS},
      UNIQUE KEY uk_warehouse_code (warehouse_code),
      KEY idx_category_id (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='仓储商品表'
  `);
  console.log('[OK] 表 zhcc_product 已创建');

  // 3.1 商品类别表（按客户隔离，每客户一条 is_default=1 的「默认分类」，不可删除）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_product_category (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(50) NOT NULL COMMENT '所属客户编号（类别按客户隔离）',
      category_name VARCHAR(100) NOT NULL COMMENT '类别名称',
      is_default TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否默认分类：每客户恰好一条，不可删除',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '分类排序，值小的在前；相同则默认分类优先、再按名称',
      create_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
      update_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
      UNIQUE KEY uk_customer_category (customer_code, category_name),
      KEY idx_customer_code (customer_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品类别表'
  `);
  console.log('[OK] 表 zhcc_product_category 已创建');

  // 4. 咨询记录表（含收货单位、批次号）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_inquiry_record (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id VARCHAR(36) DEFAULT NULL COMMENT '咨询批次号',
      customer_code VARCHAR(50) NOT NULL COMMENT '客户编号',
      downstream_customer_id INT DEFAULT NULL COMMENT '收货单位ID',
      downstream_customer_name VARCHAR(255) DEFAULT NULL COMMENT '收货单位名称',
      product_id INT DEFAULT NULL COMMENT '商品ID',
      warehouse_code VARCHAR(50) NOT NULL COMMENT '仓储商品号',
      customer_product_code VARCHAR(50) DEFAULT NULL COMMENT '客户商品编号',
      product_name VARCHAR(255) DEFAULT NULL COMMENT '商品名称',
      request_qty INT NOT NULL COMMENT '订货数量',
      stock_qty INT DEFAULT 0 COMMENT '当时库存数量',
      frozen_qty INT DEFAULT 0 COMMENT '当时已冻结数量',
      available_qty INT DEFAULT 0 COMMENT '当时可用结余',
      result VARCHAR(20) NOT NULL COMMENT '判断结果: approved/rejected',
      batch_result VARCHAR(20) NOT NULL COMMENT '批次整体结果: approved/rejected',
      inquiry_date DATE NOT NULL COMMENT '咨询日期',
      ${AUDIT_FIELDS}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='咨询记录表'
  `);
  console.log('[OK] 表 zhcc_inquiry_record 已创建');

  // 5. 库存冻结表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_stock_freeze (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL COMMENT '商品ID',
      warehouse_code VARCHAR(50) NOT NULL COMMENT '仓储商品号',
      customer_code VARCHAR(50) NOT NULL COMMENT '客户编号',
      freeze_qty INT NOT NULL COMMENT '冻结数量',
      inquiry_id INT DEFAULT NULL COMMENT '关联咨询记录ID',
      batch_id VARCHAR(36) DEFAULT NULL COMMENT '咨询批次号',
      freeze_date DATE NOT NULL COMMENT '冻结日期',
      status VARCHAR(20) DEFAULT 'active' COMMENT '状态: active/released/completed',
      ${AUDIT_FIELDS}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='库存冻结表'
  `);
  console.log('[OK] 表 zhcc_stock_freeze 已创建');

  // 6. Excel 解析规则表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_excel_parse_rule (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(50) NOT NULL COMMENT '客户编号',
      rule_name VARCHAR(100) DEFAULT NULL COMMENT '规则名称',
      sheet_index INT DEFAULT 0 COMMENT '工作表索引',
      downstream_name_cell VARCHAR(20) NOT NULL COMMENT '收货单位名称单元格，如 D1',
      downstream_name_extra_cells VARCHAR(255) DEFAULT NULL COMMENT '辅助客户信息单元格，逗号分隔，如 D2,D3',
      product_code_start_cell VARCHAR(20) NOT NULL COMMENT '商品编号起始单元格，如 H11',
      quantity_column_offset INT DEFAULT 1 COMMENT '数量列相对商品编号列的偏移，1表示右侧第1列',
      end_marker VARCHAR(50) DEFAULT '合计' COMMENT '结束标记（读到该行停止）',
      empty_value_treat_as_zero TINYINT DEFAULT 1 COMMENT '空数量是否视为0',
      is_default TINYINT DEFAULT 0 COMMENT '是否为该客户默认规则',
      ${AUDIT_FIELDS},
      KEY idx_customer_code (customer_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Excel解析规则表'
  `);
  console.log('[OK] 表 zhcc_excel_parse_rule 已创建');

  // 7. 入库记录表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_stock_in (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(50) NOT NULL COMMENT '客户编号',
      product_id INT NOT NULL COMMENT '商品ID',
      warehouse_code VARCHAR(50) NOT NULL COMMENT '仓储商品号',
      stock_in_date DATE NOT NULL COMMENT '入库日期',
      stock_in_qty INT NOT NULL COMMENT '入库数量',
      defective_qty INT DEFAULT 0 COMMENT '不良品数量',
      actual_qty INT NOT NULL COMMENT '实际入库数量（入库数量-不良品数量）',
      status VARCHAR(20) DEFAULT 'confirmed' COMMENT '状态: confirmed',
      remark VARCHAR(255) DEFAULT NULL COMMENT '备注',
      create_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
      update_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '修改时间',
      KEY idx_customer_code (customer_code),
      KEY idx_product_id (product_id),
      KEY idx_stock_in_date (stock_in_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='入库记录表'
  `);
  console.log('[OK] 表 zhcc_stock_in 已创建');

  // 8. 商品备份表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zhcc_product_backup (
      id INT AUTO_INCREMENT PRIMARY KEY,
      backup_date DATETIME(3) NOT NULL COMMENT '备份日期',
      product_id INT NOT NULL COMMENT '原商品ID',
      warehouse_code VARCHAR(50) NOT NULL COMMENT '仓储商品号',
      customer_code VARCHAR(50) NOT NULL COMMENT '客户编号',
      customer_product_code VARCHAR(50) DEFAULT NULL COMMENT '客户商品编号',
      product_name VARCHAR(255) DEFAULT NULL COMMENT '商品名称',
      spec VARCHAR(100) DEFAULT NULL COMMENT '规格',
      stock_qty INT DEFAULT 0 COMMENT '备份时结存数量（已扣除冻结）',
      frozen_qty INT DEFAULT 0 COMMENT '备份时已冻结（已发货）数量',
      remark VARCHAR(255) DEFAULT NULL COMMENT '备注',
      create_time DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
      KEY idx_backup_date (backup_date),
      KEY idx_product_id (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品备份表'
  `);
  console.log('[OK] 表 zhcc_product_backup 已创建');

  // 导入Excel数据
  await importExcelData(pool);

  await pool.end();
  console.log('[DONE] 数据库初始化完成');
}

async function importExcelData(pool) {
  const excelPath = path.resolve(projectRoot, '..', '中辉仓储商品明细.xlsx');
  console.log(`[INFO] 读取Excel: ${excelPath}`);

  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // 第一行是表头，从第二行开始是数据
  // 列: 序号, 仓储商品号, 客户编号, 客户商品编号, 商品名称, 规格, 数量
  const dataRows = rows.slice(1).filter(r => r[1]); // 过滤掉空行
  
  const customerSet = new Set();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  let inserted = 0;
  for (const row of dataRows) {
    const [seq, warehouseCode, customerCode, customerProductCode, productName, spec, stockQty] = row;
    if (!warehouseCode) continue;

    // 收集客户
    if (customerCode && !customerSet.has(customerCode)) {
      customerSet.add(customerCode);
    }

    // UPSERT 商品数据
    await pool.query(`
      INSERT INTO zhcc_product 
        (warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, create_time, update_time)
      VALUES (?, ?, ?, ?, ?, ?, '${now}', '${now}')
      ON DUPLICATE KEY UPDATE
        customer_code = VALUES(customer_code),
        customer_product_code = VALUES(customer_product_code),
        product_name = VALUES(product_name),
        spec = VALUES(spec),
        stock_qty = VALUES(stock_qty),
        update_time = '${now}'
    `, [warehouseCode, customerCode || '', customerProductCode || '', productName || '', spec || '', stockQty || 0]);
    inserted++;
  }
  console.log(`[OK] 导入 ${inserted} 条商品数据`);

  // 导入客户
  for (const code of customerSet) {
    await pool.query(`
      INSERT IGNORE INTO zhcc_customer (customer_code, create_time, update_time)
      VALUES (?, '${now}', '${now}')
    `, [code]);
  }
  console.log(`[OK] 导入 ${customerSet.size} 个客户`);

  // 为 OEM016（引能仕）插入默认 Excel 解析规则
  await pool.query(`
    INSERT IGNORE INTO zhcc_excel_parse_rule
      (customer_code, rule_name, sheet_index, downstream_name_cell, downstream_name_extra_cells,
       product_code_start_cell, quantity_column_offset, end_marker, empty_value_treat_as_zero, is_default, create_time, update_time)
    VALUES ('OEM016', '引能仕订货单默认规则', 0, 'D1', null, 'H11', 1, '合计', 1, 1, '${now}', '${now}')
  `);
  console.log('[OK] 已初始化 OEM016 默认 Excel 解析规则');
}

initDatabase().catch(err => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
