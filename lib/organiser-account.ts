import type { User } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

export async function organiserIdsForUser(userId: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('organiser_memberships')
    .select('organiser_id')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []).map((membership) => membership.organiser_id as string);
}

export async function ensureOrganiser(user: User) {
  if (user.user_metadata?.account_purpose === 'customer') {
    throw new Error('An organiser account is required.');
  }
  const client = getSupabaseAdminClient();
  const existing = await organiserIdsForUser(user.id);
  if (existing[0]) return existing[0];

  const metadata = user.user_metadata || {};
  const accountType =
    metadata.account_type === 'individual' ? 'individual' : 'organisation';
  const name =
    metadata.organisation_name ||
    metadata.full_name ||
    `${user.email?.split('@')[0] || 'New'} Events`;
  const { data: organiser, error: organiserError } = await client
    .from('organisers')
    .insert({
      name,
      slug: `${slugify(name)}-${user.id.slice(0, 8)}`,
      contact_email: user.email || 'organiser@naijatickets.ng',
      phone: metadata.phone || null,
      description: 'Naija Tickets organiser account.',
      account_type: accountType,
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (organiserError) throw organiserError;

  const { error: membershipError } = await client
    .from('organiser_memberships')
    .insert({ organiser_id: organiser.id, user_id: user.id, title: 'Owner' });
  if (membershipError) throw membershipError;
  return organiser.id as string;
}
