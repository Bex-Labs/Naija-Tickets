import { NextResponse } from 'next/server';
import { EVENT_IMAGE_MAX_BYTES, validEventImageType } from '@/lib/event-image';
import { ensureOrganiser } from '@/lib/organiser-account';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  let image: FormDataEntryValue | null;
  try {
    image = (await request.formData()).get('image');
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }

  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json(
      { error: 'Choose an image from your computer.' },
      { status: 400 },
    );
  }
  if (image.size > EVENT_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: 'Profile images must be 5 MB or smaller.' },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const extension = validEventImageType(bytes, image.type);
  if (!extension) {
    return NextResponse.json(
      { error: 'Upload a valid JPEG, PNG or WebP image.' },
      { status: 415 },
    );
  }

  try {
    const organiserId = await ensureOrganiser(user);
    const client = getSupabaseAdminClient();
    const path = `${user.id}/profiles/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage
      .from('event-images')
      .upload(path, bytes, {
        cacheControl: '31536000',
        contentType: image.type,
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data } = client.storage.from('event-images').getPublicUrl(path);
    const { error: updateError } = await client
      .from('organisers')
      .update({ logo_path: data.publicUrl })
      .eq('id', organiserId);
    if (updateError) throw updateError;

    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    console.error('Unable to upload organiser profile image', error);
    return NextResponse.json(
      { error: 'We could not upload that image. Please try again.' },
      { status: 500 },
    );
  }
}
