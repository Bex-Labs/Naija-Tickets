import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import {
  hostedCheckoutAdditionalMigrations,
  hostedCheckoutFixtureSql,
  hostedFixtureIds as ids,
  hostedCheckoutMigration,
} from '../lib/test-support/hosted-checkout-database.ts';
import { generateIntegrationCredential } from '../lib/integrations/keys.ts';
import {
  hostedSecretDigest,
  hostedSessionSecret,
} from '../lib/integrations/checkout-access.ts';
const container = process.env.NAIJA_TEST_POSTGRES_CONTAINER;
const socket = process.env.NAIJA_TEST_POSTGRES_SOCKET;
const native =
  !!socket && /^\/(?:private\/)?tmp\/naija-phase3-pg[a-zA-Z0-9]+$/.test(socket);
if (!native && (!container || !/^naija-phase3-[a-z0-9-]+$/.test(container)))
  throw Error(
    'Use a disposable naija-phase3-* container or /tmp/naija-phase3-pg* Unix socket; never point this test at an existing database.',
  );
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const execute = (sql: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      native ? `${process.env.NAIJA_TEST_POSTGRES_BIN}/psql` : 'docker',
      native
        ? [
            '-h',
            socket!,
            '-p',
            process.env.NAIJA_TEST_POSTGRES_PORT ?? '65483',
            '-U',
            'postgres',
            '-d',
            'naija_phase3',
            '-v',
            'ON_ERROR_STOP=1',
            '-Atq',
          ]
        : [
            '--context',
            'desktop-linux',
            'exec',
            '-i',
            container!,
            'psql',
            '-U',
            'postgres',
            '-d',
            'naija_phase3',
            '-v',
            'ON_ERROR_STOP=1',
            '-Atq',
          ],
      { timeout: 45000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) =>
        error ? reject(Error(stderr.slice(0, 1500))) : resolve(stdout.trim()),
    );
    child.stdin?.end(sql);
  });
