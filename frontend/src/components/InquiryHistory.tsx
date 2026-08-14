import { useState, useEffect } from 'react';
import { fetchInquiryHistory } from '../services/api';
import type { InquiryRecord } from '../types';
import '../App.css';

interface BatchGroup {
  batch_id: string;
  inquiry_date: string;
  customer_code: string;
  customer_name: string;
  downstream_customer_name: string;
  batch_result: string;
  create_time: string;
  items: InquiryRecord[];
}

export default function InquiryHistory({ refreshKey }: { refreshKey?: number }) {
  const [batches, setBatches] = useState<BatchGroup[]>([]);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);

  const loadHistory = async (selectedMonth?: string) => {
    setLoading(true);
    try {
      const params: any = { page: 1, pageSize: 200 };
      if (selectedMonth) params.month = selectedMonth;
      const res = await fetchInquiryHistory(params);
      if (res && res.records) {
        const groupMap = new Map<string, BatchGroup>();
        for (const rec of res.records) {
          const bid = rec.batch_id || rec.id.toString();
          if (!groupMap.has(bid)) {
            groupMap.set(bid, {
              batch_id: bid,
              inquiry_date: rec.inquiry_date,
              customer_code: rec.customer_code,
              customer_name: rec.customer_name || rec.customer_code,
              downstream_customer_name: rec.downstream_customer_name || '',
              batch_result: rec.batch_result || 'unknown',
              create_time: rec.create_time,
              items: [],
            });
          }
          groupMap.get(bid)!.items.push(rec);
        }
        const groups = Array.from(groupMap.values());
        groups.sort((a, b) => new Date(b.create_time).getTime() - new Date(a.create_time).getTime());
        setBatches(groups);
      }
    } catch (err) {
      console.error('加载历史记录失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory(month);
  }, [month, refreshKey]);

  const toggleExpand = (batchId: string) => {
    setExpandedBatch(prev => prev === batchId ? null : batchId);
  };

  const getBatchTag = (result: string) => {
    if (result === 'approved') {
      return <span className="result-tag tag-pass">✓ 全部可订</span>;
    }
    return <span className="result-tag tag-fail">✗ 不可订货</span>;
  };

  return (
    <div className="history-section">
      <h2>咨询历史记录</h2>

      <div className="month-filter" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <label style={{ fontWeight: 500 }}>月份：</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' }}
        />
        <button
          onClick={() => setMonth('')}
          style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '13px' }}
        >全部</button>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : batches.length === 0 ? (
        <div className="empty-state">暂无咨询记录</div>
      ) : (
        <div className="batch-list">
          <div className="batch-header">
            <span className="batch-col-expand"></span>
            <span className="batch-col-date">咨询日期</span>
            <span className="batch-col-customer">客户</span>
            <span className="batch-col-downstream">收货单位</span>
            <span className="batch-col-count">商品数</span>
            <span className="batch-col-result">咨询结论</span>
            <span className="batch-col-time">咨询时间</span>
          </div>

          {batches.map(batch => (
            <div key={batch.batch_id} className={`batch-row ${expandedBatch === batch.batch_id ? 'expanded' : ''}`}>
              <div className="batch-main" onClick={() => toggleExpand(batch.batch_id)}>
                <span className="batch-col-expand">
                  <span className={`expand-icon ${expandedBatch === batch.batch_id ? 'expand-icon-open' : ''}`}>▶</span>
                </span>
                <span className="batch-col-date">{new Date(batch.inquiry_date).toLocaleDateString('zh-CN')}</span>
                <span className="batch-col-customer">{batch.customer_name}（{batch.customer_code}）</span>
                <span className="batch-col-downstream">{batch.downstream_customer_name || '-'}</span>
                <span className="batch-col-count">{batch.items.length} 个商品</span>
                <span className="batch-col-result">{getBatchTag(batch.batch_result)}</span>
                <span className="batch-col-time">{new Date(batch.create_time).toLocaleString('zh-CN')}</span>
              </div>

              {expandedBatch === batch.batch_id && (
                <div className="batch-detail">
                  <table className="detail-table">
                    <thead>
                      <tr>
                        <th>客户商品编号</th>
                        <th>商品名称</th>
                        <th>仓储商品号</th>
                        <th>订货数量</th>
                        <th>商品库存</th>
                        <th>冻结数量</th>
                        <th>实时库存</th>
                        <th>商品结论</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.items.map(item => (
                        <tr key={item.id} className={item.result === 'approved' ? 'row-pass' : 'row-fail'}>
                          <td><code>{item.customer_product_code}</code></td>
                          <td>{item.product_name}</td>
                          <td><code>{item.warehouse_code}</code></td>
                          <td className="num">{item.request_qty}</td>
                          <td className="num">{item.stock_qty}</td>
                          <td className="num">{item.frozen_qty}</td>
                          <td className="num">{item.available_qty}</td>
                          <td>
                            {item.result === 'approved' ? (
                              <span className="result-tag tag-pass">✓ 可订</span>
                            ) : (
                              <span className="result-tag tag-fail">✗ 不可订</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
