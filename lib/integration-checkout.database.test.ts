import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostedCheckoutTestDatabase,
  hostedCheckoutFixtureSql,
  hostedFixtureIds as ids,
} from './test-support/hosted-checkout-database.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
import {
  hostedSessionSecret,
  hostedSecretDigest,
} from './integrations/checkout-access.ts';
import {
  parseReservationInput,
  reservationPayloadHash,
  reservationRpcInput,
} from './checkout-service.ts';
const signing = {
  activeVersion: 'v1',
  keys: { v1: 'isolated-test-only-' + 'x'.repeat(50) },
};
void test('hosted sessions reuse transactional checkout, customer history and verified individual/group/free issuance', async (t) => {
  const db = await createHostedCheckoutTestDatabase();
  try {
    await db.exec(hostedCheckoutFixtureSql());
    const app = (
      await db.query<{ app: { id: string } }>(
        "select public.save_organiser_integration($1,null,$2,'Partner','active',$3::jsonb,$4::uuid[]) as app",
        [
          ids.owner,
          ids.org,
          JSON.stringify([
            { environment: 'live', origin: 'https://partner.example' },
            { environment: 'test', origin: 'http://localhost:3001' },
          ]),
          [ids.event],
        ],
      )
    ).rows[0].app;
    const key = await generateIntegrationCredential('live');
    await db.query(
      "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'live',$7::text[],now()+interval '90 days',null)",
      [
        ids.owner,
        app.id,
        key.id,
        key.digest,
        key.prefix,
        key.suffix,
        ['integration:read', 'checkout:write', 'orders:read'],
      ],
    );
    const create = async (
      ticket = ids.tier,
      quantity = 1,
      idem = crypto.randomUUID(),
      event = ids.event,
      url = 'https://partner.example/done',
      credential = key,
    ) => {
      const environment = credential === key ? 'live' : 'test';
      const identity = {
        id: crypto.randomUUID(),
        environment: environment as 'live' | 'test',
        expires_at: new Date(Date.now() + 1800000).toISOString(),
        signing_key_version: 'v1',
      };
      const access = await hostedSessionSecret(identity, 'access', signing),
        reservation = await hostedSessionSecret(
          identity,
          'reservation',
          signing,
        );
      const item = [{ ticket_type_id: ticket, quantity }],
        payload = await hostedSecretDigest(
          JSON.stringify({ event, item, url }),
        );
      const row = (
        await db.query<{ session: { id: string; capability_hash: string } }>(
          'select public.create_integration_checkout_session($1,$2,$3,$4,$5,$6::jsonb,null,$7,$7,$8,$9,$10,$11,$12,$13) as session',
          [
            credential.id,
            credential.digest,
            environment,
            identity.id,
            event,
            JSON.stringify(item),
            url,
            await hostedSecretDigest(idem),
            payload,
            await hostedSecretDigest(access),
            await hostedSecretDigest(reservation),
            'v1',
            identity.expires_at,
          ],
        )
      ).rows[0].session;
      return {
        identity: { ...identity, id: row.id },
        id: row.id,
        access,
        reservation,
        payload,
        item,
        idem,
      };
    };
    const buyer = {
      name: 'Test buyer',
      email: 'buyer@example.test',
      phone: '08012345678',
    };
    const reserve = async (
      s: Awaited<ReturnType<typeof create>>,
      customer: string | null = ids.customer,
      changedName = 'Test buyer',
    ) => {
      const input = parseReservationInput({
        eventId: ids.event,
        items: s.item.map((item) => ({
          ticketTypeId: item.ticket_type_id,
          quantity: item.quantity,
          attendees:
            item.ticket_type_id === ids.group
              ? []
              : Array.from({ length: item.quantity }, () => buyer),
        })),
        purchaser: { ...buyer, name: changedName },
        promoCode: '',
      });
      const rpc = reservationRpcInput(
        input,
        customer,
        await hostedSecretDigest(s.reservation),
      );
      return (
        await db.query<{
          reservation: {
            orderId: string;
            totalKobo: number;
            subtotalKobo: number;
            feeKobo: number;
            reference: string;
          };
        }>(
          'select public.reserve_hosted_checkout($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) as reservation',
          [
            s.id,
            await hostedSecretDigest(s.access),
            customer,
            JSON.stringify(rpc.p_items),
            JSON.stringify(rpc.p_purchaser),
            null,
            await reservationPayloadHash(input, customer),
          ],
        )
      ).rows[0].reservation;
    };
    const reject = async (run: () => Promise<unknown>, pattern: RegExp) => {
      await db.exec('savepoint rejection');
      await assert.rejects(run, pattern);
      await db.exec(
        'rollback to savepoint rejection;release savepoint rejection',
      );
    };
    const scenario = async (name: string, run: () => Promise<void>) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await run();
        } finally {
          await db.exec('rollback');
        }
      });
    await scenario(
      'creation stores intent only; same idempotency key replays original session while differing payload conflicts',
      async () => {
        const s = await create();
        const replay = await create(ids.tier, 1, s.idem);
        assert.equal(replay.id, s.id);
        assert.equal(
          (await db.query('select * from public.orders')).rows.length,
          0,
        );
        assert.equal(
          (await db.query('select * from public.reservations')).rows.length,
          0,
        );
        await reject(
          () => create(ids.tier, 2, s.idem),
          /Idempotency payload conflict/,
        );
        await reject(
          () => create(ids.tier, 1, crypto.randomUUID(), ids.otherEvent),
          /Event not found/,
        );
        for (const url of [
          'https://evil.example/done',
          'https://partner.example.evil/done',
          'https://partner.example/done?secret=x',
          'https://partner.example@evil.example/done',
        ])
          await reject(
            () => create(ids.tier, 1, crypto.randomUUID(), ids.event, url),
            /Return URL/,
          );
      },
    );
    await scenario(
      'reservation response loss reuses one order/hold and preserves first verified customer linkage',
      async () => {
        const s = await create(ids.tier, 2);
        const first = await reserve(s);
        const replay = await reserve(s);
        assert.equal(replay.orderId, first.orderId);
        assert.equal(
          (await db.query('select * from public.orders')).rows.length,
          1,
        );
        const order = (
          await db.query<{
            customer_id: string;
            integration_checkout_session_id: string;
            subtotal_kobo: string;
          }>(
            'select customer_id,integration_checkout_session_id,subtotal_kobo from public.orders where id=$1',
            [first.orderId],
          )
        ).rows[0];
        assert.equal(order.customer_id, ids.customer);
        assert.equal(order.integration_checkout_session_id, s.id);
        assert.equal(Number(order.subtotal_kobo), 100000);
        await reject(() => reserve(s, null), /Reservation payload conflict/);
        await reject(
          () => reserve(s, ids.customer, 'Someone else'),
          /Reservation payload conflict/,
        );
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select quantity_reserved as n from public.ticket_types where id=$1',
              [ids.tier],
            )
          ).rows[0].n,
          2,
        );
        const snapshot = (
          await db.query<{ v: Record<string, unknown> }>(
            'select public.get_integration_checkout_session($1,$2,$3,$4) as v',
            [key.id, key.digest, 'live', s.id],
          )
        ).rows[0].v;
        assert.equal(snapshot.status, 'reserved');
        assert.ok(!JSON.stringify(snapshot).includes(buyer.email));
        assert.ok(!JSON.stringify(snapshot).includes(first.reference));
      },
    );
    await scenario(
      'verified group purchase counts ten admissions, duplicate callback/webhook cannot issue again, failures cannot downgrade paid state',
      async () => {
        const s = await create(ids.group, 2);
        const order = await reserve(s);
        const tokenHash = await hostedSecretDigest(s.reservation);
        const prepared = (
          await db.query<{ payment_reference: string }>(
            'select * from public.prepare_paystack_payment($1,$2)',
            [order.orderId, tokenHash],
          )
        ).rows[0];
        const finish = (
          status = 'success',
          amount = order.totalKobo,
          currency = 'NGN',
          event: string | null = null,
        ) =>
          db.query<{ outcome: string }>(
            "select * from public.finalize_paystack_payment($1,$2,$3,$4,'111','{}'::jsonb,$5,'charge.success','hash')",
            [prepared.payment_reference, status, amount, currency, event],
          );
        assert.equal(
          (await finish('success', order.totalKobo, 'NGN', 'event-1')).rows[0]
            .outcome,
          'success',
        );
        assert.equal(
          (await finish('success', order.totalKobo, 'NGN', 'event-1')).rows[0]
            .outcome,
          'duplicate_event',
        );
        assert.equal((await finish()).rows[0].outcome, 'already_paid');
        assert.equal((await finish('failed')).rows[0].outcome, 'already_paid');
        assert.equal(
          (await finish('success', 1)).rows[0].outcome,
          'amount_or_currency_mismatch',
        );
        assert.equal(
          (
            await db.query<{ n: string }>(
              'select status::text as n from public.payments where provider_reference=$1',
              [prepared.payment_reference],
            )
          ).rows[0].n,
          'verified',
        );
        assert.equal(
          (
            await db.query(
              "select * from public.tickets where claim_state='UNCLAIMED' and display_code is null and qr_token_hash is null",
            )
          ).rows.length,
          10,
        );
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select quantity_sold as n from public.ticket_types where id=$1',
              [ids.group],
            )
          ).rows[0].n,
          10,
        );
        const returned = (
          await db.query<{
            v: { url: string; status: string; session_id: string };
          }>('select public.integration_checkout_return($1,false) as v', [
            order.orderId,
          ])
        ).rows[0].v;
        assert.equal(returned.status, 'paid');
        assert.equal(returned.session_id, s.id);
        assert.ok(!JSON.stringify(returned).includes(order.reference));
        await db.query(
          'delete from public.integration_domains where integration_id=$1',
          [app.id],
        );
        assert.equal(
          (
            await db.query<{ v: null }>(
              'select public.integration_checkout_return($1,false) as v',
              [order.orderId],
            )
          ).rows[0].v,
          null,
        );
      },
    );
    await scenario(
      'free hosted bookings use existing issuance/payment proof and ordinary tickets get distinct usable QR records',
      async () => {
        const s = await create(ids.free, 2);
        const order = await reserve(s, null);
        assert.equal(order.totalKobo, 0);
        const first = (
          await db.query<{ outcome: string }>(
            'select * from public.complete_free_checkout($1,$2)',
            [order.orderId, await hostedSecretDigest(s.reservation)],
          )
        ).rows[0];
        assert.equal(first.outcome, 'success');
        assert.equal(
          (
            await db.query(
              'select * from public.complete_free_checkout($1,$2)',
              [order.orderId, await hostedSecretDigest(s.reservation)],
            )
          ).rows.length,
          1,
        );
        const qr = (
          await db.query<{ display_code: string; qr_token_hash: string }>(
            'select display_code,qr_token_hash from public.tickets',
          )
        ).rows;
        assert.equal(qr.length, 2);
        assert.equal(new Set(qr.map((q) => q.display_code)).size, 2);
        assert.equal(new Set(qr.map((q) => q.qr_token_hash)).size, 2);
      },
    );
    await scenario(
      'mode isolation, scopes, expired capability, disabled/revoked issuer and cancellation block unpaid work',
      async () => {
        const s = await create();
        await reject(
          () =>
            db.query('select public.get_hosted_checkout($1,$2)', [
              s.id,
              'b'.repeat(64),
            ]),
          /Checkout not found/,
        );
        await reject(
          () =>
            db.query('select public.require_integration_resource_mode($1)', [
              'test',
            ]),
          /not configured/,
        );
        await db.query(
          "update public.integration_checkout_sessions set expires_at=now()-interval '1 second',created_at=now()-interval '1 hour' where id=$1",
          [s.id],
        );
        await reject(() => reserve(s), /Checkout expired/);
        const active = await create();
        await db.query(
          'update public.integration_api_keys set revoked_at=now() where id=$1',
          [key.id],
        );
        await reject(() => reserve(active), /Checkout disabled/);
        await db.query(
          'update public.integration_api_keys set revoked_at=null where id=$1',
          [key.id],
        );
        const hold = await reserve(active);
        await db.query('select public.cancel_hosted_checkout($1,$2)', [
          active.id,
          await hostedSecretDigest(active.access),
        ]);
        assert.equal(
          (
            await db.query<{ v: string }>(
              'select status::text as v from public.orders where id=$1',
              [hold.orderId],
            )
          ).rows[0].v,
          'expired',
        );
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select quantity_reserved as n from public.ticket_types where id=$1',
              [ids.tier],
            )
          ).rows[0].n,
          0,
        );
        await reject(() => reserve(active), /Checkout expired/);
      },
    );
    await scenario(
      'payment leases serialize starts and fence stale provider responses without creating another reference',
      async () => {
        const s = await create();
        const order = await reserve(s);
        const a = crypto.randomUUID(),
          b = crypto.randomUUID(),
          hash = await hostedSecretDigest(s.reservation);
        const claim = async (id: string) =>
          (
            await db.query<{
              v: { outcome: string; payment_reference: string };
            }>(
              'select public.claim_checkout_payment_initialization($1,$2,$3) as v',
              [order.orderId, hash, id],
            )
          ).rows[0].v;
        const first = await claim(a);
        assert.equal(first.outcome, 'ready');
        assert.equal((await claim(b)).outcome, 'initialization_busy');
        await db.query(
          "update public.payments set initialize_lease_expires_at=now()-interval '1 second' where order_id=$1",
          [order.orderId],
        );
        const next = await claim(b);
        assert.equal(next.payment_reference, first.payment_reference);
        const finish = async (id: string) =>
          (
            await db.query<{ v: boolean }>(
              "select public.finish_checkout_payment_initialization($1,$2,'https://checkout.paystack.com/test','test','{}'::jsonb,null,null) as v",
              [first.payment_reference, id],
            )
          ).rows[0].v;
        assert.equal(await finish(a), false);
        assert.equal(await finish(b), true);
        assert.equal((await claim(a)).outcome, 'ready');
        assert.equal(
          (await db.query('select * from public.payments')).rows.length,
          1,
        );
      },
    );
    await scenario(
      'status requires its own scope and current application/event grant; foreign application cannot see a session',
      async () => {
        const s = await create();
        const read = () =>
          db.query(
            'select public.get_integration_checkout_session($1,$2,$3,$4)',
            [key.id, key.digest, 'live', s.id],
          );
        await db.query(
          "update public.integration_api_keys set scopes='{checkout:write}' where id=$1",
          [key.id],
        );
        await reject(read, /Insufficient scope/);
        await db.query(
          "update public.integration_api_keys set scopes='{checkout:write,orders:read}',created_at=now()-interval '1 hour',expires_at=now()-interval '1 second' where id=$1",
          [key.id],
        );
        await reject(read, /Invalid API key/);
        await db.query(
          "update public.integration_api_keys set expires_at=now()+interval '1 day' where id=$1",
          [key.id],
        );
        await db.query(
          'delete from public.integration_event_grants where integration_id=$1',
          [app.id],
        );
        await reject(read, /Checkout not found/);
        await db.query(
          'insert into public.integration_event_grants values($1,$2,$3)',
          [app.id, ids.org, ids.event],
        );
        const other = (
          await db.query<{ v: { id: string } }>(
            "select public.save_organiser_integration($1,null,$2,'Second partner','active','[]'::jsonb,$3::uuid[]) as v",
            [ids.owner, ids.org, [ids.event]],
          )
        ).rows[0].v;
        const foreign = await generateIntegrationCredential('live');
        await db.query(
          "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'live','{orders:read}',now()+interval '1 day',null)",
          [
            ids.owner,
            other.id,
            foreign.id,
            foreign.digest,
            foreign.prefix,
            foreign.suffix,
          ],
        );
        await reject(
          () =>
            db.query(
              'select public.get_integration_checkout_session($1,$2,$3,$4)',
              [foreign.id, foreign.digest, 'live', s.id],
            ),
          /Checkout not found/,
        );
        await db.query(
          "update public.integrations set status='disabled' where id=$1",
          [app.id],
        );
        await reject(read, /Invalid API key/);
        await reject(() => reserve(s), /Checkout disabled/);
      },
    );
    await scenario(
      'only an explicitly isolated test resource database accepts its own test key and localhost returns',
      async () => {
        const testKey = await generateIntegrationCredential('test');
        await db.query(
          "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'test','{checkout:write,orders:read,events:read}',now()+interval '1 day',null)",
          [
            ids.owner,
            app.id,
            testKey.id,
            testKey.digest,
            testKey.prefix,
            testKey.suffix,
          ],
        );
        const testCreate = () =>
          create(
            ids.free,
            2,
            crypto.randomUUID(),
            ids.event,
            'http://localhost:3001/done',
            testKey,
          );
        await reject(testCreate, /not configured/);
        await db.exec(
          "update public.integration_resource_settings set environment='test',project_ref='abcdefghijklmnopqrst',live_project_ref='zyxwvutsrqponmlkjihg'",
        );
        await reject(() => create(), /not configured/);
        const s = await testCreate();
        const booking = await reserve(s, null);
        await db.query('select public.complete_free_checkout($1,$2)', [
          booking.orderId,
          await hostedSecretDigest(s.reservation),
        ]);
        const status = (
          await db.query<{
            v: { environment: string; status: string; admissions: number };
          }>(
            'select public.get_integration_checkout_session($1,$2,$3,$4) as v',
            [testKey.id, testKey.digest, 'test', s.id],
          )
        ).rows[0].v;
        assert.equal(status.environment, 'test');
        assert.equal(status.status, 'paid');
        assert.equal(status.admissions, 2);
        await db.query(
          "select public.require_integration_event_reader($1,$2,'test','events:read')",
          [testKey.id, testKey.digest],
        );
      },
    );
    await scenario(
      'mismatched, failed and late provider verification cannot issue tickets or create another hosted payment reference',
      async () => {
        const s = await create(),
          booking = await reserve(s);
        const hash = await hostedSecretDigest(s.reservation);
        const prepared = (
          await db.query<{ payment_reference: string }>(
            'select * from public.prepare_paystack_payment($1,$2)',
            [booking.orderId, hash],
          )
        ).rows[0];
        const finish = (
          status: string,
          amount = booking.totalKobo,
          currency = 'NGN',
        ) =>
          db.query<{ outcome: string }>(
            "select * from public.finalize_paystack_payment($1,$2,$3,$4,'late-transaction','{}'::jsonb,null,null,null)",
            [prepared.payment_reference, status, amount, currency],
          );
        assert.equal(
          (await finish('success', 1)).rows[0].outcome,
          'amount_or_currency_mismatch',
        );
        assert.equal(
          (
            await db.query<{ outcome: string }>(
              'select * from public.prepare_paystack_payment($1,$2)',
              [booking.orderId, hash],
            )
          ).rows[0].outcome,
          'failed',
        );
        assert.equal(
          (await db.query('select * from public.payments')).rows.length,
          1,
        );
        assert.equal(
          (await db.query('select * from public.tickets')).rows.length,
          0,
        );
        await db.query(
          "update public.orders set reservation_expires_at=now()-interval '1 second' where id=$1",
          [booking.orderId],
        );
        await db.query(
          "update public.reservations set expires_at=now()-interval '1 second' where order_item_id in (select id from public.order_items where order_id=$1)",
          [booking.orderId],
        );
        assert.equal(
          (await finish('success')).rows[0].outcome,
          'reservation_expired',
        );
        assert.equal(
          (await db.query('select * from public.tickets')).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select quantity_reserved as n from public.ticket_types where id=$1',
              [ids.tier],
            )
          ).rows[0].n,
          0,
        );
        const state = (
          await db.query<{ v: { status: string } }>(
            'select public.integration_checkout_snapshot($1) as v',
            [s.id],
          )
        ).rows[0].v;
        assert.equal(state.status, 'expired');
      },
    );
    await scenario(
      'event-level dates now protect ordinary and hosted reservations; browser roles cannot invoke private or legacy helpers',
      async () => {
        const s = await create();
        await db.query(
          "update public.events set sales_start_at=now()+interval '1 day' where id=$1",
          [ids.event],
        );
        await reject(() => reserve(s), /Event sales/);
        for (const role of ['anon', 'authenticated', 'service_role']) {
          await db.exec(`set role ${role}`);
          for (const sql of role === 'service_role'
            ? ['select public.release_checkout_order_pre_hosted(null)']
            : [
                'select public.get_hosted_checkout(null,null)',
                'select public.cancel_hosted_checkout(null,null)',
                'select public.create_integration_checkout_session(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)',
                'select public.get_integration_resource_settings()',
              ]) {
            await reject(() => db.query(sql), /permission denied/);
          }
          await db.exec('reset role');
        }
      },
    );
  } finally {
    await db.close();
  }
});
