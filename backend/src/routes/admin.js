import { Router } from 'express';
import pool from '../config/db.js';
import { createHmac } from 'crypto';
import XLSX from 'xlsx';

const router = Router();

// ===== 认证 =====
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'zhcc_secret';

function signToken(payload) {
  const data = JSON.stringify(payload);
  const sig = createHmac('sha256', ADMIN_SECRET).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + sig;
}

function verifyToken(token) {
  try {
    const [dataB64, sig] = token.split('.');
    const data = Buffer.from(dataB64, 'base64').toString();
    const expected = createHmac('sha256', ADMIN_SECRET).update(data).digest('hex');
    if (sig !== expected) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: '登录已过期' });
  }
  req.admin = payload;
  next();
}

// ===== 登录 =====
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = signToken({ username, exp: Date.now() + 24 * 3600 * 1000 });
    return res.json({ data: { token, username } });
  }
  res.status(401).json({ error: '用户名或密码错误' });
});

// ===== 客户 CRUD =====
router.get('/customers', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM zhcc_customer ORDER BY id');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers', authMiddleware, async (req, res) => {
  try {
    const { customer_code, customer_name } = req.body;
    if (!customer_code) return res.status(400).json({ error: '缺少客户编号' });
    const [result] = await pool.query(
      'INSERT INTO zhcc_customer (customer_code, customer_name, create_time, update_time) VALUES (?, ?, NOW(3), NOW(3))',
      [customer_code, customer_name || null]
    );
    res.json({ data: { id: result.insertId, customer_code, customer_name } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '客户编号已存在' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/customers/:id', authMiddleware, async (req, res) => {
  try {
    const { customer_code, customer_name } = req.body;
    await pool.query(
      'UPDATE zhcc_customer SET customer_code = ?, customer_name = ?, update_time = NOW(3) WHERE id = ?',
      [customer_code, customer_name || null, req.params.id]
    );
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/customers/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM zhcc_customer WHERE id = ?', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 收货单位 CRUD =====
router.get('/downstream-customers', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT dc.*, c.customer_name as upstream_customer_name 
       FROM zhcc_downstream_customer dc 
       LEFT JOIN zhcc_customer c ON dc.customer_code = c.customer_code 
       ORDER BY dc.id`
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/downstream-customers', authMiddleware, async (req, res) => {
  try {
    const { customer_code, downstream_name, downstream_contact, downstream_phone } = req.body;
    if (!customer_code || !downstream_name) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const [result] = await pool.query(
      `INSERT INTO zhcc_downstream_customer 
        (customer_code, downstream_name, downstream_contact, downstream_phone, create_time, update_time) 
       VALUES (?, ?, ?, ?, NOW(3), NOW(3))`,
      [customer_code, downstream_name, downstream_contact || null, downstream_phone || null]
    );
    res.json({ data: { id: result.insertId, customer_code, downstream_name, downstream_contact, downstream_phone } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/downstream-customers/:id', authMiddleware, async (req, res) => {
  try {
    const { customer_code, downstream_name, downstream_contact, downstream_phone } = req.body;
    await pool.query(
      `UPDATE zhcc_downstream_customer 
       SET customer_code = ?, downstream_name = ?, downstream_contact = ?, downstream_phone = ?, update_time = NOW(3) 
       WHERE id = ?`,
      [customer_code, downstream_name, downstream_contact || null, downstream_phone || null, req.params.id]
    );
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/downstream-customers/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM zhcc_downstream_customer WHERE id = ?', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 按月导出可订明细 =====
router.get('/export', authMiddleware, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: '请选择年月' });

    const y = parseInt(year);
    const m = parseInt(month);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // 查询该月所有 approved 记录
    const [records] = await pool.query(
      `SELECT ir.*, c.customer_name 
       FROM zhcc_inquiry_record ir
       LEFT JOIN zhcc_customer c ON ir.customer_code = c.customer_code
       WHERE ir.result = 'approved' 
         AND ir.inquiry_date >= ? AND ir.inquiry_date < ?
       ORDER BY ir.warehouse_code, ir.customer_code`,
      [startDate, endDate]
    );

    // 获取所有客户（有序）
    const [allCustomers] = await pool.query('SELECT customer_code, customer_name FROM zhcc_customer ORDER BY customer_code');
    const customerMap = new Map();
    allCustomers.forEach(c => customerMap.set(c.customer_code, c.customer_name || c.customer_code));

    // 获取所有商品
    const [allProducts] = await pool.query('SELECT * FROM zhcc_product ORDER BY warehouse_code');

    // 构建 product-customer 订货数量矩阵
    const productCustomerQty = new Map(); // key: warehouseCode|customerCode -> qty
    for (const rec of records) {
      const key = `${rec.warehouse_code}|${rec.customer_code}`;
      productCustomerQty.set(key, (productCustomerQty.get(key) || 0) + rec.request_qty);
    }

    // 构建 Excel
    const customerCodes = Array.from(customerMap.keys());
    const baseCols = ['', '仓储产品编号', '客户编号', '客户产品代码', '产品名称', '规格'];

    // Row 0: 标题行（日期）
    const titleDate = new Date(y, m - 1, 1);
    const titleRow = new Array(baseCols.length + customerCodes.length * 3).fill(null);
    titleRow[4] = titleDate;

    // Row 1-2: 空行
    const emptyRow = new Array(titleRow.length).fill(null);

    // Row 3: 表头行（客户名）
    const headerRow3 = [...baseCols];
    const headerRow4 = new Array(baseCols.length).fill(null);
    for (const cc of customerCodes) {
      const name = customerMap.get(cc);
      headerRow3.push(name, null, null);
      headerRow4.push('结存', '入库', '不良品');
    }

    // Data rows
    const dataRows = [];
    let seq = 1;
    for (const p of allProducts) {
      const row = [seq, p.warehouse_code, p.customer_code, p.customer_product_code, p.product_name, p.spec];
      for (const cc of customerCodes) {
        const qty = productCustomerQty.get(`${p.warehouse_code}|${cc}`) || null;
        row.push(null, qty || null, null); // 结存=null, 入库=qty, 不良品=null
      }
      dataRows.push(row);
      seq++;
    }

    // 组装
    const sheetData = [titleRow, [], [], headerRow3, headerRow4, ...dataRows];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // 设置列宽
    ws['!cols'] = [
      { wch: 4 },  // 序号
      { wch: 16 }, // 仓储产品编号
      { wch: 12 }, // 客户编号
      { wch: 16 }, // 客户产品代码
      { wch: 40 }, // 产品名称
      { wch: 12 }, // 规格
    ];
    for (let i = 0; i < customerCodes.length * 3; i++) {
      ws['!cols'].push({ wch: 8 });
    }

    // 合并标题行
    ws['!merges'] = [];

    XLSX.utils.book_append_sheet(wb, ws, `${m}月可订明细`);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `${y}年${m}月可订明细.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (err) {
    console.error('[EXPORT ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Excel 解析规则 CRUD =====

router.get('/excel-rules', authMiddleware, async (req, res) => {
  try {
    const { customer_code } = req.query;
    let sql = 'SELECT * FROM zhcc_excel_parse_rule';
    const params = [];
    if (customer_code) {
      sql += ' WHERE customer_code = ?';
      params.push(customer_code);
    }
    sql += ' ORDER BY customer_code, id';
    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/excel-rules/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM zhcc_excel_parse_rule WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '规则不存在' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/excel-rules', authMiddleware, async (req, res) => {
  try {
    const {
      customer_code, rule_name, sheet_index, downstream_name_cell,
      downstream_name_extra_cells, product_code_start_cell, quantity_column_offset,
      end_marker, empty_value_treat_as_zero, is_default
    } = req.body;
    if (!customer_code || !downstream_name_cell || !product_code_start_cell) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (is_default) {
        await conn.query(
          'UPDATE zhcc_excel_parse_rule SET is_default = 0 WHERE customer_code = ?',
          [customer_code]
        );
      }
      const [result] = await conn.query(
        `INSERT INTO zhcc_excel_parse_rule
          (customer_code, rule_name, sheet_index, downstream_name_cell, downstream_name_extra_cells,
           product_code_start_cell, quantity_column_offset, end_marker, empty_value_treat_as_zero, is_default, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [customer_code, rule_name || null, sheet_index || 0, downstream_name_cell,
         downstream_name_extra_cells || null, product_code_start_cell, quantity_column_offset || 1,
         end_marker || '合计', empty_value_treat_as_zero === false ? 0 : 1, is_default ? 1 : 0]
      );
      await conn.commit();
      res.json({ data: { id: result.insertId } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/excel-rules/:id', authMiddleware, async (req, res) => {
  try {
    const {
      customer_code, rule_name, sheet_index, downstream_name_cell,
      downstream_name_extra_cells, product_code_start_cell, quantity_column_offset,
      end_marker, empty_value_treat_as_zero, is_default
    } = req.body;
    if (!customer_code || !downstream_name_cell || !product_code_start_cell) {
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (is_default) {
        await conn.query(
          'UPDATE zhcc_excel_parse_rule SET is_default = 0 WHERE customer_code = ?',
          [customer_code]
        );
      }
      await conn.query(
        `UPDATE zhcc_excel_parse_rule SET
          customer_code = ?, rule_name = ?, sheet_index = ?, downstream_name_cell = ?,
          downstream_name_extra_cells = ?, product_code_start_cell = ?, quantity_column_offset = ?,
          end_marker = ?, empty_value_treat_as_zero = ?, is_default = ?, update_time = NOW(3)
         WHERE id = ?`,
        [customer_code, rule_name || null, sheet_index || 0, downstream_name_cell,
         downstream_name_extra_cells || null, product_code_start_cell, quantity_column_offset || 1,
         end_marker || '合计', empty_value_treat_as_zero === false ? 0 : 1, is_default ? 1 : 0, req.params.id]
      );
      await conn.commit();
      res.json({ data: { success: true } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/excel-rules/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM zhcc_excel_parse_rule WHERE id = ?', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/excel-rules/:id/set-default', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT customer_code FROM zhcc_excel_parse_rule WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '规则不存在' });
    const customerCode = rows[0].customer_code;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE zhcc_excel_parse_rule SET is_default = 0 WHERE customer_code = ?', [customerCode]);
      await conn.query('UPDATE zhcc_excel_parse_rule SET is_default = 1 WHERE id = ?', [req.params.id]);
      await conn.commit();
      res.json({ data: { success: true } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 商品管理 CRUD =====

router.get('/products', authMiddleware, async (req, res) => {
  try {
    const { customer_code } = req.query;
    let sql = `SELECT p.*, c.customer_name 
               FROM zhcc_product p 
               LEFT JOIN zhcc_customer c ON p.customer_code = c.customer_code`;
    const params = [];
    if (customer_code) {
      sql += ' WHERE p.customer_code = ?';
      params.push(customer_code);
    }
    sql += ' ORDER BY p.warehouse_code';
    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products', authMiddleware, async (req, res) => {
  try {
    const { warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty } = req.body;
    if (!warehouse_code) return res.status(400).json({ error: '缺少仓储商品号' });
    const [result] = await pool.query(
      `INSERT INTO zhcc_product 
        (warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, create_time, update_time) 
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [warehouse_code, customer_code || '', customer_product_code || '', product_name || '', spec || '', stock_qty || 0]
    );
    res.json({ data: { id: result.insertId, warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '仓储商品号已存在' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/products/:id', authMiddleware, async (req, res) => {
  try {
    const { warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty } = req.body;
    await pool.query(
      `UPDATE zhcc_product SET 
        warehouse_code = ?, customer_code = ?, customer_product_code = ?, 
        product_name = ?, spec = ?, stock_qty = ?, update_time = NOW(3) 
       WHERE id = ?`,
      [warehouse_code, customer_code || '', customer_product_code || '', product_name || '', spec || '', stock_qty || 0, req.params.id]
    );
    res.json({ data: { success: true } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '仓储商品号已存在' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM zhcc_product WHERE id = ?', [req.params.id]);
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 入库管理 CRUD =====

router.get('/stock-in', authMiddleware, async (req, res) => {
  try {
    const { customer_code, start_date, end_date } = req.query;
    let sql = `SELECT si.*, p.product_name, p.spec, p.customer_product_code, c.customer_name 
               FROM zhcc_stock_in si 
               LEFT JOIN zhcc_product p ON si.product_id = p.id 
               LEFT JOIN zhcc_customer c ON si.customer_code = c.customer_code`;
    const conditions = [];
    const params = [];
    if (customer_code) {
      conditions.push('si.customer_code = ?');
      params.push(customer_code);
    }
    if (start_date) {
      conditions.push('si.stock_in_date >= ?');
      params.push(start_date);
    }
    if (end_date) {
      conditions.push('si.stock_in_date <= ?');
      params.push(end_date);
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY si.stock_in_date DESC, si.id DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stock-in', authMiddleware, async (req, res) => {
  try {
    const { customer_code, product_id, warehouse_code, stock_in_date, stock_in_qty, defective_qty, remark } = req.body;
    if (!customer_code || !product_id || !stock_in_date || stock_in_qty === undefined) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const actual_qty = (stock_in_qty || 0) - (defective_qty || 0);
    if (actual_qty < 0) return res.status(400).json({ error: '实际入库数量不能为负数' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO zhcc_stock_in 
          (customer_code, product_id, warehouse_code, stock_in_date, stock_in_qty, defective_qty, actual_qty, remark, create_time, update_time) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [customer_code, product_id, warehouse_code, stock_in_date, stock_in_qty, defective_qty || 0, actual_qty, remark || null]
      );
      // 更新商品结存数量
      await conn.query(
        'UPDATE zhcc_product SET stock_qty = stock_qty + ?, update_time = NOW(3) WHERE id = ?',
        [actual_qty, product_id]
      );
      await conn.commit();
      res.json({ data: { id: result.insertId, actual_qty } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/stock-in/:id', authMiddleware, async (req, res) => {
  try {
    const { customer_code, product_id, warehouse_code, stock_in_date, stock_in_qty, defective_qty, remark } = req.body;
    if (!customer_code || !product_id || !stock_in_date || stock_in_qty === undefined) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const new_actual_qty = (stock_in_qty || 0) - (defective_qty || 0);
    if (new_actual_qty < 0) return res.status(400).json({ error: '实际入库数量不能为负数' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 获取旧记录
      const [oldRows] = await conn.query('SELECT actual_qty, product_id FROM zhcc_stock_in WHERE id = ?', [req.params.id]);
      if (oldRows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: '入库记录不存在' });
      }
      const old = oldRows[0];
      // 回退旧的 actual_qty
      await conn.query('UPDATE zhcc_product SET stock_qty = stock_qty - ?, update_time = NOW(3) WHERE id = ?', [old.actual_qty, old.product_id]);
      // 更新入库记录
      await conn.query(
        `UPDATE zhcc_stock_in SET 
          customer_code = ?, product_id = ?, warehouse_code = ?, stock_in_date = ?, 
          stock_in_qty = ?, defective_qty = ?, actual_qty = ?, remark = ?, update_time = NOW(3) 
         WHERE id = ?`,
        [customer_code, product_id, warehouse_code, stock_in_date, stock_in_qty, defective_qty || 0, new_actual_qty, remark || null, req.params.id]
      );
      // 应用新的 actual_qty
      await conn.query('UPDATE zhcc_product SET stock_qty = stock_qty + ?, update_time = NOW(3) WHERE id = ?', [new_actual_qty, product_id]);
      await conn.commit();
      res.json({ data: { success: true, actual_qty: new_actual_qty } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/stock-in/:id', authMiddleware, async (req, res) => {
  try {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT actual_qty, product_id FROM zhcc_stock_in WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: '入库记录不存在' });
      }
      const rec = rows[0];
      // 回退库存
      await conn.query('UPDATE zhcc_product SET stock_qty = stock_qty - ?, update_time = NOW(3) WHERE id = ?', [rec.actual_qty, rec.product_id]);
      await conn.query('DELETE FROM zhcc_stock_in WHERE id = ?', [req.params.id]);
      await conn.commit();
      res.json({ data: { success: true } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 一键备份 =====

/**
 * POST /backup
 * 1. 查询所有商品，对每个商品计算前一月份的冻结数量之和
 * 2. 将前一月份的 active 冻结记录标记为 shipped（已发货）
 * 3. 更新商品表的 stock_qty：减去已发货的冻结数量
 * 4. 将商品数据复制到 zhcc_product_backup 表，带上备份日期
 */
router.post('/backup', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const now = new Date();
    const backupDate = now.toISOString().slice(0, 19).replace('T', ' ');

    // 计算前一个月的起止日期
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStart = prevMonth.toISOString().slice(0, 10);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    // 查询所有商品
    const [products] = await conn.query('SELECT * FROM zhcc_product');

    let totalBackedUp = 0;
    let totalReleased = 0;

    for (const product of products) {
      // 查询前一月份该商品的 active 冻结数量之和
      // 注意：仅统计 status='active' 的记录，已标记为 shipped 的记录不会被重复计算
      // 这确保重复执行备份时，同一冻结记录不会被多次扣除
      const [freezeResult] = await conn.query(
        `SELECT COALESCE(SUM(freeze_qty), 0) as total_frozen 
         FROM zhcc_stock_freeze 
         WHERE product_id = ? AND status = 'active' 
           AND freeze_date >= ? AND freeze_date < ?`,
        [product.id, prevMonthStart, prevMonthEnd]
      );
      const frozenQty = Number(freezeResult[0].total_frozen) || 0;

      // 将前一月份该商品的 active 冻结记录标记为 shipped
      if (frozenQty > 0) {
        await conn.query(
          `UPDATE zhcc_stock_freeze 
           SET status = 'shipped', update_time = NOW(3) 
           WHERE product_id = ? AND status = 'active' 
             AND freeze_date >= ? AND freeze_date < ?`,
          [product.id, prevMonthStart, prevMonthEnd]
        );
        totalReleased += frozenQty;
      }

      // 计算新的结存数量：原始 stock_qty - 已发货冻结
      const newStockQty = product.stock_qty - frozenQty;

      // 更新商品表的结存数量
      await conn.query(
        'UPDATE zhcc_product SET stock_qty = ?, update_time = NOW(3) WHERE id = ?',
        [newStockQty, product.id]
      );

      // 写入备份表
      await conn.query(
        `INSERT INTO zhcc_product_backup 
          (backup_date, product_id, warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, frozen_qty, create_time) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
        [backupDate, product.id, product.warehouse_code, product.customer_code, product.customer_product_code, product.product_name, product.spec, newStockQty, frozenQty]
      );
      totalBackedUp++;
    }

    await conn.commit();
    res.json({
      data: {
        success: true,
        backup_date: backupDate,
        prev_month_range: { start: prevMonthStart, end: prevMonthEnd },
        total_products: products.length,
        total_backed_up: totalBackedUp,
        total_released_qty: totalReleased,
      }
    });
  } catch (err) {
    await conn.rollback();
    console.error('[BACKUP ERROR]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * GET /backups
 * 查询备份历史，支持按日期筛选
 */
router.get('/backups', authMiddleware, async (req, res) => {
  try {
    const { backup_date } = req.query;
    let sql = `SELECT pb.*, c.customer_name 
               FROM zhcc_product_backup pb 
               LEFT JOIN zhcc_customer c ON pb.customer_code = c.customer_code`;
    const params = [];
    if (backup_date) {
      sql += ' WHERE DATE(pb.backup_date) = ?';
      params.push(backup_date);
    }
    sql += ' ORDER BY pb.backup_date DESC, pb.warehouse_code';
    const [rows] = await pool.query(sql, params);

    // 查询所有备份日期（去重）
    const [dates] = await pool.query(
      'SELECT DISTINCT DATE(backup_date) as backup_date, COUNT(*) as product_count FROM zhcc_product_backup GROUP BY DATE(backup_date) ORDER BY backup_date DESC'
    );

    res.json({ data: { records: rows, backup_dates: dates } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 咨询记录管理 =====

/**
 * GET /inquiry-records
 * 管理后台查询咨询记录，支持按客户、月份筛选
 */
router.get('/inquiry-records', authMiddleware, async (req, res) => {
  try {
    const { customer_code, month, downstream_customer_name, page = 1, pageSize = 50 } = req.query;
    let where = '1=1';
    const params = [];

    if (customer_code) {
      where += ' AND ir.customer_code = ?';
      params.push(customer_code);
    }
    if (month) {
      where += ' AND DATE_FORMAT(ir.inquiry_date, \'%Y-%m\') = ?';
      params.push(month);
    }
    if (downstream_customer_name) {
      where += ' AND ir.downstream_customer_name = ?';
      params.push(downstream_customer_name);
    }

    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM zhcc_inquiry_record ir WHERE ${where}`, params
    );

    const [records] = await pool.query(
      `SELECT ir.*, c.customer_name 
       FROM zhcc_inquiry_record ir
       LEFT JOIN zhcc_customer c ON ir.customer_code = c.customer_code
       WHERE ${where}
       ORDER BY ir.id DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );

    // 查询所有月份（用于筛选下拉）
    const [months] = await pool.query(
      'SELECT DISTINCT DATE_FORMAT(inquiry_date, \'%Y-%m\') as month FROM zhcc_inquiry_record ORDER BY month DESC'
    );

    // 查询所有客户（从咨询记录中去重）
    const [upstreams] = await pool.query(
      `SELECT DISTINCT ir.customer_code, c.customer_name 
       FROM zhcc_inquiry_record ir 
       LEFT JOIN zhcc_customer c ON ir.customer_code = c.customer_code 
       ORDER BY ir.customer_code`
    );

    // 查询收货单位名称（如果指定了客户则联动筛选）
    let downstreamSql = 'SELECT DISTINCT downstream_customer_name FROM zhcc_inquiry_record WHERE downstream_customer_name IS NOT NULL AND downstream_customer_name != \'\'';
    const downstreamParams = [];
    if (customer_code) {
      downstreamSql += ' AND customer_code = ?';
      downstreamParams.push(customer_code);
    }
    downstreamSql += ' ORDER BY downstream_customer_name';
    const [downstreams] = await pool.query(downstreamSql, downstreamParams);

    res.json({ data: { records, total: countResult[0].total, months: months.map(m => m.month), upstreams, downstreams: downstreams.map(d => d.downstream_customer_name) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /inquiry-records/:id
 * 删除单条咨询记录，同时回退对应的库存冻结
 */
router.delete('/inquiry-records/:id', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id);

    // 查询该记录
    const [rows] = await conn.query(
      'SELECT * FROM zhcc_inquiry_record WHERE id = ?', [id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }
    const rec = rows[0];

    // 如果该记录结果是通过的（可订），需要回退冻结
    if (rec.result === 'approved' && rec.freeze_qty > 0) {
      // 查找对应的冻结记录并回退
      await conn.query(
        `UPDATE zhcc_stock_freeze 
         SET status = 'cancelled', update_time = NOW(3)
         WHERE inquiry_record_id = ? AND status = 'active'`,
        [id]
      );
      // 恢复商品库存
      await conn.query(
        'UPDATE zhcc_product SET stock_qty = stock_qty + ?, update_time = NOW(3) WHERE id = ?',
        [rec.freeze_qty, rec.product_id]
      );
    }

    // 删除咨询记录
    await conn.query('DELETE FROM zhcc_inquiry_record WHERE id = ?', [id]);

    await conn.commit();
    res.json({ data: { success: true } });
  } catch (err) {
    await conn.rollback();
    console.error('[DELETE INQUIRY RECORD ERROR]', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

export default router;
