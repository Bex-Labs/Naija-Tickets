import { NextResponse } from 'next/server';
import { verifyAdminCredentials } from '@/lib/admin-auth';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

type AccountKind = 'customer' | 'organiser';

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  created_at: string;
};

type MembershipRow = {
  user_id: string;
  organiser_id: string;
  organisers:
    | {
        id: string;
        name: string;
        contact_email: string;
        phone: string | null;
        created_at: string;
        verified_at: string | null;
      }
    | Array<{
        id: string;
        name: string;
        contact_email: string;
        phone: string | null;
        created_at: string;
        verified_at: string | null;
      }>
    | null;
};

function organiserRelation(row: MembershipRow) {
  return Array.isArray(row.organisers) ? row.organisers[0] : row.organisers;
}

async function listAccounts() {
  const client = getSupabaseAdminClient();
  const [{ data: authData, error: authError }, profiles, memberships] =
    await Promise.all([
      client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      client.from('profiles').select('id,full_name,phone,created_at'),
      client
        .from('organiser_memberships')
        .select(
          'user_id,organiser_id,organisers(id,name,contact_email,phone,created_at,verified_at)',
        ),
    ]);
  if (authError) throw authError;
  if (profiles.error) throw profiles.error;
  if (memberships.error) throw memberships.error;

  const profileById = new Map(
    ((profiles.data || []) as ProfileRow[]).map((profile) => [
      profile.id,
      profile,
    ]),
  );
  const membershipByUser = new Map(
    ((memberships.data || []) as unknown as MembershipRow[]).map(
      (membership) => [membership.user_id, membership],
    ),
  );
  const activeUsers = authData.users.filter(
    (user) => !(user as unknown as { deleted_at?: string }).deleted_at,
  );

  const organisers = activeUsers.flatMap((user) => {
    const membership = membershipByUser.get(user.id);
    const organisation = membership ? organiserRelation(membership) : null;
    if (!membership || !organisation) return [];
    const profile = profileById.get(user.id);
    return [
      {
        id: user.id,
        organiserId: organisation.id,
        name: profile?.full_name || 'Organiser',
        organisation: organisation.name,
        verified: Boolean(organisation.verified_at),
        email: user.email || organisation.contact_email,
        phone: profile?.phone || organisation.phone || '',
        createdAt: user.created_at,
      },
    ];
  });
  const organiserUserIds = new Set(organisers.map((item) => item.id));
  const customers = activeUsers
    .filter((user) => !organiserUserIds.has(user.id))
    .map((user) => {
      const profile = profileById.get(user.id);
      return {
        id: user.id,
        name: profile?.full_name || 'Customer',
        email: user.email || '',
        phone: profile?.phone || '',
        createdAt: user.created_at,
        confirmed: Boolean(user.email_confirmed_at),
      };
    });

  return { customers, organisers };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

async function audit(
  action: string,
  actorAdminId: string,
  targetUserId: string,
  accountKind: AccountKind,
) {
  const { error } = await getSupabaseAdminClient()
    .from('audit_logs')
    .insert({
      action,
      entity_type: 'auth_user',
      entity_id: targetUserId,
      metadata: { actor_admin_id: actorAdminId, account_kind: accountKind },
    });
  if (error) console.error('Admin user audit failed', error);
}

export async function GET() {
  if (!(await getAuthenticatedAdmin())) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  try {
    return NextResponse.json(await listAccounts());
  } catch (error) {
    console.error('Admin user list failed', error);
    return NextResponse.json(
      { error: 'Accounts could not be loaded.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const current = await getAuthenticatedAdmin();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const text = (key: string) =>
    typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  const accountKind = text('accountKind') as AccountKind;
  const name = text('name');
  const email = text('email').toLowerCase();
  const phone = text('phone');
  const password = text('password');
  const organisation = text('organisation');
  if (
    !['customer', 'organiser'].includes(accountKind) ||
    name.length < 2 ||
    !email.includes('@') ||
    phone.length < 7 ||
    password.length < 12 ||
    (accountKind === 'organiser' && organisation.length < 2)
  ) {
    return NextResponse.json(
      { error: 'Complete all account details with a 12-character password.' },
      { status: 400 },
    );
  }

  const client = getSupabaseAdminClient();
  let createdUserId = '';
  let createdOrganiserId = '';
  try {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        phone,
        account_type:
          accountKind === 'organiser' ? 'organisation' : 'individual',
        organisation_name: accountKind === 'organiser' ? organisation : null,
      },
    });
    if (error || !data.user)
      throw error || new Error('Account was not created.');
    createdUserId = data.user.id;

    if (accountKind === 'organiser') {
      const { data: organiser, error: organiserError } = await client
        .from('organisers')
        .insert({
          name: organisation,
          slug: `${slugify(organisation)}-${crypto.randomUUID().slice(0, 8)}`,
          contact_email: email,
          phone,
          description: 'Administrator-created organiser account.',
          approved_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (organiserError) throw organiserError;
      createdOrganiserId = organiser.id;
      const { error: membershipError } = await client
        .from('organiser_memberships')
        .insert({
          organiser_id: organiser.id,
          user_id: createdUserId,
          title: 'Owner',
        });
      if (membershipError) throw membershipError;
      const { error: roleError } = await client.from('user_roles').upsert({
        user_id: createdUserId,
        role: 'organiser',
      });
      if (roleError) throw roleError;
    }

    await audit('admin.user_created', current.id, createdUserId, accountKind);
    return NextResponse.json(await listAccounts());
  } catch (error) {
    if (createdUserId) await client.auth.admin.deleteUser(createdUserId);
    if (createdOrganiserId) {
      await client.from('organisers').delete().eq('id', createdOrganiserId);
    }
    console.error('Admin user creation failed', error);
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json(
      {
        error: message.toLowerCase().includes('already')
          ? 'An account already uses that email address.'
          : 'The account could not be created.',
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const current = await getAuthenticatedAdmin();
  if (!current) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const accountKind = body.accountKind as AccountKind;
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (
    !userId ||
    !['customer', 'organiser'].includes(accountKind) ||
    !currentPassword
  ) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (
    !(await verifyAdminCredentials(current.username, currentPassword, current))
  ) {
    return NextResponse.json(
      { error: 'Your current password is incorrect.' },
      { status: 400 },
    );
  }

  const client = getSupabaseAdminClient();
  try {
    if (accountKind === 'organiser') {
      const { data: memberships, error: membershipError } = await client
        .from('organiser_memberships')
        .select('organiser_id')
        .eq('user_id', userId);
      if (membershipError) throw membershipError;
      const organiserIds = (memberships || []).map((item) => item.organiser_id);
      if (organiserIds.length) {
        const { error: eventError } = await client
          .from('events')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .in('organiser_id', organiserIds)
          .in('status', ['draft', 'submitted', 'published', 'rejected']);
        if (eventError) throw eventError;
      }
      const { error: deleteMembershipError } = await client
        .from('organiser_memberships')
        .delete()
        .eq('user_id', userId);
      if (deleteMembershipError) throw deleteMembershipError;
    }

    await client.from('user_roles').delete().eq('user_id', userId);
    await client
      .from('profiles')
      .update({
        full_name: 'Deleted account',
        phone: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    const { error: deleteError } = await client.auth.admin.deleteUser(
      userId,
      true,
    );
    if (deleteError) throw deleteError;

    await audit('admin.user_deleted', current.id, userId, accountKind);
    return NextResponse.json(await listAccounts());
  } catch (error) {
    console.error('Admin user deletion failed', error);
    return NextResponse.json(
      { error: 'The account could not be deleted.' },
      { status: 400 },
    );
  }
}
