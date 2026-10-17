import { createWidgetTestFixture } from './widget-database.ts';
import { hostedCheckoutMigration } from './hosted-checkout-database.ts';
import {
  credentialDigest,
  generateIntegrationCredential,
} from '../integrations/keys.ts';
import { hostedSessionSecret } from '../integrations/checkout-access.ts';
import {
  operationDatabaseError,
  type OperationsDependencies,
} from '../integrations/operations.ts';
import type { IntegrationApiDependencies } from '../integrations/api.ts';
import type {
  IntegrationContext,
  IntegrationScope,
} from '../integrations/types.ts';
export async function createOperationsFixture(mode: 'test' | 'live' = 'live') {
  const fixture = await createWidgetTestFixture(
    'https://partner.example',
    'https://tickets.example',
    mode,
  );
  const { db, ids, app } = fixture;
  try {
    for (const name of [
      '202609150004_guest_privacy_and_ticket_email.sql',
      '202609300001_isolate_event_entry.sql',
      '202610160003_integration_operations.sql',
    ]) {
      const sql = hostedCheckoutMigration(name);
      await db.exec(
        name === '202609150004_guest_privacy_and_ticket_email.sql'
          ? sql.slice(
              0,
              sql.indexOf(
                'create or replace function public.claim_ticket_delivery_v2',
              ),
            )
          : sql,
      );
    }
    await fixture.configure();
    const issue = async (
      scopes: IntegrationScope[],
      application = app.id,
      owner = ids.owner,
    ) => {
      const key = await generateIntegrationCredential(mode);
      await db.query(
        "select public.issue_organiser_integration_key($1,$2,$3,$4,$5,$6,$7,$8::text[],now()+interval '90 days',null)",
        [
          owner,
          application,
          key.id,
          key.digest,
          key.prefix,
          key.suffix,
          mode,
          scopes,
        ],
      );
      return key;
    };
    const logs: unknown[] = [];
    const api: IntegrationApiDependencies = {
      authenticate: async (id, digest, environment) =>
        (
          await db.query<{ value: IntegrationContext | null }>(
            'select public.authenticate_integration_key($1,$2,$3) value',
            [id, digest, environment],
          )
        ).rows[0].value,
      limit: async (bucket, max) =>
        (
          await db.query<{ value: { allowed: boolean; retryAfter: number } }>(
            'select public.consume_integration_rate_limit($1,$2,60) value',
            [bucket, max],
          )
        ).rows[0].value,
      log: (row) => {
        logs.push(row);
      },
    };
    const deps: OperationsDependencies = {
      requireConfiguration: async () => {},
      async read(proof, operation, q) {
        try {
          return (
            await db.query<{ value: { rows: unknown[] } }>(
              'select public.read_integration_operations($1,$2,$3,$4,$5,$6,$7,$8) value',
              [
                proof.keyId,
                proof.digest,
                proof.environment,
                operation,
                q.eventId,
                q.resourceId,
                q.limit,
                q.after,
              ],
            )
          ).rows[0].value;
        } catch (cause) {
          throw operationDatabaseError(cause);
        }
      },
      async entry(proof, input) {
        try {
          return (
            await db.query<{ value: unknown }>(
              'select public.perform_integration_entry($1,$2,$3,$4,$5,$6,$7,$8) value',
              [
                proof.keyId,
                proof.digest,
                proof.environment,
                input.eventId,
                input.code,
                input.admit,
                input.idempotencyDigest,
                input.payloadHash,
              ],
            )
          ).rows[0].value;
        } catch (cause) {
          throw operationDatabaseError(cause);
        }
      },
    };
    const buy = async (tier = ids.group, quantity = 1, paid = true) => {
      const session = {
        id: crypto.randomUUID(),
        environment: mode,
        expires_at: new Date(Date.now() + 1800000).toISOString(),
        signing_key_version: 'v1',
      };
      const accessHash = await credentialDigest(
        await hostedSessionSecret(session, 'access', fixture.signing),
      );
      const reservationHash = await credentialDigest(
        await hostedSessionSecret(session, 'reservation', fixture.signing),
      );
      const intent = {
        event_id: ids.event,
        items: [{ ticket_type_id: tier, quantity }],
        promo_code: null,
        return_url: 'https://partner.example/done',
        cancel_url: 'https://partner.example/done',
      };
      const settings = await fixture.configure();
      await fixture.deps.create(fixture.selection, {
        session,
        intent,
        revision: settings.revision,
        idempotencyDigest: await credentialDigest(crypto.randomUUID()),
        payloadHash: await credentialDigest(JSON.stringify(intent)),
        accessHash,
        reservationHash,
      });
      const buyer = {
        name: 'Fictional buyer',
        email: 'buyer@example.test',
        phone: '08012345678',
      };
      const booking = (
        await db.query<{ value: { orderId: string } }>(
          'select public.reserve_hosted_checkout($1,$2,null,$3::jsonb,$4::jsonb,null,$5) value',
          [
            session.id,
            accessHash,
            JSON.stringify([
              {
                ticket_type_id: tier,
                quantity,
                attendees:
                  tier === ids.group
                    ? []
                    : Array.from({ length: quantity }, () => buyer),
              },
            ]),
            JSON.stringify(buyer),
            await credentialDigest(crypto.randomUUID()),
          ],
        )
      ).rows[0].value;
      if (paid) {
        if (tier === ids.free)
          await db.query('select public.complete_free_checkout($1,$2)', [
            booking.orderId,
            reservationHash,
          ]);
        else {
          const payment = (
            await db.query<{ payment_reference: string; amount_kobo: number }>(
              'select * from public.prepare_paystack_payment($1,$2)',
              [booking.orderId, reservationHash],
            )
          ).rows[0];
          await db.query(
            "select * from public.finalize_paystack_payment($1,'success',$2,'NGN',$3,'{}')",
            [
              payment.payment_reference,
              payment.amount_kobo,
              'fixture-' + session.id,
            ],
          );
        }
      }
      return {
        orderId: booking.orderId,
        sessionId: session.id,
        reservationHash,
      };
    };
    return { ...fixture, issue, api, operations: deps, logs, buy };
  } catch (cause) {
    await db.close();
    throw cause;
  }
}
