import { useState, useMemo, useEffect } from 'react';
import SearchableSelect from './SearchableSelect.tsx';
import {
  fetchAdminProducts, updateAdminInquiryBatch,
  type AdminInquiryRecord, type AdminProduct, type InquiryBatchFailure,
} from '../services/adminApi.ts';

interface BatchLike {
  batch_id: string;
  inquiry_date: string;
  customer_code: string;
  customer_name: string;
  downstream_customer_name: string;
  items: AdminInquiryRecord[];
}

interface Props {
  batch: BatchLike;
  onClose: (saved: boolean) => void;
}

/** 编辑中的一行；qty 用字符串，避免清空时被 Number('') 变成 0 */
interface DraftRow {
  key: string;
  product_id: number;
  warehouse_code: string;
  product_name: string;
  customer_product_code: string;
  qty: string;
}

/**
 * 咨询记录整单编辑。
 *
 * 可以改数量、删掉某个商品、追加新商品，一次性提交这单最终的商品清单。
 * 保存时后端会对全部商品重做可订性判定——全部可订才落库，
 * 有一项不足就整单拒绝并回传缺口，不做部分保存。
 */
export default function InquiryBatchEditModal({ batch, onClose }: Props) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    batch.items.map(it => ({
      key: `old-${it.id}`,
      product_id: it.product_id,
      warehouse_code: it.warehouse_code,
      product_name: it.product_name || '',
      customer_product_code: it.customer_product_code || '',
      qty: String(it.request_qty ?? ''),
    }))
  );
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [addPick, setAddPick] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [failures, setFailures] = useState<InquiryBatchFailure[]>([]);

  useEffect(() => {
    fetchAdminProducts(batch.customer_code).then(setProducts).catch(() => {});
  }, [batch.customer_code]);

  const usedIds = useMemo(() => new Set(rows.map(r => r.product_id)), [rows]);

  // 已在单据里的商品不再出现在「添加」下拉中，从源头避免重复行
  const addOptions = useMemo(
    () => products
      .filter(p => !usedIds.has(p.id))
      .map(p => ({
        value: String(p.id),
        label: `${p.customer_product_code || p.warehouse_code}　${p.product_name || ''}`,
        keywords: `${p.warehouse_code} ${p.spec || ''}`,
      })),
    [products, usedIds]
  );

  const setQty = (key: string, v: string) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, qty: v } : r)));

  const removeRow = (key: string) => setRows(rs => rs.filter(r => r.key !== key));

  const addRow = (productIdStr: string) => {
    const p = products.find(x => String(x.id) === productIdStr);
    if (!p) return;
    setRows(rs => [...rs, {
      key: `new-${p.id}`,
      product_id: p.id,
      warehouse_code: p.warehouse_code,
      product_name: p.product_name || '',
      customer_product_code: p.customer_product_code || '',
      qty: '1',
    }]);
    setAddPick('');
    setFailures([]);
  };

  const invalidQty = rows.some(r => {
    const n = Number(r.qty);
    return !Number.isInteger(n) || n <= 0;
  });

  const origin = useMemo(
    () => new Map(batch.items.map(it => [it.product_id, it.request_qty])),
    [batch.items]
  );
  const dirty = rows.length !== batch.items.length
    || rows.some(r => origin.get(r.product_id) !== Number(r.qty));

  const handleSave = async () => {
    if (rows.length === 0) return setError('至少保留一个商品，若要清空请直接删除整单');
    if (invalidQty) return setError('订货数量必须是大于 0 的整数');

    const removedNames = batch.items
      .filter(it => !rows.some(r => r.product_id === it.product_id))
      .map(it => it.product_name || it.warehouse_code);
    const addedNames = rows
      .filter(r => !origin.has(r.product_id))
      .map(r => r.product_name || r.warehouse_code);
    const changed = rows
      .filter(r => origin.has(r.product_id) && origin.get(r.product_id) !== Number(r.qty))
      .map(r => `${r.product_name || r.warehouse_code}：${origin.get(r.product_id)} → ${r.qty}`);

    const summary = [
      addedNames.length ? `新增 ${addedNames.length} 项：${addedNames.join('、')}` : null,
      removedNames.length ? `删除 ${removedNames.length} 项：${removedNames.join('、')}` : null,
      changed.length ? `数量调整：\n  ${changed.join('\n  ')}` : null,
    ].filter(Boolean).join('\n');

    if (!confirm(`确认保存对这单咨询记录的修改？\n\n${summary}\n\n保存后相关商品的冻结数量会按新清单重算。`)) return;

    setSaving(true); setError(''); setFailures([]);
    try {
      await updateAdminInquiryBatch(
        batch.batch_id,
        rows.map(r => ({ product_id: r.product_id, request_qty: Number(r.qty) }))
      );
      onClose(true);
    } catch (e) {
      const err = e as Error & { details?: InquiryBatchFailure[] };
      setError(err.message || '保存失败');
      if (Array.isArray(err.details)) setFailures(err.details);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="backup-overlay" onClick={() => !saving && onClose(false)}>
      <div className="backup-confirm-modal batch-edit-modal" onClick={e => e.stopPropagation()}>
        <h3>编辑咨询记录</h3>

        <div className="batch-edit-meta">
          <div><span>客户</span>{batch.customer_name}</div>
          <div><span>收货单位</span>{batch.downstream_customer_name || '-'}</div>
          <div><span>咨询日期</span>{new Date(batch.inquiry_date).toLocaleDateString('zh-CN')}</div>
        </div>

        {error && (
          <div className="category-error">
            {error}
            {failures.length > 0 && (
              <ul className="batch-edit-failures">
                {failures.map(f => (
                  <li key={f.product_id}>
                    {f.product_name || f.warehouse_code || `商品#${f.product_id}`}：{f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <table className="batch-edit-table">
          <thead>
            <tr>
              <th>客户商品编号</th>
              <th>商品名称</th>
              <th className="col-qty">订货数量</th>
              <th className="col-op"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const bad = failures.some(f => f.product_id === r.product_id);
              const n = Number(r.qty);
              const qtyBad = !Number.isInteger(n) || n <= 0;
              return (
                <tr key={r.key} className={bad ? 'row-fail' : ''}>
                  <td><code>{r.customer_product_code || r.warehouse_code}</code></td>
                  <td title={r.product_name}>{r.product_name || '-'}</td>
                  <td>
                    <input
                      className={`cell-input cell-input-num${qtyBad ? ' cell-input-error' : ''}`}
                      type="number"
                      min={1}
                      step={1}
                      value={r.qty}
                      onFocus={e => e.target.select()}
                      onChange={e => { setQty(r.key, e.target.value); setFailures([]); }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-sm btn-danger"
                      title="从本单移除该商品"
                      onClick={() => { removeRow(r.key); setFailures([]); }}
                    >移除</button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="empty-row">已移除全部商品，请添加或直接删除整单</td></tr>
            )}
          </tbody>
        </table>

        <div className="batch-edit-add">
          <SearchableSelect
            className="batch-edit-picker"
            options={addOptions}
            value={addPick}
            onChange={addRow}
            placeholder="添加商品（可检索编号/名称/规格）"
          />
        </div>

        <p className="inquiry-edit-hint">
          保存时会对全部商品重新判定可订性，只要有一项超出可用结余就整单不保存。
        </p>

        <div className="backup-actions">
          <button className="btn-sm" onClick={() => onClose(false)} disabled={saving}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty || invalidQty || rows.length === 0}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
