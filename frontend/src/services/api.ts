import type { Customer, DownstreamCustomer, Product, BatchInquiryResult, InquiryHistoryResponse, ExcelParseResult } from '../types/index.ts';

const BASE = '/api';

export async function fetchCustomers(): Promise<Customer[]> {
  const res = await fetch(`${BASE}/customers`);
  const json = await res.json();
  return json.data;
}

export async function fetchProducts(customerCode?: string): Promise<Product[]> {
  const url = customerCode
    ? `${BASE}/products?customer_code=${encodeURIComponent(customerCode)}`
    : `${BASE}/products`;
  const res = await fetch(url);
  const json = await res.json();
  return json.data;
}

export interface InquiryItem {
  customer_product_code: string;
  request_qty: number;
}

export async function submitInquiry(params: {
  customer_code: string;
  downstream_customer_id?: number;
  downstream_customer_name: string;
  items: InquiryItem[];
  inquiry_date: string;
}): Promise<BatchInquiryResult> {
  const res = await fetch(`${BASE}/inquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

export async function fetchInquiryHistory(params?: {
  page?: number;
  pageSize?: number;
  customer_code?: string;
  inquiry_date?: string;
  month?: string;
}): Promise<InquiryHistoryResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.customer_code) searchParams.set('customer_code', params.customer_code);
  if (params?.inquiry_date) searchParams.set('inquiry_date', params.inquiry_date);
  if (params?.month) searchParams.set('month', params.month);
  const res = await fetch(`${BASE}/inquiry/history?${searchParams}`);
  const json = await res.json();
  return json.data;
}

export async function fetchDownstreamCustomers(customerCode?: string): Promise<DownstreamCustomer[]> {
  const url = customerCode
    ? `${BASE}/inquiry/downstream-customers?customer_code=${encodeURIComponent(customerCode)}`
    : `${BASE}/inquiry/downstream-customers`;
  const res = await fetch(url);
  const json = await res.json();
  return json.data;
}

export async function createDownstreamCustomer(params: {
  customer_code: string;
  downstream_name: string;
  downstream_contact?: string;
  downstream_phone?: string;
}): Promise<DownstreamCustomer> {
  const res = await fetch(`${BASE}/inquiry/downstream-customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

export async function deleteDownstreamCustomer(id: number): Promise<void> {
  await fetch(`${BASE}/inquiry/downstream-customers/${id}`, { method: 'DELETE' });
}

export async function confirmInquiry(batchId: string): Promise<{ confirmed: boolean }> {
  const res = await fetch(`${BASE}/inquiry/confirm/${batchId}`, { method: 'POST' });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

export async function cancelInquiry(batchId: string): Promise<{ cancelled: boolean }> {
  const res = await fetch(`${BASE}/inquiry/cancel/${batchId}`, { method: 'POST' });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}

export async function parseExcelInquiry(customerCode: string, file: File): Promise<ExcelParseResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('customer_code', customerCode);
  const res = await fetch(`${BASE}/inquiry/excel/parse`, {
    method: 'POST',
    body: formData
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.data;
}
