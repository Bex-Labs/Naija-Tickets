import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectEventImageExtension,
  EVENT_IMAGE_MAX_BYTES,
  validEventImageType,
} from './event-image.ts';

void test('detects supported event image signatures', () => {
  assert.equal(
    detectEventImageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    'jpg',
  );
  assert.equal(
    detectEventImageExtension(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    'png',
  );
  assert.equal(
    detectEventImageExtension(
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
    'webp',
  );
});

void test('rejects disguised and unsupported image files', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(validEventImageType(jpeg, 'image/png'), null);
  assert.equal(
    validEventImageType(new Uint8Array([1, 2, 3]), 'image/jpeg'),
    null,
  );
});

void test('limits event images to five megabytes', () => {
  assert.equal(EVENT_IMAGE_MAX_BYTES, 5_242_880);
});