void test('independent PostgreSQL connections serialize hosted reservations, discount limits, initialization and duplicate finalization', async (t) => {
  const early = hostedCheckoutMigration(
    '202609170002_early_bird_ticket_pricing.sql',
  );
  await execute(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create schema extensions;create extension pgcrypto with schema extensions;`,
  );
  for (const sql of [
    hostedCheckoutMigration('202609120001_initial_schema.sql'),
    hostedCheckoutMigration('202609150001_paystack_payments.sql'),
    early.slice(
      0,
      early.indexOf('create function public.save_organiser_event_v2'),
    ),
    early.slice(
      early.indexOf(
        'create or replace function public.create_checkout_reservation_v2',
      ),
      early.indexOf(
        'comment on function public.save_organiser_event_v2',
        early.indexOf(
          'create or replace function public.create_checkout_reservation_v2',
        ),
      ),
    ),
    hostedCheckoutMigration('202609200001_promo_codes.sql'),
    ...hostedCheckoutAdditionalMigrations(),
    hostedCheckoutMigration('202609250001_admin_refunds.sql'),
    hostedCheckoutMigration('202610160001_integration_webhooks.sql'),
    hostedCheckoutMigration('202610160002_integration_widgets.sql'),
    hostedCheckoutMigration('202610160006_integration_widget_rate_limits.sql'),
    hostedCheckoutMigration(
      '202609150004_guest_privacy_and_ticket_email.sql',
    ).split('create or replace function public.claim_ticket_delivery_v2')[0],
    hostedCheckoutMigration('202609300001_isolate_event_entry.sql'),
    hostedCheckoutMigration('202610160003_integration_operations.sql'),
    hostedCheckoutMigration('202610160004_integration_readiness.sql'),
  ])
    await execute(sql);
  await execute(hostedCheckoutFixtureSql());
  const key = await generateIntegrationCredential('live');
  const app = JSON.parse(
    await execute(
      `select public.save_organiser_integration('${ids.owner}',null,'${ids.org}','Partner','active','[{"environment":"live","origin":"https://partner.example"}]'::jsonb,'{${ids.event}}'::uuid[]);`,
    ),
  ).id;
  await execute(
    `select public.issue_organiser_integration_key('${ids.owner}','${app}','${key.id}','${key.digest}','${key.prefix}','${key.suffix}','live','{checkout:write,orders:read}',now()+interval '90 days',null);`,
  );
  const signing = {
    activeVersion: 'v1',
    keys: { v1: 'disposable-concurrency-fixture-' + 'x'.repeat(50) },
  };
  const freshEvent = async (
    total = 20,
    size = 1,
    earlyLimit: number | null = null,
  ) => {
    const event = crypto.randomUUID(),
      tier = crypto.randomUUID();
    await execute(
      `insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at,status) values('${event}','${ids.org}','${ids.owner}','Concurrent','concurrent-${event}','Test presents','Show','Hall','Road','Lagos','Lagos',now()+interval '2 days',now()+interval '3 days','published');insert into public.integration_event_grants values('${app}','${ids.org}','${event}');insert into public.ticket_types(id,event_id,name,price_kobo,standard_price_kobo,quantity_total,admissions_per_ticket,early_bird_price_kobo,early_bird_ends_at,early_bird_quantity) values('${tier}','${event}','Pass',100000,100000,${total},${size},${earlyLimit ? '50000' : 'null'},${earlyLimit ? "now()+interval '1 day'" : 'null'},${earlyLimit ?? 'null'});`,
    );
    return { event, tier, size };
  };
  const create = async (
    fixture: Awaited<ReturnType<typeof freshEvent>>,
    quantity = 1,
    idem = crypto.randomUUID(),
    promo: string | null = null,
  ) => {
    const identity = {
      id: crypto.randomUUID(),
      environment: 'live' as const,
      expires_at: new Date(Date.now() + 1800000).toISOString(),
      signing_key_version: 'v1',
    };
    const access = await hostedSessionSecret(identity, 'access', signing),
      token = await hostedSessionSecret(identity, 'reservation', signing);
    const intent = JSON.stringify([{ ticket_type_id: fixture.tier, quantity }]);
    const row = JSON.parse(
      await execute(
        `select public.create_integration_checkout_session('${key.id}','${key.digest}','live','${identity.id}','${fixture.event}',${quote(intent)}::jsonb,${promo ? quote(promo) : 'null'},'https://partner.example/done','https://partner.example/cancel','${await hostedSecretDigest(idem)}','${await hostedSecretDigest(intent)}','${await hostedSecretDigest(access)}','${await hostedSecretDigest(token)}','v1','${identity.expires_at}');`,
      ),
    );
    const real = { ...identity, id: row.id, expires_at: row.expires_at };
    return {
      ...fixture,
      quantity,
      promo,
      id: row.id,
      access: await hostedSessionSecret(real, 'access', signing),
      token: await hostedSessionSecret(real, 'reservation', signing),
    };
  };
  const reserve = async (session: Awaited<ReturnType<typeof create>>) => {
    const buyer = {
      name: 'Concurrent guest',
      email: 'concurrent@example.test',
      phone: '08012345678',
    };
    const items = JSON.stringify([
      {
        ticket_type_id: session.tier,
        quantity: session.quantity,
        attendees:
          session.size > 1
            ? []
            : Array.from({ length: session.quantity }, () => buyer),
      },
    ]);
    return JSON.parse(
      await execute(
        `select public.reserve_hosted_checkout('${session.id}','${await hostedSecretDigest(session.access)}',null,${quote(items)}::jsonb,${quote(JSON.stringify(buyer))}::jsonb,${session.promo ? quote(session.promo) : 'null'},'${await hostedSecretDigest(items)}');`,
      ),
    );
  };
  await t.test(
    'concurrent absent idempotency row produces one session and concurrent form retries produce one order/hold',
    async () => {
      const fixture = await freshEvent(),
        idem = crypto.randomUUID();
      const sessions = await Promise.all(
        Array.from({ length: 10 }, () => create(fixture, 2, idem)),
      );
      assert.equal(new Set(sessions.map((s) => s.id)).size, 1);
      const booked = await Promise.all(sessions.map(reserve));
      assert.equal(new Set(booked.map((b) => b.orderId)).size, 1);
      assert.equal(
        Number(
          await execute(
            `select quantity_reserved from public.ticket_types where id='${fixture.tier}';`,
          ),
        ),
        2,
      );
    },
  );
  await t.test(
    'competing customers cannot exceed the last admission packages',
    async () => {
      const fixture = await freshEvent(5);
      const sessions = await Promise.all(
        Array.from({ length: 5 }, () => create(fixture, 2)),
      );
      const result = await Promise.allSettled(sessions.map(reserve));
      assert.equal(result.filter((r) => r.status === 'fulfilled').length, 2);
      assert.equal(
        Number(
          await execute(
            `select quantity_reserved from public.ticket_types where id='${fixture.tier}';`,
          ),
        ),
        4,
      );
    },
  );
  await t.test(
    'one remaining early bird package is discounted once under concurrent requests',
    async () => {
      const fixture = await freshEvent(20, 1, 1);
      const sessions = await Promise.all(
        Array.from({ length: 6 }, () => create(fixture)),
      );
      const result = await Promise.all(sessions.map(reserve));
      assert.equal(
        result.filter((r) => r.subtotalKobo === 50000).length,
        1,
        JSON.stringify(
          result.map((r) => ({ subtotal: r.subtotalKobo, total: r.totalKobo })),
        ),
      );
      assert.equal(result.filter((r) => r.subtotalKobo === 100000).length, 5);
    },
  );
  await t.test(
    'one remaining promo redemption cannot be spent twice by simultaneous hosted reservations',
    async () => {
      const fixture = await freshEvent(20);
      await execute(
        `select public.create_organiser_promo_code('${ids.owner}','${fixture.event}','LASTPROMO','percentage',1000,now()-interval '1 hour',now()+interval '1 day',1,'{}'::uuid[]);`,
      );
      const sessions = await Promise.all(
        Array.from({ length: 6 }, () =>
          create(fixture, 1, crypto.randomUUID(), 'LASTPROMO'),
        ),
      );
      const results = await Promise.allSettled(sessions.map(reserve));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        Number(
          await execute(
            `select quantity_reserved from public.ticket_types where id='${fixture.tier}';`,
          ),
        ),
        1,
      );
      assert.equal(
        Number(
          await execute(
            `select count(*) from public.orders where event_id='${fixture.event}';`,
          ),
        ),
        1,
      );
    },
  );
  await t.test(
    'one initialization lease and duplicate paid callbacks cannot issue or sell group admissions twice',
    async () => {
      const fixture = await freshEvent(50, 5),
        session = await create(fixture, 2),
        booking = await reserve(session),
        token = await hostedSecretDigest(session.token);
      const leaseIds = Array.from({ length: 10 }, () => crypto.randomUUID());
      const claimed = await Promise.all(
        leaseIds.map(async (lease) =>
          JSON.parse(
            await execute(
              `select public.claim_checkout_payment_initialization('${booking.orderId}','${token}','${lease}');`,
            ),
          ),
        ),
      );
      assert.equal(claimed.filter((r) => r.outcome === 'ready').length, 1);
      assert.equal(
        claimed.filter((r) => r.outcome === 'initialization_busy').length,
        9,
      );
      const reference = claimed.find(
        (r) => r.outcome === 'ready',
      ).payment_reference;
      const finished = await Promise.all(
        Array.from({ length: 10 }, () =>
          execute(
            `select outcome from public.finalize_paystack_payment('${reference}','success',${booking.totalKobo},'NGN','concurrent-provider','{}'::jsonb,'one-event','charge.success','hash');`,
          ),
        ),
      );
      assert.equal(finished.filter((r) => r === 'success').length, 1);
      assert.equal(finished.filter((r) => r === 'duplicate_event').length, 9);
      const counts = JSON.parse(
        await execute(
          `select json_build_object('sold',quantity_sold,'reserved',quantity_reserved,'slots',(select count(*) from public.tickets where event_id='${fixture.event}'),'usable',(select count(*) from public.tickets where event_id='${fixture.event}' and display_code is not null)) from public.ticket_types where id='${fixture.tier}';`,
        ),
      );
      assert.deepEqual(counts, { sold: 10, reserved: 0, slots: 10, usable: 0 });
    },
  );
  await t.test(
    'cancel and reservation races finish without deadlock and leave no duplicate order or live hold',
    async () => {
      const fixture = await freshEvent(),
        session = await create(fixture);
      await Promise.allSettled([
        reserve(session),
        execute(
          `select public.cancel_hosted_checkout('${session.id}','${await hostedSecretDigest(session.access)}');`,
        ),
      ]);
      assert.equal(
        Number(
          await execute(
            `select quantity_reserved from public.ticket_types where id='${fixture.tier}';`,
          ),
        ),
        0,
      );
      assert.ok(
        Number(
          await execute(
            `select count(*) from public.orders where event_id='${fixture.event}';`,
          ),
        ) <= 1,
      );
    },
  );
  await t.test(
    'transactional events deduplicate concurrent callbacks and concurrent workers claim each delivery once',
    async () => {
      const endpoint = crypto.randomUUID();
      await execute(
        `select public.save_integration_webhook('${ids.owner}','${app}','${endpoint}','live','https://partner.example/hooks','https://partner.example','{order.created,order.paid,group.admissions_reserved}','v1.${'x'.repeat(120)}');`,
      );
      const fixture = await freshEvent(50, 5),
        session = await create(fixture, 2),
        booking = await reserve(session);
      const prepared = JSON.parse(
        await execute(
          `select row_to_json(p) from public.prepare_paystack_payment('${booking.orderId}','${await hostedSecretDigest(session.token)}') p;`,
        ),
      );
      await Promise.all(
        Array.from({ length: 10 }, () =>
          execute(
            `select outcome from public.finalize_paystack_payment('${prepared.payment_reference}','success',${booking.totalKobo},'NGN','webhook-provider','{}');`,
          ),
        ),
      );
      const events = JSON.parse(
        await execute(
          `select json_agg(type order by type) from public.integration_outbox_events where event_id='${fixture.event}';`,
        ),
      );
      assert.deepEqual(events, [
        'group.admissions_reserved',
        'order.created',
        'order.paid',
      ]);
      const batches = await Promise.all(
        Array.from(
          { length: 10 },
          async () =>
            JSON.parse(
              await execute(
                "select public.claim_integration_webhooks('live',5);",
              ),
            ) as { id: string; leaseId: string }[],
        ),
      );
      const claimed = batches.flat();
      assert.equal(claimed.length, 3);
      assert.equal(new Set(claimed.map((job) => job.id)).size, 3);
      const job = claimed[0];
      await execute(
        `update public.integration_webhook_deliveries set lease_expires_at=now()-interval '1 second' where id='${job.id}';`,
      );
      const replay = JSON.parse(
        await execute("select public.claim_integration_webhooks('live',5);"),
      )[0];
      assert.notEqual(replay.leaseId, job.leaseId);
      assert.equal(
        await execute(
          `select public.finish_integration_webhook('${job.id}','${job.leaseId}',200,'success',30);`,
        ),
        'f',
      );
      const completed = await Promise.all(
        Array.from({ length: 10 }, () =>
          execute(
            `select public.finish_integration_webhook('${replay.id}','${replay.leaseId}',200,'success',30);`,
          ),
        ),
      );
      assert.equal(completed.filter((result) => result === 't').length, 1);
    },
  );
  await t.test(
    'public widget creation replays one session under concurrent requests and disabling it leaves API-key checkout independent',
    async () => {
      const widget = await execute(
        `select widget_id from public.integrations where id='${app}';`,
      );
      await execute(
        `select public.manage_integration_widget('${ids.owner}','${app}','live',true,true);`,
      );
      const fixture = await freshEvent(50, 5),
        intent = JSON.stringify([
          { ticket_type_id: fixture.tier, quantity: 2 },
        ]);
      const idem = await hostedSecretDigest('public-widget-concurrency'),
        hash = await hostedSecretDigest(intent);
      const open = async () => {
        const identity = {
          id: crypto.randomUUID(),
          environment: 'live' as const,
          expires_at: new Date(Date.now() + 1800000).toISOString(),
          signing_key_version: 'v1',
        };
        return JSON.parse(
          await execute(
            `select public.create_scoped_integration_session(null,null,'live','${identity.id}','${fixture.event}',${quote(intent)}::jsonb,null,'https://partner.example/done','https://partner.example/cancel','${idem}','${hash}','${await hostedSecretDigest(await hostedSessionSecret(identity, 'access', signing))}','${await hostedSecretDigest(await hostedSessionSecret(identity, 'reservation', signing))}','v1','${identity.expires_at}','${widget}','https://partner.example',1);`,
          ),
        );
      };
      const sessions = await Promise.all(Array.from({ length: 10 }, open));
      assert.equal(new Set(sessions.map((session) => session.id)).size, 1);
      assert.equal(
        await execute(
          `select count(*) from public.integration_checkout_sessions where event_id='${fixture.event}' and key_id is null and widget_configuration_id is not null;`,
        ),
        '1',
      );
      assert.equal(
        await execute(
          `select quantity_reserved from public.ticket_types where id='${fixture.tier}';`,
        ),
        '0',
      );
      await execute(
        `select public.manage_integration_widget('${ids.owner}','${app}','live',false,false);`,
      );
      await assert.rejects(open, /Widget or event unavailable/);
      const apiSession = await create(fixture, 1);
      assert.ok(apiSession.id);
    },
  );
  await t.test(
    'delegated entry serialises duplicate scans/replays and a concurrent full refund without reusing an admission',
    async () => {
      const entryKey = await generateIntegrationCredential('live');
      await execute(
        `select public.issue_organiser_integration_key('${ids.owner}','${app}','${entryKey.id}','${entryKey.digest}','${entryKey.prefix}','${entryKey.suffix}','live','{entry:verify,entry:check-in}',now()+interval '90 days',null);`,
      );
      const paid = async () => {
        const fixture = await freshEvent(10),
          session = await create(fixture),
          booking = await reserve(session);
        const payment = JSON.parse(
          await execute(
            `select row_to_json(p) from public.prepare_paystack_payment('${booking.orderId}','${await hostedSecretDigest(session.token)}') p;`,
          ),
        );
        await execute(
          `select * from public.finalize_paystack_payment('${payment.payment_reference}','success',${booking.totalKobo},'NGN','entry-${session.id}','{}');`,
        );
        const ticket = JSON.parse(
          await execute(
            `select row_to_json(t) from (select id,display_code from public.tickets where event_id='${fixture.event}') t;`,
          ),
        );
        return { fixture, booking, ticket, transaction: 'entry-' + session.id };
      };
      const scan = async (
        target: Awaited<ReturnType<typeof paid>>,
        idem: string,
      ) =>
        JSON.parse(
          await execute(
            `select public.perform_integration_entry('${entryKey.id}','${entryKey.digest}','live','${target.fixture.event}','${target.ticket.display_code}',true,'${await hostedSecretDigest(idem)}','${await hostedSecretDigest(target.ticket.id)}');`,
          ),
        );
      const first = await paid(),
        idem = crypto.randomUUID();
      const replay = await Promise.all(
        Array.from({ length: 10 }, () => scan(first, idem)),
      );
      assert.equal(replay.filter((r) => !r.replayed).length, 1);
      assert.ok(replay.every((r) => r.outcome === 'admitted'));
      assert.equal(
        await execute(
          `select count(*) from public.check_ins where ticket_id='${first.ticket.id}';`,
        ),
        '1',
      );
      const distinct = await paid();
      const scans = await Promise.all(
        Array.from({ length: 10 }, () => scan(distinct, crypto.randomUUID())),
      );
      assert.equal(scans.filter((r) => r.outcome === 'admitted').length, 1);
      assert.equal(scans.filter((r) => r.outcome === 'already_used').length, 9);
      const race = await paid();
      const results = await Promise.allSettled([
        scan(race, crypto.randomUUID()),
        execute(
          `select public.record_admin_refund('${race.booking.orderId}','700001','${race.transaction}',${race.booking.totalKobo},'NGN','processed','Concurrent test refund','test-admin');`,
        ),
      ]);
      assert.ok(
        results.every((r) => r.status === 'fulfilled'),
        JSON.stringify(
          results.map((r) =>
            r.status === 'rejected' ? String(r.reason) : 'fulfilled',
          ),
        ),
      );
      assert.equal(
        await execute(
          `select status from public.orders where id='${race.booking.orderId}';`,
        ),
        'refunded',
      );
      const count = Number(
        await execute(
          `select count(*) from public.check_ins where ticket_id='${race.ticket.id}';`,
        ),
      );
      assert.ok(count <= 1);
      const denied = await scan(race, crypto.randomUUID());
      assert.equal(denied.admitted, false);
      assert.equal(
        await execute(
          `select count(*) from public.check_ins where ticket_id='${race.ticket.id}';`,
        ),
        String(count),
      );
    },
  );
  await t.test(
    'existing group claims serialise duplicate contact and competition for the final unclaimed slot',
    async () => {
      const fixture = await freshEvent(2, 2),
        session = await create(fixture),
        booking = await reserve(session);
      const payment = JSON.parse(
        await execute(
          `select row_to_json(p) from public.prepare_paystack_payment('${booking.orderId}','${await hostedSecretDigest(session.token)}') p;`,
        ),
      );
      await execute(
        `select * from public.finalize_paystack_payment('${payment.payment_reference}','success',${booking.totalKobo},'NGN','group-claim-race','{}');`,
      );
      const token = await execute(
        `select g.invite_token from public.group_bookings g join public.order_items i on i.id=g.order_item_id where i.order_id='${booking.orderId}';`,
      );
      const claims = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          execute(
            `select public.claim_group_ticket('${token}','Fictional member','duplicate@example.test','08011111111');`,
          ),
        ),
      );
      assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
      const last = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          execute(
            `select public.claim_group_ticket('${token}','Fictional member','last${i}@example.test','0802222222${i}');`,
          ),
        ),
      );
      assert.equal(last.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        await execute(
          `select count(*) from public.tickets where event_id='${fixture.event}' and claim_state='CLAIMED';`,
        ),
        '2',
      );
      assert.equal(
        await execute(
          `select quantity_sold from public.ticket_types where id='${fixture.tier}';`,
        ),
        '2',
      );
    },
  );
  await t.test(
    'shared admin limiter bounds a burst across independent connections',
    async () => {
      const bucket = 'admin-login:account:' + 'f'.repeat(64);
      const responses = await Promise.all(
        Array.from({ length: 30 }, () =>
          execute(
            `select public.consume_integration_rate_limit('${bucket}',8,60)->>'allowed';`,
          ),
        ),
      );
      assert.equal(responses.filter((v) => v === 'true').length, 8);
      assert.equal(responses.filter((v) => v === 'false').length, 22);
    },
  );
  await t.test(
    'administrator suspension cannot race key issuance to leave an active credential',
    async () => {
      const target = JSON.parse(
        await execute(
          `select public.save_organiser_integration('${ids.owner}',null,'${ids.org}','Suspension race','active','[]','{${ids.event}}');`,
        ),
      ).id;
      const fresh = await generateIntegrationCredential('live');
      const results = await Promise.allSettled([
        execute(
          `select public.issue_organiser_integration_key('${ids.owner}','${target}','${fresh.id}','${fresh.digest}','${fresh.prefix}','${fresh.suffix}','live','{events:read}',now()+interval '90 days',null);`,
        ),
        execute(
          `select public.admin_suspend_integration('${target}','primary',true,'Concurrent abuse review');`,
        ),
      ]);
      assert.equal(results[1].status, 'fulfilled');
      if (results[0].status === 'rejected')
        assert.match(String(results[0].reason), /Enable this integration/);
      assert.equal(
        await execute(
          `select count(*) from public.integration_api_keys where integration_id='${target}' and revoked_at is null;`,
        ),
        '0',
      );
      await assert.rejects(
        () =>
          execute(
            `select public.save_organiser_integration('${ids.owner}','${target}','${ids.org}','Try re-enable','active','[]','{${ids.event}}');`,
          ),
        /suspended/,
      );
    },
  );
  await t.test(
    'concurrent slow-hash upgrades compare-and-swap the exact previous account hash',
    async () => {
      const legacy = 'a'.repeat(64),
        first = 'scrypt-v1:' + 'b'.repeat(128),
        second = 'scrypt-v1:' + 'c'.repeat(128);
      await execute(
        `insert into public.platform_settings(key,value) values('admin_accounts','{"accounts":[{"id":"primary","password_hash":"${legacy}"}]}');`,
      );
      const updates = await Promise.all(
        [first, second].map((hash) =>
          execute(
            `select public.upgrade_admin_password_hash('primary','${legacy}','${hash}');`,
          ),
        ),
      );
      assert.equal(updates.filter((v) => v === 't').length, 1);
      const stored = await execute(
        `select value->'accounts'->0->>'password_hash' from public.platform_settings where key='admin_accounts';`,
      );
      assert.ok([first, second].includes(stored));
    },
  );
});
