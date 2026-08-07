import { useState, useRef } from 'react';
import type { ExcelParseResult, DownstreamCustomer } from '../types/index.ts';
import { parseExcelInquiry } from '../services/api.ts';

interface Props {
  customerCode: string;
  existingDownstreamCustomers: DownstreamCustomer[];
  onConfirm: (result: ExcelParseResult) => void;
  onCancel: () => void;
}

export default function ExcelUploadModal({ customerCode, onConfirm, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExcelParseResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
      setError('');
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setError('');
    try {
      const res = await parseExcelInquiry(customerCode, file);
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
      setFile(f);
      setResult(null);
      setError('');
    } else {
      setError('请上传 Excel 文件');
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content excel-modal" onClick={e => e.stopPropagation()}>
        <h3>Excel 导入订货单</h3>

        {!result && (
          <>
            <div
              className="excel-drop-zone"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {file ? (
                <div className="file-name">{file.name}</div>
              ) : (
                <>
                  <div className="drop-hint">点击或拖拽 Excel 文件到此处</div>
                  <div className="drop-sub">支持 .xlsx / .xls</div>
                </>
              )}
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onCancel}>取消</button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleParse}
                disabled={!file || parsing}
              >
                {parsing ? '解析中...' : '开始解析'}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div className="parse-summary">
              <div className="summary-row">
                <label>匹配收货单位：</label>
                <span>{result.downstream_customer?.downstream_name || '—'}</span>
              </div>
              {result.unmatched_downstream_hint && (
                <div className="summary-row hint">{result.unmatched_downstream_hint}</div>
              )}
              <div className="summary-row">
                <label>识别商品：</label>
                <span>{result.items.length} 条</span>
              </div>
              {result.unmatched_items.length > 0 && (
                <div className="summary-row warning">
                  <label>未匹配商品：</label>
                  <span>{result.unmatched_items.length} 条</span>
                </div>
              )}
            </div>

            {result.items.length > 0 && (
              <div className="parse-items">
                <table>
                  <thead>
                    <tr>
                      <th>商品编号</th>
                      <th>商品名称</th>
                      <th>规格</th>
                      <th>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.customer_product_code}</td>
                        <td>{item.product_name}</td>
                        <td>{item.spec}</td>
                        <td>{item.request_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.unmatched_items.length > 0 && (
              <div className="parse-unmatched">
                <h4>未匹配商品</h4>
                <ul>
                  {result.unmatched_items.map((item, idx) => (
                    <li key={idx}>{item.code}（数量 {item.qty}）— {item.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="error-msg">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => { setResult(null); setFile(null); }}>重新上传</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => onConfirm(result)}
                disabled={result.items.length === 0}
              >
                确认使用该清单
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
