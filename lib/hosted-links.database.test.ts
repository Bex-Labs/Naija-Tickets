import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';
import { hostedCheckoutMigration } from './test-support/hosted-checkout-database.ts';
import {
  hostedSessionSecret,
  hostedSecretDigest,
} from './integrations/checkout-access.ts';
void test('hosted links reuse scoped sessions and protect organiser, event, selection and accounting boundaries', async (t) => {
  const f = await createOperationsFixture();
  const { db, ids, app, key, signing } = f;
  try {
    await db.exec(
      hostedCheckoutMigration('202610160004_integration_readiness.sql'),
    );
    await db.exec(
      hostedCheckoutMigration('202610170001_hosted_checkout_links.sql'),
    );
    await db.exec(
      hostedCheckoutMigration('202610170002_hosted_report_efficiency.sql'),
    );
    const scalar = async <T>(sql: string, values: unknown[] = []) =>
      (await db.query<{ v: T }>(sql, values)).rows[0].v;
    const configure = (
      user = ids.owner,
      event = ids.event,
      returnUrl = 'https://partner.example/done',
      enabled = true,
    ) =>
      scalar<{ id: string; publicId: string; revision: number }>(
        'select public.manage_hosted_checkout_link($1,$2,$3,$4,$5,$5,$6) v',
        [user, app.id, event, 'live', returnUrl, enabled],
      );
    await t.test(
      'only managers can configure assigned owned events with registered returns',
      async () => {
        await assert.rejects(configure(ids.customer));
        await assert.rejects(configure(ids.owner, ids.otherEvent));
        await assert.rejects(
          configure(ids.owner, ids.event, 'https://evil.example/'),
        );
      },
    );
    const link = await configure();
    assert.match(link.publicId, /^nt_link_[a-f0-9]{32}$/);
    const create = async (
      publicId = link.publicId,
      event = ids.event,
      revision = link.revision,
    ) => {
      const id = crypto.randomUUID(),
        session = {
          id,
          environment: 'live' as const,
          expires_at: new Date(Date.now() + 1500000).toISOString(),
          signing_key_version: 'v1',
        };
      const access = await hostedSessionSecret(session, 'access', signing),
        digest = await hostedSecretDigest(access);
      await scalar(
        'select public.create_scoped_integration_session(null,null,$1,$2,$3,$4,null,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) v',
        [
          'live',
          id,
          event,
          '[]',
          'https://partner.example/done',
          await hostedSecretDigest(id),
          await hostedSecretDigest('payload'),
          digest,
          await hostedSecretDigest(
            await hostedSessionSecret(session, 'reservation', signing),
          ),
          'v1',
          session.expires_at,
          publicId,
          'https://partner.example',
          revision,
        ],
      );
      return { id, access, digest };
    };
    await t.test(
      'public link actor binds exact event, mode, enabled revision and registered origin',
      async () => {
        await assert.rejects(create(link.publicId, ids.otherEvent));
        await assert.rejects(create('nt_link_' + 'a'.repeat(32)));
        await assert.rejects(create(link.publicId, ids.event, 99));
      },
    );
    const s = await create();
    await t.test(
      'new no-code session has live catalogue but holds no inventory before reservation',
      async () => {
        const details = await scalar<{
          catalogue: unknown[];
          lines: unknown[];
          return_url: string;
        }>('select public.hosted_checkout_details($1,$2) v', [s.id, s.digest]);
        assert.ok(details.catalogue.length >= 2);
        assert.ok(
          details.catalogue.every((row) => {
            const tier = row as {
              max_packages: number;
              remaining_packages: number;
            };
            return tier.remaining_packages >= tier.max_packages;
          }),
        );
        assert.equal(details.lines.length, 0);
        assert.equal(details.return_url, 'https://partner.example/done');
        assert.equal(
          await scalar('select count(*)::integer v from public.orders'),
          0,
        );
        await assert.rejects(
          scalar('select public.hosted_checkout_details($1,$2) v', [
            s.id,
            'f'.repeat(64),
          ]),
        );
      },
    );
    let legacySession: { id: string; digest: string } | null = null;
    await t.test(
      'existing widget actors still create and read hosted sessions under the extended schema',
      async () => {
        const snapshot = await f.deps.read(f.selection),
          identity = {
            id: crypto.randomUUID(),
            environment: 'live' as const,
            expires_at: new Date(Date.now() + 1200000).toISOString(),
            signing_key_version: 'v1',
          };
        const digest = await hostedSecretDigest(
          await hostedSessionSecret(identity, 'access', signing),
        );
        const stored = await f.deps.create(f.selection, {
          session: identity,
          intent: {
            event_id: ids.event,
            items: [{ ticket_type_id: ids.group, quantity: 1 }],
            promo_code: null,
            return_url: 'https://partner.example/done',
            cancel_url: 'https://partner.example/done',
          },
          revision: snapshot.actor.revision,
          idempotencyDigest: await hostedSecretDigest(
            'legacy-widget-' + identity.id,
          ),
          payloadHash: await hostedSecretDigest('legacy-payload'),
          accessHash: digest,
          reservationHash: await hostedSecretDigest(
            await hostedSessionSecret(identity, 'reservation', signing),
          ),
        });
        assert.equal(stored.source, 'legacy_widget');
        assert.ok(
          await scalar('select public.get_hosted_checkout($1,$2) v', [
            identity.id,
            digest,
          ]),
        );
        legacySession = { id: identity.id, digest };
      },
    );
    const select = (items: unknown) =>
      scalar('select public.update_hosted_selection($1,$2,$3::jsonb,null) v', [
        s.id,
        s.digest,
        JSON.stringify(items),
      ]);
    await t.test(
      'selection rejects foreign tickets, bad quantities and prices, and counts group admissions',
      async () => {
        await assert.rejects(
          select([{ ticket_type_id: ids.otherEvent, quantity: 1 }]),
        );
        await assert.rejects(
          select([{ ticket_type_id: ids.group, quantity: 0 }]),
        );
        await assert.rejects(
          select([{ ticket_type_id: ids.group, quantity: 2, price: 1 }]),
        );
        await select([{ ticket_type_id: ids.group, quantity: 2 }]);
        const snapshot = await scalar<{ admissions: number }>(
          'select public.integration_checkout_snapshot($1) v',
          [s.id],
        );
        assert.equal(snapshot.admissions, 10);
      },
    );
    await t.test(
      'a reservation uses the existing capacity engine and locks subsequent selection changes',
      async () => {
        const purchaser = {
          name: 'Hosted Buyer',
          email: 'hosted@example.test',
          phone: '+2348001234500',
        };
        await scalar(
          'select public.reserve_hosted_checkout($1,$2,null,$3::jsonb,$4::jsonb,null,$5) v',
          [
            s.id,
            s.digest,
            JSON.stringify([
              { ticket_type_id: ids.group, quantity: 2, attendees: [] },
            ]),
            JSON.stringify(purchaser),
            await hostedSecretDigest('reservation'),
          ],
        );
        assert.equal(
          await scalar(
            'select quantity_reserved v from public.ticket_types where id=$1',
            [ids.group],
          ),
          10,
        );
        await assert.rejects(
          select([{ ticket_type_id: ids.group, quantity: 1 }]),
        );
      },
    );
    await t.test(
      'optional API selections and customer prefill reuse free fulfilment, idempotency and refund status',
      async () => {
        const identity = {
          id: crypto.randomUUID(),
          environment: 'live' as const,
          expires_at: new Date(Date.now() + 1200000).toISOString(),
          signing_key_version: 'v1',
        };
        const access = await hostedSessionSecret(identity, 'access', signing),
          digest = await hostedSecretDigest(access),
          reservation = await hostedSecretDigest(
            await hostedSessionSecret(identity, 'reservation', signing),
          );
        const args = [
          key.id,
          key.digest,
          'live',
          identity.id,
          ids.event,
          '[]',
          null,
          'https://partner.example/done',
          'https://partner.example/done',
          await hostedSecretDigest(identity.id),
          await hostedSecretDigest('api-optional'),
          digest,
          reservation,
          'v1',
          identity.expires_at,
          JSON.stringify({ email: 'api-prefill@example.test' }),
          'ABUJA-TGIF-123',
        ];
        const statement =
          'select public.create_hosted_session_v2(' +
          args.map((_, i) => '$' + (i + 1)).join(',') +
          ') v';
        await assert.rejects(
          scalar(
            statement,
            args.map((v, i) => (i === 1 ? 'f'.repeat(64) : v)),
          ),
        );
        const first = await scalar<{
          id: string;
          source: string;
          external_reference: string;
        }>(statement, args);
        assert.equal(first.source, 'hosted_api');
        assert.equal(first.external_reference, 'ABUJA-TGIF-123');
        assert.equal(
          (await scalar<{ id: string }>(statement, args)).id,
          first.id,
        );
        const details = await scalar<{ customer: { email: string } }>(
          'select public.hosted_checkout_details($1,$2) v',
          [identity.id, digest],
        );
        assert.equal(details.customer.email, 'api-prefill@example.test');
        await scalar(
          'select public.update_hosted_selection($1,$2,$3::jsonb,null) v',
          [
            identity.id,
            digest,
            JSON.stringify([{ ticket_type_id: ids.free, quantity: 1 }]),
          ],
        );
        const attendee = {
          name: 'API Test Guest',
          email: 'api-prefill@example.test',
          phone: '+2348001234599',
        };
        const booked = await scalar<{ orderId: string }>(
          'select public.reserve_hosted_checkout($1,$2,null,$3::jsonb,$4::jsonb,null,$5) v',
          [
            identity.id,
            digest,
            JSON.stringify([
              { ticket_type_id: ids.free, quantity: 1, attendees: [attendee] },
            ]),
            JSON.stringify(attendee),
            await hostedSecretDigest('api-reservation'),
          ],
        );
        const consumed = await scalar<{ customer: Record<string, unknown> }>(
          'select public.hosted_checkout_details($1,$2) v',
          [identity.id, digest],
        );
        assert.deepEqual(consumed.customer, {});
        await scalar(
          'select to_jsonb(x) v from public.complete_free_checkout($1,$2) x',
          [booked.orderId, reservation],
        );
        await scalar(
          'select to_jsonb(x) v from public.complete_free_checkout($1,$2) x',
          [booked.orderId, reservation],
        );
        const paid = await scalar<{ status: string; tickets_issued: number }>(
          'select public.integration_checkout_snapshot($1) v',
          [identity.id],
        );
        assert.equal(paid.status, 'paid');
        assert.equal(paid.tickets_issued, 1);
        assert.equal(
          await scalar(
            'select count(*)::integer v from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1',
            [booked.orderId],
          ),
          1,
        );
        await db.query(
          "update public.orders set status='refunded' where id=$1",
          [booked.orderId],
        );
        await db.query(
          "update public.payments set status='refunded' where order_id=$1",
          [booked.orderId],
        );
        assert.equal(
          (
            await scalar<{ status: string }>(
              'select public.integration_checkout_snapshot($1) v',
              [identity.id],
            )
          ).status,
          'refunded',
        );
      },
    );
    await t.test(
      'expired prefill is cleared without deleting sessions or financial history',
      async () => {
        const pending = await create();
        await db.query(
          "update public.integration_checkout_sessions set created_at=now()-interval '1 hour',expires_at=now()-interval '1 minute',customer_prefill=$2::jsonb where id=$1",
          [pending.id, JSON.stringify({ email: 'expired@example.test' })],
        );
        assert.equal(
          await scalar<number>('select public.purge_hosted_prefill($1,50) v', [
            'live',
          ]),
          1,
        );
        assert.deepEqual(
          await scalar(
            'select customer_prefill v from public.integration_checkout_sessions where id=$1',
            [pending.id],
          ),
          {},
        );
        assert.equal(
          await scalar('select count(*)::integer v from public.orders'),
          2,
        );
      },
    );
    await t.test(
      'disabling a link blocks its unpaid sessions, without affecting an API key',
      async () => {
        await configure(
          ids.owner,
          ids.event,
          'https://partner.example/done',
          false,
        );
        await assert.rejects(
          scalar('select public.get_hosted_checkout($1,$2) v', [
            s.id,
            s.digest,
          ]),
        );
        assert.ok(
          await scalar(
            'select public.authenticate_integration_key($1,$2,$3) v',
            [key.id, key.digest, 'live'],
          ),
        );
      },
    );
    assert.ok(legacySession);
    assert.ok(
      await scalar('select public.get_hosted_checkout($1,$2) v', [
        (legacySession as { id: string; digest: string }).id,
        (legacySession as { id: string; digest: string }).digest,
      ]),
    );
    await t.test(
      'manager report is scoped and contains no attendee contacts or capability secrets',
      async () => {
        const report = await scalar<{ report: { sessions: unknown[] } }>(
          'select public.organiser_hosted_overview($1,$2) v',
          [ids.owner, app.id],
        );
        assert.equal(report.report.sessions.length, 4);
        assert.ok(!JSON.stringify(report).includes(s.access));
        assert.ok(!JSON.stringify(report).includes('hosted@example.test'));
        await assert.rejects(
          scalar('select public.organiser_hosted_overview($1,$2) v', [
            ids.customer,
            app.id,
          ]),
        );
      },
    );
    await t.test(
      'public browser database roles have no link, mint, selection or report authority',
      async () => {
        for (const role of ['anon', 'authenticated']) {
          const access = await scalar<boolean>(
            "select has_table_privilege($1,'public.integration_hosted_links','SELECT') v",
            [role],
          );
          assert.equal(access, false);
          assert.equal(
            await scalar(
              "select has_function_privilege($1,'public.update_hosted_selection(uuid,text,jsonb,text)','EXECUTE') v",
              [role],
            ),
            false,
          );
        }
      },
    );
  } finally {
    await db.close();
  }
});
