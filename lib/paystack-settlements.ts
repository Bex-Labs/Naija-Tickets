import {
  listPaystackSettlementTransactions,
  listPaystackSettlements,
  getPaystackSubaccount,
} from './paystack.ts';

export type Settlement = {
  id: string;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  grossKobo: number;
  feesKobo: number;
  amountKobo: number;
  date: string;
  updatedAt: string;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid settlement response.');
  return value as Record<string, unknown>;
}
function money(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid settlement amount.');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('Invalid settlement date.');
  return new Date(value).toISOString();
}
export function providerId(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('Invalid provider ID.');
  if (!/^[1-9][0-9]{0,19}$/.test(String(value)))
    throw new Error('Invalid provider ID.');
  return String(value);
}
export function parseSettlement(value: unknown): Settlement {
  const row = object(value);
  if (row.domain !== 'live' || row.currency !== 'NGN')
    throw new Error('Only live NGN settlements can be recorded.');
  if (
    !['success', 'pending', 'processing', 'failed'].includes(String(row.status))
  )
    throw new Error('Unknown settlement status.');
  const grossKobo = money(row.total_processed);
  const feesKobo = money(row.total_fees);
  const amountKobo = money(row.effective_amount);
  // Do not guess how refund/chargeback deductions should be allocated.
  if (
    (row.deductions != null && row.deductions !== 0) ||
    grossKobo !== feesKobo + amountKobo
  )
    throw new Error('Settlement deductions need reconciliation.');
  return {
    id: providerId(row.id),
    status:
      row.status === 'success' ? 'paid' : (row.status as Settlement['status']),
    grossKobo,
    feesKobo,
    amountKobo,
    date: date(row.settlement_date),
    updatedAt: date(row.updatedAt),
  };
}
export function settlementTransaction(value: unknown) {
  const row = object(value);
  if (
    row.domain !== 'live' ||
    row.currency !== 'NGN' ||
    row.status !== 'success' ||
    typeof row.reference !== 'string' ||
    !/^[A-Za-z0-9.=-]{8,100}$/.test(row.reference)
  )
    throw new Error('Invalid settlement transaction.');
  return { reference: row.reference, amountKobo: money(row.amount) };
}

// Every page must be fetched: a partial batch must never become a paid payout.
export async function allPages(
  fetchPage: (
    page: number,
  ) => Promise<{ data: unknown[]; meta?: { pageCount?: number } }>,
) {
  const rows: unknown[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = await fetchPage(page);
    if (!Array.isArray(result.data))
      throw new Error('Invalid settlement list.');
    rows.push(...result.data);
    const pages = result.meta?.pageCount;
    if (
      typeof pages !== 'number' ||
      !Number.isInteger(pages) ||
      pages < 0 ||
      pages > 100
    )
      throw new Error('Incomplete settlement pagination.');
    if (page >= pages) return rows;
  }
  throw new Error('Settlement history needs additional reconciliation.');
}

export async function reconcileSubaccount(
  code: string,
  record: (
    settlement: Settlement,
    transactions: { reference: string; amountKobo: number }[],
  ) => Promise<void>,
  signal: AbortSignal,
) {
  const { data: account } = await getPaystackSubaccount(code, signal);
  if (account.subaccount_code !== code || account.domain !== 'live')
    throw new Error('Settlement account does not match.');
  const id = providerId(account.id);
  const settlements = await allPages((page) =>
    listPaystackSettlements(id, page, signal),
  );
  for (const raw of settlements) {
    const settlement = parseSettlement(raw);
    if (settlement.grossKobo === 0 && settlement.amountKobo === 0) continue;
    const rows = await allPages((page) =>
      listPaystackSettlementTransactions(settlement.id, page, signal),
    );
    const transactions = rows.map(settlementTransaction);
    if (
      !transactions.length ||
      new Set(transactions.map((row) => row.reference)).size !==
        transactions.length
    )
      throw new Error('Settlement transactions are missing or duplicated.');
    await record(settlement, transactions);
  }
}
