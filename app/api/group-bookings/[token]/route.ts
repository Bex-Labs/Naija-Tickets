import { NextResponse } from 'next/server';
import { GROUP_TOKEN_PATTERN, parseGroupClaim } from '@/lib/group-bookings';
import { getPublicGroupInvitation } from '@/lib/group-bookings.server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { token } = await context.params;
    const invitation = await getPublicGroupInvitation(token);
    return invitation
      ? respond(invitation)
      : respond({ error: 'This group invitation is unavailable.' }, 404);
  } catch (error) {
    console.error('Group invitation failed', error);
    return respond({ error: 'Unable to load this invitation.' }, 500);
  }
}
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  const claim = parseGroupClaim(await request.json().catch(() => null));
  if (!GROUP_TOKEN_PATTERN.test(token) || !claim)
    return respond(
      { error: 'Enter a valid name, email and phone number.' },
      400,
    );
  try {
    const { data, error } = await getSupabaseAdminClient().rpc(
      'claim_group_ticket',
      {
        p_invite_token: token,
        p_name: claim.name,
        p_email: claim.email,
        p_phone: claim.phone,
      },
    );
    if (error) throw error;
    return respond({ ticketPath: `/group-ticket/${data}` });
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : '';
    const safe = [
      'Enter a valid name, email and phone number.',
      'This group invitation is unavailable.',
      'This email or phone number has already claimed a ticket in this group.',
      'All tickets in this group have been claimed.',
    ];
    if (!safe.includes(message))
      console.error('Group ticket claim failed', error);
    return respond(
      {
        error: safe.includes(message)
          ? message
          : 'Your ticket could not be claimed. Please try again.',
      },
      409,
    );
  }
}
