import { IntegrationError } from './errors.ts';
export type PopupTransaction = {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  id: number | string;
  domain?: string;
};
export async function verifyPopupPayment(
  expected: {
    reference: string;
    amount: number;
    currency: string;
    environment: 'test' | 'live';
  },
  dependencies: {
    verify(reference: string): Promise<{ data: PopupTransaction }>;
    record(reference: string, status: string, payload: unknown): Promise<void>;
    finalize(input: {
      reference: string;
      status: string;
      amountKobo: number;
      currency: string;
      transactionId: string;
      payload: unknown;
    }): Promise<{ outcome: string; order_id: string | null }>;
    deliver(orderId: string): void;
  },
) {
  const verification = await dependencies.verify(expected.reference),
    transaction = verification.data;
  if (
    transaction.reference !== expected.reference ||
    !Number.isSafeInteger(transaction.amount) ||
    transaction.amount !== expected.amount ||
    transaction.currency !== expected.currency ||
    transaction.domain !== expected.environment
  )
    throw new IntegrationError(
      409,
      'PAYMENT_MISMATCH',
      'Payment could not be verified for this booking.',
    );
  if (transaction.status !== 'success') {
    await dependencies.record(
      expected.reference,
      transaction.status,
      verification,
    );
    return false;
  }
  const result = await dependencies.finalize({
    reference: expected.reference,
    status: transaction.status,
    amountKobo: transaction.amount,
    currency: transaction.currency,
    transactionId: String(transaction.id),
    payload: verification,
  });
  if (!['success', 'already_paid', 'duplicate_event'].includes(result.outcome))
    return false;
  if (result.order_id) dependencies.deliver(result.order_id);
  return true;
}
