import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';
import { hostedCheckoutMigration } from './test-support/hosted-checkout-database.ts';
import {
  projectAdminOverview,
  projectAdminActivity,
} from './integrations/admin.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';
void test('private platform oversight suspends abusive apps without exposing secrets or losing authorised payment completion', async (t) => {
  const f = await createOperationsFixture();
  const { db, ids, app, key, buy } = f;
  try {
    await db.exec(
      hostedCheckoutMigration('202610160004_integration_readiness.sql'),
    );
    const overview = async (
      search = '',
      status = 'all',
      after: string | null = null,
    ) =>
      projectAdminOverview(
        (
          await db.query<{ value: unknown }>(
            'select public.admin_integration_overview($1,$2,$3) value',
            [search, status, after],
          )
        ).rows[0].value,
      );
    const activity = async (before: string | null = null) =>
      projectAdminActivity(
        (
          await db.query<{ value: unknown }>(
            'select public.admin_integration_activity($1,$2) value',
            [app.id, before],
          )
        ).rows[0].value,
      );
    await t.test(
      'browser/customer roles cannot inspect or suspend any integration',
      async () => {
        for (const role of ['anon', 'authenticated']) {
          await db.exec('set role ' + role);
          for (const sql of [
            'select public.admin_integration_overview()',
            "select public.admin_integration_activity('" + app.id + "')",
            "select public.admin_suspend_integration('" +
              app.id +
              "','primary',true,'Abuse review')",
            "select public.upgrade_admin_password_hash('primary',null,null)",
          ])
            await assert.rejects(() => db.query(sql), /permission denied/);
          await db.exec('reset role');
        }
      },
    );
    await t.test(
      'safe aggregate activity supports literal search, bounded pagination and filtered audit metadata',
      async () => {
        const r = crypto.randomUUID();
        await db.query(
          "select public.record_integration_request($1,$2,'events.list',200,null,8)",
          [r, key.id],
        );
        await db.query(
          "insert into public.audit_logs(action,entity_type,entity_id,metadata) values('integration.fixture','integration',$1,$2::jsonb)",
          [
            app.id,
            JSON.stringify({
              secret: 'DO_NOT_EXPOSE',
              credential_digest: key.digest,
              invite_token: 'DO_NOT_EXPOSE',
              integration_id: app.id,
            }),
          ],
        );
        const result = await overview();
        assert.equal(result.applications.length, 1);
        assert.equal(result.totals.requests24h, 1);
        assert.equal(result.applications[0].requests24h, 1);
        assert.equal(result.applications[0].activeKeys, 1);
        assert.equal((await overview('%')).applications.length, 0);
        const details = await activity();
        assert.equal(details.requests[0].id, r);
        assert.ok(
          details.audit.some((a) => a.action === 'integration.fixture'),
        );
        const serialized = JSON.stringify([result, details]);
        assert.ok(!serialized.includes('DO_NOT_EXPOSE'));
        assert.ok(!serialized.includes(key.digest));
        assert.ok(!serialized.includes(key.credential));
        for (let i = 0; i < 24; i++)
          await db.query(
            "select public.record_integration_request($1,$2,'events.list',403,'INSUFFICIENT_SCOPE',2)",
            [crypto.randomUUID(), key.id],
          );
        const first = await activity();
        assert.equal(first.requests.length, 20);
        assert.ok(first.nextCursor);
        const second = await activity(first.nextCursor);
        assert.equal(second.requests.length, 5);
        assert.ok(
          !second.requests.some((a) =>
            first.requests.some((b) => a.id === b.id),
          ),
        );
        assert.equal((await overview()).totals.errors24h, 24);
        await assert.rejects(
          () => activity(crypto.randomUUID()),
          /Invalid activity cursor/,
        );
      },
    );
    const paid = await buy(ids.group, 1);
    const pending = await buy(ids.tier, 1, false);
    const payment = (
      await db.query<{ payment_reference: string; amount_kobo: number }>(
        'select * from public.prepare_paystack_payment($1,$2)',
        [pending.orderId, pending.reservationHash],
      )
    ).rows[0];
    await t.test(
      'suspension revokes keys, pauses widgets/endpoints and prevents organiser reactivation',
      async () => {
        await db.query(
          "select public.admin_suspend_integration($1,'primary',true,'Fictional abuse investigation')",
          [app.id],
        );
        assert.equal((await overview('', 'suspended')).applications.length, 1);
        assert.equal(
          (
            await db.query<{ value: unknown }>(
              "select public.authenticate_integration_key($1,$2,'live') value",
              [key.id, key.digest],
            )
          ).rows[0].value,
          null,
        );
        assert.equal(
          (
            await db.query<{ enabled: boolean }>(
              'select enabled from public.integration_widgets where integration_id=$1',
              [app.id],
            )
          ).rows[0].enabled,
          false,
        );
        await assert.rejects(
          () =>
            db.query(
              "select public.save_organiser_integration($1,$2,$3,'Re-enable','active','[]',$4::uuid[])",
              [ids.owner, app.id, ids.org, [ids.event]],
            ),
          /suspended/,
        );
        const generated = await generateIntegrationCredential('live');
        await assert.rejects(
          () =>
            db.query(
              "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,'live','{events:read}',now()+interval '90 days',null)",
              [
                ids.owner,
                app.id,
                generated.id,
                generated.digest,
                generated.prefix,
                generated.suffix,
              ],
            ),
          /Enable this integration/,
        );
      },
    );
    await t.test(
      'previously authorised payment finishes and paid receipt/group history survives suspension',
      async () => {
        await db.query(
          "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','phase7-authorised','{}')",
          [payment.payment_reference, payment.amount_kobo],
        );
        assert.equal(
          (
            await db.query<{ status: string }>(
              'select status from public.orders where id=$1',
              [pending.orderId],
            )
          ).rows[0].status,
          'paid',
        );
        const hash = (
          await db.query<{ capability_hash: string }>(
            'select capability_hash from public.integration_checkout_sessions where id=$1',
            [pending.sessionId],
          )
        ).rows[0].capability_hash;
        assert.ok(
          (
            await db.query('select public.get_hosted_checkout($1,$2)', [
              pending.sessionId,
              hash,
            ])
          ).rows.length,
        );
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select count(*)::int n from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1',
              [paid.orderId],
            )
          ).rows[0].n,
          5,
        );
      },
    );
    await t.test(
      'restoration keeps the app disabled and never resurrects old keys or staged widget settings',
      async () => {
        await f.configure(true, true);
        await db.query(
          "select public.admin_suspend_integration($1,'primary',false,'Fictional review complete')",
          [app.id],
        );
        const row = (await overview()).applications[0];
        assert.equal(row.status, 'disabled');
        assert.equal(row.suspendedAt, null);
        assert.equal(row.activeKeys, 0);
        assert.equal(
          (
            await db.query<{ enabled: boolean }>(
              'select enabled from public.integration_widgets where integration_id=$1',
              [app.id],
            )
          ).rows[0].enabled,
          false,
        );
        await db.query(
          "select public.save_organiser_integration($1,$2,$3,'Reviewed app','active',$4::jsonb,$5::uuid[])",
          [
            ids.owner,
            app.id,
            ids.org,
            JSON.stringify([
              { environment: 'live', origin: 'https://partner.example' },
            ]),
            [ids.event],
          ],
        );
        assert.equal(
          (
            await db.query<{ value: unknown }>(
              "select public.authenticate_integration_key($1,$2,'live') value",
              [key.id, key.digest],
            )
          ).rows[0].value,
          null,
        );
        assert.ok(
          (await activity()).audit.some(
            (a) => a.action === 'integration.admin_restored',
          ),
        );
      },
    );
    await t.test(
      'password hash upgrades are conditional and cannot overwrite changed accounts or accept null/malformed replacements',
      async () => {
        const old = 'a'.repeat(64),
          next = 'scrypt-v1:' + 'b'.repeat(128),
          changed = 'c'.repeat(64);
        await db.query(
          "insert into public.platform_settings(key,value) values('admin_accounts',$1::jsonb)",
          [
            JSON.stringify({
              accounts: [
                {
                  id: 'primary',
                  username: 'fixture-admin',
                  password_hash: old,
                  password_salt: 'fixture-salt-0123456789',
                },
              ],
            }),
          ],
        );
        const upgrade = async (a: string | null, b: string | null) =>
          (
            await db.query<{ value: boolean }>(
              "select public.upgrade_admin_password_hash('primary',$1,$2) value",
              [a, b],
            )
          ).rows[0].value;
        assert.equal(await upgrade(old, null), false);
        assert.equal(await upgrade(null, next), false);
        assert.equal(await upgrade(old, 'wrong'), false);
        assert.equal(await upgrade(changed, next), false);
        assert.equal(await upgrade(old, next), true);
        assert.equal(await upgrade(old, 'scrypt-v1:' + 'd'.repeat(128)), false);
        const stored = (
          await db.query<{ value: { accounts: { password_hash: string }[] } }>(
            "select value from public.platform_settings where key='admin_accounts'",
          )
        ).rows[0].value;
        assert.equal(stored.accounts[0].password_hash, next);
      },
    );
    await t.test(
      'admin authentication buckets are atomic and expire without exposing identities',
      async () => {
        const bucket = 'admin-login:account:' + 'a'.repeat(64);
        for (let i = 0; i < 8; i++)
          assert.equal(
            (
              await db.query<{ value: { allowed: boolean } }>(
                'select public.consume_integration_rate_limit($1,8,60) value',
                [bucket],
              )
            ).rows[0].value.allowed,
            true,
          );
        assert.equal(
          (
            await db.query<{ value: { allowed: boolean } }>(
              'select public.consume_integration_rate_limit($1,8,60) value',
              [bucket],
            )
          ).rows[0].value.allowed,
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});
