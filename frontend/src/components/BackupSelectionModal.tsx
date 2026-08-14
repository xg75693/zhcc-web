import { useState, useMemo } from 'react';
import type { BackupCandidates, BackupCandidateBatch } from '../services/adminApi.ts';

interface Props {
  candidates: BackupCandidates;
  onConfirm: (selectedInquiryIds: number[]) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function BackupSelectionModal({ candidates, onConfirm, onCancel, loading }: Props) {
  const allIds = useMemo(() => {
    const ids: number[] = [];
    for (const b of candidates.batches) {
      for (const item of b.items) ids.push(item.inquiry_id);
    }
    return ids;
  }, [candidates]);

  const [selected, setSelected] = useState<Set<number>>(new Set(allIds));
  const [expanded, setExpanded] = useState<Set<string>>(new Set(candidates.batches.map(b => b.batch_id)));

  const toggleBatch = (batch: BackupCandidateBatch) => {
    const batchIds = batch.items.map(i => i.inquiry_id);
    const allSelected = batchIds.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) {
      batchIds.forEach(id => next.delete(id));
    } else {
      batchIds.forEach(id => next.add(id));
    }
    setSelected(next);
  };

  const toggleItem = (inquiryId: number) => {
    const next = new Set(selected);
    if (next.has(inquiryId)) next.delete(inquiryId);
    else next.add(inquiryId);
    setSelected(next);
  };

  const toggleExpand = (batchId: string) => {
    const next = new Set(expanded);
    if (next.has(batchId)) next.delete(batchId);
    else next.add(batchId);
    setExpanded(next);
  };

  const totalQty = useMemo(() => {
    let qty = 0;
    for (const b of candidates.batches) {
      for (const item of b.items) {
        if (selected.has(item.inquiry_id)) qty += item.freeze_qty;
      }
    }
    return qty;
  }, [candidates, selected]);

  return (
    <div className="backup-overlay">
      <div className="backup-confirm-modal backup-selection-modal">
        <h3>一键备份 - 选择要发货的记录</h3>
        <p className="backup-warning">
          截止线：<code>{candidates.freeze_before}</code> 之前的 active 冻结记录。
          默认全部选中，可取消不需要发货的批次或商品。
        </p>

        <div className="backup-selection-summary">
          已选 <strong>{selected.size}</strong> 条记录，合计冻结 <strong>{totalQty}</strong>
        </div>

        <div className="backup-selection-list">
          {candidates.batches.map(batch => {
            const batchIds = batch.items.map(i => i.inquiry_id);
            const checkedCount = batchIds.filter(id => selected.has(id)).length;
            const isIndeterminate = checkedCount > 0 && checkedCount < batchIds.length;
            const isChecked = checkedCount === batchIds.length && batchIds.length > 0;
            const isExpanded = expanded.has(batch.batch_id);

            return (
              <div key={batch.batch_id} className="backup-batch">
                <div className="backup-batch-header">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                    onChange={() => toggleBatch(batch)}
                  />
                  <span className="backup-batch-toggle" onClick={() => toggleExpand(batch.batch_id)}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="backup-batch-title">
                    {batch.inquiry_date} · {batch.downstream_customer_name}
                    <span className="backup-batch-count">（{checkedCount}/{batchIds.length}）</span>
                  </span>
                </div>

                {isExpanded && (
                  <div className="backup-batch-items">
                    {batch.items.map(item => (
                      <label key={item.inquiry_id} className="backup-item">
                        <input
                          type="checkbox"
                          checked={selected.has(item.inquiry_id)}
                          onChange={() => toggleItem(item.inquiry_id)}
                        />
                        <span className="backup-item-info">
                          <span className="backup-item-code">{item.warehouse_code}</span>
                          <span className="backup-item-name">{item.product_name}</span>
                          <span className="backup-item-qty">冻结：{item.freeze_qty}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="backup-actions">
          <button className="btn-cancel" onClick={onCancel} disabled={loading}>取消</button>
          <button
            className="btn-danger-confirm"
            onClick={() => onConfirm(Array.from(selected))}
            disabled={loading || selected.size === 0}
          >
            {loading ? '备份中...' : `确认备份（${selected.size}条）`}
          </button>
        </div>
      </div>
    </div>
  );
}
