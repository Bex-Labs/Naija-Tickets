import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';
import { hostedCheckoutMigration } from './test-support/hosted-checkout-database.ts';
import {
  generateIntegrationCredential,
  credentialDigest,
} from './integrations/keys.ts';

void test('one database isolates Test and Live no-code and API checkout', async (t) => {
  const main = await createOperationsFixture('live');
  const isolated = main;
  const source = 'b'.repeat(20);
  type Copy = {
    integrationId: string;
    organiserId: string;
    ownerId: string;
    keyId: string;
    events: Record<string, string>;
    tickets: Record<string, string>;
  };
  const scalar = async <T>(
    db: typeof main.db,
    sql: string,
    args: unknown[] = [],
  ) => (await db.query<{ v: T }>(sql, args)).rows[0].v;
  try {
    for (const f of [main])
      for (const migration of [
        '202610160004_integration_readiness.sql',
        '202610170001_hosted_checkout_links.sql',
        '202610170002_hosted_report_efficiency.sql',
        '202610180001_integration_lifecycle.sql',
        '202611120001_integrated_testing.sql',
        '202609200005_admin_sales_analytics.sql',
        '202609240001_admin_transactions.sql',
        '202611130001_single_project_testing.sql',
        '202611130002_integration_setup_path.sql',
      ])
        await f.db.exec(hostedCheckoutMigration(migration));
    await t.test(
      'API/no-code preference persists in authorised connection metadata',
      async () => {
        const saveArgs = [
          main.ids.owner,
          main.app.id,
          main.ids.org,
          JSON.stringify([
            { environment: 'test', origin: 'http://127.0.0.1:5500' },
          ]),
          [main.ids.event],
        ];
        const saved = await scalar<{ setupPath: string }>(
          main.db,
          "select public.save_integration_setup_v2($1,$2,$3,'Developer site','active',$4::jsonb,$5::uuid[],'test','local','api') v",
          saveArgs,
        );
        assert.equal(saved.setupPath, 'api');
        assert.equal(
          (
            await scalar<{ setupPath: string }>(
              main.db,
              'select public.integration_public_metadata($1) v',
              [main.app.id],
            )
          ).setupPath,
          'api',
        );
        await assert.rejects(
          () =>
            scalar(
              main.db,
              "select public.save_integration_setup_v2($1,$2,$3,'Developer site','active',$4::jsonb,$5::uuid[],'test','local','invalid') v",
              saveArgs,
            ),
          /Choose a checkout link/,
        );
        assert.equal(
          (
            await scalar<{ setupPath: string }>(
              main.db,
              'select public.integration_public_metadata($1) v',
              [main.app.id],
            )
          ).setupPath,
          'api',
        );
        await assert.rejects(() =>
          scalar(
            main.db,
            "select public.save_integration_setup_v2($1,$2,$3,'Unauthorised','active',$4::jsonb,$5::uuid[],'test','local','link') v",
            [main.ids.customer, ...saveArgs.slice(1)],
          ),
        );
      },
    );
    const key = await generateIntegrationCredential('test');
    await scalar(
      main.db,
      "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'test','{events:read,tickets:read,availability:read,checkout:write,orders:read,external_events:write,entry:verify,entry:check-in}',now()+interval '90 days',null) v",
      [main.ids.owner, main.app.id, key.id, key.digest, key.prefix, key.suffix],
    );
    const snapshot = () =>
      scalar<Record<string, unknown>>(
        main.db,
        'select public.integration_testing_snapshot($1,null,$2,$3) v',
        [main.app.id, key.id, key.digest],
      );
    await scalar(
      main.db,
      "select public.save_integration_setup($1,$2,$3,'My local website','active',$4::jsonb,$5::uuid[],'test','local') v",
      [
        main.ids.owner,
        main.app.id,
        main.ids.org,
        JSON.stringify([
          { environment: 'test', origin: 'http://127.0.0.1:5500' },
        ]),
        [main.ids.event],
      ],
    );
    const internalDigest = 'd'.repeat(64);
    const sync = async (value?: Record<string, unknown>) =>
      scalar<Copy>(
        isolated.db,
        'select public.sync_local_integration_test_copy($1,$2::jsonb,$3) v',
        [source, JSON.stringify(value ?? (await snapshot())), internalDigest],
      );
    const copy = await sync();
    await t.test(
      'test authority is private and Test keys cannot read live resources directly',
      async () => {
        await assert.rejects(
          () =>
            scalar(
              main.db,
              'select public.integration_testing_snapshot($1,$2) v',
              [main.app.id, main.ids.customer],
            ),
          /permission/,
        );
        await assert.rejects(
          () =>
            scalar(
              main.db,
              "select public.read_integration_events($1,$2,'test','list') v",
              [key.id, key.digest],
            ),
          /matching Test or Live/,
        );
        const copyEvent = await scalar<{
          is_test: boolean;
          external_managed: boolean;
        }>(
          main.db,
          "select jsonb_build_object('is_test',is_test,'external_managed',external_managed) v from public.events where id=$1",
          [copy.events[main.ids.event]],
        );
        assert.equal(copyEvent.is_test, true);
        assert.equal(copyEvent.external_managed, true);
        assert.notEqual(copy.events[main.ids.event], main.ids.event);
        assert.notEqual(copy.tickets[main.ids.free], main.ids.free);
        assert.equal(
          await scalar(
            isolated.db,
            "select public.authenticate_integration_key($1,$2,'test') v",
            [copy.keyId, key.digest],
          ),
          null,
        );
        assert.ok(
          await scalar(
            isolated.db,
            "select public.authenticate_integration_key($1,$2,'test') v",
            [copy.keyId, internalDigest],
          ),
        );
        for (const role of ['anon', 'authenticated']) {
          await isolated.db.exec('set role ' + role);
          await assert.rejects(
            () =>
              scalar(
                isolated.db,
                'select public.sync_local_integration_test_copy($1,$2::jsonb,$3) v',
                [source, '{}', internalDigest],
              ),
            /permission denied/,
          );
          await isolated.db.exec('reset role');
        }
      },
    );
    await t.test(
      'no-code links accept local return pages without switching workspaces',
      async () => {
        const link = await scalar<{ publicId: string }>(
          main.db,
          "select public.manage_hosted_checkout_link($1,$2,$3,'test','http://127.0.0.1:5500/dist/index.html','http://127.0.0.1:5500/dist/index.html',true) v",
          [main.ids.owner, main.app.id, main.ids.event],
        );
        const descriptor = await scalar<{
          environment: string;
          managedBy: string;
        }>(main.db, 'select public.read_main_test_link($1) v', [link.publicId]);
        assert.equal(descriptor.environment, 'test');
        assert.equal(descriptor.managedBy, main.ids.owner);
        const remote = await scalar<{ publicId: string; revision: number }>(
          isolated.db,
          "select public.manage_hosted_checkout_link($1,$2,$3,'test','http://127.0.0.1:5500/dist/index.html','http://127.0.0.1:5500/dist/index.html',true) v",
          [copy.ownerId, copy.integrationId, copy.events[main.ids.event]],
        );
        assert.notEqual(remote.publicId, link.publicId);
        assert.ok(
          await scalar(
            isolated.db,
            "select public.require_hosted_link($1,'test','http://127.0.0.1:5500',$2) v",
            [remote.publicId, copy.events[main.ids.event]],
          ),
        );
        const sessionId = crypto.randomUUID(),
          access = await credentialDigest('no-code-access-' + sessionId),
          token = await credentialDigest('no-code-token-' + sessionId);
        const started = await scalar<{ status: string; environment: string }>(
          isolated.db,
          "select public.create_scoped_integration_session(null,null,'test',$1,$2,'[]',null,'http://127.0.0.1:5500/dist/index.html','http://127.0.0.1:5500/dist/index.html',$3,$4,$5,$6,'v1',now()+interval '30 minutes',$7,'http://127.0.0.1:5500',$8) v",
          [
            sessionId,
            copy.events[main.ids.event],
            await credentialDigest(sessionId),
            await credentialDigest('no-code-' + sessionId),
            access,
            token,
            remote.publicId,
            remote.revision,
          ],
        );
        assert.equal(started.status, 'open');
        assert.equal(started.environment, 'test');
        const buyer = {
            name: 'No-code tester',
            email: 'no-code@example.test',
            phone: '08012345678',
          },
          items = [
            { ticket_type_id: copy.tickets[main.ids.free], quantity: 1 },
          ];
        await scalar(
          isolated.db,
          'select public.update_hosted_selection($1,$2,$3::jsonb,null) v',
          [sessionId, access, JSON.stringify(items)],
        );
        const reservation = await scalar<{ orderId: string }>(
          isolated.db,
          'select public.reserve_hosted_checkout($1,$2,null,$3::jsonb,$4::jsonb,null,$5) v',
          [
            sessionId,
            access,
            JSON.stringify([{ ...items[0], attendees: [buyer] }]),
            JSON.stringify(buyer),
            await credentialDigest('no-code-reserve-' + sessionId),
          ],
        );
        await scalar(
          isolated.db,
          'select public.complete_free_checkout($1,$2) v',
          [reservation.orderId, token],
        );
        assert.equal(
          await scalar(
            isolated.db,
            "select count(*)::integer v from public.tickets where event_id=$1 and status='valid'",
            [copy.events[main.ids.event]],
          ),
          1,
        );
        assert.equal(
          await scalar(
            main.db,
            'select quantity_sold v from public.ticket_types where id=$1',
            [main.ids.free],
          ),
          0,
        );
      },
    );
    await t.test(
      'API checkout issues a marked free test ticket and preserves live inventory and sales totals',
      async () => {
        const session = crypto.randomUUID(),
          token = 'e'.repeat(64),
          access = 'f'.repeat(64),
          intent = [
            { ticket_type_id: copy.tickets[main.ids.free], quantity: 1 },
          ];
        const stored = await scalar<{ environment: string }>(
          isolated.db,
          "select public.create_hosted_session_v2($1,$2,'test',$3,$4,$5::jsonb,null,'http://127.0.0.1:5500/done','http://127.0.0.1:5500/done',$6,$7,$8,$9,'v1',now()+interval '30 minutes','{}',null) v",
          [
            copy.keyId,
            internalDigest,
            session,
            copy.events[main.ids.event],
            JSON.stringify(intent),
            await credentialDigest(session),
            await credentialDigest(JSON.stringify(intent)),
            access,
            token,
          ],
        );
        assert.equal(stored.environment, 'test');
        const buyer = {
          name: 'Fictional tester',
          email: 'tester@example.test',
          phone: '08012345678',
        };
        const reservation = await scalar<{ orderId: string }>(
          isolated.db,
          'select public.reserve_hosted_checkout($1,$2,null,$3::jsonb,$4::jsonb,null,$5) v',
          [
            session,
            access,
            JSON.stringify([{ ...intent[0], attendees: [buyer] }]),
            JSON.stringify(buyer),
            await credentialDigest('reserve-' + session),
          ],
        );
        await scalar(
          isolated.db,
          'select public.complete_free_checkout($1,$2) v',
          [reservation.orderId, token],
        );
        assert.equal(
          await scalar(
            isolated.db,
            "select count(*)::integer v from public.tickets where event_id=$1 and status='valid'",
            [copy.events[main.ids.event]],
          ),
          2,
        );
        assert.equal(
          await scalar(
            isolated.db,
            'select quantity_sold v from public.ticket_types where id=$1',
            [copy.tickets[main.ids.free]],
          ),
          2,
        );
        assert.equal(
          await scalar(
            main.db,
            'select quantity_sold v from public.ticket_types where id=$1',
            [main.ids.free],
          ),
          0,
        );
        assert.equal(
          await scalar(
            main.db,
            'select count(*)::integer v from public.orders where not is_test',
          ),
          0,
        );
        assert.equal(
          await scalar(
            isolated.db,
            'select title v from public.events where id=$1',
            [copy.events[main.ids.event]],
          ),
          '[TEST] Hosted show',
        );
        await sync();
        assert.equal(
          await scalar(
            isolated.db,
            'select quantity_sold v from public.ticket_types where id=$1',
            [copy.tickets[main.ids.free]],
          ),
          2,
          'refreshing a test copy must not reset sold inventory',
        );
        const status = await scalar<{ status: string; tickets_issued: number }>(
          isolated.db,
          "select public.get_integration_checkout_session($1,$2,'test',$3) v",
          [copy.keyId, internalDigest, session],
        );
        assert.equal(status.status, 'paid');
        assert.equal(status.tickets_issued, 1);
        assert.equal(
          await scalar(
            main.db,
            'select is_test v from public.orders where id=$1',
            [reservation.orderId],
          ),
          true,
        );
        const analytics = await scalar<{
          bookings: number;
          ticketRevenueKobo: number;
        }>(main.db, 'select public.admin_sales_analytics() v');
        assert.equal(analytics.bookings, 0);
        assert.equal(analytics.ticketRevenueKobo, 0);
        const txs = await scalar<{ total: number; transactions: unknown[] }>(
          main.db,
          'select public.admin_transactions() v',
        );
        assert.equal(txs.transactions.length, 0);
        const ticketCode = await scalar<string>(
          main.db,
          'select display_code v from public.tickets where event_id=$1 limit 1',
          [copy.events[main.ids.event]],
        );
        const wrongEvent = await scalar<{ outcome: string; admitted: boolean }>(
          main.db,
          'select public.verify_event_entry($1,$2,$3,true) v',
          [main.ids.owner, main.ids.event, ticketCode],
        );
        assert.equal(wrongEvent.outcome, 'invalid');
        assert.equal(wrongEvent.admitted, false);
      },
    );
    await t.test(
      'paid group Test checkout verifies provider mode and issues ten reserved admissions without touching live stock',
      async () => {
        const session = crypto.randomUUID(),
          access = '1'.repeat(64),
          token = '2'.repeat(64);
        const items = [
          { ticket_type_id: copy.tickets[main.ids.group], quantity: 2 },
        ];
        await scalar(
          main.db,
          "select public.create_hosted_session_v2($1,$2,'test',$3,$4,$5::jsonb,null,'http://127.0.0.1:5500/done','http://127.0.0.1:5500/done',$6,$7,$8,$9,'v1',now()+interval '30 minutes','{}',null) v",
          [
            copy.keyId,
            internalDigest,
            session,
            copy.events[main.ids.event],
            JSON.stringify(items),
            await credentialDigest(session),
            await credentialDigest('payload' + session),
            access,
            token,
          ],
        );
        const reservation = await scalar<{
          orderId: string;
          totalKobo: number;
        }>(
          main.db,
          'select public.reserve_hosted_checkout($1,$2,null,$3::jsonb,$4::jsonb,null,$5) v',
          [
            session,
            access,
            JSON.stringify(items.map((i) => ({ ...i, attendees: [] }))),
            JSON.stringify({
              name: 'Group tester',
              email: 'buyer@example.test',
              phone: '08012345678',
            }),
            await credentialDigest('group' + session),
          ],
        );
        const lease = crypto.randomUUID();
        const prepared = await scalar<{ payment_reference: string }>(
          main.db,
          'select public.claim_checkout_payment_initialization($1,$2,$3) v',
          [reservation.orderId, token, lease],
        );
        await assert.rejects(
          () =>
            scalar(
              main.db,
              "select public.pin_checkout_payment_environment($1,$2,$3,'live') v",
              [reservation.orderId, prepared.payment_reference, lease],
            ),
          /cannot use real/,
        );
        assert.equal(
          await scalar(
            main.db,
            "select public.pin_checkout_payment_environment($1,$2,$3,'test') v",
            [reservation.orderId, prepared.payment_reference, lease],
          ),
          true,
        );
        const finalize = (domain: string) =>
          scalar<{ outcome: string }>(
            main.db,
            "select to_jsonb(r) v from public.finalize_paystack_payment($1,'success',$2,'NGN','fake-provider-test-id',$3::jsonb) r",
            [
              prepared.payment_reference,
              reservation.totalKobo,
              JSON.stringify({ data: { domain } }),
            ],
          );
        await assert.rejects(() => finalize('live'), /environment mismatch/);
        assert.equal((await finalize('test')).outcome, 'success');
        assert.equal((await finalize('test')).outcome, 'already_paid');
        assert.equal(
          await scalar(
            main.db,
            "select count(*)::integer v from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1 and t.claim_state='UNCLAIMED' and t.display_code is null",
            [reservation.orderId],
          ),
          10,
        );
        assert.equal(
          await scalar(
            main.db,
            'select quantity_sold v from public.ticket_types where id=$1',
            [copy.tickets[main.ids.group]],
          ),
          10,
        );
        assert.equal(
          await scalar(
            main.db,
            'select quantity_sold v from public.ticket_types where id=$1',
            [main.ids.group],
          ),
          0,
        );
        const invite = await scalar<string>(
          main.db,
          'select invite_token v from public.group_bookings where order_item_id in(select id from public.order_items where order_id=$1)',
          [reservation.orderId],
        );
        await scalar(
          main.db,
          "select public.claim_group_ticket($1,'Test attendee','group@example.test','08012345679') v",
          [invite],
        );
        const code = await scalar<string>(
          main.db,
          "select display_code v from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1 and t.claim_state='CLAIMED'",
          [reservation.orderId],
        );
        const scan = () =>
          scalar<{ outcome: string; admitted: boolean }>(
            main.db,
            'select public.verify_event_entry($1,$2,$3,true) v',
            [copy.ownerId, copy.events[main.ids.event], code],
          );
        assert.equal((await scan()).admitted, true);
        assert.equal((await scan()).outcome, 'already_used');
        const metrics = await scalar<{ bookings: number }>(
          main.db,
          'select public.admin_sales_analytics() v',
        );
        assert.equal(metrics.bookings, 0);
      },
    );
    await t.test(
      'already-open Test checkout rejects source revocation or admin suspension without a replica refresh',
      async () => {
        const session = crypto.randomUUID(),
          access = '3'.repeat(64),
          token = '4'.repeat(64);
        await scalar(
          main.db,
          "select public.create_hosted_session_v2($1,$2,'test',$3,$4,'[]',null,'http://127.0.0.1:5500/done','http://127.0.0.1:5500/done',$5,$6,$7,$8,'v1',now()+interval '30 minutes','{}',null) v",
          [
            copy.keyId,
            internalDigest,
            session,
            copy.events[main.ids.event],
            await credentialDigest(session),
            await credentialDigest('revocation' + session),
            access,
            token,
          ],
        );
        await main.db.query(
          'update public.integration_api_keys set revoked_at=now() where id=$1',
          [key.id],
        );
        await assert.rejects(
          () =>
            scalar(
              main.db,
              'select public.require_hosted_checkout_active($1) v',
              [session],
            ),
          /Test key disabled/,
        );
        await main.db.query(
          'update public.integration_api_keys set revoked_at=null where id=$1',
          [key.id],
        );
        await main.db.query(
          'update public.integrations set admin_suspended_at=now() where id=$1',
          [main.app.id],
        );
        await assert.rejects(
          () =>
            scalar(
              main.db,
              'select public.require_hosted_checkout_active($1) v',
              [session],
            ),
          /Test checkout disabled/,
        );
        await main.db.query(
          'update public.integrations set admin_suspended_at=null where id=$1',
          [main.app.id],
        );
        await scalar(
          main.db,
          'select public.require_hosted_checkout_active($1) v',
          [session],
        );
      },
    );
    await t.test(
      'external Test events remain hidden and marked in the same database',
      async () => {
        const result = await scalar<{ id: string }>(
          main.db,
          "select public.upsert_integration_external_event($1,$2,'test','external-rehearsal',$3::jsonb) v",
          [
            copy.keyId,
            internalDigest,
            JSON.stringify({
              title: '[TEST] Partner event',
              starts_at: new Date(Date.now() + 86400000).toISOString(),
              ends_at: new Date(Date.now() + 172800000).toISOString(),
              tickets: [
                {
                  external_id: 'general',
                  name: 'General',
                  price_kobo: 0,
                  quantity: 3,
                },
              ],
            }),
          ],
        );
        assert.equal(
          await scalar(
            main.db,
            'select is_test v from public.events where id=$1',
            [result.id],
          ),
          true,
        );
      },
    );
    await t.test(
      'saving grants or disabling the connection blocks new and unpaid test checkout',
      async () => {
        await scalar(
          isolated.db,
          'select public.invalidate_local_integration_test_copy($1,$2) v',
          [source, main.app.id],
        );
        assert.equal(
          await scalar(
            isolated.db,
            "select public.authenticate_integration_key($1,$2,'test') v",
            [copy.keyId, internalDigest],
          ),
          null,
        );
        await sync();
        await main.db.query(
          'delete from public.integration_event_grants where integration_id=$1',
          [main.app.id],
        );
        await sync();
        assert.equal(
          await scalar(
            isolated.db,
            'select count(*)::integer v from public.integration_event_grants where integration_id=$1 and event_id=$2',
            [copy.integrationId, copy.events[main.ids.event]],
          ),
          0,
        );
        await main.db.query(
          'update public.integration_api_keys set revoked_at=now() where id=$1',
          [key.id],
        );
        await assert.rejects(snapshot, /Invalid API key/);
        const afterRevocation = await scalar<Record<string, unknown>>(
          main.db,
          'select public.integration_testing_snapshot($1,$2) v',
          [main.app.id, main.ids.owner],
        );
        await sync(afterRevocation);
        assert.equal(
          await scalar(
            isolated.db,
            "select public.authenticate_integration_key($1,$2,'test') v",
            [copy.keyId, internalDigest],
          ),
          null,
          'refreshing a test copy must not resurrect revoked keys',
        );
      },
    );
  } finally {
    await main.db.close();
  }
});
