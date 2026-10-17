import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';
import {
  advancedReadHandler,
  entryOperationHandler,
  type AdvancedOperation,
} from './integrations/operations.ts';
import { INTEGRATION_SCOPES } from './integrations/types.ts';
import type { generateIntegrationCredential } from './integrations/keys.ts';
type Dto = Record<string, string | number | boolean | null>;
type DataFor<T extends AdvancedOperation> = T extends
  | 'order'
  | 'ticket'
  | 'sales'
  ? Dto
  : Dto[];
type Key = Awaited<ReturnType<typeof generateIntegrationCredential>>;
void test('advanced operations preserve attribution, field permission, existing claim/refund engines and delegated entry', async (t) => {
  const f = await createOperationsFixture();
  const { db, ids, app, api, operations, issue, buy, logs } = f;
  try {
    const key = await issue([...INTEGRATION_SCOPES]);
    const basic = await issue([
      'orders:read',
      'tickets:status',
      'attendees:read',
      'groups:read',
      'sales:read',
      'refunds:read',
    ]);
    let inTransaction = false;
    t.beforeEach(async () => {
      await db.exec('delete from public.integration_rate_buckets');
    });
    const read = async <T extends AdvancedOperation>(
      op: T,
      resource: string | null = null,
      query = '',
      credential: Key = key,
    ) => {
      if (inTransaction) await db.exec('savepoint api_operation');
      const response = await advancedReadHandler(
        api,
        operations,
        op,
        resource,
      )(
        new Request('https://tickets.example/api/v1/test' + query, {
          headers: { Authorization: 'Bearer ' + credential.credential },
        }),
      );
      if (inTransaction) {
        if (response.status >= 400) await db.exec('rollback to api_operation');
        await db.exec('release api_operation');
      }
      return {
        status: response.status,
        body: (await response.json()) as {
          data: DataFor<T>;
          meta: { next_cursor: string | null };
          error?: { code: string };
        },
      };
    };
    const enter = async (
      code: string,
      action = 'admit',
      idem = crypto.randomUUID(),
      credential: Key = key,
      event = ids.event,
    ) => {
      if (inTransaction) await db.exec('savepoint api_operation');
      const response = await entryOperationHandler(
        api,
        operations,
        event,
      )(
        new Request(
          'https://tickets.example/api/v1/events/' + event + '/check-ins',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + credential.credential,
              'Content-Type': 'application/json',
              'Idempotency-Key': idem,
            },
            body: JSON.stringify({ code, action }),
          },
        ),
      );
      if (inTransaction) {
        if (response.status >= 400) await db.exec('rollback to api_operation');
        await db.exec('release api_operation');
      }
      return {
        status: response.status,
        body: (await response.json()) as {
          data: Dto;
          error?: { code: string };
        },
      };
    };
    const booking = await buy(ids.group, 2);
    let memberCode = '',
      memberTicket = '';
    await t.test(
      'new permissions are opt-in and private tables/helpers remain inaccessible to browser roles',
      async () => {
        const old = (
          await db.query<{ scopes: string[] }>(
            'select scopes from public.integration_api_keys where id=$1',
            [f.key.id],
          )
        ).rows[0];
        assert.deepEqual(old.scopes, ['checkout:write', 'orders:read']);
        assert.equal(
          (await read('tickets', booking.orderId, '', f.key)).status,
          403,
        );
        for (const role of ['anon', 'authenticated']) {
          await db.exec('set role ' + role);
          await assert.rejects(
            () => db.query('select * from public.integration_entry_requests'),
            /permission denied/,
          );
          await assert.rejects(
            () =>
              db.query(
                "select public.read_integration_operations($1,$2,'live','orders')",
                [key.id, key.digest],
              ),
            /permission denied/,
          );
          await assert.rejects(
            () =>
              db.query(
                "select public.perform_integration_entry($1,$2,'live',$3,'NT-123456ABCDEF',true,$4,$5)",
                [key.id, key.digest, ids.event, 'a'.repeat(64), 'b'.repeat(64)],
              ),
            /permission denied/,
          );
          await db.exec('reset role');
        }
        await db.exec('set role service_role');
        await assert.rejects(
          () =>
            db.query(
              "select * from public.integration_attributed_orders($1,$2,'live')",
              [app.id, ids.org],
            ),
          /permission denied/,
        );
        await db.exec('reset role');
        assert.equal((await read('orders')).status, 200);
      },
    );
    await t.test(
      'paid group slots count admissions immediately but disclose no usable QR or private links; unverified bookings do not inflate sales',
      async () => {
        const order = await read('order', booking.orderId);
        assert.equal(order.status, 200);
        assert.equal(order.body.data.admissions, 10);
        assert.equal(order.body.data.payment_status, 'verified');
        const tickets = await read('tickets', booking.orderId);
        assert.equal(tickets.body.data.length, 10);
        assert.ok(
          tickets.body.data.every(
            (r) => r.claim_state === 'UNCLAIMED' && !r.usable_for_entry,
          ),
        );
        const groups = await read('groups', booking.orderId);
        assert.equal(groups.body.data.length, 1);
        assert.equal(groups.body.data[0].unclaimed_admissions, 10);
        assert.equal(groups.body.data[0].claimable_admissions, 10);
        assert.equal((await read('attendees', ids.event)).body.data.length, 0);
        const text = JSON.stringify([order.body, tickets.body, groups.body]);
        for (const secret of [
          'reference',
          'invite_token',
          'display_code',
          'qr_token_hash',
          'claim_access_token',
          'purchaser_email',
          'attendee_email',
        ])
          assert.ok(!text.includes('"' + secret + '"'), secret);
        await buy(ids.tier, 1, false);
        const sales = await read('sales');
        assert.equal(sales.body.data.verified_orders, 1);
        assert.equal(sales.body.data.sold_admissions, 10);
        assert.equal(sales.body.data.ticket_subtotal_kobo, 9000000);
        assert.equal(
          sales.body.data.net_customer_payments_kobo,
          sales.body.data.customer_payments_kobo,
        );
        assert.equal(
          (
            await db.query<{ quantity_sold: number }>(
              'select quantity_sold from public.ticket_types where id=$1',
              [ids.group],
            )
          ).rows[0].quantity_sold,
          10,
        );
      },
    );
    await t.test(
      'existing group claim blocks duplicate contact and creates one attendee; names and contact information have separate grants',
      async () => {
        const group = (
          await db.query<{ invite_token: string }>(
            'select g.invite_token from public.group_bookings g join public.order_items i on i.id=g.order_item_id where i.order_id=$1',
            [booking.orderId],
          )
        ).rows[0];
        await db.query(
          "select public.claim_group_ticket($1,'Fictional member','member@example.test','08012345678')",
          [group.invite_token],
        );
        await assert.rejects(
          () =>
            db.query(
              "select public.claim_group_ticket($1,'Other member','MEMBER@example.test','08099999999')",
              [group.invite_token],
            ),
          /already claimed/,
        );
        await assert.rejects(
          () =>
            db.query(
              "select public.claim_group_ticket($1,'Other member','other@example.test','+2348012345678')",
              [group.invite_token],
            ),
          /already claimed/,
        );
        const ticket = (
          await db.query<{ id: string; display_code: string }>(
            "select t.id,t.display_code from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1 and t.claim_state='CLAIMED'",
            [booking.orderId],
          )
        ).rows[0];
        memberCode = ticket.display_code;
        memberTicket = ticket.id;
        const names = (await read('attendees', ids.event, '', basic)).body.data;
        assert.equal(names.length, 1);
        assert.equal(names[0].name, 'Fictional member');
        assert.ok(!('email' in names[0]));
        assert.ok(!('phone' in names[0]));
        const contacts = (await read('attendees', ids.event)).body.data;
        assert.equal(contacts[0].email, 'member@example.test');
        assert.equal(contacts[0].phone, '08012345678');
        const contactOnly = await issue(['attendees:contact']);
        assert.equal(
          (await read('attendees', ids.event, '', contactOnly)).status,
          403,
        );
        const groups = (await read('groups', booking.orderId)).body.data;
        assert.equal(groups[0].registered_admissions, 1);
        assert.equal(groups[0].unclaimed_admissions, 9);
      },
    );
    await t.test(
      'another application, marketplace orders, foreign tenant/event and forged attribution do not become visible',
      async () => {
        const secondApp = (
          await db.query<{ value: { id: string } }>(
            "select public.save_organiser_integration($1,null,$2,'Other app','active','[]',$3::uuid[]) value",
            [ids.owner, ids.org, [ids.event]],
          )
        ).rows[0].value.id;
        const otherKey = await issue([...INTEGRATION_SCOPES], secondApp);
        assert.deepEqual(
          (await read('orders', null, '', otherKey)).body.data,
          [],
        );
        assert.equal(
          (await read('order', booking.orderId, '', otherKey)).status,
          404,
        );
        assert.equal(
          (await read('ticket', memberTicket, '', otherKey)).status,
          404,
        );
        assert.equal(
          (await enter(memberCode, 'admit', crypto.randomUUID(), otherKey))
            .status,
          404,
        );
        assert.equal((await read('attendees', ids.otherEvent)).status, 404);
        const marketplace = await buy(ids.free);
        await db.query(
          'update public.orders set integration_checkout_session_id=null where id=$1',
          [marketplace.orderId],
        );
        assert.equal((await read('order', marketplace.orderId)).status, 404);
        assert.equal((await read('sales')).body.data.verified_orders, 1);
        await db.query(
          'update public.orders set integration_checkout_session_id=$1 where id=$2',
          [marketplace.sessionId, marketplace.orderId],
        );
        await db.exec('begin');
        inTransaction = true;
        try {
          await db.query(
            'update public.events set organiser_id=$1 where id=$2',
            [ids.otherOrg, ids.event],
          );
          assert.equal((await read('order', booking.orderId)).status, 404);
          assert.equal((await enter(memberCode)).status, 404);
        } finally {
          await db.exec('rollback');
          inTransaction = false;
        }
      },
    );
    await t.test(
      'delegated entry calls the existing one-admission engine; repeats are idempotent and actor/key audit is retained',
      async () => {
        const verifyOnly = await issue(['entry:verify']);
        assert.equal(
          (await enter(memberCode, 'admit', crypto.randomUUID(), verifyOnly))
            .status,
          403,
        );
        assert.equal(
          (await enter(memberCode, 'verify', crypto.randomUUID(), verifyOnly))
            .body.data.outcome,
          'valid',
        );
        assert.equal((await enter('NT-000000000000')).status, 404);
        const idem = crypto.randomUUID();
        const first = await enter(memberCode, 'admit', idem);
        assert.equal(first.status, 200);
        assert.equal(first.body.data.outcome, 'admitted');
        assert.equal(first.body.data.admissions_used, 1);
        const replay = await enter(memberCode, 'admit', idem);
        assert.equal(replay.body.data.replayed, true);
        assert.equal(replay.body.data.outcome, 'admitted');
        assert.equal((await enter(memberCode, 'verify', idem)).status, 409);
        assert.equal(
          (await enter(memberCode, 'admit', crypto.randomUUID())).body.data
            .outcome,
          'already_used',
        );
        const used = (await read('ticket', memberTicket)).body.data;
        assert.equal(used.claim_state, 'CHECKED_IN');
        assert.equal(used.usable_for_entry, false);
        const checks = (
          await db.query<{ staff_id: string }>(
            'select staff_id from public.check_ins where ticket_id=$1',
            [memberTicket],
          )
        ).rows;
        assert.equal(checks.length, 1);
        assert.equal(checks[0].staff_id, ids.owner);
        const requests = (
          await db.query<{
            actor_id: string;
            key_id: string;
            result: Record<string, unknown>;
          }>(
            'select actor_id,key_id,result from public.integration_entry_requests where ticket_id=$1',
            [memberTicket],
          )
        ).rows;
        assert.ok(requests.every((r) => r.actor_id === ids.owner));
        assert.ok(requests.some((r) => r.key_id === key.id));
        assert.ok(!JSON.stringify(requests).includes(memberCode));
        assert.equal(
          (await read('groups', booking.orderId)).body.data[0]
            .checked_in_admissions,
          1,
        );
        assert.equal(
          (
            await db.query<{ n: number }>(
              "select count(*)::int n from public.integration_outbox_events where type='ticket.checked_in'",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      'entry replay expires after seven days and the shared extra entry budget is enforced',
      async () => {
        const record = (
          await db.query<{ id: string; idempotency_digest: string }>(
            'select id,idempotency_digest from public.integration_entry_requests where ticket_id=$1 limit 1',
            [memberTicket],
          )
        ).rows[0];
        await db.query(
          "update public.integration_entry_requests set expires_at=now()-interval '1 second' where id=$1",
          [record.id],
        );
        const bucket = 'entry:key:' + key.id;
        for (let n = 0; n < 30; n++)
          await db.query(
            'select public.consume_integration_rate_limit($1,30,60)',
            [bucket],
          );
        assert.equal((await enter(memberCode, 'verify')).status, 429);
        await db.exec('delete from public.integration_rate_buckets');
        const proof = {
          keyId: key.id,
          digest: key.digest,
          environment: 'live' as const,
        };
        const payload = (
          await db.query<{ payload_hash: string }>(
            'select payload_hash from public.integration_entry_requests where id=$1',
            [record.id],
          )
        ).rows[0].payload_hash;
        await assert.rejects(
          () =>
            operations.entry(proof, {
              eventId: ids.event,
              code: memberCode,
              admit: true,
              idempotencyDigest: record.idempotency_digest,
              payloadHash: payload,
            }),
          (error) =>
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENTRY_REPLAY_EXPIRED',
        );
      },
    );
    await t.test(
      'current key/app/manager/event grants and resource mode are checked again for history and entry replay',
      async () => {
        const changes = [
          [
            'update public.integration_api_keys set revoked_at=now() where id=$1',
            [key.id],
            401,
          ],
          [
            "update public.integrations set status='disabled' where id=$1",
            [app.id],
            401,
          ],
          [
            'update public.organiser_memberships set can_manage_integrations=false where organiser_id=$1',
            [ids.org],
            401,
          ],
          [
            'delete from public.integration_event_grants where integration_id=$1',
            [app.id],
            404,
          ],
        ] as const;
        for (const [sql, params, status] of changes) {
          await db.exec('begin');
          inTransaction = true;
          try {
            await db.query(sql, [...params]);
            assert.equal((await read('order', booking.orderId)).status, status);
            assert.equal((await enter(memberCode)).status, status);
          } finally {
            await db.exec('rollback');
            inTransaction = false;
          }
        }
        await db.exec('begin');
        inTransaction = true;
        try {
          await db.exec(
            "update public.integration_resource_settings set environment='test',project_ref='aaaaaaaaaaaaaaaaaaaa',live_project_ref='bbbbbbbbbbbbbbbbbbbb' where singleton",
          );
          assert.equal((await read('orders')).status, 503);
          assert.equal((await enter(memberCode)).status, 503);
        } finally {
          await db.exec('rollback');
          inTransaction = false;
        }
        await db.exec('begin');
        inTransaction = true;
        try {
          await db.query(
            "update public.events set starts_at=now()-interval '3 days',ends_at=now()-interval '2 days',status='draft' where id=$1",
            [ids.event],
          );
          await db.query(
            "update public.events set status='published' where id=$1",
            [ids.event],
          );
          assert.equal((await read('order', booking.orderId)).status, 200);
          assert.equal((await enter(memberCode)).status, 404);
          assert.equal(
            (await read('ticket', memberTicket)).body.data.usable_for_entry,
            false,
          );
          assert.equal(
            (await read('groups', booking.orderId)).body.data[0]
              .claimable_admissions,
            0,
          );
        } finally {
          await db.exec('rollback');
          inTransaction = false;
        }
      },
    );
    await t.test(
      'privacy erasure suppresses names/contact without removing financial history or ticket status',
      async () => {
        await db.query(
          "select * from public.anonymize_guest_order_personal_data($1,'test-admin')",
          [booking.orderId],
        );
        const member = (await read('attendees', ids.event)).body.data.find(
          (r) => r.ticket_id === memberTicket,
        );
        assert.ok(member);
        assert.equal(member.personal_data_erased, true);
        assert.equal(member.name, null);
        assert.equal(member.email, null);
        assert.equal(member.phone, null);
        assert.equal((await read('order', booking.orderId)).status, 200);
        assert.equal((await read('ticket', memberTicket)).status, 200);
        assert.equal(
          (await read('groups', booking.orderId)).body.data[0]
            .claimable_admissions,
          0,
        );
        const group = (
          await db.query<{ invite_token: string }>(
            'select g.invite_token from public.group_bookings g join public.order_items i on i.id=g.order_item_id where i.order_id=$1',
            [booking.orderId],
          )
        ).rows[0];
        await assert.rejects(
          () =>
            db.query(
              "select public.claim_group_ticket($1,'Fictional new member','new@example.test','08099999999')",
              [group.invite_token],
            ),
          /unavailable/,
        );
        const slots = (
          await db.query<{
            attendee_name: null;
            attendee_phone: null;
            claim_phone_key: null;
          }>(
            "select attendee_name,attendee_phone,claim_phone_key from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1 and claim_state='UNCLAIMED'",
            [booking.orderId],
          )
        ).rows;
        assert.equal(slots.length, 9);
        assert.ok(
          slots.every(
            (row) =>
              row.attendee_name === null &&
              row.attendee_phone === null &&
              row.claim_phone_key === null,
          ),
        );
      },
    );
    await t.test(
      'verified refund status is read-only; full refunds invalidate unused entry and adjust application totals',
      async () => {
        const paid = await buy(ids.tier, 1);
        const ticket = (
          await db.query<{ id: string; display_code: string }>(
            'select t.id,t.display_code from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1',
            [paid.orderId],
          )
        ).rows[0];
        await db.exec('begin');
        inTransaction = true;
        try {
          await db.query(
            'update public.payments set amount_kobo=amount_kobo+1 where order_id=$1',
            [paid.orderId],
          );
          assert.equal(
            (await enter(ticket.display_code)).body.data.outcome,
            'unpaid',
          );
          assert.equal(
            (await read('ticket', ticket.id)).body.data.usable_for_entry,
            false,
          );
        } finally {
          await db.exec('rollback');
          inTransaction = false;
        }
        const payment = (
          await db.query<{
            provider_transaction_id: string;
            amount_kobo: number;
          }>(
            'select provider_transaction_id,amount_kobo from public.payments where order_id=$1',
            [paid.orderId],
          )
        ).rows[0];
        await db.query(
          "select public.record_admin_refund($1,'600001',$2,$3,'NGN','processed','Fictional test refund','test-admin')",
          [paid.orderId, payment.provider_transaction_id, payment.amount_kobo],
        );
        const refunds = await read('refunds', paid.orderId);
        assert.equal(refunds.body.data[0].status, 'completed');
        assert.equal(refunds.body.data[0].amount_kobo, payment.amount_kobo);
        assert.ok(!JSON.stringify(refunds.body).includes('600001'));
        assert.equal(
          (await enter(ticket.display_code)).body.data.outcome,
          'refunded',
        );
        assert.equal(
          (await read('ticket', ticket.id)).body.data.usable_for_entry,
          false,
        );
        const summary = (await read('sales')).body.data;
        assert.equal(summary.completed_refunds_kobo, payment.amount_kobo);
        assert.equal(
          summary.net_customer_payments_kobo,
          Number(summary.customer_payments_kobo) - payment.amount_kobo,
        );
        const response = await advancedReadHandler(
          api,
          operations,
          'refunds',
          paid.orderId,
        )(
          new Request('https://tickets.example/', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key.credential },
          }),
        );
        assert.equal(response.status, 405);
      },
    );
    await t.test(
      'pagination is bounded, cursors are reusable only for the same scope/filter and logs contain no ticket or contact secrets',
      async () => {
        const page = await read('orders', null, '?limit=1');
        assert.equal(page.body.data.length, 1);
        assert.ok(page.body.meta.next_cursor);
        const next = await read(
          'orders',
          null,
          '?limit=1&cursor=' + page.body.meta.next_cursor,
        );
        assert.equal(next.status, 200);
        assert.notEqual(next.body.data[0].id, page.body.data[0].id);
        assert.equal(
          (
            await read(
              'orders',
              null,
              '?limit=1&event_id=' +
                ids.event +
                '&cursor=' +
                page.body.meta.next_cursor,
            )
          ).status,
          400,
        );
        const metadata = JSON.stringify(logs);
        for (const privateValue of [
          key.credential,
          memberCode,
          'member@example.test',
          '08012345678',
        ])
          assert.ok(!metadata.includes(privateValue));
      },
    );
  } finally {
    await db.close();
  }
});

void test('advanced Test credentials use only the isolated database mode; Live credentials and mismatched modes are rejected', async () => {
  const f = await createOperationsFixture('test');
  try {
    const key = await f.issue(['orders:read', 'sales:read']);
    await f.buy(f.ids.free);
    const proof = {
      keyId: key.id,
      digest: key.digest,
      environment: 'test' as const,
    };
    const query = { eventId: null, resourceId: null, limit: 20, after: null };
    const result = await f.operations.read(proof, 'orders', query);
    assert.equal(result.rows.length, 1);
    await assert.rejects(() =>
      f.operations.read({ ...proof, environment: 'live' }, 'orders', query),
    );
    await f.db.exec(
      "update public.integration_resource_settings set environment='live',project_ref=null,live_project_ref=null where singleton",
    );
    await assert.rejects(() => f.operations.read(proof, 'orders', query));
  } finally {
    await f.db.close();
  }
});
