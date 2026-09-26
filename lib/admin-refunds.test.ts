import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePaystackRefund } from './admin-refunds.ts';

void test('Paystack refund details must identify one NGN transaction and amount', () => {
  const data = {
    id: 12345,
    transaction: { id: 67890 },
    amount: 12500,
    currency: 'NGN',
    status: 'processed',
  };
  assert.deepEqual(parsePaystackRefund(data, '12345'), {
    id: '12345',
    transactionId: '67890',
    amountKobo: 12500,
    currency: 'NGN',
    providerStatus: 'processed',
  });
  assert.throws(() => parsePaystackRefund({ ...data, id: 54321 }, '12345'));
  assert.throws(() => parsePaystackRefund({ ...data, amount: -1 }, '12345'));
  assert.throws(() =>
    parsePaystackRefund({ ...data, currency: 'USD' }, '12345'),
  );
  assert.throws(() =>
    parsePaystackRefund({ ...data, status: 'unknown' }, '12345'),
  );
  assert.throws(() =>
    parsePaystackRefund({ ...data, transaction: null }, '12345'),
  );
});
