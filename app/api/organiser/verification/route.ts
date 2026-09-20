import { NextResponse } from 'next/server';
import { ensureOrganiser } from '@/lib/organiser-account';
import {
  organiserFacingReference,
  validIdentityReference,
} from '@/lib/organiser-verification';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

async function verificationForUser(
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>,
) {
  const organiserId = await ensureOrganiser(user);
  const client = getSupabaseAdminClient();
  const [organiser, request] = await Promise.all([
    client
      .from('organisers')
      .select('name,account_type,verified_at')
      .eq('id', organiserId)
      .single(),
    client
      .from('organiser_verification_requests')
      .select(
        'legal_name,registration_reference,status,submitted_at,reviewed_at,decision_seen_at,review_note',
      )
      .eq('organiser_id', organiserId)
      .maybeSingle(),
  ]);
  if (organiser.error) throw organiser.error;
  if (request.error) throw request.error;
  return {
    organiserName: organiser.data.name,
    accountType: organiser.data.account_type,
    verified: Boolean(organiser.data.verified_at),
    status: request.data?.status || 'unverified',
    legalName: request.data?.legal_name || '',
    ...organiserFacingReference(
      organiser.data.account_type as 'individual' | 'organisation',
      request.data?.registration_reference || '',
    ),
    submittedAt: request.data?.submitted_at || null,
    reviewedAt: request.data?.reviewed_at || null,
    reviewNote: request.data?.review_note || '',
    decisionUnread: Boolean(
      request.data?.reviewed_at && !request.data?.decision_seen_at,
    ),
  };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  try {
    return NextResponse.json(
      { verification: await verificationForUser(user) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Unable to load organiser verification', error);
    return NextResponse.json(
      { error: 'Verification could not be loaded.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const legalName =
    typeof body.legalName === 'string' ? body.legalName.trim() : '';
  const registrationReference =
    typeof body.registrationReference === 'string'
      ? body.registrationReference.trim()
      : '';
  if (
    legalName.length < 2 ||
    legalName.length > 120 ||
    registrationReference.length > 120
  ) {
    return NextResponse.json(
      {
        error: 'Enter a valid legal name and identity reference.',
      },
      { status: 400 },
    );
  }
  try {
    const organiserId = await ensureOrganiser(user);
    const client = getSupabaseAdminClient();
    const { data: organiser, error: organiserError } = await client
      .from('organisers')
      .select('account_type')
      .eq('id', organiserId)
      .single();
    if (organiserError) throw organiserError;
    const accountType = organiser.account_type as 'individual' | 'organisation';
    if (!validIdentityReference(accountType, registrationReference)) {
      return NextResponse.json(
        {
          error:
            accountType === 'individual'
              ? 'NIN must contain exactly 11 digits.'
              : 'Enter a valid CAC registration number.',
        },
        { status: 400 },
      );
    }
    const { error } = await client.rpc('submit_organiser_verification', {
      p_user_id: user.id,
      p_organiser_id: organiserId,
      p_legal_name: legalName,
      p_registration_reference: registrationReference,
    });
    if (error) {
      if (error.code === '22023' || error.code === '42501')
        return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    return NextResponse.json(
      { verification: await verificationForUser(user) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Unable to submit organiser verification', error);
    return NextResponse.json(
      { error: 'Verification could not be submitted.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user)
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const reviewedAt = typeof body.reviewedAt === 'string' ? body.reviewedAt : '';
  if (!reviewedAt || Number.isNaN(Date.parse(reviewedAt)))
    return NextResponse.json({ error: 'Invalid decision.' }, { status: 400 });
  try {
    const organiserId = await ensureOrganiser(user);
    const { error } = await getSupabaseAdminClient()
      .from('organiser_verification_requests')
      .update({ decision_seen_at: new Date().toISOString() })
      .eq('organiser_id', organiserId)
      .eq('reviewed_at', reviewedAt)
      .is('decision_seen_at', null);
    if (error) throw error;
    return NextResponse.json(
      { verification: await verificationForUser(user) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Unable to acknowledge verification decision', error);
    return NextResponse.json(
      { error: 'Decision could not be dismissed.' },
      { status: 500 },
    );
  }
}
