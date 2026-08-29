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
    // 类别按客户隔离，新客户先备好默认分类，之后建商品才有兜底去处
    await ensureDefaultCategory(pool, customer_code);
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
 *   A-G  商品基础信息（序号/仓储产品编号/客户编号/产品分类/客户产品代码/产品名称/规格）
 *   H    期初结存（上月末余额，不参与结存公式链——与手工表一致）
 *   I起  按当月发生业务的日期横向展开，每块 = [入库][出库单位1..N][结存]
 *
 * 数值口径：
 *   入库 = stock_in_qty - defective_qty（净入库，不良品不再单列）
 *   出库 = -request_qty（记负数）
 *
 * 结存列公式：SUM(上一个结存列 : 本块结存列的前一列)
 *   —— 首块从本块入库列起算，不含 H 列期初结存
 *
 * 末行合计：数据区下方一行，H 列起每列纵向 SUM(首个产品行 : 末个产品行)
 *
 * 产品分类列：商品按「分类 → id」排序，同分类的行在 D 列合并成一格
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

    // ===== 行：该客户全部商品 =====
    // 按「分类 → id」排序，同分类的行才连续，D 列的合并单元格才成立。
    // 分类内部仍是 id 序，与手工表一致；默认分类排在最前，与类别管理页的顺序一致。
    const [products] = await pool.query(
      `SELECT p.*, cat.category_name, cat.is_default AS category_is_default
       FROM zhcc_product p
       LEFT JOIN zhcc_product_category cat ON cat.id = p.category_id
       WHERE p.customer_code = ?
       ORDER BY cat.is_default DESC, cat.category_name, p.id`,
      [customer_code]
    );
    if (products.length === 0) return res.status(404).json({ error: '该客户下没有商品' });

    // ===== 期初结存：取截止日期(endDate)之前最近一次备份的 stock_qty =====
    const [backups] = await pool.query(
      `SELECT product_id, stock_qty FROM zhcc_product_backup
       WHERE customer_code = ? AND backup_date < ?
       ORDER BY backup_date ASC`,
      [customer_code, endDate]
    );
    const openingOfProduct = new Map();
    for (const b of backups) {
      // ASC 遍历，后写覆盖 => 截止日期前最近一次备份
      openingOfProduct.set(b.product_id, b.stock_qty);
    }
    const openingOf = id => openingOfProduct.get(id) ?? null;

    // ===== 入库：按 商品+日期 汇总（净入库 = 毛入库 - 不良品）=====
    const [stockIns] = await pool.query(
      `SELECT product_id, stock_in_date, SUM(stock_in_qty) AS in_qty, SUM(defective_qty) AS bad_qty
       FROM zhcc_stock_in
       WHERE customer_code = ? AND stock_in_date >= ? AND stock_in_date < ?
       GROUP BY product_id, stock_in_date`,
      [customer_code, startDate, endDate]
    );

    // ===== 出库：按 商品+日期+收货单位 汇总，只取实际成交（整批通过）且冻结仍 active 的咨询 =====
    // 列顺序 = 当天各收货单位首次咨询的先后（seq），与手工表「当天发了几家就排几列」一致
    const [outs] = await pool.query(
      `SELECT ir.product_id, ir.inquiry_date,
              COALESCE(ir.downstream_customer_name, '未指定') AS downstream_name,
              SUM(sf.freeze_qty) AS out_qty, MIN(ir.id) AS seq
       FROM zhcc_inquiry_record ir
       INNER JOIN zhcc_stock_freeze sf ON ir.id = sf.inquiry_id
       WHERE ir.customer_code = ? AND ir.batch_result = 'approved' AND ir.result = 'approved'
         AND ir.inquiry_date < ?
         AND sf.status = 'active'
       GROUP BY ir.product_id, ir.inquiry_date, ir.downstream_customer_name
       ORDER BY ir.inquiry_date, seq`,
      [customer_code, endDate]
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

    // 基础信息列（0 基下标，+1 才是 exceljs 的列号）
    const COL_SEQ = 0, COL_WAREHOUSE = 1, COL_CUSTOMER = 2, COL_CATEGORY = 3,
          COL_PRODUCT_CODE = 4, COL_NAME = 5, COL_SPEC = 6;
    const BASE_COLS = 7;                 // A-G
    const OPENING_COL = BASE_COLS;       // H 期初结存（独立一列，不入公式链）
    let cursor = BASE_COLS + 1;          // I 起为第一个日期块

    const blocks = dates.map(date => {
      // 当天有发货的收货单位 —— 有几家就开几列，按当天首次咨询先后排序
      const names = [...new Set(outs.filter(o => o.inquiry_date === date).map(o => o.downstream_name))]
        .sort((a, b) => nameSeq.get(`${date}|${a}`) - nameSeq.get(`${date}|${b}`));
      const inCol = cursor;
      const outCols = names.map((_, i) => cursor + 1 + i);
      const balCol = cursor + 1 + names.length;
      cursor = balCol + 1;
      return { date, names, inCol, outCols, balCol };
    });
    const totalCols = cursor;

    // 快速查表
    const inMap = new Map();  // product_id|date -> {in_qty, bad_qty}
    for (const s of stockIns) inMap.set(`${s.product_id}|${s.stock_in_date}`, s);
    const outMap = new Map(); // product_id|date|name -> qty
    for (const o of outs) outMap.set(`${o.product_id}|${o.inquiry_date}|${o.downstream_name}`, Number(o.out_qty));

    // ===== 表头 =====
    const blank = () => new Array(totalCols).fill(null);
    const row4 = [null, '仓储产品编号', '客户编号', '产品分类', '客户产品代码', '产品名称', '规格'];

    // ===== 数据行 =====
    const dataRows = products.map((p, idx) => {
      const row = blank();
      row[COL_SEQ] = idx + 1;
      row[COL_WAREHOUSE] = p.warehouse_code;
      row[COL_CUSTOMER] = p.customer_code;
      row[COL_CATEGORY] = p.category_name;
      row[COL_PRODUCT_CODE] = p.customer_product_code;
      row[COL_NAME] = p.product_name;
      row[COL_SPEC] = p.spec;
      row[OPENING_COL] = openingOf(p.id);
      for (const b of blocks) {
        const si = inMap.get(`${p.id}|${b.date}`);
        const netIn = si ? Number(si.in_qty) - Number(si.bad_qty) : 0;
        row[b.inCol] = netIn || null;
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
      views: [{ state: 'frozen', xSplit: BASE_COLS, ySplit: 5 }],   // 冻结 A-G 列 + 前 5 行
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
    put(1, COL_NAME + 1, new Date(Date.UTC(y, m - 1, 1)), { numFmt: 'yyyy"年"m"月";@' });

    // --- 行3 日期 / 行4 表头（边框口径实测自手工台账，一致率 100%）---
    const BOX = bd({ top: 'thin', left: 'thin', bottom: 'thin', right: 'thin' });
    const HDR = bd({ top: 'thin', bottom: 'thin' });                  // 块内列：上下线
    const HDR_END = bd({ top: 'thin', bottom: 'thin', right: 'thin' }); // 块末列：收口
    // A..G 基础信息列 + H 期初结存列
    for (let c = 1; c <= OPENING_COL + 1; c++) {
      put(3, c, null, { alignment: CENTER_WRAP, border: BOX });
      put(4, c, c >= 2 && c <= BASE_COLS ? row4[c - 1] : null, { alignment: CENTER_WRAP, border: BOX });
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
    const B5_BASE = bd({ top: 'thin', left: 'thin', right: 'thin' });  // A-H：带左线
    const B5 = bd({ top: 'thin', right: 'thin' });                     // 块内列
    for (let c = 1; c <= BASE_COLS; c++) put(5, c, null, { border: B5_BASE });
    put(5, OPENING_COL + 1, '结存', { border: B5_BASE });
    for (const b of blocks) {
      put(5, b.inCol + 1, '入库', { border: B5, fill: YELLOW });
      b.names.forEach((n, i) => put(5, b.outCols[i] + 1, n, { border: B5, alignment: CENTER_WRAP }));
      put(5, b.balCol + 1, '结存', { border: B5 });
    }

    // --- 数据行 ---
    const lastRow = 5 + dataRows.length;
    // 右边框口径（实测手工台账）：出库列一律不画；入库列在其右邻为出库列时不画，否则画；其余都画
    const outColSet = new Set(blocks.flatMap(b => b.outCols.map(c => c + 1)));
    const noRightCols = new Set(outColSet);
    for (const b of blocks) if (b.names.length > 0) noRightCols.add(b.inCol + 1);

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
        const wrap = c === COL_NAME + 1 && typeof rowData[COL_NAME] === 'string' && rowData[COL_NAME].includes('\n');
        put(r, c, rowData[c - 1], { border: b, alignment: wrap ? CENTER_WRAP : CENTER });
      }
      // 结存列公式：首块从 G 列期初起算，其余从上一个结存列起算
      blocks.forEach((b, bi) => {
        const from = bi === 0 ? OPENING_COL : blocks[bi - 1].balCol;
        ws.getCell(r, b.balCol + 1).value = {
          formula: `SUM(${XLSX.utils.encode_col(from)}${r}:${XLSX.utils.encode_col(b.balCol - 1)}${r})`,
        };
      });
    });

    // --- 产品分类列：同分类的连续行合并成一格 ---
    // products 已按「分类 → id」排序，所以同分类的行必然相邻。
    // exceljs 的合并区以主格（区首）为准，值和样式在上面的数据行循环里已经写好了。
    for (let i = 0; i < dataRows.length;) {
      const name = dataRows[i][COL_CATEGORY];
      let j = i + 1;
      while (j < dataRows.length && dataRows[j][COL_CATEGORY] === name) j++;
      if (j - i > 1) {
        const top = 6 + i, bottom = 6 + j - 1;
        ws.mergeCells(top, COL_CATEGORY + 1, bottom, COL_CATEGORY + 1);
        // 合并区整体套用主格的边框，所以底线要按区末行（而非区首行）的口径重设
        const head = ws.getCell(top, COL_CATEGORY + 1);
        head.border = { ...head.border, bottom: { style: bottom === lastRow ? 'medium' : 'hair' } };
      }
      i = j;
    }

    // --- 合计行：紧贴末个产品行，H 列（期初结存）起每列纵向求和 ---
    const totalRow = lastRow + 1;
    const TOTAL_BORDER = { left: { style: 'thin' }, top: { style: 'medium' }, bottom: { style: 'medium' } };
    for (let c = 1; c <= totalCols; c++) {
      const b = { ...TOTAL_BORDER };
      if (!noRightCols.has(c)) b.right = { style: 'thin' };
      const cell = put(totalRow, c, null, { border: b });
      if (c > OPENING_COL) {
        const col = XLSX.utils.encode_col(c - 1);
        cell.value = { formula: `SUM(${col}6:${col}${lastRow})` };
      }
      cell.font = { ...FONT, bold: true };
    }
    ws.mergeCells(totalRow, 1, totalRow, BASE_COLS);
    ws.getCell(totalRow, 1).value = '合计';

    // --- 自动筛选：与手工台账一致，挂在列名行(第5行)上；合计行不纳入筛选区 ---
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: lastRow, column: totalCols } };

    // --- 行高 / 列宽 ---
    ws.getRow(4).height = 36;
    ws.getRow(5).height = 28.95;
    const BASE_W = [4.67, 13, 13, 12, 18.33, 37.67, 10.78];   // 序号/仓储号/客户/分类/客户产品代码/品名/规格
    BASE_W.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(OPENING_COL + 1).width = 9;
    for (const b of blocks) {
      ws.getColumn(b.inCol + 1).width = 9;
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

// ===== 商品类别 CRUD =====
//
// 类别按客户隔离：每个客户一套自己的类别，其中恰好一条 is_default = 1（「默认分类」）。
// 默认分类不可删除，是商品失去类别归属时的兜底去处：
//   - 新建商品未指定类别
//   - 商品改挂到别的客户，原类别不属于新客户
//   - 类别被删除，其下商品回落

const DEFAULT_CATEGORY_NAME = '默认分类';

/** 取该客户的默认分类 id，没有就建一条。客户是后来新增的、或迁移时漏掉的都能兜住 */
async function ensureDefaultCategory(conn, customerCode) {
  if (!customerCode) return null;
  const [rows] = await conn.query(
    'SELECT id FROM zhcc_product_category WHERE customer_code = ? AND is_default = 1 LIMIT 1',
    [customerCode]
  );
  if (rows.length > 0) return rows[0].id;
  const [result] = await conn.query(
    `INSERT INTO zhcc_product_category (customer_code, category_name, is_default, create_time, update_time)
     VALUES (?, ?, 1, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE is_default = 1, id = LAST_INSERT_ID(id)`,
    [customerCode, DEFAULT_CATEGORY_NAME]
  );
  return result.insertId;
}

/**
 * 把前端传来的 category_id 归一成「确实属于 customerCode 的类别 id」。
 * 空值、不存在、或属于别的客户，一律落到该客户的默认分类。
 */
async function resolveCategoryId(conn, customerCode, categoryId) {
  if (!customerCode) return null;
  const id = Number(categoryId);
  if (id > 0) {
    const [rows] = await conn.query(
      'SELECT id FROM zhcc_product_category WHERE id = ? AND customer_code = ?',
      [id, customerCode]
    );
    if (rows.length > 0) return rows[0].id;
  }
  return ensureDefaultCategory(conn, customerCode);
}

/** GET /categories?customer_code= —— 不传则返回全部客户的类别 */
router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const { customer_code } = req.query;
    if (customer_code) await ensureDefaultCategory(pool, customer_code);
    const params = [];
    let sql = `SELECT cat.*, c.customer_name,
                      (SELECT COUNT(*) FROM zhcc_product p WHERE p.category_id = cat.id) AS product_count
               FROM zhcc_product_category cat
               LEFT JOIN zhcc_customer c ON c.customer_code = cat.customer_code`;
    if (customer_code) {
      sql += ' WHERE cat.customer_code = ?';
      params.push(customer_code);
    }
    // 默认分类固定排在本客户第一位，其余按名称
    sql += ' ORDER BY cat.customer_code, cat.is_default DESC, cat.category_name';
    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', authMiddleware, async (req, res) => {
  try {
    const { customer_code, category_name } = req.body;
    if (!customer_code) return res.status(400).json({ error: '请选择所属客户' });
    const name = (category_name || '').trim();
    if (!name) return res.status(400).json({ error: '类别名称不能为空' });

    await ensureDefaultCategory(pool, customer_code);
    const [result] = await pool.query(
      `INSERT INTO zhcc_product_category (customer_code, category_name, is_default, create_time, update_time)
       VALUES (?, ?, 0, NOW(3), NOW(3))`,
      [customer_code, name]
    );
    res.json({ data: { id: result.insertId, customer_code, category_name: name, is_default: 0 } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '该客户下已有同名类别' });
    res.status(500).json({ error: err.message });
  }
});

