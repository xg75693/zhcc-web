import XLSX from 'xlsx';
import pool from '../config/db.js';
import { chatCompletion, extractJsonFromMarkdown } from './zhipuService.js';

function cellToRowCol(cell) {
  const match = cell.match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new Error(`非法单元格地址: ${cell}`);
  const colLetters = match[1].toUpperCase();
  let col = 0;
  for (const ch of colLetters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(match[2], 10), col };
}

function getCellValue(ws, cell) {
  const addr = XLSX.utils.decode_cell(cell);
  const ref = XLSX.utils.encode_cell(addr);
  return ws[ref]?.v ?? null;
}

function getCellText(ws, cell) {
  const val = getCellValue(ws, cell);
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function normalizeQty(val, treatEmptyAsZero) {
  if (val === null || val === undefined || val === '') {
    return treatEmptyAsZero ? 0 : null;
  }
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function parseExcelByRule(buffer, rule) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[rule.sheet_index || 0]];
  if (!ws) throw new Error('Excel 中找不到指定工作表');

  // 收货单位原始文本
  const downstreamTextParts = [getCellText(ws, rule.downstream_name_cell)];
  if (rule.downstream_name_extra_cells) {
    for (const cell of rule.downstream_name_extra_cells.split(',')) {
      const text = getCellText(ws, cell.trim());
      if (text) downstreamTextParts.push(text);
    }
  }
  const downstreamRawText = downstreamTextParts.join('\n');

  // 商品读取
  const start = cellToRowCol(rule.product_code_start_cell);
  const qtyCol = start.col + (rule.quantity_column_offset || 1);
  const endMarker = rule.end_marker || '合计';
  const treatEmptyAsZero = rule.empty_value_treat_as_zero === 1;

  const rows = [];
  const maxRow = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e.r + 1 : 1000;

  for (let r = start.row; r <= maxRow; r++) {
    const codeCell = XLSX.utils.encode_cell({ r: r - 1, c: start.col - 1 });
    const codeVal = ws[codeCell]?.v;
    if (codeVal === null || codeVal === undefined || String(codeVal).trim() === '') continue;

    const codeText = String(codeVal).trim();
    // 遇到结束标记停止
    if (codeText.includes(endMarker) || codeText.toLowerCase().includes('total')) break;

    const qtyCell = XLSX.utils.encode_cell({ r: r - 1, c: qtyCol - 1 });
    const qtyVal = ws[qtyCell]?.v;
    const qty = normalizeQty(qtyVal, treatEmptyAsZero);

    rows.push({ row: r, code: codeText, qty });
  }

  return { downstreamRawText, rows };
}

export async function matchDownstreamCustomer(rawText, existingCustomers) {
  const names = existingCustomers.map(d => `- ID=${d.id}, 名称="${d.downstream_name}"`).join('\n');
  const prompt = `你是仓储系统的客户名称匹配助手。请根据下面从 Excel 中提取到的收货单位信息，判断它对应下面已有收货单位中的哪一个；如果没有明显匹配的，请判断为需要新建。

从 Excel 提取到的客户信息：
"""
${rawText}
"""

已有收货单位列表：
${names || '（无）'}

请严格返回 JSON 格式，不要包含其他解释文字：
{
  "downstream_name": "提取/标准化后的客户名称",
  "matched_id": 匹配到的已有客户ID（没有则填 null）,
  "confidence": "high/medium/low",
  "is_new": true/false,
  "reason": "简短匹配理由"
}`;

  try {
    const content = await chatCompletion([
      { role: 'system', content: '你只会返回 JSON，不做额外解释。' },
      { role: 'user', content: prompt }
    ]);
    const parsed = extractJsonFromMarkdown(content);
    if (!parsed || typeof parsed !== 'object') {
      return { downstream_name: rawText.replace(/\n/g, ' '), matched_id: null, confidence: 'low', is_new: true, reason: '模型返回非 JSON，降级为新建' };
    }
    return {
      downstream_name: parsed.downstream_name || rawText.replace(/\n/g, ' '),
      matched_id: parsed.matched_id || null,
      confidence: parsed.confidence || 'low',
      is_new: parsed.is_new === true || parsed.confidence === 'low',
      reason: parsed.reason || ''
    };
  } catch (err) {
    console.error('[LLM match error]', err);
    return { downstream_name: rawText.replace(/\n/g, ' '), matched_id: null, confidence: 'low', is_new: true, reason: '模型调用失败，降级为新建' };
  }
}

export async function createDownstreamCustomerIfNeeded(customerCode, name) {
  const [existing] = await pool.query(
    'SELECT id FROM zhcc_downstream_customer WHERE customer_code = ? AND downstream_name = ? LIMIT 1',
    [customerCode, name]
  );
  if (existing.length > 0) return existing[0];

  const [result] = await pool.query(
    'INSERT INTO zhcc_downstream_customer (customer_code, downstream_name, create_time, update_time) VALUES (?, ?, NOW(3), NOW(3))',
    [customerCode, name]
  );
  return { id: result.insertId };
}

export async function matchProducts(rows, customerCode) {
  const [products] = await pool.query(
    'SELECT id, warehouse_code, customer_product_code, product_name, spec FROM zhcc_product WHERE customer_code = ?',
    [customerCode]
  );
  const productMap = new Map();
  for (const p of products) {
    productMap.set(p.customer_product_code, p);
  }

  const items = [];
  const unmatchedItems = [];

  for (const row of rows) {
    if (row.qty === null || row.qty === undefined || row.qty === 0) continue;
    const product = productMap.get(row.code);
    if (!product) {
      unmatchedItems.push({ code: row.code, qty: row.qty, reason: '未找到对应商品' });
      continue;
    }
    items.push({
      customer_product_code: product.customer_product_code,
      warehouse_code: product.warehouse_code,
      product_name: product.product_name,
      spec: product.spec,
      request_qty: row.qty
    });
  }

  return { items, unmatchedItems };
}
