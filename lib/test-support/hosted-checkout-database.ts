import { readFileSync } from 'node:fs';
import { createPromoTestDatabase } from './promo-database.ts';
export const hostedCheckoutMigration = (name: string) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  );
export function hostedCheckoutAdditionalMigrations() {
  const early = hostedCheckoutMigration(
    '202609170002_early_bird_ticket_pricing.sql',
  );
  return [
    hostedCheckoutMigration('202609150002_event_detail_editor.sql'),
    early.slice(
      early.indexOf('create function public.save_organiser_event_v2'),
      early.indexOf(
        'create or replace function public.create_checkout_reservation_v2',
      ),
    ),
    hostedCheckoutMigration('202609160002_paystack_split_settlement.sql'),
    hostedCheckoutMigration('202609260002_group_tickets.sql'),
    hostedCheckoutMigration('202609260003_group_ticket_claims.sql'),
    hostedCheckoutMigration('202610100001_early_bird_quantity.sql'),
    'alter table public.organisers add column verified_at timestamptz;',
    hostedCheckoutMigration('202610130001_integration_foundation.sql'),
    hostedCheckoutMigration('202610140001_integration_event_reads.sql'),
    hostedCheckoutMigration('202610140002_integration_hosted_checkout.sql'),
  ];
}
export async function createHostedCheckoutTestDatabase() {
  const db = await createPromoTestDatabase();
  try {
    for (const sql of hostedCheckoutAdditionalMigrations()) await db.exec(sql);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
export const hostedFixtureIds = {
  owner: '10000000-0000-4000-8000-000000000001',
  customer: '10000000-0000-4000-8000-000000000002',
  org: '20000000-0000-4000-8000-000000000001',
  otherOrg: '20000000-0000-4000-8000-000000000002',
  event: '30000000-0000-4000-8000-000000000001',
  otherEvent: '30000000-0000-4000-8000-000000000002',
  tier: '40000000-0000-4000-8000-000000000001',
  group: '40000000-0000-4000-8000-000000000002',
  free: '40000000-0000-4000-8000-000000000003',
};
export function hostedCheckoutFixtureSql() {
  const {
    owner,
    customer,
    org,
    otherOrg,
    event,
    otherEvent,
    tier,
    group,
    free,
  } = hostedFixtureIds;
  return `
 insert into auth.users values('${owner}'),('${customer}');
 insert into public.profiles(id,full_name) values('${owner}','Owner'),('${customer}','Test customer');
 insert into public.organisers(id,name,slug,contact_email,verified_at) values('${org}','Test organiser','test-organiser','owner@example.test',now()),('${otherOrg}','Other','other','other@example.test',now());
 insert into public.organiser_memberships(organiser_id,user_id,title) values('${org}','${owner}','Owner');
 insert into public.categories(id,name,slug) values('${owner}','Concert','concert');
 insert into public.events(id,organiser_id,category_id,title,slug,presenter_line,description,venue_name,address,city,state,starts_at,ends_at,status)
 values('${event}','${org}','${owner}','Hosted show','hosted-show','Test organiser presents','Show','Hall','Road','Lagos','Lagos',now()+interval '2 days',now()+interval '3 days','published'),('${otherEvent}','${otherOrg}','${owner}','Other show','other-show','Other presents','Show','Hall','Road','Abuja','Abuja',now()+interval '2 days',now()+interval '3 days','published');
 insert into public.ticket_types(id,event_id,name,price_kobo,standard_price_kobo,quantity_total,admissions_per_ticket,early_bird_price_kobo,early_bird_ends_at,early_bird_quantity)
 values('${tier}','${event}','General',100000,100000,20,1,50000,now()+interval '1 day',2),('${group}','${event}','Squad Pass',4500000,4500000,50,5,null,null,null),('${free}','${event}','Free',0,0,20,1,null,null,null);
 `;
}
