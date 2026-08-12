import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

/** 获取本地日期字符串 YYYY-MM-DD（避免 UTC 时区偏差） */
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

import {
  adminLogin,
  fetchAdminCustomers, fetchAdminDownstreamCustomers,
  createAdminCustomer, updateAdminCustomer, deleteAdminCustomer,
  createAdminDownstreamCustomer, updateAdminDownstreamCustomer, deleteAdminDownstreamCustomer,
  exportMonthlyReport,
  fetchExcelRules, createExcelRule, updateExcelRule, deleteExcelRule, setDefaultExcelRule,
  fetchAdminProducts, createAdminProduct, updateAdminProduct, deleteAdminProduct,
  fetchStockInRecords, createStockInRecord, updateStockInRecord, deleteStockInRecord,
  executeBackup,
  fetchAdminInquiryRecords,
  type AdminCustomer, type AdminDownstreamCustomer, type AdminProduct, type StockInRecord, type BackupResult,
  type AdminInquiryRecord,
} from '../services/adminApi';
import type { ExcelParseRule } from '../types/index.ts';

export default function AdminApp() {
  const [token, setToken] = useState(localStorage.getItem('admin_token') || '');
  const [username, setUsername] = useState(localStorage.getItem('admin_user') || '');

  if (!token) {
    return <LoginPage onLogin={(t, u) => { setToken(t); setUsername(u); }} />;
  }

  return (
    <div className="admin-app">
      <header className="admin-header">
        <Link to="/" className="back-link">← 返回咨询系统</Link>
        <h1>管理后台</h1>
        <span className="admin-user">{username} <button className="logout-btn" onClick={() => {
          localStorage.removeItem('admin_token');
          localStorage.removeItem('admin_user');
          setToken(''); setUsername('');
        }}>退出</button></span>
      </header>
      <AdminTabs />
    </div>
  );
}

