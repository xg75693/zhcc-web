import { Router } from 'express';
import { processBatchInquiry, confirmBatch, cancelBatch, getInquiryHistory, getDownstreamCustomers, createDownstreamCustomer, deleteDownstreamCustomer } from '../services/inquiryService.js';

const router = Router();

// 提交订货咨询（批量商品，整体判断）
router.post('/', async (req, res) => {
  try {
    const { customer_code, downstream_customer_id, downstream_customer_name, items, inquiry_date } = req.body;

    if (!customer_code) {
      return res.status(400).json({ error: '缺少必填参数: customer_code' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '请至少选择一个商品' });
    }
    if (!downstream_customer_name) {
      return res.status(400).json({ error: '请选择或输入收货单位' });
    }
    for (const item of items) {
      if (!item.customer_product_code) {
        return res.status(400).json({ error: '商品缺少 customer_product_code' });
      }
      if (typeof item.request_qty !== 'number' || item.request_qty <= 0) {
        return res.status(400).json({ error: `商品 ${item.customer_product_code} 的订货数量必须为正整数` });
      }
    }

    const results = await processBatchInquiry({
      customer_code,
      downstream_customer_id,
      downstream_customer_name,
      items,
      inquiry_date: inquiry_date || new Date().toISOString().slice(0, 10)
    });

    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 确认咨询（写入记录 + 冻结库存）
router.post('/confirm/:batch_id', async (req, res) => {
  try {
    const result = await confirmBatch(req.params.batch_id);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取消咨询（丢弃暂存）
router.post('/cancel/:batch_id', async (req, res) => {
  try {
    const result = await cancelBatch(req.params.batch_id);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取咨询历史记录
router.get('/history', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, customer_code, inquiry_date, month } = req.query;
    const result = await getInquiryHistory({
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      customer_code,
      inquiry_date,
      month
    });
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 收货单位列表
router.get('/downstream-customers', async (req, res) => {
  try {
    const { customer_code } = req.query;
    const rows = await getDownstreamCustomers(customer_code);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增收货单位
router.post('/downstream-customers', async (req, res) => {
  try {
    const { customer_code, downstream_name, downstream_contact, downstream_phone } = req.body;
    if (!customer_code || !downstream_name) {
      return res.status(400).json({ error: '缺少必填参数: customer_code, downstream_name' });
    }
    const result = await createDownstreamCustomer({ customer_code, downstream_name, downstream_contact, downstream_phone });
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除收货单位
router.delete('/downstream-customers/:id', async (req, res) => {
  try {
    await deleteDownstreamCustomer(parseInt(req.params.id));
    res.json({ data: { success: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
