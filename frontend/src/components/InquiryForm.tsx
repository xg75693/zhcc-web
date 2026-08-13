import { useState, useEffect, useMemo } from 'react';
import type { Customer, DownstreamCustomer, Product, BatchInquiryResult, ExcelParseResult } from '../types/index.ts';
import { fetchCustomers, fetchProducts, submitInquiry, fetchDownstreamCustomers, createDownstreamCustomer, confirmInquiry, cancelInquiry } from '../services/api.ts';
import InquiryResultList from './InquiryResult.tsx';
import ExcelUploadModal from './ExcelUploadModal.tsx';
import SearchableSelect from './SearchableSelect.tsx';

interface SelectedItem {
  customer_product_code: string;
  product_name: string;
  spec: string;
  stock_qty: number;
  request_qty: number;
}

export default function InquiryForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [downstreamCustomers, setDownstreamCustomers] = useState<DownstreamCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedDownstream, setSelectedDownstream] = useState<number | ''>('');
  const [newDownstreamName, setNewDownstreamName] = useState('');
  const [showNewDownstream, setShowNewDownstream] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedItems, setSelectedItems] = useState<Map<string, SelectedItem>>(new Map());
  const [inquiryDate, setInquiryDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchInquiryResult | null>(null);
  const [showExcelModal, setShowExcelModal] = useState(false);

  const [error, setError] = useState('');

  useEffect(() => {
    fetchCustomers().then(setCustomers).catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedCustomer) {
      setSelectedItems(new Map());
      setSelectedDownstream('');
      setNewDownstreamName('');
      setShowNewDownstream(false);
      setProductSearch('');
      fetchProducts(selectedCustomer).then(setProducts).catch(console.error);
      fetchDownstreamCustomers(selectedCustomer).then(setDownstreamCustomers).catch(console.error);
    } else {
      setProducts([]);
      setSelectedItems(new Map());
      setDownstreamCustomers([]);
    }
  }, [selectedCustomer]);

  const toggleProduct = (p: Product) => {
    const next = new Map(selectedItems);
    if (next.has(p.customer_product_code)) {
      next.delete(p.customer_product_code);
    } else {
      next.set(p.customer_product_code, {
        customer_product_code: p.customer_product_code,
        product_name: p.product_name,
        spec: p.spec,
        stock_qty: p.stock_qty,
        request_qty: 1
      });
    }
    setSelectedItems(next);
  };

  const updateQty = (code: string, qty: number) => {
    const next = new Map(selectedItems);
    const item = next.get(code);
    if (item) {
      next.set(code, { ...item, request_qty: qty });
      setSelectedItems(next);
    }
  };

  const handleAddDownstream = async () => {
    if (!newDownstreamName.trim() || !selectedCustomer) return;
    try {
      const created = await createDownstreamCustomer({
        customer_code: selectedCustomer,
        downstream_name: newDownstreamName.trim()
      });
      setDownstreamCustomers(prev => [created, ...prev]);
      setSelectedDownstream(created.id);
      setNewDownstreamName('');
      setShowNewDownstream(false);
    } catch (err) {
      console.error('添加收货单位失败:', err);
    }
  };

  const getDownstreamName = (): string => {
    if (selectedDownstream === '') return '';
    const found = downstreamCustomers.find(d => d.id === selectedDownstream);
    return found ? found.downstream_name : '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) {
      setError('请选择客户');
      return;
    }
    if (!selectedDownstream) {
      setError('请选择收货单位');
      return;
    }
    if (selectedItems.size === 0) {
      setError('请至少选择一个商品');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const items = Array.from(selectedItems.values()).map(item => ({
        customer_product_code: item.customer_product_code,
        request_qty: item.request_qty
      }));
      const res = await submitInquiry({
        customer_code: selectedCustomer,
        downstream_customer_id: typeof selectedDownstream === 'number' ? selectedDownstream : undefined,
        downstream_customer_name: getDownstreamName(),
        items,
        inquiry_date: inquiryDate
      });
      setResult(res);
      setSelectedItems(new Map());
      onSubmitted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const selectedList = Array.from(selectedItems.values());
  const canSubmit = selectedCustomer && selectedDownstream && selectedItems.size > 0;
  const downstreamOptions = useMemo(
    () => downstreamCustomers.map(d => ({ value: String(d.id), label: d.downstream_name })),
    [downstreamCustomers]
  );

  return (
    <div className="inquiry-section">
      <h2>订货咨询</h2>
      <form onSubmit={handleSubmit} className="inquiry-form">
        <div className="form-row">
          <div className="form-group">
            <label>客户</label>
            <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} required>
              <option value="">请选择客户</option>
              {customers.map(c => (
                <option key={c.id} value={c.customer_code}>
                  {c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>咨询日期</label>
            <input type="date" value={inquiryDate} onChange={e => setInquiryDate(e.target.value)} required />
          </div>
        </div>

        {selectedCustomer && (
          <div className="form-group excel-import-group">
            <label>批量导入</label>
            <button type="button" className="excel-import-btn" onClick={() => setShowExcelModal(true)}>
              通过 Excel 导入订货单
            </button>
            <span className="excel-import-tip">将自动匹配收货单位与商品</span>
          </div>
        )}

        {selectedCustomer && (
          <div className="form-group">
            <label>收货单位</label>
            <div className="downstream-select-row">
              {/* 收货单位数量多，改成可检索下拉；
                  「新增」原先藏在选项列表末尾，拆成独立按钮，避免和选择动作混在一起 */}
              <div className="downstream-picker">
                <SearchableSelect
                  className="downstream-searchable"
                  options={downstreamOptions}
                  value={selectedDownstream === '' ? '' : String(selectedDownstream)}
                  onChange={v => {
                    setSelectedDownstream(v === '' ? '' : Number(v));
                    setShowNewDownstream(false);
                  }}
                  placeholder="输入名称检索，或点右侧展开选择"
                />
                <button
                  type="button"
                  className="add-btn"
                  aria-expanded={showNewDownstream}
                  onClick={() => setShowNewDownstream(s => !s)}
                >
                  {showNewDownstream ? '取消新增' : '+ 新增'}
                </button>
              </div>
              {showNewDownstream && (
                <div className="new-downstream-input">
                  <input
                    type="text"
                    placeholder="输入收货单位名称"
                    autoFocus
                    value={newDownstreamName}
                    onChange={e => setNewDownstreamName(e.target.value)}
                    onKeyDown={e => {
                      if (e.nativeEvent.isComposing) return; // 输入法组合中的回车是上屏，不提交
                      if (e.key === 'Enter') { e.preventDefault(); handleAddDownstream(); }
                    }}
                  />
                  <button type="button" className="add-btn" onClick={handleAddDownstream}>添加</button>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedCustomer && products.length > 0 && (
          <div className="form-group">
            <label>选择商品（可多选，支持按名称或编号检索）</label>
            <input
              className="product-search"
              type="text"
              placeholder="输入商品名称或编号检索..."
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
            />
            <div className="product-list">
              {products
                .filter(p => {
                  if (!productSearch.trim()) return true;
                  const kw = productSearch.trim().toLowerCase();
                  return (
                    (p.customer_product_code || '').toLowerCase().includes(kw) ||
                    (p.product_name || '').toLowerCase().includes(kw)
                  );
                })
                .map(p => {
                  const isSelected = selectedItems.has(p.customer_product_code);
                  const item = selectedItems.get(p.customer_product_code);
                  return (
                    <div key={p.id} className={`product-item ${isSelected ? 'selected' : ''}`}>
                      <label className="product-checkbox">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleProduct(p)} />
                        <span className="product-info">
                          <span className="product-code">{p.customer_product_code}</span>
                          <span className="product-name">{p.product_name}</span>
                          {/* 规格为空时不要渲染出一对空括号 */}
                          {p.spec && <span className="product-spec">({p.spec})</span>}
                        </span>
                      </label>
                      {isSelected && item && (
                        <div className="qty-input">
                          <label>数量:</label>
                          {/* 用 0 表示「编辑中的空值」并渲染为空串：清空后不会残留 0 被当成前缀，
                              失焦时若仍为空则回落到 1 */}
                          <input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={item.request_qty === 0 ? '' : item.request_qty}
                            onFocus={e => e.target.select()}
                            onChange={e => {
                              const raw = e.target.value;
                              updateQty(p.customer_product_code, raw === '' ? 0 : Math.max(0, Math.floor(Number(raw)) || 0));
                            }}
                            onBlur={() => {
                              if (item.request_qty < 1) updateQty(p.customer_product_code, 1);
                            }}
                            required
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {selectedList.length > 0 && (
          <div className="selection-summary">已选 <strong>{selectedList.length}</strong> 个商品</div>
        )}

        {error && <div className="error-msg">{error}</div>}

        <button type="submit" className="submit-btn" disabled={loading || !canSubmit}>
          {loading ? '处理中...' : `提交咨询${selectedItems.size > 0 ? ` (${selectedItems.size}件商品)` : ''}`}
        </button>
      </form>

      {result && <InquiryResultList 
        result={result} 
        onConfirm={async () => {
          try {
            await confirmInquiry(result.batch_id);
            setResult(null);
            onSubmitted();
          } catch (e) {
            alert(e instanceof Error ? e.message : '确认失败');
          }
        }}
        onCancel={async () => {
          try {
            await cancelInquiry(result.batch_id);
            setResult(null);
            onSubmitted();
          } catch (e) {
            alert(e instanceof Error ? e.message : '取消失败');
          }
        }}
      />}
      {showExcelModal && selectedCustomer && (
        <ExcelUploadModal
          customerCode={selectedCustomer}
          existingDownstreamCustomers={downstreamCustomers}
          onConfirm={(parseResult: ExcelParseResult) => {
            setShowExcelModal(false);
            if (parseResult.downstream_customer) {
              setSelectedDownstream(parseResult.downstream_customer.id);
              setDownstreamCustomers(prev => {
                const exists = prev.some(d => d.id === parseResult.downstream_customer!.id);
                return exists ? prev : [parseResult.downstream_customer!, ...prev];
              });
            }
            const next = new Map<string, SelectedItem>();
            for (const item of parseResult.items) {
              const product = products.find(p => p.customer_product_code === item.customer_product_code);
              if (product) {
                next.set(item.customer_product_code, {
                  customer_product_code: item.customer_product_code,
                  product_name: item.product_name,
                  spec: item.spec,
                  stock_qty: product.stock_qty,
                  request_qty: item.request_qty
                });
              }
            }
            setSelectedItems(next);
          }}
          onCancel={() => setShowExcelModal(false)}
        />
      )}
    </div>
  );
}
