import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';
import { hostedCheckoutMigration } from './test-support/hosted-checkout-database.ts';
import {
  generateIntegrationCredential,
  credentialDigest,
} from './integrations/keys.ts';

void test('one dashboard provisions isolated test event copies for no-code and API checkout', async (t) => {
  const main = await createOperationsFixture('live'),
    isolated = await createOperationsFixture('test');
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
    for (const f of [main, isolated])
      for (const migration of [
        '202610160004_integration_readiness.sql',
        '202610170001_hosted_checkout_links.sql',
        '202610170002_hosted_report_efficiency.sql',
        '202610180001_integration_lifecycle.sql',
        '202611120001_integrated_testing.sql',
      ])
        await f.db.exec(hostedCheckoutMigration(migration));
    const key = await generateIntegrationCredential('test');
    await scalar(
      main.db,
      "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'test','{events:read,tickets:read,availability:read,checkout:write,orders:read}',now()+interval '90 days',null) v",
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
        'select public.sync_integration_test_copy($1,$2::jsonb,$3) v',
        [source, JSON.stringify(value ?? (await snapshot())), internalDigest],
      );
    const copy = await sync();
    await t.test(
      'only authorised managers can export templates and only a correctly bound test database can import them',
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
              'select public.sync_integration_test_copy($1,$2::jsonb,$3) v',
              [source, JSON.stringify({}), internalDigest],
            ),
          /Resource environment/,
        );
        await assert.rejects(
          async () =>
            scalar(
              isolated.db,
              'select public.sync_integration_test_copy($1,$2::jsonb,$3) v',
              [
                'c'.repeat(20),
                JSON.stringify(await snapshot()),
                internalDigest,
              ],
            ),
          /binding mismatch/,
        );
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
                'select public.sync_integration_test_copy($1,$2::jsonb,$3) v',
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
      'API checkout issues a real free test ticket and preserves live inventory and main orders',
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
            'select count(*)::integer v from public.orders',
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
      },
    );
    await t.test(
      'saving grants or disabling the connection blocks new and unpaid test checkout',
      async () => {
        await scalar(
          isolated.db,
          'select public.invalidate_integration_test_copy($1,$2) v',
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
            'select count(*)::integer v from public.integration_event_grants where integration_id=$1',
            [copy.integrationId],
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
    await isolated.db.close();
  }
});
