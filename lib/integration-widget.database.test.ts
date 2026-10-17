import assert from 'node:assert/strict';
import test from 'node:test';
import { createWidgetTestFixture } from './test-support/widget-database.ts';
import {
  widgetPageHandler,
  widgetCheckoutHandler,
} from './integrations/widget-html.ts';
import { hostedSecretDigest } from './integrations/checkout-access.ts';
import { parseIntegrationCredential } from './integrations/keys.ts';
import { signWidgetProof } from './integrations/widget-proof.ts';
import { projectWidgetSnapshot } from './integrations/widget.ts';
void test('widgets reuse the hosted checkout and inventory engine with a separate public opt-in actor', async (t) => {
  const fixture = await createWidgetTestFixture();
  const { db, ids, app, key, selection, signing, deps, configure } = fixture;
  try {
    const page = new URL(
      '/embed/events/' + ids.event,
      deps.origin(new Request('https://tickets.example')),
    );
    for (const [name, value] of Object.entries({
      widget: selection.widgetId,
      environment: selection.environment,
      parent_origin: selection.parentOrigin,
      return_url: selection.returnUrl,
      channel: selection.channel,
    }))
      page.searchParams.set(name, value);
    const snapshot = () => deps.read(selection);
    const handoff = async (
      ticket = ids.group,
      quantity = 2,
      proof?: string,
    ) => {
      const row = await snapshot();
      const token =
        proof ||
        signWidgetProof(
          {
            ...selection,
            configurationId: row.actor.widgetConfigId,
            revision: row.actor.revision,
          },
          signing,
        );
      const body = new URLSearchParams({
        proof: token,
        ['quantity_' + ticket]: String(quantity),
        promo_code: '',
      });
      return {
        token,
        body,
        response: await widgetCheckoutHandler(deps)(
          new Request('https://tickets.example/integrations/widget-checkout', {
            method: 'POST',
            headers: {
              Origin: 'https://tickets.example',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
          }),
        ),
      };
    };
    await t.test(
      'default disabled, manager/tenant/origin/event/mode restrictions and private grants',
      async () => {
        assert.equal(parseIntegrationCredential(app.widgetId), null);
        await assert.rejects(() => snapshot(), /unavailable/);
        await assert.rejects(
          () => configure(true, true, ids.customer),
          /permission/,
        );
        await configure();
        for (const change of [
          { parentOrigin: 'https://evil.example' },
          { eventId: ids.otherEvent },
          { environment: 'test' as const },
          { widgetId: 'nt_widget_' + '0'.repeat(32) },
        ])
          await assert.rejects(() => deps.read({ ...selection, ...change }));
        await db.exec('set role anon');
        await assert.rejects(
          () => db.query('select * from public.integration_widgets'),
          /permission denied/,
        );
        await assert.rejects(() => snapshot(), /permission denied/);
        await db.exec('reset role');
      },
    );
    await t.test(
      'public projection and framed HTML contain only allowed fields and a signed selection proof',
      async () => {
        const row = await snapshot(),
          data = projectWidgetSnapshot(row, selection);
        assert.equal(
          data.tickets.find((t) => t.id === ids.group)!.admissions_per_ticket,
          5,
        );
        assert.equal(
          data.tickets.find((t) => t.id === ids.group)!.price_kobo,
          4500000,
        );
        assert.equal(
          data.tickets.find((t) => t.id === ids.group)!.max_packages_available,
          6,
        );
        const response = await widgetPageHandler(
          deps,
          ids.event,
        )(new Request(page));
        assert.equal(response.status, 200);
        assert.ok(
          response.headers
            .get('Content-Security-Policy')!
            .includes('frame-ancestors https://partner.example'),
        );
        assert.equal(response.headers.get('X-Frame-Options'), null);
        const html = await response.text();
        assert.match(html, /target="_top"/);
        assert.match(html, /Select tickets/);
        for (const secret of [
          key.credential,
          key.digest,
          signing.keys.v1,
          'service_role',
          'purchaser_email',
          'qr_token_hash',
          'claim_access_token',
        ])
          assert.ok(!html.includes(secret), secret);
        assert.ok(!JSON.stringify(data).includes('widgetConfigId'));
      },
    );
    let orderId = '',
      accessHash = '',
      sessionId = '',
      reservationToken = '';
    await t.test(
      'native handoff is idempotent and reserves no admissions until normal reservation; 2 group packages reserve 10',
      async () => {
        const first = await handoff();
        assert.equal(first.response.status, 303);
        const target = new URL(first.response.headers.get('Location')!);
        sessionId = target.pathname.split('/').at(-1)!;
        accessHash = await hostedSecretDigest(
          target.searchParams.get('access')!,
        );
        const repeat = await handoff(ids.group, 2, first.token);
        assert.equal(repeat.response.headers.get('Location'), target.href);
        assert.equal(
          (await handoff(ids.group, 1, first.token)).response.status,
          409,
        );
        assert.equal(
          (await db.query('select * from public.orders')).rows.length,
          0,
        );
        assert.equal(
          (await db.query('select * from public.integration_api_keys')).rows
            .length,
          1,
        );
        const session = (
          await db.query<{
            key_id: null;
            widget_configuration_id: string;
            reservation_token_hash: string;
          }>(
            'select key_id,widget_configuration_id,reservation_token_hash from public.integration_checkout_sessions where id=$1',
            [sessionId],
          )
        ).rows[0];
        assert.equal(session.key_id, null);
        assert.ok(session.widget_configuration_id);
        reservationToken = session.reservation_token_hash;
        const items = [
          { ticket_type_id: ids.group, quantity: 2, attendees: [] },
        ];
        const buyer = {
          name: 'Widget buyer',
          email: 'buyer@example.com',
          phone: '08012345678',
        };
        const reservation = (
          await db.query<{ value: { orderId: string } }>(
            'select public.reserve_hosted_checkout($1,$2,$3,$4::jsonb,$5::jsonb,null,$6) value',
            [
              sessionId,
              accessHash,
              ids.customer,
              JSON.stringify(items),
              JSON.stringify(buyer),
              'c'.repeat(64),
            ],
          )
        ).rows[0].value;
        orderId = reservation.orderId;
        assert.equal(
          (
            await db.query<{ quantity_reserved: number }>(
              'select quantity_reserved from public.ticket_types where id=$1',
              [ids.group],
            )
          ).rows[0].quantity_reserved,
          10,
        );
      },
    );
    await t.test(
      'verified group payment issues reserved slots once, and checkout API key can read its application status',
      async () => {
        const payment = (
          await db.query<{ payment_reference: string; amount_kobo: number }>(
            'select * from public.prepare_paystack_payment($1,$2)',
            [orderId, reservationToken],
          )
        ).rows[0];
        for (let i = 0; i < 2; i++)
          await db.query(
            "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','widget-provider','{}')",
            [payment.payment_reference, payment.amount_kobo],
          );
        const status = (
          await db.query<{
            value: {
              status: string;
              admissions: number;
              tickets_issued: number;
            };
          }>(
            "select public.get_integration_checkout_session($1,$2,'live',$3) value",
            [key.id, key.digest, sessionId],
          )
        ).rows[0].value;
        assert.equal(status.status, 'paid');
        assert.equal(status.admissions, 10);
        assert.equal(status.tickets_issued, 0);
        assert.equal(
          (
            await db.query(
              "select * from public.tickets where claim_state='UNCLAIMED' and display_code is null",
            )
          ).rows.length,
          10,
        );
        const tier = (
          await db.query<{ quantity_sold: number; quantity_reserved: number }>(
            'select quantity_sold,quantity_reserved from public.ticket_types where id=$1',
            [ids.group],
          )
        ).rows[0];
        assert.deepEqual(tier, { quantity_sold: 10, quantity_reserved: 0 });
        assert.equal(
          (
            await db.query(
              "select * from public.integration_outbox_events where type='order.paid'",
            )
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      'past, draft and sold-out events are handled without creating a reservation',
      async () => {
        await db.exec('begin');
        try {
          await db.query(
            "update public.events set starts_at=now()-interval '3 days',ends_at=now()-interval '2 days' where id=$1",
            [ids.event],
          );
          await assert.rejects(() => snapshot(), /unavailable/);
        } finally {
          await db.exec('rollback');
        }
        await db.exec('begin');
        try {
          await db.query(
            "update public.events set status='draft' where id=$1",
            [ids.event],
          );
          await assert.rejects(() => snapshot(), /unavailable/);
        } finally {
          await db.exec('rollback');
        }
        await db.exec('begin');
        try {
          await db.query(
            'update public.ticket_types set quantity_sold=quantity_total where id=$1',
            [ids.group],
          );
          assert.equal(
            projectWidgetSnapshot(await snapshot(), selection).tickets.find(
              (item) => item.id === ids.group,
            )!.max_packages_available,
            0,
          );
          assert.equal((await handoff(ids.group, 1)).response.status, 409);
          assert.match(
            await (
              await widgetPageHandler(deps, ids.event)(new Request(page))
            ).text(),
            /Sold out/,
          );
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test(
      'ordinary/free checkout reuses customer linkage; an authorised provider callback still completes after widget disable',
      async () => {
        await db.exec('begin');
        try {
          for (const type of [ids.free, ids.tier]) {
            const result = await handoff(type, 1),
              target = new URL(result.response.headers.get('Location')!);
            const id = target.pathname.split('/').at(-1)!,
              hash = await hostedSecretDigest(
                target.searchParams.get('access')!,
              );
            const buyer = {
              name: 'Widget member',
              email: 'member@example.com',
              phone: '08012345678',
            };
            const booking = (
              await db.query<{ value: { orderId: string } }>(
                'select public.reserve_hosted_checkout($1,$2,$3,$4::jsonb,$5::jsonb,null,$6) value',
                [
                  id,
                  hash,
                  ids.customer,
                  JSON.stringify([
                    { ticket_type_id: type, quantity: 1, attendees: [buyer] },
                  ]),
                  JSON.stringify(buyer),
                  'd'.repeat(64),
                ],
              )
            ).rows[0].value;
            const token = (
              await db.query<{ token: string }>(
                'select reservation_token_hash token from public.integration_checkout_sessions where id=$1',
                [id],
              )
            ).rows[0].token;
            if (type === ids.free)
              await db.query('select public.complete_free_checkout($1,$2)', [
                booking.orderId,
                token,
              ]);
            else {
              const prepared = (
                await db.query<{
                  payment_reference: string;
                  amount_kobo: number;
                }>('select * from public.prepare_paystack_payment($1,$2)', [
                  booking.orderId,
                  token,
                ])
              ).rows[0];
              await configure(false, false);
              await db.query(
                "select * from public.finalize_paystack_payment($1,'success',$2,'NGN','widget-ordinary-provider','{}')",
                [prepared.payment_reference, prepared.amount_kobo],
              );
            }
            const order = (
              await db.query<{ status: string; customer_id: string }>(
                'select status,customer_id from public.orders where id=$1',
                [booking.orderId],
              )
            ).rows[0];
            assert.equal(order.status, 'paid');
            assert.equal(order.customer_id, ids.customer);
            assert.equal(
              (
                await db.query(
                  'select t.id from public.tickets t join public.order_items i on i.id=t.order_item_id where i.order_id=$1 and t.display_code is not null',
                  [booking.orderId],
                )
              ).rows.length,
              1,
            );
          }
        } finally {
          await db.exec('rollback');
        }
      },
    );
    await t.test(
      'disable/revision/origin/grant/manager changes block unpaid work while paid receipts remain available',
      async () => {
        const pending = await handoff(ids.free, 1);
        const target = new URL(pending.response.headers.get('Location')!);
        const id = target.pathname.split('/').at(-1)!,
          hash = await hostedSecretDigest(target.searchParams.get('access')!);
        await configure(false, false);
        await assert.rejects(
          () =>
            db.query('select public.get_hosted_checkout($1,$2)', [id, hash]),
          /disabled/,
        );
        assert.ok(
          (
            await db.query('select public.get_hosted_checkout($1,$2)', [
              sessionId,
              accessHash,
            ])
          ).rows.length,
        );
        await configure();
        assert.equal(
          (await handoff(ids.free, 1, pending.token)).response.status,
          409,
        );
        await db.query(
          'delete from public.integration_event_grants where integration_id=$1',
          [app.id],
        );
        await assert.rejects(() => snapshot(), /unavailable/);
        await db.query(
          'insert into public.integration_event_grants values($1,$2,$3)',
          [app.id, ids.org, ids.event],
        );
        await db.query(
          'delete from public.integration_domains where integration_id=$1',
          [app.id],
        );
        await assert.rejects(() => snapshot(), /unavailable/);
        await db.query(
          "insert into public.integration_domains values($1,'live',$2)",
          [app.id, selection.parentOrigin],
        );
        await db.query(
          'update public.organiser_memberships set can_manage_integrations=false where user_id=$1',
          [ids.owner],
        );
        await assert.rejects(() => snapshot(), /unavailable/);
        await db.query(
          'update public.organiser_memberships set can_manage_integrations=true where user_id=$1',
          [ids.owner],
        );
        await assert.rejects(() => snapshot(), /unavailable/);
      },
    );
  } finally {
    await db.close();
  }
});

void test('widget database budgets accept all real widget namespaces and preserve restrictive API access', async () => {
  const f = await createWidgetTestFixture();
  try {
    for (const bucket of [
      'widget:global',
      'widget:ip:' + 'a'.repeat(64),
      'widget:read:' + f.app.id,
      'widget:read:org:' + f.ids.org,
      'widget:create:' + f.app.id,
      'widget:create:org:' + f.ids.org,
    ]) {
      const read = async () =>
        (
          await f.db.query<{ v: { allowed: boolean } }>(
            'select public.consume_integration_rate_limit($1,1,60) v',
            [bucket],
          )
        ).rows[0].v.allowed;
      assert.equal(await read(), true);
      assert.equal(await read(), false);
    }
    await assert.rejects(
      () =>
        f.db.query(
          "select public.consume_integration_rate_limit('widget:anything',1,60)",
        ),
      /Invalid rate limit bucket/,
    );
    await f.db.exec('set role anon');
    await assert.rejects(
      () =>
        f.db.query(
          "select public.consume_integration_rate_limit('widget:global',1,60)",
        ),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
