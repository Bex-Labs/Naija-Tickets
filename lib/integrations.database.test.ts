import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPromoTestDatabase } from './test-support/promo-database.ts';
import { generateIntegrationCredential } from './integrations/keys.ts';

void test('integration foundation enforces tenant ownership, key lifecycle and private access in PostgreSQL', async (t) => {
  const db = await createPromoTestDatabase();
  const a = '10000000-0000-4000-8000-000000000001',
    b = '10000000-0000-4000-8000-000000000002',
    viewer = '10000000-0000-4000-8000-000000000003',
    customer = '10000000-0000-4000-8000-000000000004';
  const orgA = '20000000-0000-4000-8000-000000000001',
    orgB = '20000000-0000-4000-8000-000000000002';
  const eventA = '30000000-0000-4000-8000-000000000001',
    eventB = '30000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`insert into auth.users values('${a}'),('${b}'),('${viewer}'),('${customer}');
      insert into public.profiles(id,full_name) values('${a}','Owner A'),('${b}','Owner B'),('${viewer}','Staff'),('${customer}','Customer');
      insert into public.organisers(id,name,slug,contact_email) values('${orgA}','Org A','org-a','a@example.com'),('${orgB}','Org B','org-b','b@example.com');
      insert into public.organiser_memberships(organiser_id,user_id,title) values('${orgA}','${a}','Owner'),('${orgB}','${b}','Owner'),('${orgA}','${viewer}','Staff');
      insert into public.categories(id,name,slug) values('${a}','Concert','concert');
      insert into public.events(id,organiser_id,category_id,title,slug,description,venue_name,address,city,state,starts_at,ends_at,status)
      values('${eventA}','${orgA}','${a}','Event A','event-a','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','published'),
      ('${eventB}','${orgB}','${a}','Event B','event-b','Show','Hall','Road','Lagos','Lagos',now()+interval '1 day',now()+interval '2 days','published');`);
    await db.exec(`insert into public.organisers(id,name,slug,contact_email) values('20000000-0000-4000-8000-000000000003','Ambiguous','ambiguous','ambiguous@example.com');
      insert into public.organiser_memberships(organiser_id,user_id,title) values('20000000-0000-4000-8000-000000000003','${viewer}','Owner'),('20000000-0000-4000-8000-000000000003','${customer}','Owner');`);
    await db.exec(
      readFileSync(
        new URL(
          '../supabase/migrations/202610130001_integration_foundation.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await t.test(
      'ambiguous owners are not auto-granted and new server-created owners bootstrap safely',
      async () => {
        const ambiguous = (
          await db.query<{ can_manage_integrations: boolean }>(
            "select can_manage_integrations from public.organiser_memberships where organiser_id='20000000-0000-4000-8000-000000000003'",
          )
        ).rows;
        assert.equal(ambiguous.length, 2);
        assert.ok(ambiguous.every((row) => !row.can_manage_integrations));
        await db.exec('begin');
        try {
          const third = '20000000-0000-4000-8000-000000000004';
          await db.query(
            "insert into public.organisers(id,name,slug,contact_email) values($1,'New','new','new@example.com')",
            [third],
          );
          await db.query(
            "insert into public.organiser_memberships(organiser_id,user_id,title) values($1,$2,'Owner'),($1,$3,'Owner')",
            [third, customer, viewer],
          );
          const rows = (
            await db.query<{
              user_id: string;
              can_manage_integrations: boolean;
            }>(
              'select user_id,can_manage_integrations from public.organiser_memberships where organiser_id=$1 order by user_id',
              [third],
            )
          ).rows;
          assert.equal(
            rows.find((row) => row.user_id === customer)
              ?.can_manage_integrations,
            true,
          );
          assert.equal(
            rows.find((row) => row.user_id === viewer)?.can_manage_integrations,
            false,
          );
        } finally {
          await db.exec('rollback');
        }
      },
    );
    const save = async (
      user = a,
      org = orgA,
      id: string | null = null,
      events = [eventA],
      status = 'active',
      domains: unknown[] = [],
    ) =>
      (
        await db.query<{
          app: { id: string; keys: unknown[]; widgetId: string };
        }>(
          'select public.save_organiser_integration($1,$2,$3,$4,$5,$6::jsonb,$7::uuid[]) as app',
          [user, id, org, 'Website', status, JSON.stringify(domains), events],
        )
      ).rows[0].app;
    const appA = await save(),
      appB = await save(b, orgB, null, [eventB]);
    const issue = async (
      id = appA.id,
      user = a,
      mode: 'test' | 'live' = 'test',
      scopes = ['integration:read'],
      rotate: string | null = null,
    ) => {
      const generated = await generateIntegrationCredential(mode);
      await db.query(
        "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,$7,$8::text[],now()+interval '90 days',$9)",
        [
          user,
          id,
          generated.id,
          generated.digest,
          generated.prefix,
          generated.suffix,
          mode,
          scopes,
          rotate,
        ],
      );
      return { ...generated, environment: mode };
    };
    const auth = async (
      k: Awaited<ReturnType<typeof issue>>,
      mode = k.environment,
      digest = k.digest,
    ) =>
      (
        await db.query<{
          context: { integrationId: string; environment: string } | null;
        }>('select public.authenticate_integration_key($1,$2,$3) as context', [
          k.id,
          digest,
          mode,
        ])
      ).rows[0].context;
    const reject = async (
      operation: () => Promise<unknown>,
      pattern: RegExp,
    ) => {
      await db.exec('savepoint rejection');
      await assert.rejects(operation, pattern);
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
      'only trusted owners have management permissions; customers and staff do not',
      async () => {
        const grants = (
          await db.query<{ user_id: string; can_manage_integrations: boolean }>(
            "select user_id,can_manage_integrations from public.organiser_memberships where organiser_id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002') order by user_id",
          )
        ).rows;
        assert.deepEqual(
          grants.map((row) => row.can_manage_integrations),
          [true, true, false],
        );
        for (const user of [viewer, customer, b])
          await reject(() => save(user), /permission/);
        const result = (
          await db.query<{
            dashboard: {
              integrations: { id: string }[];
              events: { id: string }[];
            };
          }>('select public.list_organiser_integrations($1) as dashboard', [a])
        ).rows[0].dashboard;
        assert.deepEqual(
          result.integrations.map((app) => app.id),
          [appA.id],
        );
        assert.deepEqual(
          result.events.map((event) => event.id),
          [eventA],
        );
      },
    );
    await scenario(
      'origin configuration is validated by the DB and failed edits roll back',
      async () => {
        await reject(
          () =>
            save(a, orgA, appA.id, [eventA], 'active', [
              { environment: 'live', origin: 'https://example.com/checkout' },
            ]),
          /exact HTTPS/,
        );
        await reject(
          () =>
            save(a, orgA, appA.id, [eventA], 'active', [
              { environment: 'live', origin: 'http://localhost:3001' },
            ]),
          /exact HTTPS/,
        );
        await reject(
          () =>
            save(a, orgA, appA.id, [eventA], 'active', [
              { environment: 'live', origin: 'https://localhost' },
            ]),
          /public HTTPS/,
        );
        const result = await save(a, orgA, appA.id, [eventA], 'active', [
          { environment: 'test', origin: 'http://localhost:3001' },
          { environment: 'live', origin: 'https://example.com' },
        ]);
        assert.ok(result.id);
      },
    );
    await scenario(
      'app edits, keys and event assignments cannot cross organisers',
      async () => {
        await reject(() => save(a, orgA, appB.id), /not found/);
        await reject(() => save(a, orgA, appA.id, [eventB]), /not authorised/);
        await reject(() => issue(appB.id, a), /not found/);
        await reject(
          () =>
            db.query(
              'insert into public.integration_event_grants(integration_id,organiser_id,event_id) values($1,$2,$3)',
              [appA.id, orgA, eventB],
            ),
          /not authorised/,
        );
      },
    );
    await scenario(
      'valid credentials are hashed, test/live bound, scoped and safe in metadata',
      async () => {
        const k = await issue();
        assert.equal((await auth(k))?.integrationId, appA.id);
        assert.equal(await auth(k, 'live'), null);
        assert.equal(await auth(k, 'test', '0'.repeat(64)), null);
        const stored = (
          await db.query<{ credential_digest: string }>(
            'select credential_digest from public.integration_api_keys where id=$1',
            [k.id],
          )
        ).rows[0];
        assert.equal(stored.credential_digest, k.digest);
        const metadata = (
          await db.query('select public.list_organiser_integrations($1)', [a])
        ).rows;
        assert.ok(!JSON.stringify(metadata).includes(k.credential));
        assert.ok(!JSON.stringify(metadata).includes(k.digest));
        await reject(
          () => issue(appA.id, a, 'test', ['orders:read']),
          /Invalid API key/,
        );
        const noScope = await issue(appA.id, a, 'test', []);
        assert.ok(await auth(noScope));
      },
    );
    await scenario(
      'rotation atomically revokes the old key and cannot elevate scopes or cross apps',
      async () => {
        const old = await issue(appA.id, a, 'test', []);
        const newer = await issue(
          appA.id,
          a,
          'test',
          ['integration:read'],
          old.id,
        );
        assert.equal(await auth(old), null);
        assert.ok(await auth(newer));
        const row = (
          await db.query<{ scopes: string[] }>(
            'select scopes from public.integration_api_keys where id=$1',
            [newer.id],
          )
        ).rows[0];
        assert.deepEqual(row.scopes, []);
        await reject(
          () => issue(appB.id, b, 'test', [], newer.id),
          /not found/,
        );
        assert.ok(await auth(newer));
        await reject(
          () => issue(appA.id, a, 'live', [], newer.id),
          /mode cannot change/,
        );
        assert.ok(await auth(newer));
      },
    );
    await scenario(
      'revocation, integration disable, expiry and issuer permission loss invalidate immediately',
      async () => {
        const k = await issue();
        await db.query(
          'select public.revoke_organiser_integration_key($1,$2,$3)',
          [a, appA.id, k.id],
        );
        assert.equal(await auth(k), null);
        const active = await issue();
        await save(a, orgA, appA.id, [eventA], 'disabled');
        assert.equal(await auth(active), null);
        await save(a, orgA, appA.id);
        assert.ok(await auth(active));
        await db.query(
          "update public.integration_api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
          [active.id],
        );
        assert.equal(await auth(active), null);
        const valid = await issue();
        await db.query(
          'update public.organiser_memberships set can_manage_integrations=false where organiser_id=$1 and user_id=$2',
          [orgA, a],
        );
        assert.equal(await auth(valid), null);
        await db.query(
          'update public.organiser_memberships set can_manage_integrations=true where organiser_id=$1 and user_id=$2',
          [orgA, a],
        );
        assert.equal(
          await auth(valid),
          null,
          'restoring manager access must not resurrect a revoked secret',
        );
        const current = await issue();
        await db.query(
          'delete from public.organiser_memberships where organiser_id=$1 and user_id=$2',
          [orgA, a],
        );
        assert.equal(await auth(current), null);
      },
    );
    await scenario(
      'event access requires own assignment, active credential, scope and public sale state',
      async () => {
        const k = await issue();
        const allowed = async (event: string, scope = 'integration:read') =>
          (
            await db.query<{ allowed: boolean }>(
              'select public.integration_key_can_access_event($1,$2,$3,$4,$5) as allowed',
              [k.id, k.digest, k.environment, event, scope],
            )
          ).rows[0].allowed;
        assert.equal(await allowed(eventA), true);
        assert.equal(await allowed(eventB), false);
        assert.equal(await allowed(eventA, 'orders:read'), false);
        await save(a, orgA, appA.id, []);
        assert.equal(await allowed(eventA), false);
        await save(a, orgA, appA.id);
        await db.query("update public.events set status='draft' where id=$1", [
          eventA,
        ]);
        assert.equal(await allowed(eventA), false);
      },
    );
    await scenario(
      'rate budgets are atomic and bounded; active key cap is enforced',
      async () => {
        const limit = async () =>
          (
            await db.query<{
              result: { allowed: boolean; retryAfter: number };
            }>(
              "select public.consume_integration_rate_limit('global:v1',3,60) as result",
            )
          ).rows[0].result;
        const results = await Promise.all(Array.from({ length: 8 }, limit));
        assert.equal(results.filter((row) => row.allowed).length, 3);
        assert.ok(results.every((row) => row.retryAfter >= 1));
        for (let i = 0; i < 20; i++) await issue();
        await reject(() => issue(), /20 active keys/);
      },
    );
    await scenario(
      'browser roles cannot read secret tables or invoke private RPCs',
      async () => {
        for (const role of ['anon', 'authenticated']) {
          await db.exec(`set role ${role}`);
          try {
            await reject(
              () => db.query('select * from public.integration_api_keys'),
              /permission denied/,
            );
            await reject(
              () =>
                db.query('select public.list_organiser_integrations($1)', [a]),
              /permission denied/,
            );
            await reject(
              () =>
                db.query(
                  "select public.consume_integration_rate_limit('global:v1',3,60)",
                ),
              /permission denied/,
            );
          } finally {
            await db.exec('reset role');
          }
        }
      },
    );
    await scenario(
      'audit/request metadata excludes secrets and updates last-used safely',
      async () => {
        const k = await issue();
        await db.query(
          'select public.record_integration_request($1,$2,$3,$4,$5,$6)',
          [crypto.randomUUID(), k.id, 'integration.introspect', 200, null, 10],
        );
        assert.ok(
          (
            await db.query<{ last_used_at: string }>(
              'select last_used_at from public.integration_api_keys where id=$1',
              [k.id],
            )
          ).rows[0].last_used_at,
        );
        const records = (
          await db.query('select metadata from public.audit_logs')
        ).rows;
        assert.ok(!JSON.stringify(records).includes(k.digest));
        assert.ok(!JSON.stringify(records).includes(k.credential));
        const columns = (
          await db.query<{ column_name: string }>(
            "select column_name from information_schema.columns where table_name='integration_request_logs'",
          )
        ).rows.map((row) => row.column_name);
        assert.ok(!columns.includes('payload'));
        assert.ok(!columns.includes('authorization'));
      },
    );
  } finally {
    await db.close();
  }
});
