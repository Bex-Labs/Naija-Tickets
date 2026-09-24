export const transactionStatuses = [
  'all',
  'verified',
  'pending',
  'failed',
  'abandoned',
  'expired',
  'refunded',
  'partially_refunded',
  'needs_review',
] as const;

export type TransactionStatusFilter = (typeof transactionStatuses)[number];
export type TransactionMethodFilter = 'all' | 'paystack' | 'demo_free';

export type AdminTransaction = {
  id: string;
  reference: string;
  createdAt: string;
  customerName: string;
  customerEmail: string | null;
  eventTitle: string;
  amountKobo: number;
  currency: string;
  paymentMethod: string;
  provider: string | null;
  providerReference: string | null;
  status: Exclude<TransactionStatusFilter, 'all'>;
  orderStatus: string;
  paymentStatus: string;
  verifiedAt: string | null;
};

export type AdminTransactionsPage = {
  total: number;
  page: number;
  pageSize: number;
  transactions: AdminTransaction[];
};
