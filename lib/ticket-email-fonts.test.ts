import assert from 'node:assert/strict';
import test from 'node:test';
import data from '../assets/ticket-fonts/noto-sans.json' with { type: 'json' };
import { outlineTicketEmailText } from './ticket-email-fonts.ts';

void test('bundled fonts include Nigerian currency, accented names and ticket codes', async () => {
  const { default: opentype } = await import('opentype.js');
  for (const encoded of [data.regular, data.bold]) {
    const font = opentype.parse(
      Uint8Array.from(Buffer.from(encoded, 'base64')).buffer,
    );
    for (const character of '₦ỌọÀáé0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ&–') {
      assert.notEqual(
        font.charToGlyphIndex(character),
        0,
        `Missing glyph: ${character}`,
      );
    }
  }
});

void test('ticket text becomes paths with line breaks, colour and alignment preserved', async () => {
  const svg =
    '<svg><text x="100" y="40" font-size="16" font-weight="700" text-anchor="middle" fill="#ffffff"><tspan x="100" dy="0">Ada &amp; Ọmọ</tspan><tspan x="100" dy="22">₦8,500</tspan></text></svg>';
  const outlined = await outlineTicketEmailText(svg);
  assert.equal(outlined.includes('<text'), false);
  assert.equal(outlined.includes('<tspan'), false);
  assert.equal((outlined.match(/<path d="M/g) || []).length, 2);
  assert.match(outlined, /<g fill="#ffffff">/);
  assert.equal(outlined.includes('NaN'), false);
  assert.notEqual(
    await outlineTicketEmailText(svg.replace('Ọmọ', 'Different')),
    outlined,
  );
});

void test('long text never loses glyphs to floating-point SVG coordinates', async () => {
  const svg =
    '<svg><text x="26" y="170" font-size="16" font-weight="700">Saturday, 10 October 2026</text></svg>';
  const outlined = await outlineTicketEmailText(svg);
  assert.equal(outlined.includes('NaN'), false);
  assert.equal(outlined.includes('Infinity'), false);
  assert.equal((outlined.match(/M/g) || []).length > 20, true);
});
