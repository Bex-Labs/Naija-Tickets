export type PaystackRefundRecord = {
  id: string;
  transactionId: string;
  amountKobo: number;
  currency: 'NGN';
  providerStatus:
    | 'pending'
    | 'processing'
    | 'needs-attention'
    | 'processed'
    | 'failed';
};

const providerStatuses = new Set<PaystackRefundRecord['providerStatus']>([
  'pending',
  'processing',
  'needs-attention',
  'processed',
  'failed',
]);

function numericId(value: unknown) {
  const result = String(value);
  return /^[0-9]{1,20}$/.test(result) ? result : null;
}

export function parsePaystackRefund(
  value: unknown,
  expectedId: string,
): PaystackRefundRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('Paystack returned an invalid refund record.');
  }
  const record = value as Record<string, unknown>;
  const transaction = record.transaction;
  const transactionId = numericId(
    transaction && typeof transaction === 'object'
      ? (transaction as Record<string, unknown>).id
      : transaction,
  );
  const amount = Number(record.amount);
  const id = numericId(record.id);
  if (
    !id ||
    id !== expectedId ||
    !transactionId ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    record.currency !== 'NGN' ||
    !providerStatuses.has(
      record.status as PaystackRefundRecord['providerStatus'],
    )
  ) {
    throw new Error('Paystack returned an invalid refund record.');
  }
  return {
    id,
    transactionId,
    amountKobo: amount,
    currency: 'NGN',
    providerStatus: record.status as PaystackRefundRecord['providerStatus'],
  };
}
