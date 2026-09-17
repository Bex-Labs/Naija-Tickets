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
      { error: 'Event images must be 5 MB or smaller.' },
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
    await ensureOrganiser(user);
    const client = getSupabaseAdminClient();
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage
      .from('event-images')
      .upload(path, bytes, {
        cacheControl: '31536000',
        contentType: image.type,
        upsert: false,
      });
    if (error) throw error;

    const { data } = client.storage.from('event-images').getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    console.error('Unable to upload organiser event image', error);
    return NextResponse.json(
      { error: 'We could not upload that image. Please try again.' },
      { status: 500 },
    );
  }
}
