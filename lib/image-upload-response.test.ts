import assert from 'node:assert/strict';
import test from 'node:test';
import nextConfig from '../next.config.ts';
import { EVENT_IMAGE_MAX_BYTES } from './event-image.ts';
import { readImageUploadResponse } from './image-upload-response.ts';
import { parseBodySizeLimit } from 'vinext/internal/config/next-config';

void test('plain-text 413 is shown as an upload error instead of a JSON syntax error', async () => {
  await assert.rejects(
    readImageUploadResponse(new Response('Payload Too Large', { status: 413 })),
    /image is too large/,
  );
});
void test('keeps useful JSON upload errors and handles HTML failures', async () => {
  await assert.rejects(
    readImageUploadResponse(
      Response.json(
        { error: 'Profile images must be 5 MB or smaller.' },
        { status: 413 },
      ),
    ),
    /5 MB or smaller/,
  );
  await assert.rejects(
    readImageUploadResponse(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    ),
    /could not be uploaded/,
  );
  await assert.rejects(
    readImageUploadResponse(new Response('', { status: 401 })),
    /Log in again/,
  );
});
void test('requires a URL before treating an upload as successful', async () => {
  const url = 'https://example.com/image.png';
  assert.equal(await readImageUploadResponse(Response.json({ url })), url);
  for (const body of [null, {}, { url: 3 }, { url: '' }]) {
    await assert.rejects(
      readImageUploadResponse(Response.json(body)),
      /invalid response/,
    );
  }
  await assert.rejects(
    readImageUploadResponse(new Response('not JSON')),
    /invalid response/,
  );
});
void test('configured multipart limit accommodates a full 5 MB image and form overhead', async () => {
  const form = new FormData();
  form.set(
    'image',
    new File([new Uint8Array(EVENT_IMAGE_MAX_BYTES)], 'profile.png', {
      type: 'image/png',
    }),
  );
  const request = new Request(
    'https://example.com/api/organiser/profile-image',
    { method: 'POST', body: form },
  );
  const bytes = (await request.arrayBuffer()).byteLength;
  const limit = parseBodySizeLimit(
    nextConfig.experimental?.serverActions?.bodySizeLimit,
  );
  assert.ok(bytes > EVENT_IMAGE_MAX_BYTES);
  assert.ok(bytes < limit);
});
