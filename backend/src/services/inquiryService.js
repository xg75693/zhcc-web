import pool from '../config/db.js';
import { randomUUID } from 'crypto';

// ===== 暂存待确认的咨询批次（内存） =====
const pendingBatches = new Map();

/**
 * 提交咨询（仅预计算，不写库不冻结）
 */
export async function processBatchInquiry({ customer_code, downstream_customer_id, downstream_customer_name, items, inquiry_date }) {
  const conn = await pool.getConnection();
  try {
    const batch_id = randomUUID();

    // ===== 计算每个商品的结余 =====
    const evaluations = [];
    for (const item of items) {
      const { customer_product_code, request_qty } = item;

      const [products] = await conn.query(
        'SELECT * FROM zhcc_product WHERE customer_code = ? AND customer_product_code = ?',
        [customer_code, customer_product_code]
      );
      if (products.length === 0) {
        evaluations.push({
          customer_product_code,
          request_qty,
          product: null,
          stock_qty: 0,
          frozen_qty: 0,
          available_qty: 0,
          passed: false,
          error_text: `未找到商品: 客户商品编号 ${customer_product_code}`
        });
        continue;
      }
      const product = products[0];

      const [freezeResult] = await conn.query(
        'SELECT COALESCE(SUM(freeze_qty), 0) as total_frozen FROM zhcc_stock_freeze WHERE product_id = ? AND status = ?',
        [product.id, 'active']
      );
      const frozen_qty = freezeResult[0].total_frozen;
      const stock_qty = product.stock_qty;
      const available_qty = stock_qty - frozen_qty;
      const passed = available_qty >= request_qty;

      evaluations.push({
        customer_product_code,
        request_qty,
        product,
        stock_qty,
        frozen_qty,
        available_qty,
        passed
      });
    }

    // ===== 整体判断 =====
    const allPassed = evaluations.every(e => e.passed);
    const batch_result = allPassed ? 'approved' : 'rejected';

    // ===== 构造返回结果（不写库） =====
    const results = [];
    for (const ev of evaluations) {
      const itemResult = ev.passed ? 'approved' : 'rejected';
      const itemResultText = ev.error_text
        ? ev.error_text
        : ev.passed
          ? (allPassed ? '可以订货，待确认冻结' : '可以订货（但批次整体不可订）')
          : `不可订货，可用结余 ${ev.available_qty}，订货数量 ${ev.request_qty}`;

      results.push({
        customer_code,
        customer_product_code: ev.customer_product_code,
        warehouse_code: ev.product?.warehouse_code,
        product_name: ev.product?.product_name,
        spec: ev.product?.spec,
        request_qty: ev.request_qty,
        stock_qty: ev.stock_qty,
        frozen_qty: ev.frozen_qty,
        available_qty: ev.available_qty,
        result: itemResult,
        result_text: itemResultText,
        inquiry_date
      });
    }

    // ===== 暂存待确认批次 =====
    pendingBatches.set(batch_id, {
      customer_code,
      downstream_customer_id,
      downstream_customer_name,
      evaluations,
      inquiry_date,
      batch_result,
      items: results,
    });

    // 10分钟自动过期
    setTimeout(() => pendingBatches.delete(batch_id), 10 * 60 * 1000);

    return {
      batch_id,
      batch_result,
      batch_result_text: allPassed
        ? '全部商品可订货，请确认以执行冻结'
        : '本次咨询整体不可订货，存在商品库存结余不足，需先入库补仓',
      downstream_customer_name,
      inquiry_date,
      items: results
    };
  } finally {
    conn.release();
  }
}

/**
 * 确认咨询 → 写入记录 + 冻结库存
 */