/** PUT /categories/:id —— 只改名字。默认分类也允许改名，is_default 标记不变 */
router.put('/categories/:id', authMiddleware, async (req, res) => {
  try {
    const name = (req.body.category_name || '').trim();
    if (!name) return res.status(400).json({ error: '类别名称不能为空' });
    const [result] = await pool.query(
      'UPDATE zhcc_product_category SET category_name = ?, update_time = NOW(3) WHERE id = ?',
      [name, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: '类别不存在' });
    res.json({ data: { success: true } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '该客户下已有同名类别' });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /categories/:id —— 默认分类不可删；其余删除后，下属商品回落到默认分类 */
router.delete('/categories/:id', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM zhcc_product_category WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '类别不存在' });
    }
    const category = rows[0];
    if (category.is_default) {
      await conn.rollback();
      return res.status(400).json({ error: '默认分类不可删除' });
    }

    const fallbackId = await ensureDefaultCategory(conn, category.customer_code);
    const [moved] = await conn.query(
      'UPDATE zhcc_product SET category_id = ?, update_time = NOW(3) WHERE category_id = ?',
      [fallbackId, category.id]
    );
    await conn.query('DELETE FROM zhcc_product_category WHERE id = ?', [category.id]);
    await conn.commit();
    res.json({ data: { success: true, moved_to_default: moved.affectedRows } });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ===== 商品管理 CRUD =====

router.get('/products', authMiddleware, async (req, res) => {
  try {
    const { customer_code, category_id } = req.query;
    let sql = `SELECT p.*, c.customer_name, cat.category_name
               FROM zhcc_product p
               LEFT JOIN zhcc_customer c ON p.customer_code = c.customer_code
               LEFT JOIN zhcc_product_category cat ON cat.id = p.category_id`;
    const conditions = [];
    const params = [];
    if (customer_code) {
      conditions.push('p.customer_code = ?');
      params.push(customer_code);
    }
    if (category_id) {
      conditions.push('p.category_id = ?');
      params.push(category_id);
    }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY p.warehouse_code';
    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /products
 *
 * 建档时手填的初始库存视为「期初结存」，同步写一条 zhcc_product_backup。
 * 进出库明细的期初结存列只认这张备份表，不补这条记录的话，
 * 新商品导出时该列为空、整行结存链全为 0，手填的库存在报表上不体现。
 */
router.post('/products', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, category_id } = req.body;
    if (!warehouse_code) return res.status(400).json({ error: '缺少仓储商品号' });
    const openingQty = Number(stock_qty) || 0;

    await conn.beginTransaction();
    const categoryId = await resolveCategoryId(conn, customer_code, category_id);
    const [result] = await conn.query(
      `INSERT INTO zhcc_product
        (warehouse_code, customer_code, customer_product_code, product_name, spec, category_id, stock_qty, create_time, update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
      [warehouse_code, customer_code || '', customer_product_code || '', product_name || '', spec || '', categoryId, openingQty]
    );
    if (openingQty > 0) {
      await conn.query(
        `INSERT INTO zhcc_product_backup
          (backup_date, product_id, warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, frozen_qty, remark, create_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '建档期初', NOW(3))`,
        [localDateTime(), result.insertId, warehouse_code, customer_code || '', customer_product_code || '', product_name || '', spec || '', openingQty]
      );
    }
    await conn.commit();
    res.json({ data: { id: result.insertId, warehouse_code, customer_code, customer_product_code, product_name, spec, category_id: categoryId, stock_qty: openingQty } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '仓储商品号已存在' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * PUT /products/:id
 *
 * 两件容易被忽略的事：
 * 1. 类别按客户隔离，改挂客户时原 category_id 可能已不属于新客户，
 *    resolveCategoryId 会把这类情况落回新客户的默认分类。
 * 2. 商品在 zhcc_product_backup 里一条记录都没有时，补一条建档期初。
 *    期初结存列只认那张备份表，没有记录就导不出结存。这类商品有两个来源：
 *    「建档写期初」上线前建的存量商品，以及建档时填 0、事后才改结存的商品。
 *    只补「完全没有备份记录」的情况——已有记录说明发过货，那是历史快照，不能覆盖。
 */
router.put('/products/:id', authMiddleware, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, category_id } = req.body;
    const qty = Number(stock_qty) || 0;

    await conn.beginTransaction();
    const categoryId = await resolveCategoryId(conn, customer_code, category_id);
    await conn.query(
      `UPDATE zhcc_product SET
        warehouse_code = ?, customer_code = ?, customer_product_code = ?,
        product_name = ?, spec = ?, category_id = ?, stock_qty = ?, update_time = NOW(3)
       WHERE id = ?`,
      [warehouse_code, customer_code || '', customer_product_code || '', product_name || '', spec || '', categoryId, qty, req.params.id]
    );

    let backfilled = false;
    if (qty > 0) {
      const [had] = await conn.query(
        'SELECT 1 FROM zhcc_product_backup WHERE product_id = ? LIMIT 1',
        [req.params.id]
      );
      if (had.length === 0) {
        // backup_date 取建档时间而非当前时间，语义上这是「期初」而不是今天发生的变动
        await conn.query(
          `INSERT INTO zhcc_product_backup
            (backup_date, product_id, warehouse_code, customer_code, customer_product_code,
             product_name, spec, stock_qty, frozen_qty, remark, create_time)
           SELECT p.create_time, p.id, p.warehouse_code, p.customer_code, p.customer_product_code,
                  p.product_name, p.spec, p.stock_qty, 0, '建档期初(补录)', NOW(3)
           FROM zhcc_product p WHERE p.id = ?`,
          [req.params.id]
        );
        backfilled = true;
      }
    }

    await conn.commit();
    res.json({ data: { success: true, category_id: categoryId, opening_backfilled: backfilled } });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '仓储商品号已存在' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
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
 * GET /backup-candidates
 * 返回本月1日之前所有 active 冻结记录，按咨询批次分组，供前端选择
 */
router.get('/backup-candidates', authMiddleware, async (req, res) => {
  try {
    const currentMonthStart = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    const [rows] = await pool.query(
      `SELECT
         sf.inquiry_id,
         sf.batch_id,
         ir.inquiry_date,
         COALESCE(ir.downstream_customer_name, '未指定') AS downstream_customer_name,
         sf.product_id,
         p.warehouse_code,
         p.customer_code,
         p.customer_product_code,
         p.product_name,
         p.spec,
         SUM(sf.freeze_qty) AS freeze_qty,
         sf.freeze_date
       FROM zhcc_stock_freeze sf
       LEFT JOIN zhcc_inquiry_record ir ON sf.inquiry_id = ir.id
       LEFT JOIN zhcc_product p ON sf.product_id = p.id
       WHERE sf.status = 'active' AND sf.freeze_date < ? AND sf.inquiry_id IS NOT NULL
       GROUP BY sf.inquiry_id, sf.batch_id, ir.inquiry_date, ir.downstream_customer_name,
                sf.product_id, p.warehouse_code, p.customer_code, p.customer_product_code,
                p.product_name, p.spec, sf.freeze_date
       ORDER BY sf.batch_id, sf.inquiry_id`,
      [currentMonthStart]
    );

    const batchMap = new Map();
    for (const r of rows) {
      if (!batchMap.has(r.batch_id)) {
        batchMap.set(r.batch_id, {
          batch_id: r.batch_id,
          inquiry_date: r.inquiry_date,
          downstream_customer_name: r.downstream_customer_name,
          items: []
        });
      }
      batchMap.get(r.batch_id).items.push({
        inquiry_id: r.inquiry_id,
        product_id: r.product_id,
        warehouse_code: r.warehouse_code,
        customer_code: r.customer_code,
        customer_product_code: r.customer_product_code,
        product_name: r.product_name,
        spec: r.spec,
        freeze_qty: Number(r.freeze_qty) || 0,
        freeze_date: r.freeze_date
      });
    }

    res.json({
      data: {
        freeze_before: currentMonthStart,
        batches: Array.from(batchMap.values())
      }
    });
  } catch (err) {
    console.error('[BACKUP CANDIDATES ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /backup
 * 1. 根据前端传入的 selected_inquiry_ids 找到关联的 active 冻结记录
 * 2. 将选中的 active 冻结记录标记为 shipped（已发货）
 * 3. 按商品汇总扣减 stock_qty
 * 4. 将处理后的商品数据写入 zhcc_product_backup 表
 */
router.post('/backup', authMiddleware, async (req, res) => {
  const { selected_inquiry_ids } = req.body;
  if (!Array.isArray(selected_inquiry_ids) || selected_inquiry_ids.length === 0) {
    return res.status(400).json({ error: '请至少选择一条需要备份的记录' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const backupDate = localDateTime();

    // 本月1日作为截止线：只处理在此日期之前的 active 冻结记录
    const currentMonthStart = localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    // 1. 查询选中的咨询记录关联的 active 冻结记录，按商品汇总
    const [freezeRows] = await conn.query(
      `SELECT product_id, COALESCE(SUM(freeze_qty), 0) AS total_frozen
       FROM zhcc_stock_freeze
       WHERE inquiry_id IN (?) AND status = 'active' AND freeze_date < ?
       GROUP BY product_id`,
      [selected_inquiry_ids, currentMonthStart]
    );

    if (freezeRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: '选中的记录在截止线之前没有可发货的冻结库存' });
    }

    // 2. 将选中的冻结记录标记为 shipped
    await conn.query(
      `UPDATE zhcc_stock_freeze
       SET status = 'shipped', update_time = NOW(3)
       WHERE inquiry_id IN (?) AND status = 'active' AND freeze_date < ?`,
      [selected_inquiry_ids, currentMonthStart]
    );

    // 3. 按商品扣减结存并写入备份表
    let totalBackedUp = 0;
    let totalReleased = 0;

    for (const row of freezeRows) {
      const productId = row.product_id;
      const frozenQty = Number(row.total_frozen) || 0;
      if (frozenQty <= 0) continue;

      const [productRows] = await conn.query('SELECT * FROM zhcc_product WHERE id = ?', [productId]);
      if (productRows.length === 0) continue;
      const product = productRows[0];

      const newStockQty = product.stock_qty - frozenQty;

      await conn.query(
        'UPDATE zhcc_product SET stock_qty = ?, update_time = NOW(3) WHERE id = ?',
        [newStockQty, product.id]
      );

      await conn.query(
        `INSERT INTO zhcc_product_backup
          (backup_date, product_id, warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty, frozen_qty, create_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
        [backupDate, product.id, product.warehouse_code, product.customer_code, product.customer_product_code, product.product_name, product.spec, newStockQty, frozenQty]
      );

      totalBackedUp++;
      totalReleased += frozenQty;
    }

    await conn.commit();
    res.json({
      data: {
        success: true,
        backup_date: backupDate,
        freeze_before: currentMonthStart,
        total_products: totalBackedUp,
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
