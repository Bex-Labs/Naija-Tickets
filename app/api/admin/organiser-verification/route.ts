import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/admin-request';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import type { VerificationRequest } from '@/lib/organiser-verification';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function listVerifications(): Promise<VerificationRequest[]> {
  const { data, error } = await getSupabaseAdminClient()
    .from('organisers')
    .select(
      'id,name,account_type,contact_email,phone,verified_at,organiser_verification_requests(legal_name,registration_reference,status,submitted_at,reviewed_at,review_note)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => {
    const relation = row.organiser_verification_requests;
    const request = Array.isArray(relation) ? relation[0] : relation;
    return {
      organiserId: row.id,
      name: row.name,
      accountType: row.account_type as 'individual' | 'organisation',
      contactEmail: row.contact_email,
      phone: row.phone || '',
      verifiedAt: row.verified_at,
      legalName: request?.legal_name || '',
      registrationReference: request?.registration_reference || '',
      status: request?.status || 'unverified',
      submittedAt: request?.submitted_at || null,
      reviewedAt: request?.reviewed_at || null,
      reviewNote: request?.review_note || '',
    } as VerificationRequest;
  });
}

export async function GET() {
  if (!(await getAuthenticatedAdmin()))
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    return NextResponse.json(
      { organisers: await listVerifications() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Unable to list organiser verifications', error);
    return NextResponse.json(
      { error: 'Verification requests could not be loaded.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin)
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const organiserId =
    typeof body.organiserId === 'string' ? body.organiserId : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (
    !UUID.test(organiserId) ||
    typeof body.approved !== 'boolean' ||
    note.length > 1000 ||
    (!body.approved && note.length < 3)
  ) {
    return NextResponse.json(
      { error: 'Choose a decision and add a reason for rejection.' },
      { status: 400 },
    );
  }
  try {
    const client = getSupabaseAdminClient();
    const prior = await client
      .from('organiser_verification_requests')
      .select('status')
      .eq('organiser_id', organiserId)
      .maybeSingle();
    if (prior.error) throw prior.error;
    const { error } = await client.rpc('review_organiser_verification', {
      p_organiser_id: organiserId,
      p_approved: body.approved,
      p_note: note,
      p_actor: admin.id,
    });
    if (error) {
      if (error.code === '22023')
        return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
    const audit = await client.from('audit_logs').insert({
      action: body.approved
        ? 'organiser.verified'
        : prior.data?.status === 'verified'
          ? 'organiser.verification_revoked'
          : 'organiser.verification_rejected',
      entity_type: 'organiser',
      entity_id: organiserId,
      metadata: { actor_admin_id: admin.id, note },
    });
    if (audit.error)
      console.error('Organiser verification audit failed', audit.error);
    return NextResponse.json(
      { organisers: await listVerifications() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Unable to review organiser verification', error);
    return NextResponse.json(
      { error: 'Verification could not be updated.' },
      { status: 500 },
    );
  }
}
