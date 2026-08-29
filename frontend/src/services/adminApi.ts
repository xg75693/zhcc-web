import type { ExcelParseRule } from '../types/index.ts';

const BASE = `${import.meta.env.BASE_URL}api/admin`.replace(/\/+$/, '');

function getToken(): string | null {
  return localStorage.getItem('admin_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/admin';
    throw new Error('登录已过期');
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

// ===== 登录 =====
export async function adminLogin(username: string, password: string): Promise<{ token: string; username: string }> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

// ===== 客户 =====
export interface AdminCustomer {
  id: number;
  customer_code: string;
  customer_name: string | null;
}

export async function fetchAdminCustomers(): Promise<AdminCustomer[]> {
  return request(`${BASE}/customers`);
}

export async function createAdminCustomer(data: { customer_code: string; customer_name?: string }) {
  return request(`${BASE}/customers`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAdminCustomer(id: number, data: { customer_code: string; customer_name?: string }) {
  return request(`${BASE}/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteAdminCustomer(id: number) {
  return request(`${BASE}/customers/${id}`, { method: 'DELETE' });
}

// ===== 收货单位 =====
export interface AdminDownstreamCustomer {
  id: number;
  customer_code: string;
  downstream_name: string;
  downstream_contact: string | null;
  downstream_phone: string | null;
  upstream_customer_name: string | null;
}

export async function fetchAdminDownstreamCustomers(): Promise<AdminDownstreamCustomer[]> {
  return request(`${BASE}/downstream-customers`);
}

export async function createAdminDownstreamCustomer(data: {
  customer_code: string;
  downstream_name: string;
  downstream_contact?: string;
  downstream_phone?: string;
}) {
  return request(`${BASE}/downstream-customers`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAdminDownstreamCustomer(id: number, data: {
  customer_code: string;
  downstream_name: string;
  downstream_contact?: string;
  downstream_phone?: string;
}) {
  return request(`${BASE}/downstream-customers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteAdminDownstreamCustomer(id: number) {
  return request(`${BASE}/downstream-customers/${id}`, { method: 'DELETE' });
}

// ===== 导出 =====
export function exportMonthlyReport(year: number, month: number, customerCode: string, customerName: string) {
  const token = getToken();
  const url = `${BASE}/export?year=${year}&month=${month}&customer_code=${encodeURIComponent(customerCode)}`;
  // 使用 fetch 下载并带 auth
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(async res => {
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error || '导出失败');
      }
      return res.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${month}月${customerName}进出库明细.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}

// ===== Excel 解析规则 =====
export async function fetchExcelRules(customerCode?: string): Promise<ExcelParseRule[]> {
  const qs = customerCode ? `?customer_code=${encodeURIComponent(customerCode)}` : '';
  return request(`${BASE}/excel-rules${qs}`);
}

export async function createExcelRule(data: Omit<ExcelParseRule, 'id'>) {
  return request(`${BASE}/excel-rules`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateExcelRule(id: number, data: Omit<ExcelParseRule, 'id'>) {
  return request(`${BASE}/excel-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteExcelRule(id: number) {
  return request(`${BASE}/excel-rules/${id}`, { method: 'DELETE' });
}

export async function setDefaultExcelRule(id: number) {
  return request(`${BASE}/excel-rules/${id}/set-default`, { method: 'POST' });
}

// ===== 商品类别 =====
// 类别按客户隔离：每个客户一套，其中 is_default 的那条不可删除，是商品的兜底归属。
export interface AdminProductCategory {
  id: number;
  customer_code: string;
  category_name: string;
  is_default: number;
  /** 分类排序，值小的在前；相同则默认分类优先、再按名称 */
  sort_order: number;
  customer_name: string | null;
  product_count: number;
}

export async function fetchAdminCategories(customerCode?: string): Promise<AdminProductCategory[]> {
  const qs = customerCode ? `?customer_code=${encodeURIComponent(customerCode)}` : '';
  return request(`${BASE}/categories${qs}`);
}

export async function createAdminCategory(data: { customer_code: string; category_name: string; sort_order?: number }) {
  return request(`${BASE}/categories`, { method: 'POST', body: JSON.stringify(data) });
}

/** 传什么改什么：只改名、只改排序、或两者一起 */
export async function updateAdminCategory(id: number, data: { category_name?: string; sort_order?: number }) {
  return request(`${BASE}/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteAdminCategory(id: number): Promise<{ success: boolean; moved_to_default: number }> {
  return request(`${BASE}/categories/${id}`, { method: 'DELETE' });
}

// ===== 商品管理 =====
export interface AdminProduct {
  id: number;
  warehouse_code: string;
  customer_code: string;
  customer_product_code: string;
  product_name: string;
  spec: string | null;
  category_id: number | null;
  category_name: string | null;
  stock_qty: number;
  customer_name: string | null;
}

export async function fetchAdminProducts(customerCode?: string): Promise<AdminProduct[]> {
  const qs = customerCode ? `?customer_code=${encodeURIComponent(customerCode)}` : '';
  return request(`${BASE}/products${qs}`);
}

export async function createAdminProduct(data: {
  warehouse_code: string;
  customer_code: string;
  customer_product_code?: string;
  product_name?: string;
  spec?: string;
  category_id?: number | null;
  stock_qty?: number;
}) {
  return request(`${BASE}/products`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAdminProduct(id: number, data: {
  warehouse_code: string;
  customer_code: string;
  customer_product_code?: string;
  product_name?: string;
  spec?: string;
  category_id?: number | null;
  stock_qty?: number;
}) {
  return request(`${BASE}/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteAdminProduct(id: number) {
  return request(`${BASE}/products/${id}`, { method: 'DELETE' });
}

// ===== 入库管理 =====
export interface StockInRecord {
  id: number;
  customer_code: string;
  product_id: number;
  warehouse_code: string;
  stock_in_date: string;
  stock_in_qty: number;
  defective_qty: number;
  actual_qty: number;
  remark: string | null;
  product_name: string | null;
  spec: string | null;
  customer_product_code: string | null;
  customer_name: string | null;
}

export async function fetchStockInRecords(params?: {
  customer_code?: string;
  start_date?: string;
  end_date?: string;
}): Promise<StockInRecord[]> {
  const searchParams = new URLSearchParams();
  if (params?.customer_code) searchParams.set('customer_code', params.customer_code);
  if (params?.start_date) searchParams.set('start_date', params.start_date);
  if (params?.end_date) searchParams.set('end_date', params.end_date);
  const qs = searchParams.toString();
  return request(`${BASE}/stock-in${qs ? '?' + qs : ''}`);
}

export async function createStockInRecord(data: {
  customer_code: string;
  product_id: number;
  warehouse_code: string;
  stock_in_date: string;
  stock_in_qty: number;
  defective_qty?: number;
  remark?: string;
}) {
  return request(`${BASE}/stock-in`, { method: 'POST', body: JSON.stringify(data) });
}

export async function updateStockInRecord(id: number, data: {
  customer_code: string;
  product_id: number;
  warehouse_code: string;
  stock_in_date: string;
  stock_in_qty: number;
  defective_qty?: number;
  remark?: string;
}) {
  return request(`${BASE}/stock-in/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteStockInRecord(id: number) {
  return request(`${BASE}/stock-in/${id}`, { method: 'DELETE' });
}

// ===== 一键备份 =====
export interface BackupCandidateItem {
  inquiry_id: number;
  product_id: number;
  warehouse_code: string;
  customer_code: string;
  customer_product_code: string | null;
  product_name: string | null;
  spec: string | null;
  freeze_qty: number;
  freeze_date: string;
}

export interface BackupCandidateBatch {
  batch_id: string;
  inquiry_date: string;
  downstream_customer_name: string;
  items: BackupCandidateItem[];
}

export interface BackupCandidates {
  freeze_before: string;
  batches: BackupCandidateBatch[];
}

export interface BackupResult {
  success: boolean;
  backup_date: string;
  freeze_before: string;
  total_products: number;
  total_backed_up: number;
  total_released_qty: number;
}

export interface BackupDateSummary {
  backup_date: string;
  product_count: number;
}

export interface ProductBackupRecord {
  id: number;
  backup_date: string;
  product_id: number;
  warehouse_code: string;
  customer_code: string;
  customer_product_code: string | null;
  product_name: string | null;
  spec: string | null;
  stock_qty: number;
  frozen_qty: number;
  remark: string | null;
  customer_name: string | null;
}

export async function fetchBackupCandidates(): Promise<BackupCandidates> {
  return request(`${BASE}/backup-candidates`);
}

export async function executeBackup(selectedInquiryIds: number[]): Promise<BackupResult> {
  return request(`${BASE}/backup`, {
    method: 'POST',
    body: JSON.stringify({ selected_inquiry_ids: selectedInquiryIds }),
  });
}

export async function fetchBackups(backupDate?: string): Promise<{ records: ProductBackupRecord[]; backup_dates: BackupDateSummary[] }> {
  const qs = backupDate ? `?backup_date=${encodeURIComponent(backupDate)}` : '';
  return request(`${BASE}/backups${qs}`);
}

// ===== 咨询记录管理 =====
export interface AdminInquiryRecord {
  id: number;
  batch_id: string | null;
  customer_code: string;
  customer_name: string | null;
  customer_product_code: string | null;
  warehouse_code: string;
  product_name: string | null;
  product_id: number;
  inquiry_date: string;
  request_qty: number;
  stock_qty: number;
  frozen_qty: number;
  available_qty: number;
  result: string;
  error_text: string | null;
  downstream_customer_name: string | null;
  batch_result: string | null;
  create_time: string;
}

export async function fetchAdminInquiryRecords(params?: {
  customer_code?: string;
  month?: string;
  downstream_customer_name?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ records: AdminInquiryRecord[]; total: number; months: string[]; upstreams: { customer_code: string; customer_name: string | null }[]; downstreams: string[] }> {
  const searchParams = new URLSearchParams();
  if (params?.customer_code) searchParams.set('customer_code', params.customer_code);
  if (params?.month) searchParams.set('month', params.month);
  if (params?.downstream_customer_name) searchParams.set('downstream_customer_name', params.downstream_customer_name);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  return request(`${BASE}/inquiry-records?${searchParams}`);
}

export async function deleteAdminInquiryRecord(id: number): Promise<{ success: boolean }> {
  return request(`${BASE}/inquiry-records/${id}`, { method: 'DELETE' });
}