// ===== 登录页 =====
function LoginPage({ onLogin }: { onLogin: (token: string, username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await adminLogin(username, password);
      localStorage.setItem('admin_token', res.token);
      localStorage.setItem('admin_user', res.username);
      onLogin(res.token, res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <Link to="/" className="back-link" style={{ alignSelf: 'flex-start' }}>← 返回首页</Link>
        <h2>管理后台登录</h2>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>用户名</label>
            <input value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label>密码</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="submit-btn" disabled={loading}>{loading ? '登录中...' : '登录'}</button>
        </form>
      </div>
    </div>
  );
}

// ===== Tabs =====
function AdminTabs() {
  const [tab, setTab] = useState<'upstream' | 'downstream' | 'product' | 'stock-in' | 'inquiry' | 'excel' | 'export'>('upstream');
  return (
    <div className="admin-tabs">
      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'upstream' ? 'active' : ''}`} onClick={() => setTab('upstream')}>客户管理</button>
        <button className={`tab-btn ${tab === 'product' ? 'active' : ''}`} onClick={() => setTab('product')}>商品管理</button>
        <button className={`tab-btn ${tab === 'stock-in' ? 'active' : ''}`} onClick={() => setTab('stock-in')}>入库管理</button>
        <button className={`tab-btn ${tab === 'inquiry' ? 'active' : ''}`} onClick={() => setTab('inquiry')}>咨询记录管理</button>
        <button className={`tab-btn ${tab === 'downstream' ? 'active' : ''}`} onClick={() => setTab('downstream')}>收货单位管理</button>
        <button className={`tab-btn ${tab === 'excel' ? 'active' : ''}`} onClick={() => setTab('excel')}>Excel 解析规则</button>
        <button className={`tab-btn ${tab === 'export' ? 'active' : ''}`} onClick={() => setTab('export')}>导出可订明细</button>
      </div>
      <div className="tab-content">
        {tab === 'upstream' && <UpstreamCustomerTab />}
        {tab === 'product' && <ProductTab />}
        {tab === 'stock-in' && <StockInTab />}
        {tab === 'inquiry' && <InquiryRecordsTab />}
        {tab === 'downstream' && <DownstreamCustomerTab />}
        {tab === 'excel' && <ExcelRuleTab />}
        {tab === 'export' && <ExportTab />}
      </div>
    </div>
  );
}

// ===== 客户 Tab =====
function UpstreamCustomerTab() {
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [editing, setEditing] = useState<AdminCustomer | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setCustomers(await fetchAdminCustomers()); } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (c: AdminCustomer) => { setEditing(c); setCode(c.customer_code); setName(c.customer_name || ''); };
  const startNew = () => { setEditing(null); setCode(''); setName(''); };

  const handleSave = async () => {
    if (!code.trim()) return;
    try {
      if (editing) {
        await updateAdminCustomer(editing.id, { customer_code: code, customer_name: name });
      } else {
        await createAdminCustomer({ customer_code: code, customer_name: name });
      }
      startNew();
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此客户？')) return;
    try { await deleteAdminCustomer(id); await load(); } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  return (
    <div className="admin-tab-panel">
      <div className="admin-form-inline">
        <input placeholder="客户编号" value={code} onChange={e => setCode(e.target.value)} />
        <input placeholder="客户名称" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn-primary" onClick={handleSave} disabled={!code.trim()}>{editing ? '保存' : '新增'}</button>
        {editing && <button className="btn-cancel" onClick={startNew}>取消</button>}
      </div>
      {loading ? <div className="loading">加载中...</div> : (
        <table className="admin-table">
          <thead><tr><th>ID</th><th>客户编号</th><th>客户名称</th><th>操作</th></tr></thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td><code>{c.customer_code}</code></td>
                <td>{c.customer_name || '-'}</td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(c)}>编辑</button>
                  <button className="btn-sm btn-danger" onClick={() => handleDelete(c.id)}>删除</button>
                </td>
              </tr>
            ))}
            {customers.length === 0 && <tr><td colSpan={4} className="empty-row">暂无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ===== 收货单位 Tab =====
function DownstreamCustomerTab() {
  const [items, setItems] = useState<AdminDownstreamCustomer[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [editing, setEditing] = useState<AdminDownstreamCustomer | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [dName, setDName] = useState('');
  const [dContact, setDContact] = useState('');
  const [dPhone, setDPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dc, c] = await Promise.all([fetchAdminDownstreamCustomers(), fetchAdminCustomers()]);
      setItems(dc); setCustomers(c);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (d: AdminDownstreamCustomer) => {
    setEditing(d); setCustomerCode(d.customer_code); setDName(d.downstream_name);
    setDContact(d.downstream_contact || ''); setDPhone(d.downstream_phone || '');
  };
  const startNew = () => { setEditing(null); setCustomerCode(''); setDName(''); setDContact(''); setDPhone(''); };

  const handleSave = async () => {
    if (!customerCode || !dName.trim()) return;
    const data = { customer_code: customerCode, downstream_name: dName, downstream_contact: dContact, downstream_phone: dPhone };
    try {
      if (editing) {
        await updateAdminDownstreamCustomer(editing.id, data);
      } else {
        await createAdminDownstreamCustomer(data);
      }
      startNew(); await load();
    } catch (e) { alert(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此收货单位？')) return;
    try { await deleteAdminDownstreamCustomer(id); await load(); } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  return (
    <div className="admin-tab-panel">
      <div className="admin-form-inline">
        <select value={customerCode} onChange={e => setCustomerCode(e.target.value)}>
          <option value="">选择客户</option>
          {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}</option>)}
        </select>
        <input placeholder="收货单位名称" value={dName} onChange={e => setDName(e.target.value)} />
        <input placeholder="联系人" value={dContact} onChange={e => setDContact(e.target.value)} />
        <input placeholder="联系电话" value={dPhone} onChange={e => setDPhone(e.target.value)} />
        <button className="btn-primary" onClick={handleSave} disabled={!customerCode || !dName.trim()}>{editing ? '保存' : '新增'}</button>
        {editing && <button className="btn-cancel" onClick={startNew}>取消</button>}
      </div>
      {loading ? <div className="loading">加载中...</div> : (
        <table className="admin-table">
          <thead><tr><th>ID</th><th>客户</th><th>收货单位名称</th><th>联系人</th><th>联系电话</th><th>操作</th></tr></thead>
          <tbody>
            {items.map(d => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td><code>{d.customer_code}</code> {d.upstream_customer_name || ''}</td>
                <td>{d.downstream_name}</td>
                <td>{d.downstream_contact || '-'}</td>
                <td>{d.downstream_phone || '-'}</td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(d)}>编辑</button>
                  <button className="btn-sm btn-danger" onClick={() => handleDelete(d.id)}>删除</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="empty-row">暂无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ===== 商品管理 Tab =====
function ProductTab() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState({ warehouse_code: '', customer_code: '', customer_product_code: '', product_name: '', spec: '', stock_qty: 0 });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showBackupConfirm, setShowBackupConfirm] = useState(false);
  const [backupStep, setBackupStep] = useState(0); // 0: hidden, 1: first confirm, 2: second confirm
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        fetchAdminProducts(filterCustomer || undefined),
        fetchAdminCustomers()
      ]);
      setProducts(p); setCustomers(c);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filterCustomer]);

  const startNew = () => {
    setEditing(null);
    setForm({ warehouse_code: '', customer_code: filterCustomer || '', customer_product_code: '', product_name: '', spec: '', stock_qty: 0 });
    setShowForm(true);
  };

  const startEdit = (p: AdminProduct) => {
    setEditing(p);
    setForm({ warehouse_code: p.warehouse_code, customer_code: p.customer_code, customer_product_code: p.customer_product_code || '', product_name: p.product_name || '', spec: p.spec || '', stock_qty: p.stock_qty });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.warehouse_code.trim()) return;
    const data = { warehouse_code: form.warehouse_code, customer_code: form.customer_code, customer_product_code: form.customer_product_code, product_name: form.product_name, spec: form.spec, stock_qty: Number(form.stock_qty) || 0 };
    try {
      if (editing) {
        await updateAdminProduct(editing.id, data);
      } else {
        await createAdminProduct(data);
      }
      setShowForm(false); setEditing(null);
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此商品？')) return;
    try { await deleteAdminProduct(id); await load(); } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  const handleBackupClick = () => {
    setBackupStep(1);
    setBackupResult(null);
  };

  const handleBackupConfirm = async () => {
    if (backupStep === 1) {
      setBackupStep(2);
      return;
    }
    // backupStep === 2, execute
    setBackupLoading(true);
    try {
      const result = await executeBackup();
      setBackupResult(result);
      setBackupStep(0);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : '备份失败');
    } finally {
      setBackupLoading(false);
    }
  };

  const cancelBackup = () => {
    setBackupStep(0);
    setBackupResult(null);
  };

  return (
    <div className="admin-tab-panel">
      <div className="admin-form-inline">
        <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
          <option value="">全部客户</option>
          {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}</option>)}
        </select>
        <button className="btn-primary" onClick={startNew}>新增商品</button>
        <button className="btn-backup" onClick={handleBackupClick} disabled={backupStep > 0}>一键备份</button>
      </div>

      {showForm && (
        <div className="rule-form">
          <div className="admin-form-inline" style={{ flexWrap: 'wrap' }}>
            <select value={form.customer_code} onChange={e => setForm(f => ({ ...f, customer_code: e.target.value }))}>
              <option value="">选择客户</option>
              {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}</option>)}
            </select>
            <input placeholder="仓储商品号" value={form.warehouse_code} onChange={e => setForm(f => ({ ...f, warehouse_code: e.target.value }))} />
            <input placeholder="客户商品编号" value={form.customer_product_code} onChange={e => setForm(f => ({ ...f, customer_product_code: e.target.value }))} />
            <input placeholder="商品名称" value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))} />
            <input placeholder="规格" value={form.spec} onChange={e => setForm(f => ({ ...f, spec: e.target.value }))} />
            <input placeholder="结存数量" type="number" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: Number(e.target.value) || 0 }))} />
            <button className="btn-primary" onClick={handleSave} disabled={!form.warehouse_code.trim()}>{editing ? '保存' : '新增'}</button>
            <button className="btn-cancel" onClick={() => { setShowForm(false); setEditing(null); }}>取消</button>
          </div>
        </div>
      )}

      {/* 备份确认弹窗 */}
      {backupStep > 0 && (
        <div className="backup-overlay">
          <div className="backup-confirm-modal">
            <h3>⚠️ 一键备份确认</h3>
            {backupStep === 1 && (
              <>
                <p className="backup-warning">此操作将执行以下关键步骤：</p>
                <ul className="backup-steps">
                  <li>备份所有商品当前数据到备份表</li>
                  <li>将<strong>本月1日之前</strong>所有已冻结库存标记为「已发货」</li>
                  <li>按公式重新计算每个商品的结存数量：<code>新结存 = 当前结存 - 已释放冻结之和</code></li>
                </ul>
                <p className="backup-warning-text">此操作不可撤销，请确认后再继续。</p>
              </>
            )}
            {backupStep === 2 && (
              <>
                <p className="backup-final-confirm">请再次确认：你确定要执行一键备份吗？</p>
                <p className="backup-warning-text">此操作将永久修改商品结存数量和冻结状态，无法撤销！</p>
              </>
            )}
            <div className="backup-actions">
              <button className="btn-cancel" onClick={cancelBackup} disabled={backupLoading}>取消</button>
              <button className="btn-danger-confirm" onClick={handleBackupConfirm} disabled={backupLoading}>
                {backupLoading ? '备份中...' : backupStep === 1 ? '我已了解，继续' : '确认执行备份'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 备份结果提示 */}
      {backupResult && (
        <div className="backup-result">
          <p>备份成功！共备份 <strong>{backupResult.total_backed_up}</strong> 个商品，
            冻结截止线：<code>{backupResult.freeze_before}</code> 之前的活跃冻结已释放，
            已释放冻结数量：<strong>{backupResult.total_released_qty}</strong></p>
          <button className="btn-sm" onClick={() => setBackupResult(null)}>关闭</button>
        </div>
      )}

      {loading ? <div className="loading">加载中...</div> : (
        <table className="admin-table">
          <thead><tr><th>ID</th><th>仓储商品号</th><th>客户</th><th>客户商品编号</th><th>商品名称</th><th>规格</th><th>结存数量</th><th>操作</th></tr></thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><code>{p.warehouse_code}</code></td>
                <td><code>{p.customer_code}</code> {p.customer_name ? `(${p.customer_name})` : ''}</td>
                <td>{p.customer_product_code || '-'}</td>
                <td>{p.product_name || '-'}</td>
                <td>{p.spec || '-'}</td>
                <td><strong>{p.stock_qty}</strong></td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(p)}>编辑</button>
                  <button className="btn-sm btn-danger" onClick={() => handleDelete(p.id)}>删除</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan={8} className="empty-row">暂无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ===== 入库管理 Tab =====
function StockInTab() {
  const [records, setRecords] = useState<StockInRecord[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editing, setEditing] = useState<StockInRecord | null>(null);
  const [form, setForm] = useState({ customer_code: '', product_id: 0, warehouse_code: '', stock_in_date: localDateStr(), stock_in_qty: 0, defective_qty: 0, remark: '' });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        fetchStockInRecords({ customer_code: filterCustomer || undefined, start_date: startDate || undefined, end_date: endDate || undefined }),
        fetchAdminCustomers()
      ]);
      setRecords(r); setCustomers(c);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [filterCustomer, startDate, endDate]);

  const loadProducts = async (customerCode: string) => {
    if (!customerCode) { setProducts([]); return; }
    try { setProducts(await fetchAdminProducts(customerCode)); } catch (e) { console.error(e); }
  };

  const startNew = () => {
    setEditing(null);
    setForm({ customer_code: filterCustomer || '', product_id: 0, warehouse_code: '', stock_in_date: localDateStr(), stock_in_qty: 0, defective_qty: 0, remark: '' });
    setShowForm(true);
    if (filterCustomer) loadProducts(filterCustomer);
  };

  const startEdit = (r: StockInRecord) => {
    setEditing(r);
    setForm({ customer_code: r.customer_code, product_id: r.product_id, warehouse_code: r.warehouse_code, stock_in_date: r.stock_in_date.slice(0, 10), stock_in_qty: r.stock_in_qty, defective_qty: r.defective_qty, remark: r.remark || '' });
    setShowForm(true);
    loadProducts(r.customer_code);
  };

  const handleCustomerChange = (code: string) => {
    setForm(f => ({ ...f, customer_code: code, product_id: 0, warehouse_code: '' }));
    loadProducts(code);
  };

  const handleProductChange = (productId: number) => {
    const p = products.find(p => p.id === productId);
    setForm(f => ({ ...f, product_id: productId, warehouse_code: p?.warehouse_code || '' }));
  };

  const handleSave = async () => {
    if (!form.customer_code || !form.product_id || !form.stock_in_date) return;
    const data = {
      customer_code: form.customer_code,
      product_id: form.product_id,
      warehouse_code: form.warehouse_code,
      stock_in_date: form.stock_in_date,
      stock_in_qty: Number(form.stock_in_qty) || 0,
      defective_qty: Number(form.defective_qty) || 0,
      remark: form.remark || undefined,
    };
    try {
      if (editing) {
        await updateStockInRecord(editing.id, data);
      } else {
        await createStockInRecord(data);
      }
      setShowForm(false); setEditing(null);
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此入库记录？将回退对应的商品结存数量。')) return;
    try { await deleteStockInRecord(id); await load(); } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  const actualQty = (Number(form.stock_in_qty) || 0) - (Number(form.defective_qty) || 0);

  return (
    <div className="admin-tab-panel">
      <div className="admin-form-inline">
        <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
          <option value="">全部客户</option>
          {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}</option>)}
        </select>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="开始日期" />
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="结束日期" />
        <button className="btn-primary" onClick={startNew}>新增入库</button>
      </div>

      {showForm && (
        <div className="rule-form">
          <div className="admin-form-inline" style={{ flexWrap: 'wrap' }}>
            <select value={form.customer_code} onChange={e => handleCustomerChange(e.target.value)}>
              <option value="">选择客户</option>
              {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}</option>)}
            </select>
            <select value={form.product_id} onChange={e => handleProductChange(Number(e.target.value))} disabled={!form.customer_code}>
              <option value={0}>选择商品</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.warehouse_code} {p.product_name ? `- ${p.product_name}` : ''}</option>)}
            </select>
            <input type="date" value={form.stock_in_date} onChange={e => setForm(f => ({ ...f, stock_in_date: e.target.value }))} />
            <input type="number" placeholder="入库数量" value={form.stock_in_qty || ''} onChange={e => setForm(f => ({ ...f, stock_in_qty: Number(e.target.value) || 0 }))} />
            <input type="number" placeholder="不良品数量" value={form.defective_qty || ''} onChange={e => setForm(f => ({ ...f, defective_qty: Number(e.target.value) || 0 }))} />
            <span className="computed-field">实际入库: <strong>{actualQty}</strong></span>
            <input placeholder="备注" value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} />
            <button className="btn-primary" onClick={handleSave} disabled={!form.customer_code || !form.product_id || !form.stock_in_date}>{editing ? '保存' : '新增'}</button>
            <button className="btn-cancel" onClick={() => { setShowForm(false); setEditing(null); }}>取消</button>
          </div>
        </div>
      )}

      {loading ? <div className="loading">加载中...</div> : (
        <table className="admin-table">
          <thead><tr><th>ID</th><th>入库日期</th><th>客户</th><th>仓储商品号</th><th>商品名称</th><th>入库数量</th><th>不良品</th><th>实际入库</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.stock_in_date.slice(0, 10)}</td>
                <td><code>{r.customer_code}</code> {r.customer_name ? `(${r.customer_name})` : ''}</td>
                <td><code>{r.warehouse_code}</code></td>
                <td>{r.product_name || '-'}</td>
                <td>{r.stock_in_qty}</td>
                <td>{r.defective_qty}</td>
                <td><strong>{r.actual_qty}</strong></td>
                <td>{r.remark || '-'}</td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(r)}>编辑</button>
                  <button className="btn-sm btn-danger" onClick={() => handleDelete(r.id)}>删除</button>
                </td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={10} className="empty-row">暂无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ===== Excel 解析规则 Tab =====
function ExcelRuleTab() {
  const [rules, setRules] = useState<ExcelParseRule[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [editing, setEditing] = useState<ExcelParseRule | null>(null);
  const [form, setForm] = useState<Partial<ExcelParseRule>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([fetchExcelRules(), fetchAdminCustomers()]);
      setRules(r); setCustomers(c);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const startNew = () => {
    setEditing(null);
    setForm({
      customer_code: filterCustomer || '',
      rule_name: '',
      sheet_index: 0,
      downstream_name_cell: 'D1',
      downstream_name_extra_cells: '',
      product_code_start_cell: 'H11',
      quantity_column_offset: 1,
      end_marker: '合计',
      empty_value_treat_as_zero: 1,
      is_default: 0
    });
  };

  const startEdit = (rule: ExcelParseRule) => {
    setEditing(rule);
    setForm({ ...rule, downstream_name_extra_cells: rule.downstream_name_extra_cells || '' });
  };

  const handleSave = async () => {
    if (!form.customer_code || !form.downstream_name_cell || !form.product_code_start_cell) return;
    const payload = {
      customer_code: form.customer_code,
      rule_name: form.rule_name || null,
      sheet_index: Number(form.sheet_index || 0),
      downstream_name_cell: form.downstream_name_cell,
      downstream_name_extra_cells: form.downstream_name_extra_cells || null,
      product_code_start_cell: form.product_code_start_cell,
      quantity_column_offset: Number(form.quantity_column_offset || 1),
      end_marker: form.end_marker || '合计',
      empty_value_treat_as_zero: form.empty_value_treat_as_zero === 0 ? 0 : 1,
      is_default: form.is_default === 1 ? 1 : 0,
    };
    try {
      if (editing) {
        await updateExcelRule(editing.id, payload as Omit<ExcelParseRule, 'id'>);
      } else {
        await createExcelRule(payload as Omit<ExcelParseRule, 'id'>);
      }
      startNew();
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除此解析规则？')) return;
    try { await deleteExcelRule(id); await load(); } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  const handleSetDefault = async (id: number) => {
    try { await setDefaultExcelRule(id); await load(); } catch (e) { alert(e instanceof Error ? e.message : '设置失败'); }
  };

  const filteredRules = filterCustomer
    ? rules.filter(r => r.customer_code === filterCustomer)
    : rules;

  const displayRules = filteredRules.sort((a, b) => b.is_default - a.is_default);

  return (
    <div className="admin-tab-panel">
      <div className="admin-form-inline">
        <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
          <option value="">全部客户</option>
          {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code} {c.customer_name ? `(${c.customer_name})` : ''}</option>)}
        </select>
        <button className="btn-primary" onClick={startNew}>新增规则</button>
      </div>

      {form.downstream_name_cell !== undefined && (
        <div className="rule-form">
          <div className="admin-form-inline" style={{ flexWrap: 'wrap' }}>
            <select value={form.customer_code || ''} onChange={e => setForm(f => ({ ...f, customer_code: e.target.value }))}>
              <option value="">选择客户</option>
              {customers.map(c => <option key={c.id} value={c.customer_code}>{c.customer_code}</option>)}
            </select>
            <input placeholder="规则名称" value={form.rule_name || ''} onChange={e => setForm(f => ({ ...f, rule_name: e.target.value }))} />
            <input placeholder="工作表索引" type="number" value={form.sheet_index ?? 0} onChange={e => setForm(f => ({ ...f, sheet_index: Number(e.target.value) }))} />
            <input placeholder="收货单位单元格" value={form.downstream_name_cell} onChange={e => setForm(f => ({ ...f, downstream_name_cell: e.target.value }))} />
            <input placeholder="辅助单元格（逗号分隔）" value={form.downstream_name_extra_cells || ''} onChange={e => setForm(f => ({ ...f, downstream_name_extra_cells: e.target.value }))} />
            <input placeholder="商品起始单元格" value={form.product_code_start_cell} onChange={e => setForm(f => ({ ...f, product_code_start_cell: e.target.value }))} />
            <input placeholder="数量列偏移" type="number" value={form.quantity_column_offset ?? 1} onChange={e => setForm(f => ({ ...f, quantity_column_offset: Number(e.target.value) }))} />
            <input placeholder="结束标记" value={form.end_marker || '合计'} onChange={e => setForm(f => ({ ...f, end_marker: e.target.value }))} />
            <label className="checkbox-label">
              <input type="checkbox" checked={form.empty_value_treat_as_zero !== 0} onChange={e => setForm(f => ({ ...f, empty_value_treat_as_zero: e.target.checked ? 1 : 0 }))} />
              空数量视为 0
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.is_default === 1} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked ? 1 : 0 }))} />
              默认规则
            </label>
            <button className="btn-primary" onClick={handleSave} disabled={!form.customer_code || !form.downstream_name_cell || !form.product_code_start_cell}>
              {editing ? '保存' : '新增'}
            </button>
            <button className="btn-cancel" onClick={() => setForm({})}>取消</button>
          </div>
        </div>
      )}

      {loading ? <div className="loading">加载中...</div> : (
        <table className="admin-table">
          <thead><tr><th>ID</th><th>客户</th><th>规则名称</th><th>收货单位单元格</th><th>商品起始</th><th>数量偏移</th><th>结束标记</th><th>默认</th><th>操作</th></tr></thead>
          <tbody>
            {displayRules.map(r => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td><code>{r.customer_code}</code></td>
                <td>{r.rule_name || '-'}</td>
                <td><code>{r.downstream_name_cell}</code></td>
                <td><code>{r.product_code_start_cell}</code></td>
                <td>{r.quantity_column_offset}</td>
                <td>{r.end_marker}</td>
                <td>{r.is_default ? '是' : '否'}</td>
                <td>
                  <button className="btn-sm" onClick={() => startEdit(r)}>编辑</button>
                  {!r.is_default && <button className="btn-sm" onClick={() => handleSetDefault(r.id)}>设为默认</button>}
                  <button className="btn-sm btn-danger" onClick={() => handleDelete(r.id)}>删除</button>
                </td>
              </tr>
            ))}
            {displayRules.length === 0 && <tr><td colSpan={9} className="empty-row">暂无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ===== 咨询记录 Tab =====
interface AdminBatchGroup {
  batch_id: string;
  inquiry_date: string;
  customer_code: string;
  customer_name: string;
  downstream_customer_name: string;
  batch_result: string;
  create_time: string;
  items: AdminInquiryRecord[];
}

function InquiryRecordsTab() {
  const [batches, setBatches] = useState<AdminBatchGroup[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [upstreams, setUpstreams] = useState<{ customer_code: string; customer_name: string | null }[]>([]);
  const [downstreams, setDownstreams] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [customerCode, setCustomerCode] = useState('');
  const [downstreamName, setDownstreamName] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const selectStyle = { padding: '4px 8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '13px', minWidth: '100px' };

  // 当客户变更时，重置收货单位筛选
  const handleCustomerCodeChange = (code: string) => {
    setCustomerCode(code);
    setDownstreamName('');
    setPage(1);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminInquiryRecords({
        customer_code: customerCode || undefined,
        month: month || undefined,
        downstream_customer_name: downstreamName || undefined,
        page,
        pageSize,
      });
      setTotal(res.total);
      if (res.months) setMonths(res.months);
      if (res.upstreams) setUpstreams(res.upstreams);
      if (res.downstreams) setDownstreams(res.downstreams);

      // 按 batch_id 分组
      const groupMap = new Map<string, AdminBatchGroup>();
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [month, customerCode, downstreamName, page]);

  const toggleExpand = (batchId: string) => {
    setExpandedBatch(prev => prev === batchId ? null : batchId);
  };

  const getBatchTag = (result: string) => {
    if (result === 'approved') {
      return <span className="result-tag tag-pass">✓ 全部可订</span>;
    }
    return <span className="result-tag tag-fail">✗ 不可订货</span>;
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="admin-tab-panel">
      <div className="admin-filter-bar" style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <label>月份：</label>
        <select value={month} onChange={e => { setMonth(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">全部</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>客户：</label>
        <select value={customerCode} onChange={e => handleCustomerCodeChange(e.target.value)} style={selectStyle}>
          <option value="">全部</option>
          {upstreams.map(u => <option key={u.customer_code} value={u.customer_code}>{u.customer_name || u.customer_code}</option>)}
        </select>
        <label>收货单位：</label>
        <select value={downstreamName} onChange={e => { setDownstreamName(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">全部</option>
          {downstreams.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: '13px' }}>共 {total} 条记录</span>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : batches.length === 0 ? (
        <div className="empty-state">暂无咨询记录</div>
      ) : (
        <>
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
          {totalPages > 1 && (
            <div className="pagination" style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '4px 10px' }}>上一页</button>
              <span style={{ lineHeight: '28px' }}>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '4px 10px' }}>下一页</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===== 导出 Tab =====
function ExportTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customerCode, setCustomerCode] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchAdminCustomers().then(list => {
      setCustomers(list);
      if (list.length > 0) setCustomerCode(list[0].customer_code);
    }).catch(() => {});
  }, []);

  const handleExport = async () => {
    if (!customerCode) return alert('请先选择客户');
    const name = customers.find(c => c.customer_code === customerCode)?.customer_name || customerCode;
    setExporting(true);
    try {
      await exportMonthlyReport(year, month, customerCode, name);
    } catch (e) {
      alert(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="admin-tab-panel">
      <div className="export-form">
        <label>客户：</label>
        <select value={customerCode} onChange={e => setCustomerCode(e.target.value)}>
          {customers.map(c => (
            <option key={c.customer_code} value={c.customer_code}>
              {c.customer_code}（{c.customer_name}）
            </option>
          ))}
        </select>
        <label>年月：</label>
        <select value={year} onChange={e => setYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))}>
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button className="btn-primary btn-export" onClick={handleExport} disabled={exporting || !customerCode}>
          {exporting ? '导出中...' : `导出 ${year}年${month}月 进出库明细`}
        </button>
      </div>
      <div className="export-hint">
        按手工台账《N月XXX进出库明细》版式导出：左侧为商品基础信息与期初结存，
        右侧按当月发生业务的日期横向展开，每个日期块为「入库 / 不良品 / 各收货单位出库 / 结存」，
        当天有几家收货单位发货就生成几列，结存列为 SUM 公式。
      </div>
    </div>
  );
}
