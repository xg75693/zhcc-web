export interface Customer {
  id: number;
  customer_code: string;
  customer_name: string | null;
}

export interface DownstreamCustomer {
  id: number;
  customer_code: string;
  downstream_name: string;
  downstream_contact: string | null;
  downstream_phone: string | null;
}

export interface Product {
  id: number;
  warehouse_code: string;
  customer_code: string;
  customer_product_code: string;
  product_name: string;
  spec: string;
  stock_qty: number;
}

export interface InquiryResultItem {
  inquiry_id?: number;
  customer_code?: string;
  customer_product_code: string;
  warehouse_code?: string;
  product_name?: string;
  spec?: string;
  request_qty: number;
  stock_qty?: number;
  frozen_qty?: number;
  available_qty?: number;
  result: 'approved' | 'rejected';
  result_text: string;
  inquiry_date?: string;
}

export interface BatchInquiryResult {
  batch_id: string;
  batch_result: 'approved' | 'rejected';
  batch_result_text: string;
  downstream_customer_name: string;
  inquiry_date: string;
  items: InquiryResultItem[];
}

export interface InquiryRecord {
  id: number;
  batch_id: string;
  customer_code: string;
  customer_name: string | null;
  downstream_customer_id: number | null;
  downstream_customer_name: string | null;
  product_id: number;
  warehouse_code: string;
  customer_product_code: string;
  product_name: string;
  request_qty: number;
  stock_qty: number;
  frozen_qty: number;
  available_qty: number;
  result: 'approved' | 'rejected';
  batch_result: 'approved' | 'rejected';
  inquiry_date: string;
  create_time: string;
}

export interface InquiryHistoryResponse {
  records: InquiryRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExcelParseRule {
  id: number;
  customer_code: string;
  rule_name: string;
  sheet_index: number;
  downstream_name_cell: string;
  downstream_name_extra_cells: string | null;
  product_code_start_cell: string;
  quantity_column_offset: number;
  end_marker: string;
  empty_value_treat_as_zero: number;
  is_default: number;
}

export interface ExcelParseResultItem {
  customer_product_code: string;
  warehouse_code: string;
  product_name: string;
  spec: string;
  request_qty: number;
}

export interface ExcelParseResult {
  downstream_customer: DownstreamCustomer | null;
  unmatched_downstream_hint: string | null;
  items: ExcelParseResultItem[];
  unmatched_items: { code: string; qty: number; reason: string }[];
  rule: ExcelParseRule;
}