export async function confirmBatch(batch_id) {
  const pending = pendingBatches.get(batch_id);
  if (!pending) throw new Error('咨询批次不存在或已过期，请重新咨询');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { customer_code, downstream_customer_id, downstream_customer_name, evaluations, inquiry_date, batch_result } = pending;
    const allPassed = batch_result === 'approved';

    const results = [];
    for (const ev of evaluations) {
      const itemResult = ev.passed ? 'approved' : 'rejected';
      const itemResultText = ev.error_text
        ? ev.error_text
        : ev.passed
          ? (allPassed ? '可以订货，已临时冻结' : '可以订货（但批次整体不可订，未冻结）')
          : `不可订货，可用结余 ${ev.available_qty}，订货数量 ${ev.request_qty}`;

      let inquiry_id = null;
      if (ev.product) {
        const [inquiryResult] = await conn.query(
          `INSERT INTO zhcc_inquiry_record 
            (batch_id, customer_code, downstream_customer_id, downstream_customer_name, product_id, warehouse_code, customer_product_code, product_name, request_qty, stock_qty, frozen_qty, available_qty, result, batch_result, inquiry_date, create_time, update_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
          [batch_id, customer_code, downstream_customer_id || null, downstream_customer_name || null, ev.product.id, ev.product.warehouse_code, ev.customer_product_code, ev.product.product_name, ev.request_qty, ev.stock_qty, ev.frozen_qty, ev.available_qty, itemResult, batch_result, inquiry_date]
        );
        inquiry_id = inquiryResult.insertId;

        // 全部通过时执行冻结
        if (allPassed) {
          await conn.query(
            `INSERT INTO zhcc_stock_freeze 
              (product_id, warehouse_code, customer_code, freeze_qty, inquiry_id, batch_id, freeze_date, status, create_time, update_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NOW(3), NOW(3))`,
            [ev.product.id, ev.product.warehouse_code, customer_code, ev.request_qty, inquiry_id, batch_id, inquiry_date]
          );
        }
      }

      results.push({
        inquiry_id,
        customer_product_code: ev.customer_product_code,
        result: itemResult,
        result_text: itemResultText,
      });
    }

    await conn.commit();
    pendingBatches.delete(batch_id);

    return { batch_id, batch_result, confirmed: true, items: results };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 取消咨询 → 丢弃暂存
 */
export async function cancelBatch(batch_id) {
  const existed = pendingBatches.has(batch_id);
  pendingBatches.delete(batch_id);
  return { batch_id, cancelled: true, wasPending: existed };
}

/**
 * 获取咨询历史记录
 */
export async function getInquiryHistory({ page = 1, pageSize = 20, customer_code, inquiry_date, month }) {
  let where = '1=1';
  const params = [];

  if (customer_code) {
    where += ' AND ir.customer_code = ?';
    params.push(customer_code);
  }
  if (inquiry_date) {
    where += ' AND ir.inquiry_date = ?';
    params.push(inquiry_date);
  }
  if (month) {
    where += " AND DATE_FORMAT(ir.inquiry_date, '%Y-%m') = ?";
    params.push(month);
  }

  const offset = (page - 1) * pageSize;

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM zhcc_inquiry_record ir WHERE ${where}`,
    params
  );
  const total = countResult[0].total;

  const [records] = await pool.query(
    `SELECT ir.*, c.customer_name 
     FROM zhcc_inquiry_record ir
     LEFT JOIN zhcc_customer c ON ir.customer_code = c.customer_code
     WHERE ${where}
     ORDER BY ir.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return { records, total, page, pageSize };
}

/**
 * 收货单位 CRUD
 */
export async function getDownstreamCustomers(customerCode) {
  let sql = 'SELECT * FROM zhcc_downstream_customer';
  const params = [];
  if (customerCode) {
    sql += ' WHERE customer_code = ?';
    params.push(customerCode);
  }
  sql += ' ORDER BY id DESC';
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function createDownstreamCustomer({ customer_code, downstream_name, downstream_contact, downstream_phone }) {
  const [result] = await pool.query(
    `INSERT INTO zhcc_downstream_customer 
      (customer_code, downstream_name, downstream_contact, downstream_phone, create_time, update_time)
     VALUES (?, ?, ?, ?, NOW(3), NOW(3))`,
    [customer_code, downstream_name, downstream_contact || null, downstream_phone || null]
  );
  return { id: result.insertId, customer_code, downstream_name, downstream_contact, downstream_phone };
}

export async function deleteDownstreamCustomer(id) {
  await pool.query('DELETE FROM zhcc_downstream_customer WHERE id = ?', [id]);
}
