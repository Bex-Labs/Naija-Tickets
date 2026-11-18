import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperationsFixture } from './test-support/operations-database.ts';

void test('externally managed events reuse ticket capacity but remain private to the integration checkout', async () => {
  const fixture = await createOperationsFixture();
  const { db, app, issue } = fixture;
  try {
    const key = await issue(['external_events:write']);
    const payload = {
      title: 'External Lagos Design Night',
      venue_name: 'Freedom Park',
      address: '1 Hospital Road',
      city: 'Lagos',
      state: 'Lagos',
      timezone: 'Africa/Lagos',
      starts_at: '2027-12-12T18:00:00+01:00',
      ends_at: '2027-12-12T23:00:00+01:00',
      tickets: [
        {
          external_id: 'squad',
          name: 'Squad Pass',
          price_kobo: 4500000,
          quantity: 10,
          admissions_per_ticket: 5,
        },
      ],
    };
    const create = async (value = payload) =>
      (
        await db.query<{
          value: {
            id: string;
            external_id: string;
            title: string;
            status: string;
          };
        }>(
          'select public.upsert_integration_external_event($1,$2,$3,$4,$5::jsonb) value',
          [
            key.id,
            key.digest,
            'live',
            'design-night-2027',
            JSON.stringify(value),
          ],
        )
      ).rows[0].value;

    const first = await create();
    assert.equal(first.external_id, 'design-night-2027');
    assert.equal(first.status, 'published');
    const second = await create({ ...payload, title: 'Updated Design Night' });
    assert.equal(second.id, first.id);
    assert.equal(second.title, 'Updated Design Night');

    const ticket = (
      await db.query<{
        quantity_total: number;
        admissions_per_ticket: number;
        standard_price_kobo: number;
      }>(
        'select quantity_total,admissions_per_ticket,standard_price_kobo from public.ticket_types where event_id=$1',
        [first.id],
      )
    ).rows[0];
    assert.deepEqual(ticket, {
      quantity_total: 50,
      admissions_per_ticket: 5,
      standard_price_kobo: 4500000,
    });
    const grant = (
      await db.query<{ total: number }>(
        'select count(*)::integer total from public.integration_event_grants where integration_id=$1 and event_id=$2',
        [app.id, first.id],
      )
    ).rows[0];
    assert.equal(grant.total, 1);

    await db.exec('grant select on public.events,public.ticket_types to anon');
    await db.exec('set role anon');
    const catalogue = await db.query(
      'select id from public.events where id=$1',
      [first.id],
    );
    const publicTicket = await db.query(
      'select id from public.ticket_types where event_id=$1',
      [first.id],
    );
    await db.exec('reset role');
    assert.equal(catalogue.rows.length, 0);
    assert.equal(publicTicket.rows.length, 0);

    await assert.rejects(
      () =>
        create({
          ...payload,
          tickets: [
            payload.tickets[0],
            { ...payload.tickets[0], name: 'Duplicate external ID' },
          ],
        }),
      /different ID/,
    );
  } finally {
    await db.close();
  }
});
