import { NextResponse } from 'next/server';
import { ensureOrganiser } from '@/lib/organiser-account';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

async function settingsForUser(
  user: Awaited<ReturnType<typeof getAuthenticatedUser>>,
) {
  if (!user) throw new Error('Authentication required.');
  const client = getSupabaseAdminClient();
  const organiserId = await ensureOrganiser(user);
  const [profileResult, organiserResult] = await Promise.all([
    client
      .from('profiles')
      .select('full_name,phone')
      .eq('id', user.id)
      .single(),
    client
      .from('organisers')
      .select(
        'name,contact_email,phone,description,account_type,website_url,instagram_url,x_url,facebook_url,tiktok_url',
      )
      .eq('id', organiserId)
      .single(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (organiserResult.error) throw organiserResult.error;

  return {
    fullName: profileResult.data.full_name,
    accountEmail: user.email || '',
    phone: profileResult.data.phone || organiserResult.data.phone || '',
    accountType: organiserResult.data.account_type,
    organisationName: organiserResult.data.name,
    contactEmail: organiserResult.data.contact_email,
    description: organiserResult.data.description || '',
    websiteUrl: organiserResult.data.website_url || '',
    instagramUrl: organiserResult.data.instagram_url || '',
    xUrl: organiserResult.data.x_url || '',
    facebookUrl: organiserResult.data.facebook_url || '',
    tiktokUrl: organiserResult.data.tiktok_url || '',
  };
}

function optionalHttpUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  try {
    return NextResponse.json({ settings: await settingsForUser(user) });
  } catch (error) {
    console.error('Unable to load organiser settings', error);
    return NextResponse.json(
      { error: 'We could not load your settings.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const text = (key: string) =>
    typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  const fullName = text('fullName');
  const phone = text('phone');
  const organisationName = text('organisationName');
  const contactEmail = text('contactEmail').toLowerCase();
  const description = text('description');
  const socialInputs = {
    websiteUrl: text('websiteUrl'),
    instagramUrl: text('instagramUrl'),
    xUrl: text('xUrl'),
    facebookUrl: text('facebookUrl'),
    tiktokUrl: text('tiktokUrl'),
  };
  const socialUrls = Object.fromEntries(
    Object.entries(socialInputs).map(([key, value]) => [
      key,
      optionalHttpUrl(value),
    ]),
  ) as Record<keyof typeof socialInputs, string | null>;
  if (
    fullName.length < 2 ||
    fullName.length > 120 ||
    phone.length < 7 ||
    organisationName.length < 2 ||
    organisationName.length > 120 ||
    !contactEmail.includes('@') ||
    description.length > 1200 ||
    Object.values(socialInputs).some((value) => value.length > 500) ||
    Object.entries(socialInputs).some(
      ([key, value]) => value && !socialUrls[key as keyof typeof socialInputs],
    )
  ) {
    return NextResponse.json(
      { error: 'Check the profile details and try again.' },
      { status: 400 },
    );
  }

  const client = getSupabaseAdminClient();
  try {
    const organiserId = await ensureOrganiser(user);
    const updatedAt = new Date().toISOString();
    const [profileResult, organiserResult, authResult] = await Promise.all([
      client
        .from('profiles')
        .update({ full_name: fullName, phone, updated_at: updatedAt })
        .eq('id', user.id),
      client
        .from('organisers')
        .update({
          name: organisationName,
          contact_email: contactEmail,
          phone,
          description,
          website_url: socialUrls.websiteUrl,
          instagram_url: socialUrls.instagramUrl,
          x_url: socialUrls.xUrl,
          facebook_url: socialUrls.facebookUrl,
          tiktok_url: socialUrls.tiktokUrl,
        })
        .eq('id', organiserId),
      client.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          full_name: fullName,
          phone,
          organisation_name: organisationName,
        },
      }),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (organiserResult.error) throw organiserResult.error;
    if (authResult.error) throw authResult.error;
    return NextResponse.json({ settings: await settingsForUser(user) });
  } catch (error) {
    console.error('Unable to update organiser settings', error);
    return NextResponse.json(
      { error: 'We could not save your settings.' },
      { status: 500 },
    );
  }
}
