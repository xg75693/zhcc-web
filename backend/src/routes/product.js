import { Router } from 'express';
import pool from '../config/db.js';

const router = Router();

// 获取客户列表
router.get('/customers', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, customer_code, customer_name FROM zhcc_customer ORDER BY customer_code'
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取商品列表（支持按客户筛选）
router.get('/products', async (req, res) => {
  try {
    const { customer_code } = req.query;
    let sql = 'SELECT id, warehouse_code, customer_code, customer_product_code, product_name, spec, stock_qty FROM zhcc_product';
    const params = [];

    if (customer_code) {
      sql += ' WHERE customer_code = ?';
      params.push(customer_code);
    }
    sql += ' ORDER BY warehouse_code';

    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取单个商品的冻结信息
router.get('/products/:warehouse_code/freeze-info', async (req, res) => {
  try {
    const { warehouse_code } = req.params;
    const [products] = await pool.query(
      'SELECT id, stock_qty FROM zhcc_product WHERE warehouse_code = ?',
      [warehouse_code]
    );
    if (products.length === 0) {
      return res.status(404).json({ error: '商品不存在' });
    }

    const [freezeResult] = await pool.query(
      'SELECT COALESCE(SUM(freeze_qty), 0) as total_frozen FROM zhcc_stock_freeze WHERE product_id = ? AND status = ?',
      [products[0].id, 'active']
    );

    res.json({
      data: {
        warehouse_code,
        stock_qty: products[0].stock_qty,
        frozen_qty: freezeResult[0].total_frozen,
        available_qty: products[0].stock_qty - freezeResult[0].total_frozen
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
