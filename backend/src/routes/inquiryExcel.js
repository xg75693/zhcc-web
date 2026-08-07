import { Router } from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import {
  parseExcelByRule,
  matchDownstreamCustomer,
  createDownstreamCustomerIfNeeded,
  matchProducts
} from '../services/excelParseService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/parse', upload.single('file'), async (req, res) => {
  try {
    const customerCode = req.body.customer_code;
    if (!customerCode) {
      return res.status(400).json({ error: '缺少客户编号' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '缺少上传文件' });
    }

    // 读取默认规则
    const [rules] = await pool.query(
      'SELECT * FROM zhcc_excel_parse_rule WHERE customer_code = ? AND is_default = 1 LIMIT 1',
      [customerCode]
    );
    if (rules.length === 0) {
      return res.status(400).json({ error: '该客户未配置 Excel 解析规则，请先前往管理后台配置' });
    }
    const rule = rules[0];

    // 解析 Excel
    const { downstreamRawText, rows } = parseExcelByRule(req.file.buffer, rule);

    // 查询已有收货单位
    const [existingCustomers] = await pool.query(
      'SELECT id, downstream_name FROM zhcc_downstream_customer WHERE customer_code = ?',
      [customerCode]
    );

    // LLM 匹配收货单位
    const matchResult = await matchDownstreamCustomer(downstreamRawText, existingCustomers);

    let downstreamCustomer = null;
    let unmatchedDownstreamHint = null;

    if (matchResult.matched_id && !matchResult.is_new) {
      const [found] = await pool.query(
        'SELECT id, downstream_name FROM zhcc_downstream_customer WHERE id = ?',
        [matchResult.matched_id]
      );
      if (found.length > 0) downstreamCustomer = found[0];
    }

    if (!downstreamCustomer) {
      // 新建收货单位
      const created = await createDownstreamCustomerIfNeeded(customerCode, matchResult.downstream_name);
      downstreamCustomer = { id: created.id, downstream_name: matchResult.downstream_name };
      unmatchedDownstreamHint = `已根据 Excel 内容新建收货单位：${matchResult.downstream_name}（${matchResult.reason}）`;
    } else if (matchResult.is_new) {
      unmatchedDownstreamHint = `模型判断为新建客户：${matchResult.downstream_name}（${matchResult.reason}）`;
    }

    // 匹配商品
    const { items, unmatchedItems } = await matchProducts(rows, customerCode);

    res.json({
      data: {
        downstream_customer: downstreamCustomer,
        unmatched_downstream_hint: unmatchedDownstreamHint,
        items,
        unmatched_items: unmatchedItems,
        rule
      }
    });
  } catch (err) {
    console.error('[PARSE EXCEL ERROR]', err);
    res.status(500).json({ error: err.message || 'Excel 解析失败' });
  }
});

export default router;
