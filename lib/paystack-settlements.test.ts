import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allPages,
  parseSettlement,
  reconcileSubaccount,
  settlementTransaction,
} from './paystack-settlements.ts';
const settlement = {
  id: 123,
  domain: 'live',
  currency: 'NGN',
  status: 'success',
  total_processed: 4500000,
  total_fees: 50000,
  effective_amount: 4450000,
  deductions: null,
  settlement_date: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
};
void test('maps only confirmed live settlements to paid, with integer kobo unchanged', () => {
  assert.equal(parseSettlement(settlement).amountKobo, 4450000);
  assert.equal(parseSettlement(settlement).status, 'paid');
  for (const state of ['pending', 'processing', 'failed'])
    assert.equal(
      parseSettlement({ ...settlement, status: state }).status,
      state,
    );
});
void test('rejects test data, unknown statuses, malformed money and unallocated deductions', () => {
  for (const patch of [
    { domain: 'test' },
    { currency: 'USD' },
    { status: 'reversed' },
    { effective_amount: 4450000.5 },
    { total_fees: -1 },
    { effective_amount: 4490000 },
    { deductions: { refunds: 10 } },
    { settlement_date: 'bad' },
    { id: 9007199254740992 },
  ])
    assert.throws(() => parseSettlement({ ...settlement, ...patch }));
  assert.throws(() => settlementTransaction({ reference: 'abc', amount: 100 }));
});
void test('fetches all pages and fails rather than recording an incomplete batch', async () => {
  const visited: number[] = [];
  const rows = await allPages(async (page) => {
    visited.push(page);
    return { data: [page], meta: { pageCount: 3 } };
  });
  assert.deepEqual(visited, [1, 2, 3]);
  assert.deepEqual(rows, [1, 2, 3]);
  await assert.rejects(() =>
    allPages(async () => ({ data: [], meta: { pageCount: 101 } })),
  );
  await assert.rejects(() =>
    allPages(async (page) => {
      if (page === 2) throw new Error('unavailable');
      return { data: [1], meta: { pageCount: 2 } };
    }),
  );
});
void test('resolves the numeric subaccount and fetches every transaction before recording', async (t) => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_live_test_fixture_not_real';
  const paths: string[] = [];
  let records = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    paths.push(url.pathname + url.search);
    const body =
      url.pathname === '/subaccount/ACCT_fixture'
        ? { data: { id: 99, domain: 'live', subaccount_code: 'ACCT_fixture' } }
        : url.pathname === '/settlement'
          ? { data: [settlement], meta: { pageCount: 1 } }
          : {
              data: [
                {
                  domain: 'live',
                  currency: 'NGN',
                  status: 'success',
                  reference: `payment-ref-${url.searchParams.get('page')}`,
                  amount: 2250000,
                },
              ],
              meta: { pageCount: 2 },
            };
    return new Response(JSON.stringify({ status: true, ...body }));
  });
  await reconcileSubaccount(
    'ACCT_fixture',
    async (row, transactions) => {
      records++;
      assert.equal(row.id, '123');
      assert.equal(transactions.length, 2);
    },
    AbortSignal.timeout(1000),
  );
  assert.equal(records, 1);
  assert.ok(paths.includes('/settlement?subaccount=99&perPage=100&page=1'));
  assert.ok(paths.includes('/settlement/123/transactions?perPage=100&page=2'));
});
