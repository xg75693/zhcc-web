import { useState } from 'react';
import type { BatchInquiryResult, InquiryResultItem } from '../types/index.ts';

function ResultCard({ item, batchApproved }: { item: InquiryResultItem; batchApproved: boolean }) {
  const isApproved = item.result === 'approved';

  return (
    <div className={`result-card ${isApproved ? 'approved' : 'rejected'}`}>
      <div className="result-header">
        <span className="result-icon">{isApproved ? '✓' : '✗'}</span>
        <span className="result-text">{item.result_text}</span>
      </div>
      <div className="result-details">
        <div className="detail-row">
          <span className="label">客户商品编号:</span>
          <span>{item.customer_product_code}</span>
        </div>
        {item.product_name && (
          <div className="detail-row">
            <span className="label">商品:</span>
            <span>{item.product_name} {item.spec ? `(${item.spec})` : ''}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="label">订货数量:</span>
          <span>{item.request_qty}</span>
        </div>
        {item.stock_qty !== undefined && (
          <>
            <div className="detail-row">
              <span className="label">商品库存:</span>
              <span>{item.stock_qty}</span>
            </div>
            <div className="detail-row">
              <span className="label">冻结数量:</span>
              <span>{item.frozen_qty}</span>
            </div>
            <div className="detail-row highlight">
              <span className="label">实时库存:</span>
              <span className="available-qty">{item.available_qty}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  result: BatchInquiryResult;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function InquiryResultList({ result, onConfirm, onCancel }: Props) {
  const [loading, setLoading] = useState<'confirm' | 'cancel' | null>(null);
  const isAllApproved = result.batch_result === 'approved';
  const approvedCount = result.items.filter(r => r.result === 'approved').length;
  const rejectedCount = result.items.filter(r => r.result === 'rejected').length;

  const handleConfirm = async () => {
    setLoading('confirm');
    try { await onConfirm(); } finally { setLoading(null); }
  };

  const handleCancel = async () => {
    setLoading('cancel');
    try { await onCancel(); } finally { setLoading(null); }
  };

  return (
    <div className={`batch-result-card ${isAllApproved ? 'batch-approved' : 'batch-rejected'}`}>
      <div className="batch-header">
        <span className="batch-icon">{isAllApproved ? '✓' : '✗'}</span>
        <div>
          <div className="batch-title">{result.batch_result_text}</div>
          <div className="batch-meta">
            收货单位: {result.downstream_customer_name} | 日期: {result.inquiry_date} |
            共 {result.items.length} 件商品
            {approvedCount > 0 && <span className="approved-count"> | 可订 {approvedCount} 件</span>}
            {rejectedCount > 0 && <span className="rejected-count"> | 不可订 {rejectedCount} 件</span>}
          </div>
        </div>
      </div>

      {!isAllApproved && (
        <div className="batch-notice">
          整体判断规则：本次咨询中任一商品库存不足，整体不可订货，需先入库补仓后重新咨询。
        </div>
      )}
      {isAllApproved && (
        <div className="batch-freeze-notice">
          所有 {result.items.length} 件商品均可订货，点击"确认"后将执行库存冻结锁定。
        </div>
      )}

      <div className="results-grid">
        {result.items.map((item, i) => (
          <ResultCard key={item.inquiry_id || i} item={item} batchApproved={isAllApproved} />
        ))}
      </div>

      <div className="batch-actions">
        {isAllApproved && (
          <button
            className="btn-confirm"
            onClick={handleConfirm}
            disabled={loading !== null}
          >
            {loading === 'confirm' ? '确认中...' : '确认（执行冻结）'}
          </button>
        )}
        <button
          className="btn-cancel-inquiry"
          onClick={handleCancel}
          disabled={loading !== null}
        >
          {loading === 'cancel' ? '取消中...' : '取消'}
        </button>
      </div>
    </div>
  );
}
