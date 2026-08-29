import { useState, useEffect, useCallback } from 'react';
import {
  fetchAdminCategories, createAdminCategory, updateAdminCategory, deleteAdminCategory,
  type AdminCustomer, type AdminProductCategory,
} from '../services/adminApi.ts';

interface Props {
  customers: AdminCustomer[];
  /** 商品页当前筛选的客户，作为弹窗打开时的默认选中项 */
  initialCustomerCode: string;
  /** 关闭弹窗；changed 表示期间是否动过类别，用于决定商品列表要不要重拉 */
  onClose: (changed: boolean) => void;
}

/**
 * 类别管理弹窗。
 *
 * 类别按客户隔离，所以顶部必须先选客户，下面才是这个客户的类别清单。
 * 每个客户有一条 is_default 的「默认分类」：可以改名，不能删除——
 * 它是商品在原类别被删掉时的回落去处。
 */
export default function CategoryManageModal({ customers, initialCustomerCode, onClose }: Props) {
  const [customerCode, setCustomerCode] = useState(initialCustomerCode || customers[0]?.customer_code || '');
  const [categories, setCategories] = useState<AdminProductCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);

  // 排序框是常驻可编辑的，本地先存草稿，失焦/回车才提交，避免每敲一个数字发一次请求
  const [sortDraft, setSortDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!customerCode) { setCategories([]); return; }
    setLoading(true); setError('');
    try {
      const list = await fetchAdminCategories(customerCode);
      setCategories(list);
      setSortDraft(Object.fromEntries(list.map(c => [c.id, String(c.sort_order ?? 0)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载类别失败');
    } finally {
      setLoading(false);
    }
  }, [customerCode]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || !customerCode) return;
    setCreating(true); setError('');
    try {
      await createAdminCategory({ customer_code: customerCode, category_name: name });
      setNewName('');
      setChanged(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '新增失败');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (c: AdminProductCategory) => { setEditingId(c.id); setEditName(c.category_name); setError(''); };
  const cancelEdit = () => { setEditingId(null); setEditName(''); };

  const handleRename = async (c: AdminProductCategory) => {
    const name = editName.trim();
    if (!name) return;
    if (name === c.category_name) { cancelEdit(); return; }
    setSavingId(c.id); setError('');
    try {
      await updateAdminCategory(c.id, { category_name: name });
      cancelEdit();
      setChanged(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名失败');
    } finally {
      setSavingId(null);
    }
  };

  /** 排序改完提交。值没变或非法就还原成当前值，不发请求 */
  const commitSort = async (c: AdminProductCategory) => {
    const raw = (sortDraft[c.id] ?? '').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) {
      setSortDraft(d => ({ ...d, [c.id]: String(c.sort_order ?? 0) }));
      return;
    }
    const next = Math.trunc(n);
    if (next === c.sort_order) {
      setSortDraft(d => ({ ...d, [c.id]: String(next) }));
      return;
    }
    setSavingId(c.id); setError('');
    try {
      await updateAdminCategory(c.id, { sort_order: next });
      setChanged(true);
      await load();   // 重拉以按新顺序重排列表
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存排序失败');
      setSortDraft(d => ({ ...d, [c.id]: String(c.sort_order ?? 0) }));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (c: AdminProductCategory) => {
    const tip = c.product_count > 0
      ? `「${c.category_name}」下有 ${c.product_count} 个商品，删除后这些商品会转到「默认分类」。确认删除？`
      : `确认删除类别「${c.category_name}」？`;
    if (!confirm(tip)) return;
    setSavingId(c.id); setError('');
    try {
      await deleteAdminCategory(c.id);
      setChanged(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="backup-overlay" onClick={() => onClose(changed)}>
      <div className="backup-confirm-modal category-modal" onClick={e => e.stopPropagation()}>
        <h3>类别管理</h3>

        <div className="category-customer-picker">
          <label>所属客户</label>
          <select value={customerCode} onChange={e => { cancelEdit(); setCustomerCode(e.target.value); }}>
            <option value="">选择客户</option>
            {customers.map(c => (
              <option key={c.id} value={c.customer_code}>
                {c.customer_code}{c.customer_name ? ` (${c.customer_name})` : ''}
              </option>
            ))}
          </select>
          <span className="category-hint">类别按客户隔离；左侧数字为排序，值小的在前</span>
        </div>

        {error && <div className="category-error">{error}</div>}

        {!customerCode ? (
          <div className="category-empty">请先选择客户</div>
        ) : loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <div className="category-list">
            {categories.map(c => (
              <div key={c.id} className="category-row">
                {/* 排序框常驻，与名称的编辑态互不影响 */}
                <input
                  className="cell-input category-sort-input"
                  type="number"
                  step={1}
                  title="排序，值小的在前"
                  value={sortDraft[c.id] ?? ''}
                  disabled={savingId === c.id}
                  onFocus={e => e.target.select()}
                  onChange={e => setSortDraft(d => ({ ...d, [c.id]: e.target.value }))}
                  onBlur={() => commitSort(c)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                    else if (e.key === 'Escape') {
                      e.preventDefault();
                      setSortDraft(d => ({ ...d, [c.id]: String(c.sort_order ?? 0) }));
                    }
                  }}
                />
                {editingId === c.id ? (
                  <>
                    <input
                      className="cell-input"
                      autoFocus
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleRename(c); }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                      }}
                    />
                    <button className="btn-sm btn-save" onClick={() => handleRename(c)} disabled={savingId === c.id || !editName.trim()}>
                      {savingId === c.id ? '保存中' : '保存'}
                    </button>
                    <button className="btn-sm" onClick={cancelEdit} disabled={savingId === c.id}>取消</button>
                  </>
                ) : (
                  <>
                    <span className="category-name">
                      {c.category_name}
                      {!!c.is_default && <span className="category-badge">默认</span>}
                    </span>
                    <span className="category-count">{c.product_count} 个商品</span>
                    <button className="btn-sm" onClick={() => startEdit(c)}>重命名</button>
                    <button
                      className="btn-sm btn-danger"
                      onClick={() => handleDelete(c)}
                      disabled={!!c.is_default || savingId === c.id}
                      title={c.is_default ? '默认分类不可删除' : ''}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            ))}
            {categories.length === 0 && <div className="category-empty">暂无类别</div>}
          </div>
        )}

        {customerCode && (
          <div className="category-add">
            <input
              className="cell-input"
              placeholder="新类别名称"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
            />
            <button className="btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? '添加中' : '新增类别'}
            </button>
          </div>
        )}

        <div className="backup-actions">
          <button className="btn-sm" onClick={() => onClose(changed)}>关闭</button>
        </div>
      </div>
    </div>
  );
}
