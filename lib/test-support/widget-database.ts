import {
  createHostedCheckoutTestDatabase,
  hostedCheckoutMigration,
  hostedCheckoutFixtureSql,
  hostedFixtureIds as ids,
} from './hosted-checkout-database.ts';
import { generateIntegrationCredential } from '../integrations/keys.ts';
import type { WidgetSelection } from '../integrations/widget-types.ts';
import type {
  WidgetSnapshot,
  WidgetDependencies,
} from '../integrations/widget.ts';
import type { WidgetConfiguration } from '../integrations/widget-types.ts';
export async function createWidgetTestFixture(
  origin = 'https://partner.example',
  apiOrigin = 'https://tickets.example',
  mode: 'test' | 'live' = 'live',
) {
  const db = await createHostedCheckoutTestDatabase();
  try {
    for (const migration of [
      '202609250001_admin_refunds.sql',
      '202610160001_integration_webhooks.sql',
      '202610160002_integration_widgets.sql',
      '202610160006_integration_widget_rate_limits.sql',
    ])
      await db.exec(hostedCheckoutMigration(migration));
    await db.exec(hostedCheckoutFixtureSql());
    if (mode === 'test')
      await db.exec(
        "update public.integration_resource_settings set environment='test',project_ref='aaaaaaaaaaaaaaaaaaaa',live_project_ref='bbbbbbbbbbbbbbbbbbbb' where singleton",
      );
    const app = (
      await db.query<{ app: { id: string; widgetId: string } }>(
        "select public.save_organiser_integration($1,null,$2,'Widget partner','active',$3::jsonb,$4::uuid[]) app",
        [
          ids.owner,
          ids.org,
          JSON.stringify([{ environment: mode, origin }]),
          [ids.event],
        ],
      )
    ).rows[0].app;
    const key = await generateIntegrationCredential(mode);
    await db.query(
      "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,$7,$8::text[],now()+interval '90 days',null)",
      [
        ids.owner,
        app.id,
        key.id,
        key.digest,
        key.prefix,
        key.suffix,
        mode,
        ['checkout:write', 'orders:read'],
      ],
    );
    const configure = async (
      enabled = true,
      checkout = true,
      user = ids.owner,
    ) =>
      (
        await db.query<{ config: WidgetConfiguration }>(
          'select public.manage_integration_widget($1,$2,$3,$4,$5) config',
          [user, app.id, mode, enabled, checkout],
        )
      ).rows[0].config;
    const selection: WidgetSelection = {
      widgetId: app.widgetId,
      eventId: ids.event,
      environment: mode,
      parentOrigin: origin,
      returnUrl: origin + '/done',
      channel: 'a'.repeat(32),
    };
    const signing = {
      activeVersion: 'v1',
      keys: { v1: 'widget-fixture-only-' + 'x'.repeat(50) },
    };
    const deps: WidgetDependencies = {
      api: {
        limit: async (bucket, maximum) =>
          (
            await db.query<{ value: { allowed: boolean; retryAfter: number } }>(
              'select public.consume_integration_rate_limit($1,$2,60) value',
              [bucket, maximum],
            )
          ).rows[0].value,
      },
      requireConfiguration: async () => {},
      signingKeys: () => signing,
      origin: () => apiOrigin,
      read: async (s) =>
        (
          await db.query<{ value: WidgetSnapshot }>(
            'select public.read_integration_widget($1,$2,$3,$4) value',
            [s.widgetId, s.environment, s.parentOrigin, s.eventId],
          )
        ).rows[0].value,
      create: async (s, input) =>
        (
          await db.query<{
            session: Awaited<ReturnType<WidgetDependencies['create']>>;
          }>(
            'select public.create_scoped_integration_session(null,null,$1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) session',
            [
              s.environment,
              input.session.id,
              s.eventId,
              JSON.stringify(input.intent.items),
              input.intent.promo_code,
              input.intent.return_url,
              input.intent.cancel_url,
              input.idempotencyDigest,
              input.payloadHash,
              input.accessHash,
              input.reservationHash,
              input.session.signing_key_version,
              input.session.expires_at,
              s.widgetId,
              s.parentOrigin,
              input.revision,
            ],
          )
        ).rows[0].session,
    };
    return { db, ids, app, key, selection, signing, deps, configure };
  } catch (error) {
    await db.close();
    throw error;
  }
}
