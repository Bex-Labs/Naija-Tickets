import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';
import { hostedCheckoutMigration } from './test-support/hosted-checkout-database.ts';
import { projectAdminOverview } from './integrations/admin.ts';
void test('organisers can pause or remove their integrations without losing purchases', async (t) => {
  const f = await createOperationsFixture();
  const { db, ids, app, key } = f;
  try {
    for (const name of [
      '202610160004_integration_readiness.sql',
      '202610170001_hosted_checkout_links.sql',
      '202610170002_hosted_report_efficiency.sql',
      '202610180001_integration_lifecycle.sql',
    ])
      await db.exec(hostedCheckoutMigration(name));
    const scalar = async <T>(sql: string, values: unknown[] = []) =>
      (await db.query<{ v: T }>(sql, values)).rows[0].v;
    const change = (action: string, user: string = ids.owner, id = app.id) =>
      scalar<{ status?: string; removed?: boolean; id: string }>(
        'select public.change_organiser_integration_lifecycle($1,$2,$3) v',
        [user, id, action],
      );
    const authenticate = () =>
      scalar("select public.authenticate_integration_key($1,$2,'live') v", [
        key.id,
        key.digest,
      ]);
    const links = await scalar<{ publicId: string }>(
      "select public.manage_hosted_checkout_link($1,$2,$3,'live','https://partner.example/done','https://partner.example/done',true) v",
      [ids.owner, app.id, ids.event],
    );
    const readLink = () =>
      scalar(
        "select public.require_hosted_link($1,'live','https://partner.example',$2) v",
        [links.publicId, ids.event],
      );
    const endpoint = crypto.randomUUID();
    await db.query(
      "insert into public.integration_webhook_endpoints(id,integration_id,environment,url,origin,events,encrypted_secret,created_by) values($1,$2,'live','https://partner.example/hooks','https://partner.example','{order.paid}',$3,$4)",
      [endpoint, app.id, 'fixture-not-a-secret-'.repeat(4), ids.owner],
    );
    const paid = await f.buy(ids.group, 1);
    const pending = await f.buy(ids.tier, 1, false);
    const payment = (
      await db.query<{ payment_reference: string; amount_kobo: number }>(
        'select * from public.prepare_paystack_payment($1,$2)',
        [pending.orderId, pending.reservationHash],
      )
    ).rows[0];
    const retained = async () => ({
      orders: await scalar(
        "select jsonb_agg(jsonb_build_object('id',id,'status',status,'total',total_kobo) order by id) v from public.orders",
      ),
      tickets: await scalar(
        'select jsonb_agg(id order by id) v from public.tickets',
      ),
      sold: await scalar(
        "select jsonb_agg(jsonb_build_object('id',id,'sold',quantity_sold) order by id) v from public.ticket_types",
      ),
    });
    const before = await retained();
    await t.test(
      'only current integration managers can change lifecycle and browser roles cannot invoke the service function',
      async () => {
        for (const action of ['enable', 'disable', 'remove']) {
          await assert.rejects(() => change(action, ids.customer), /not found/);
          await assert.rejects(
            () => change(action, ids.owner, crypto.randomUUID()),
            /not found/,
          );
        }
        await assert.rejects(
          () => change('delete-everything'),
          /Invalid integration action/,
        );
        for (const role of ['anon', 'authenticated']) {
          await db.exec('set role ' + role);
          await assert.rejects(() => change('remove'), /permission denied/);
          await db.exec('reset role');
        }
        assert.ok(await authenticate());
      },
    );
    await t.test(
      'disable blocks keys, hosted links, unpaid checkout and outgoing delivery without deleting data',
      async () => {
        assert.equal((await change('disable')).status, 'disabled');
        assert.equal(await authenticate(), null);
        await assert.rejects(readLink, /not found/);
        const hash = await scalar<string>(
          'select capability_hash v from public.integration_checkout_sessions where id=$1',
          [pending.sessionId],
        );
        await assert.rejects(
          () =>
            scalar('select public.get_hosted_checkout($1,$2) v', [
              pending.sessionId,
              hash,
            ]),
          /disabled/,
        );
        assert.deepEqual(
          await scalar("select public.claim_integration_webhooks('live',5) v"),
          [],
        );
        assert.deepEqual(await retained(), before);
        assert.equal(
          await scalar(
            'select revoked_at v from public.integration_api_keys where id=$1',
            [key.id],
          ),
          null,
        );
      },
    );
    await t.test(
      'enable resumes the saved configuration and repeated transitions have a single audit entry',
      async () => {
        await change('disable');
        assert.equal((await change('enable')).status, 'active');
        await change('enable');
        assert.ok(await authenticate());
        assert.ok(await readLink());
        assert.equal(
          await scalar(
            "select count(*)::int v from public.audit_logs where entity_id=$1 and action='integration.disabled'",
            [app.id],
          ),
          1,
        );
        assert.equal(
          await scalar(
            "select count(*)::int v from public.audit_logs where entity_id=$1 and action='integration.enabled'",
            [app.id],
          ),
          1,
        );
        assert.deepEqual(await retained(), before);
      },
    );
    await t.test(
      'organiser reactivation cannot bypass administrator suspension',
      async () => {
        await db.query(
          "select public.admin_suspend_integration($1,'primary',true,'Fixture investigation')",
          [app.id],
        );
        await assert.rejects(() => change('enable'), /suspended/);
        await db.query(
          "select public.admin_suspend_integration($1,'primary',false,'Fixture review complete')",
          [app.id],
        );
        await change('enable');
        const replacementKey = await f.issue(['checkout:write', 'orders:read']);
        assert.ok(
          await scalar(
            "select public.authenticate_integration_key($1,$2,'live') v",
            [replacementKey.id, replacementKey.digest],
          ),
        );
        await f.configure();
        await scalar(
          "select public.manage_hosted_checkout_link($1,$2,$3,'live','https://partner.example/done','https://partner.example/done',true) v",
          [ids.owner, app.id, ids.event],
        );
        await db.query(
          'update public.integration_webhook_endpoints set enabled=true where id=$1',
          [endpoint],
        );
      },
    );
    await t.test(
      'removal hides the application, revokes all keys and shuts down configured links/widgets/endpoints',
      async () => {
        assert.deepEqual(await change('remove'), { id: app.id, removed: true });
        assert.equal(
          await scalar(
            'select count(*)::int v from public.integration_api_keys where integration_id=$1 and revoked_at is null',
            [app.id],
          ),
          0,
        );

        assert.equal(await authenticate(), null);
        await assert.rejects(readLink, /not found/);
        assert.equal(
          await scalar(
            'select enabled v from public.integration_hosted_links where integration_id=$1',
            [app.id],
          ),
          false,
        );
        assert.equal(
          await scalar(
            'select enabled v from public.integration_widgets where integration_id=$1',
            [app.id],
          ),
          false,
        );
        assert.equal(
          await scalar(
            'select enabled v from public.integration_webhook_endpoints where id=$1',
            [endpoint],
          ),
          false,
        );
        const dashboard = await scalar<{ integrations: { id: string }[] }>(
          'select public.list_organiser_integrations($1) v',
          [ids.owner],
        );
        assert.ok(!dashboard.integrations.some((a) => a.id === app.id));
        assert.deepEqual(await retained(), before);
        await assert.rejects(() => change('enable'), /not found/);
        await assert.rejects(
          () =>
            scalar(
              "select public.save_organiser_integration($1,$2,$3,'Restore','active','[]',$4::uuid[]) v",
              [ids.owner, app.id, ids.org, [ids.event]],
            ),
          /not found/,
        );
        await assert.rejects(() => f.configure(), /permission/);
        await assert.rejects(
          () =>
            scalar(
              "select public.manage_hosted_checkout_link($1,$2,$3,'live','https://partner.example/done','https://partner.example/done',true) v",
              [ids.owner, app.id, ids.event],
            ),
          /not found/,
        );
        assert.deepEqual(await change('remove'), { id: app.id, removed: true });
        assert.equal(
          await scalar(
            "select count(*)::int v from public.audit_logs where entity_id=$1 and action='integration.removed'",
            [app.id],
          ),
          1,
        );
      },
    );
    await t.test(
      'authorised in-progress payment can finish after removal, without duplicate tickets',
      async () => {
        const finalize = () =>
          db.query(
            "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','lifecycle-test','{}')",
            [payment.payment_reference, payment.amount_kobo],
          );
        await finalize();
        await finalize();
        assert.equal(
          await scalar('select status v from public.orders where id=$1', [
            pending.orderId,
          ]),
          'paid',
        );
        assert.equal(
          await scalar(
            'select count(*)::int v from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1',
            [pending.orderId],
          ),
          1,
        );
        assert.equal(
          await scalar(
            'select count(*)::int v from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1',
            [paid.orderId],
          ),
          5,
        );
        const hash = await scalar<string>(
          'select capability_hash v from public.integration_checkout_sessions where id=$1',
          [pending.sessionId],
        );
        assert.ok(
          await scalar('select public.get_hosted_checkout($1,$2) v', [
            pending.sessionId,
            hash,
          ]),
        );
      },
    );
    await t.test(
      'paid group claims and private admin history survive integration removal',
      async () => {
        const token = await scalar<string>(
          'select g.invite_token v from public.group_bookings g join public.order_items i on i.id=g.order_item_id where i.order_id=$1',
          [paid.orderId],
        );
        assert.ok(
          await scalar(
            "select public.claim_group_ticket($1,'Fictional member','member@example.test','08012345678') v",
            [token],
          ),
        );
        assert.equal(
          await scalar(
            'select count(*)::int v from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1',
            [paid.orderId],
          ),
          5,
        );
        const overview = projectAdminOverview(
          await scalar('select public.admin_integration_overview() v'),
        );
        assert.ok(
          overview.applications.find((a) => a.id === app.id)?.removedAt,
        );
        const activity = await scalar<{ audit: { action: string }[] }>(
          'select public.admin_integration_activity($1) v',
          [app.id],
        );
        assert.ok(
          activity.audit.some((a) => a.action === 'integration.removed'),
        );
        assert.ok(
          await scalar('select public.integration_hosted_report($1) v', [
            app.id,
          ]),
        );
      },
    );
    await t.test(
      'removed integrations do not consume the ten-current-applications allowance',
      async () => {
        const create = () =>
          scalar<{ id: string }>(
            "select public.save_organiser_integration($1,null,$2,'Replacement connection','active','[]','{}') v",
            [ids.owner, ids.org],
          );
        for (let i = 0; i < 10; i++) assert.ok((await create()).id);
        await assert.rejects(create, /up to 10/);
        assert.equal(
          await scalar(
            'select count(*)::int v from public.integrations where organiser_id=$1',
            [ids.org],
          ),
          11,
        );
      },
    );
  } finally {
    await db.close();
  }
});
