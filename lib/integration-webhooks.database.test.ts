import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostedCheckoutTestDatabase,
  hostedCheckoutFixtureSql,
  hostedCheckoutMigration,
  hostedFixtureIds as ids,
} from './test-support/hosted-checkout-database.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
import { WEBHOOK_EVENTS } from './integrations/webhook-types.ts';
import type { WebhookDashboard } from './integrations/webhook-types.ts';
import type { WebhookJob } from './integrations/webhook-dispatch.ts';

void test('transactional outbox and durable delivery reuse authoritative checkout, claims, entry and refunds', async (t) => {
  const db = await createHostedCheckoutTestDatabase();
  try {
    await db.exec(hostedCheckoutMigration('202609230004_event_entry.sql'));
    await db.exec(hostedCheckoutMigration('202609250001_admin_refunds.sql'));
    await db.exec(
      hostedCheckoutMigration('202610160001_integration_webhooks.sql'),
    );
    await db.exec(hostedCheckoutFixtureSql());
    const app = (
      await db.query<{ app: { id: string } }>(
        "select public.save_organiser_integration($1,null,$2,'Partner','active',$3::jsonb,$4::uuid[]) as app",
        [
          ids.owner,
          ids.org,
          JSON.stringify([
            { environment: 'live', origin: 'https://partner.com' },
          ]),
          [ids.event],
        ],
      )
    ).rows[0].app.id;
    const key = await generateIntegrationCredential('live');
    await db.query(
      "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'live',$7::text[],now()+interval '90 days',null)",
      [
        ids.owner,
        app,
        key.id,
        key.digest,
        key.prefix,
        key.suffix,
        ['checkout:write', 'orders:read'],
      ],
    );
    const endpoint = crypto.randomUUID();
    const ciphertext = 'v1.' + 'x'.repeat(120);
    const saveEndpoint = (
      user = ids.owner,
      mode = 'live',
      origin = 'https://partner.com',
    ) =>
      db.query(
        'select public.save_integration_webhook($1,$2,$3,$4,$5,$6,$7::text[],$8)',
        [
          user,
          app,
          crypto.randomUUID(),
          mode,
          origin + '/hook',
          origin,
          [...WEBHOOK_EVENTS],
          ciphertext,
        ],
      );
    await db.query(
      "select public.save_integration_webhook($1,$2,$3,'live','https://partner.com/webhook','https://partner.com',$4::text[],$5)",
      [ids.owner, app, endpoint, [...WEBHOOK_EVENTS], ciphertext],
    );
    const count = async (type: string) =>
      Number(
        (
          await db.query<{ n: number }>(
            'select count(*)::int n from public.integration_outbox_events where type=$1',
            [type],
          )
        ).rows[0].n,
      );
    const jobs = async () =>
      (
        await db.query<{ jobs: WebhookJob[] }>(
          "select public.claim_integration_webhooks('live',5) jobs",
        )
      ).rows[0].jobs;
    const authorized = async (job: WebhookJob) =>
      (
        await db.query<{ ok: boolean }>(
          'select public.authorize_integration_webhook_send($1,$2) ok',
          [job.id, job.leaseId],
        )
      ).rows[0].ok;
    const finish = async (
      job: WebhookJob,
      outcome = 'success',
      http: number | null = 200,
    ) =>
      (
        await db.query<{ ok: boolean }>(
          'select public.finish_integration_webhook($1,$2,$3,$4,30) ok',
          [job.id, job.leaseId, http, outcome],
        )
      ).rows[0].ok;
    const dashboard = async (user = ids.owner, cursor: string | null = null) =>
      (
        await db.query<{ data: WebhookDashboard }>(
          'select public.list_integration_webhooks($1,$2,$3) data',
          [user, app, cursor],
        )
      ).rows[0].data;
    const book = async (tier: string, quantity = 1) => {
      const sid = crypto.randomUUID(),
        token = crypto.randomUUID().replaceAll('-', '').repeat(2);
      await db.query(
        "select public.create_integration_checkout_session($1,$2,'live',$3,$4,$5::jsonb,null,'https://partner.com/done','https://partner.com/cancel',$6,$6,$7,$8,'v1',now()+interval '30 minutes')",
        [
          key.id,
          key.digest,
          sid,
          ids.event,
          JSON.stringify([{ ticket_type_id: tier, quantity }]),
          crypto.randomUUID().replaceAll('-', '').repeat(2),
          'a'.repeat(64),
          token,
        ],
      );
      const item = {
        ticket_type_id: tier,
        quantity,
        attendees:
          tier === ids.group
            ? []
            : Array.from({ length: quantity }, () => ({
                name: 'Buyer',
                email: 'buyer@example.com',
                phone: '08012345678',
              })),
      };
      const booking = (
        await db.query<{
          booking: { orderId: string; reference: string; totalKobo: number };
        }>(
          'select public.reserve_hosted_checkout($1,$2,$3,$4::jsonb,$5::jsonb,null,$6) booking',
          [
            sid,
            'a'.repeat(64),
            ids.customer,
            JSON.stringify([item]),
            JSON.stringify({
              name: 'Buyer',
              email: 'buyer@example.com',
              phone: '08012345678',
            }),
            'c'.repeat(64),
          ],
        )
      ).rows[0].booking;
      return { ...booking, token };
    };
    await t.test(
      'private tables/functions, explicit manager and origin/mode restrictions',
      async () => {
        await assert.rejects(() => saveEndpoint(ids.customer), /permission/);
        await assert.rejects(() => saveEndpoint(ids.owner, 'test'), /matching/);
        await assert.rejects(
          () => saveEndpoint(ids.owner, 'live', 'https://foreign.com'),
          /matching/,
        );
        await assert.rejects(() => dashboard(ids.customer), /permission/);
        await db.exec('set role anon');
        for (const table of [
          'integration_webhook_endpoints',
          'integration_outbox_events',
          'integration_webhook_deliveries',
          'integration_webhook_attempts',
        ])
          await assert.rejects(
            () => db.query(`select * from public.${table}`),
            /permission denied/,
          );
        await assert.rejects(() => jobs(), /permission denied/);
        await db.exec('reset role; set role service_role');
        await assert.rejects(
          () =>
            db.query(
              "select public.emit_integration_event($1,'order.paid',$1)",
              [crypto.randomUUID()],
            ),
          /permission denied/,
        );
        await db.exec('reset role');
      },
    );
    await t.test(
      'rollback removes booking and outbox together; committed creation survives process loss',
      async () => {
        await db.exec('begin');
        await book(ids.free);
        await db.exec('set constraints all immediate');
        assert.equal(await count('order.created'), 1);
        await db.exec('rollback');
        assert.equal(await count('order.created'), 0);
      },
    );
    const free = await book(ids.free);
    await t.test(
      'free checkout atomically emits one paid and usable ticket event; replay cannot duplicate',
      async () => {
        await db.query('select public.complete_free_checkout($1,$2)', [
          free.orderId,
          free.token,
        ]);
        await db.query('select public.complete_free_checkout($1,$2)', [
          free.orderId,
          free.token,
        ]);
        assert.equal(await count('order.created'), 1);
        assert.equal(await count('order.paid'), 1);
        assert.equal(await count('ticket.issued'), 1);
      },
    );
    const group = await book(ids.group, 2);
    let groupReference = '';
    await t.test(
      'failed/mismatched payment emits no success; verified payment reserves 10 group slots without usable issuance',
      async () => {
        const attempt = (
          await db.query<{ payment_reference: string }>(
            'select * from public.prepare_paystack_payment($1,$2)',
            [group.orderId, group.token],
          )
        ).rows[0];
        groupReference = attempt.payment_reference;
        await db.query(
          "select * from public.finalize_paystack_payment($1,'success',1,'NGN','provider-group','{}')",
          [groupReference],
        );
        assert.equal(await count('order.paid'), 1);
        await db.query(
          "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','provider-group','{}')",
          [groupReference, group.totalKobo],
        );
        await db.query(
          "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','provider-group','{}')",
          [groupReference, group.totalKobo],
        );
        assert.equal(await count('order.paid'), 2);
        assert.equal(await count('group.admissions_reserved'), 1);
        assert.equal(await count('ticket.issued'), 1);
        const slots = (
          await db.query<{ n: number }>(
            "select count(*)::int n from public.tickets where claim_state='UNCLAIMED'",
          )
        ).rows[0].n;
        assert.equal(slots, 10);
      },
    );
    let claimedTicket = '';
    await t.test(
      'group claim issues one event; normal entry emits check-in once; verified full refund emits once',
      async () => {
        const invite = (
          await db.query<{ token: string }>(
            'select invite_token token from public.group_bookings',
          )
        ).rows[0].token;
        await db.query(
          "select public.claim_group_ticket($1,'Member','member@example.com','08011112222')",
          [invite],
        );
        const ticket = (
          await db.query<{ id: string; code: string }>(
            "select id,display_code code from public.tickets where group_booking_id is not null and claim_state='CLAIMED'",
          )
        ).rows[0];
        claimedTicket = ticket.id;
        assert.equal(await count('ticket.issued'), 2);
        await assert.rejects(
          () =>
            db.query(
              "select public.claim_group_ticket($1,'Duplicate','member@example.com','08022223333')",
              [invite],
            ),
          /already claimed/,
        );
        await db.query('select public.verify_event_entry($1,$2,$3,true)', [
          ids.owner,
          ids.event,
          ticket.code,
        ]);
        await db.query('select public.verify_event_entry($1,$2,$3,true)', [
          ids.owner,
          ids.event,
          ticket.code,
        ]);
        assert.equal(await count('ticket.checked_in'), 1);
        assert.equal(await count('ticket.issued'), 2);
        await db.query(
          "select public.record_admin_refund($1,'123','provider-group',$2,'NGN','processed','Test refund','admin-test')",
          [group.orderId, group.totalKobo],
        );
        await db.query(
          "select public.record_admin_refund($1,'123','provider-group',$2,'NGN','processed','Test refund','admin-test')",
          [group.orderId, group.totalKobo],
        );
        assert.equal(await count('refund.completed'), 1);
        const payloads = JSON.stringify(
          (await db.query('select body from public.integration_outbox_events'))
            .rows,
        );
        for (const sensitive of [
          'buyer@example',
          'member@example',
          '0801111',
          invite,
          free.reference,
          group.reference,
          'qr_token_hash',
          'display_code',
        ])
          assert.ok(!payloads.includes(sensitive), sensitive);
        assert.ok(payloads.includes(claimedTicket));
      },
    );
    await t.test(
      'late verified payments cannot emit paid or usable-ticket events after the hold is released',
      async () => {
        await db.exec('begin');
        try {
          const booking = await book(ids.tier);
          const attempt = (
            await db.query<{ payment_reference: string }>(
              'select * from public.prepare_paystack_payment($1,$2)',
              [booking.orderId, booking.token],
            )
          ).rows[0];
          await db.query('select public.release_checkout_order($1)', [
            booking.orderId,
          ]);
          await db.query(
            "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','late-provider','{}')",
            [attempt.payment_reference, booking.totalKobo],
          );
          await db.exec('set constraints all immediate');
          assert.equal(await count('order.paid'), 2);
          assert.equal(await count('ticket.issued'), 2);
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test(
      'history paginates without duplicates and automatic retries exhaust after eight attempts',
      async () => {
        await db.exec('begin');
        try {
          for (let i = 0; i < 7; i++) {
            const booking = await book(ids.free);
            await db.query('select public.complete_free_checkout($1,$2)', [
              booking.orderId,
              booking.token,
            ]);
          }
          await db.exec('set constraints all immediate');
          const first = await dashboard();
          assert.equal(first.deliveries.length, 20);
          assert.ok(first.nextCursor);
          const second = await dashboard(ids.owner, first.nextCursor);
          assert.ok(second.deliveries.length > 0);
          assert.ok(
            second.deliveries.every(
              (item) =>
                !first.deliveries.some((previous) => previous.id === item.id),
            ),
          );
          // Isolate one delivery while retaining the real lease/attempt functions.
          const chosen = first.deliveries[0].id;
          await db.query(
            "update public.integration_webhook_deliveries set next_attempt_at=now()+interval '1 day' where id<>$1",
            [chosen],
          );
          for (let i = 1; i <= 8; i++) {
            const job = (await jobs())[0];
            assert.equal(job.id, chosen);
            assert.equal(job.attempt, i);
            await finish(job, 'http_retry', 503);
            await db.query(
              'update public.integration_webhook_deliveries set next_attempt_at=now() where id=$1',
              [chosen],
            );
          }
          assert.deepEqual(await jobs(), []);
          assert.equal(
            (await dashboard()).deliveries.find((item) => item.id === chosen)!
              .status,
            'exhausted',
          );
          for (let i = 0; i < 3; i++) {
            await db.query(
              'select public.retry_integration_webhook($1,$2,$3)',
              [ids.owner, app, chosen],
            );
            await finish((await jobs())[0], 'http_permanent', 400);
          }
          await db.exec('savepoint retry_limit');
          await assert.rejects(
            () =>
              db.query('select public.retry_integration_webhook($1,$2,$3)', [
                ids.owner,
                app,
                chosen,
              ]),
            /at most three/,
          );
          await db.exec('rollback to retry_limit');
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test(
      'leases exclude other workers, expire/recover, fence stale results and record bounded diagnostics',
      async () => {
        const first = await jobs();
        assert.equal(first.length, 5);
        const second = await jobs();
        assert.ok(
          second.every(
            (job) => !first.some((previous) => previous.id === job.id),
          ),
        );
        const job = first[0];
        assert.ok(await authorized(job));
        await db.query(
          "update public.integration_webhook_deliveries set lease_expires_at=now()-interval '1 second' where id=$1",
          [job.id],
        );
        const recovered = (await jobs()).find((item) => item.id === job.id)!;
        assert.ok(recovered);
        assert.notEqual(recovered.leaseId, job.leaseId);
        assert.equal(await finish(job), false);
        assert.ok(await finish(recovered));
        assert.equal(await finish(recovered), false);
        const history = (await dashboard()).deliveries.find(
          (item) => item.id === job.id,
        )!.history;
        assert.equal(
          history.find((item) => item.attempt === 1)!.outcome,
          'lease_expired',
        );
        assert.equal(
          history.find((item) => item.attempt === 2)!.outcome,
          'success',
        );
        for (const remaining of [...first.slice(1), ...second])
          await finish(remaining, 'http_permanent', 400);
      },
    );
    await t.test(
      'manual retry is tenant-authorized and bounded; rotation, pause, revocation and event grant removal block sends',
      async () => {
        const delivery = (await dashboard()).deliveries.find(
          (item) => item.status === 'exhausted',
        )!;
        await assert.rejects(
          () =>
            db.query('select public.retry_integration_webhook($1,$2,$3)', [
              ids.customer,
              app,
              delivery.id,
            ]),
          /permission/,
        );
        await db.query('select public.retry_integration_webhook($1,$2,$3)', [
          ids.owner,
          app,
          delivery.id,
        ]);
        const job = (await jobs()).find((item) => item.id === delivery.id)!;
        assert.ok(job);
        await db.query(
          'select public.update_integration_webhook($1,$2,$3,false,null)',
          [ids.owner, app, endpoint],
        );
        assert.equal(await authorized(job), false);
        await db.query(
          'select public.update_integration_webhook($1,$2,$3,true,$4)',
          [ids.owner, app, endpoint, 'v2.' + 'y'.repeat(120)],
        );
        assert.equal(await authorized(job), false);
        await db.query(
          "update public.integration_webhook_deliveries set lease_expires_at=now()-interval '1 second' where id=$1",
          [job.id],
        );
        const updated = (await jobs()).find((item) => item.id === job.id)!;
        assert.ok(await authorized(updated));
        await db.query(
          'delete from public.integration_event_grants where integration_id=$1',
          [app],
        );
        assert.equal(await authorized(updated), false);
        await db.query(
          'insert into public.integration_event_grants values($1,$2,$3)',
          [app, ids.org, ids.event],
        );
        await db.query(
          'update public.organiser_memberships set can_manage_integrations=false where user_id=$1',
          [ids.owner],
        );
        assert.equal(await authorized(updated), false);
        assert.deepEqual(await jobs(), []);
        await db.query(
          'update public.organiser_memberships set can_manage_integrations=true where user_id=$1',
          [ids.owner],
        );
        const data = await dashboard();
        assert.ok(!JSON.stringify(data).includes(ciphertext));
        assert.ok(!JSON.stringify(data).includes('encrypted_secret'));
        assert.equal(data.endpoints[0].enabled, false);
        await db.query('select public.retire_integration_webhook($1,$2,$3)', [
          ids.owner,
          app,
          endpoint,
        ]);
        await assert.rejects(
          () =>
            db.query(
              'select public.update_integration_webhook($1,$2,$3,true,null)',
              [ids.owner, app, endpoint],
            ),
          /not found/,
        );
        assert.ok((await dashboard()).endpoints[0].retiredAt);
        await saveEndpoint();
      },
    );
  } finally {
    await db.close();
  }
});
