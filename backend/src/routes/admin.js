import { Router } from 'express';
import pool from '../config/db.js';
import { createHmac } from 'crypto';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';

/** 获取本地日期字符串 YYYY-MM-DD（基于服务器本地时间） */
function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 获取本地日期时间字符串 YYYY-MM-DD HH:mm:ss */
function localDateTime(d = new Date()) {
  const date = localDate(d);
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${date} ${h}:${min}:${s}`;
}

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

// ===== 按月导出进出库明细 =====

/**
 * GET /export?year=&month=&customer_code=
 *
 * 复刻手工台账《N月XXX进出库明细.xlsx》的版式：
 *
 *   A-F  商品基础信息（序号/仓储产品编号/客户编号/客户产品代码/产品名称/规格）
 *   G    期初结存（上月末余额，不参与结存公式链——与手工表一致）
 *   H起  按当月发生业务的日期横向展开，每块 = [入库][不良品][出库单位1..N][结存]
 *
 * 数值口径（与手工表一致）：
 *   入库   = stock_in_qty（毛入库，未扣不良品）
 *   不良品 = -defective_qty（记负数，与入库同块相加得净入库）
 *   出库   = -request_qty（记负数）
 *
 * 结存列公式：SUM(上一个结存列 : 本块结存列的前一列)
 *   —— 首块从本块入库列起算，不含 G 列期初结存
 *   —— 手工表中 5 个空的不良品列被排除在 SUM 范围外（O/X/AE/BS/CH，均无数据），
 *      此处统一纳入范围，逐格计算结果与手工表完全相同
 */
router.get('/export', authMiddleware, async (req, res) => {
  try {
    const { year, month, customer_code } = req.query;
    if (!year || !month) return res.status(400).json({ error: '请选择年月' });
    if (!customer_code) return res.status(400).json({ error: '请选择客户' });

    const y = parseInt(year);
    const m = parseInt(month);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const [customers] = await pool.query('SELECT * FROM zhcc_customer WHERE customer_code = ?', [customer_code]);
    if (customers.length === 0) return res.status(404).json({ error: '客户不存在' });
    const customerName = customers[0].customer_name || customers[0].customer_code;

    // ===== 行：该客户全部商品，按 id 排序（与手工表顺序一致）=====
    const [products] = await pool.query(
      'SELECT * FROM zhcc_product WHERE customer_code = ? ORDER BY id',
      [customer_code]
    );
    if (products.length === 0) return res.status(404).json({ error: '该客户下没有商品' });

    // ===== 期初结存：一键备份在月初执行，记录的即上月末（= 本月初）余额 =====
    const [backups] = await pool.query(
      `SELECT product_id, stock_qty, backup_date FROM zhcc_product_backup
       WHERE customer_code = ? AND backup_date < ?
       ORDER BY backup_date ASC`,
      [customer_code, endDate]
    );
    const openingInMonth = new Map(); // 本月内最早一次备份
    const openingLatest = new Map();  // 兜底：本月之前最近一次备份
    for (const b of backups) {
      if (b.backup_date >= startDate) {
        if (!openingInMonth.has(b.product_id)) openingInMonth.set(b.product_id, b.stock_qty);
      } else {
        openingLatest.set(b.product_id, b.stock_qty); // ASC 遍历，后写覆盖 => 最近一次
      }
    }
    const openingOf = id => openingInMonth.get(id) ?? openingLatest.get(id) ?? null;

    // ===== 入库 / 不良品：按 商品+日期 汇总（入库取毛数，不良品单列）=====
    const [stockIns] = await pool.query(
      `SELECT product_id, stock_in_date, SUM(stock_in_qty) AS in_qty, SUM(defective_qty) AS bad_qty
       FROM zhcc_stock_in
       WHERE customer_code = ? AND stock_in_date >= ? AND stock_in_date < ?
       GROUP BY product_id, stock_in_date`,
      [customer_code, startDate, endDate]
    );

    // ===== 出库：按 商品+日期+收货单位 汇总，只取实际成交（整批通过）的咨询 =====
    // 列顺序 = 当天各收货单位首次咨询的先后（seq），与手工表「当天发了几家就排几列」一致
    const [outs] = await pool.query(
      `SELECT product_id, inquiry_date,
              COALESCE(downstream_customer_name, '未指定') AS downstream_name,
              SUM(request_qty) AS out_qty, MIN(id) AS seq
       FROM zhcc_inquiry_record
       WHERE customer_code = ? AND batch_result = 'approved' AND result = 'approved'
         AND inquiry_date >= ? AND inquiry_date < ?
       GROUP BY product_id, inquiry_date, downstream_customer_name
       ORDER BY inquiry_date, seq`,
      [customer_code, startDate, endDate]
    );

    // 每个日期下收货单位的列顺序：取该单位当天最早的记录 id
    const nameSeq = new Map(); // date|name -> 最小 id
    for (const o of outs) {
      const k = `${o.inquiry_date}|${o.downstream_name}`;
      const cur = nameSeq.get(k);
      if (cur === undefined || o.seq < cur) nameSeq.set(k, o.seq);
    }

    // ===== 日期块：入库日期 ∪ 出库日期 =====
    const dates = [...new Set([
      ...stockIns.map(r => r.stock_in_date),
      ...outs.map(r => r.inquiry_date),
    ])].sort();
    if (dates.length === 0) return res.status(404).json({ error: `${y}年${m}月没有进出库数据` });

    const BASE_COLS = 6;                 // A-F
    const OPENING_COL = BASE_COLS;       // G 期初结存（独立一列，不入公式链）
    let cursor = BASE_COLS + 1;          // H 起为第一个日期块

    const blocks = dates.map(date => {
      // 当天有发货的收货单位 —— 有几家就开几列，按当天首次咨询先后排序
      const names = [...new Set(outs.filter(o => o.inquiry_date === date).map(o => o.downstream_name))]
        .sort((a, b) => nameSeq.get(`${date}|${a}`) - nameSeq.get(`${date}|${b}`));
      const inCol = cursor;
      const badCol = cursor + 1;
      const outCols = names.map((_, i) => cursor + 2 + i);
      const balCol = cursor + 2 + names.length;
      cursor = balCol + 1;
      return { date, names, inCol, badCol, outCols, balCol };
    });
    const totalCols = cursor;

    // 快速查表
    const inMap = new Map();  // product_id|date -> {in_qty, bad_qty}
    for (const s of stockIns) inMap.set(`${s.product_id}|${s.stock_in_date}`, s);
    const outMap = new Map(); // product_id|date|name -> qty
    for (const o of outs) outMap.set(`${o.product_id}|${o.inquiry_date}|${o.downstream_name}`, Number(o.out_qty));

    // ===== 表头 =====
    const blank = () => new Array(totalCols).fill(null);
    const row4 = [null, '仓储产品编号', '客户编号', '客户产品代码', '产品名称', '规格'];

    // ===== 数据行 =====
    const dataRows = products.map((p, idx) => {
      const row = blank();
      row[0] = idx + 1;
      row[1] = p.warehouse_code;
      row[2] = p.customer_code;
      row[3] = p.customer_product_code;
      row[4] = p.product_name;
      row[5] = p.spec;
      row[OPENING_COL] = openingOf(p.id);
      for (const b of blocks) {
        const si = inMap.get(`${p.id}|${b.date}`);
        row[b.inCol] = si && Number(si.in_qty) ? Number(si.in_qty) : null;
        row[b.badCol] = si && Number(si.bad_qty) ? -Number(si.bad_qty) : null;
        b.names.forEach((n, i) => {
          const qty = outMap.get(`${p.id}|${b.date}|${n}`);
          row[b.outCols[i]] = qty ? -qty : null;          // 出库记负数
        });
        // 结存列留空，稍后写入公式
      }
      return row;
    });

    // ===== 写入工作簿（样式全部照手工台账实测值还原）=====
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${customerName}${m}月份明细`.slice(0, 31).replace(/[:\\/?*[\]]/g, ''), {
      views: [{ state: 'frozen', xSplit: 6, ySplit: 5 }],   // 冻结 A-F 列 + 前 5 行
      properties: { defaultRowHeight: 22.05, defaultColWidth: 9 },
    });

    const FONT = { name: '宋体', size: 10 };
    const CENTER = { horizontal: 'center', vertical: 'middle' };
    const CENTER_WRAP = { ...CENTER, wrapText: true };
    const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    const bd = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { style: v }]));

    const put = (r, c, value, style = {}) => {
      const cell = ws.getCell(r, c);
      if (value !== null && value !== undefined) cell.value = value;
      cell.font = FONT;
      cell.alignment = style.alignment || CENTER;
      if (style.fill) cell.fill = style.fill;
      if (style.border) cell.border = style.border;
      if (style.numFmt) cell.numFmt = style.numFmt;
      return cell;
    };

    // --- 行1：月份 ---
    // 注意：必须用 UTC 构造，否则 exceljs 按 +08:00 落盘会让日期整体前移一天
    put(1, 5, new Date(Date.UTC(y, m - 1, 1)), { numFmt: 'yyyy"年"m"月";@' });

    // --- 行3 日期 / 行4 表头（边框口径实测自手工台账，一致率 100%）---
    const BOX = bd({ top: 'thin', left: 'thin', bottom: 'thin', right: 'thin' });
    const HDR = bd({ top: 'thin', bottom: 'thin' });                  // 块内列：上下线
    const HDR_END = bd({ top: 'thin', bottom: 'thin', right: 'thin' }); // 块末列：收口
    for (let c = 1; c <= 7; c++) {
      put(3, c, null, { alignment: CENTER_WRAP, border: BOX });
      put(4, c, c >= 2 && c <= 6 ? row4[c - 1] : null, { alignment: CENTER_WRAP, border: BOX });
    }
    for (const b of blocks) {
      const [yy, mm, dd] = b.date.split('-').map(Number);
      // exceljs 中合并区各格共用主格样式：右框设在主格上，Excel 即在区块右缘画线收口
      put(3, b.inCol + 1, new Date(Date.UTC(yy, mm - 1, dd)), { alignment: CENTER_WRAP, border: HDR_END, numFmt: 'm"月"d"日"' });
      put(4, b.inCol + 1, '客户名称', { alignment: CENTER_WRAP, border: HDR_END });
      if (b.balCol > b.inCol) {
        ws.mergeCells(3, b.inCol + 1, 3, b.balCol + 1);
        ws.mergeCells(4, b.inCol + 1, 4, b.balCol + 1);
      }
    }

    // --- 行5：列名（入库列黄底，与手工台账一致）---
    const B5_BASE = bd({ top: 'thin', left: 'thin', right: 'thin' });  // A-G：带左线
    const B5 = bd({ top: 'thin', right: 'thin' });                     // 块内列
    for (let c = 1; c <= 6; c++) put(5, c, null, { border: B5_BASE });
    put(5, OPENING_COL + 1, '结存', { border: B5_BASE });
    for (const b of blocks) {
      put(5, b.inCol + 1, '入库', { border: B5, fill: YELLOW });
      put(5, b.badCol + 1, '不良品', { border: B5, alignment: CENTER_WRAP });
      b.names.forEach((n, i) => put(5, b.outCols[i] + 1, n, { border: B5, alignment: CENTER_WRAP }));
      put(5, b.balCol + 1, '结存', { border: B5 });
    }

    // --- 数据行 ---
    const lastRow = 5 + dataRows.length;
    // 右边框口径（实测手工台账）：出库列一律不画；不良品列在其右邻为出库列时不画，否则画；其余都画
    const outColSet = new Set(blocks.flatMap(b => b.outCols.map(c => c + 1)));
    const noRightCols = new Set(outColSet);
    for (const b of blocks) if (b.names.length > 0) noRightCols.add(b.badCol + 1);

    dataRows.forEach((rowData, i) => {
      const r = 6 + i;
      const border = {
        left: { style: 'thin' },
        top: { style: i === 0 ? 'medium' : 'hair' },
        bottom: { style: r === lastRow ? 'medium' : 'hair' },
      };
      for (let c = 1; c <= totalCols; c++) {
        const b = { ...border };
        if (!noRightCols.has(c)) b.right = { style: 'thin' };
        // 产品名称含换行时才开自动换行（与手工台账一致：单行品名不换行）
        const wrap = c === 5 && typeof rowData[4] === 'string' && rowData[4].includes('\n');
        put(r, c, rowData[c - 1], { border: b, alignment: wrap ? CENTER_WRAP : CENTER });
      }
      // 结存列公式：首块从本块入库列起算（不含 G 期初），其余从上一个结存列起算
      blocks.forEach((b, bi) => {
        const from = bi === 0 ? b.inCol : blocks[bi - 1].balCol;
        ws.getCell(r, b.balCol + 1).value = {
          formula: `SUM(${XLSX.utils.encode_col(from)}${r}:${XLSX.utils.encode_col(b.balCol - 1)}${r})`,
        };
      });
    });

    // --- 自动筛选：与手工台账一致，挂在列名行(第5行)上 ---
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastRow, column: totalCols } };

    // --- 行高 / 列宽 ---
    ws.getRow(4).height = 36;
    ws.getRow(5).height = 28.95;
    const BASE_W = [4.67, 13, 13, 18.33, 37.67, 10.78];
    BASE_W.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(OPENING_COL + 1).width = 9;
    for (const b of blocks) {
      ws.getColumn(b.inCol + 1).width = 9;
      ws.getColumn(b.badCol + 1).width = 9.89;
      b.names.forEach((_, i) => { ws.getColumn(b.outCols[i] + 1).width = 10.38; });
      ws.getColumn(b.balCol + 1).width = 9.67;
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const filename = `${m}月${customerName}进出库明细.xlsx`;
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
    const backupDate = localDateTime();

    // 本月1日作为截止线：处理所有在此日期之前的 active 冻结记录
    const currentMonthStart = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    // 查询所有商品
    const [products] = await conn.query('SELECT * FROM zhcc_product');

    let totalBackedUp = 0;
    let totalReleased = 0;

    for (const product of products) {
      // 查询本月1日之前该商品所有 active 状态的冻结数量之和
      // 仅统计 status='active' 的记录，已标记为 shipped 的不会被重复计算
      // 这确保重复执行备份时，同一冻结记录不会被多次扣除
      const [freezeResult] = await conn.query(
        `SELECT COALESCE(SUM(freeze_qty), 0) as total_frozen 
         FROM zhcc_stock_freeze 
         WHERE product_id = ? AND status = 'active' 
           AND freeze_date < ?`,
        [product.id, currentMonthStart]
      );
      const frozenQty = Number(freezeResult[0].total_frozen) || 0;

      // 将本月1日之前该商品的 active 冻结记录标记为 shipped
      if (frozenQty > 0) {
        await conn.query(
          `UPDATE zhcc_stock_freeze 
           SET status = 'shipped', update_time = NOW(3) 
           WHERE product_id = ? AND status = 'active' 
             AND freeze_date < ?`,
          [product.id, currentMonthStart]
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
        freeze_before: currentMonthStart,
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
