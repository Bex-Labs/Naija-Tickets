import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { renderTicketEmailArtwork } from './ticket-email-artwork.ts';

const fixture = {
  eventTitle: 'Eko Sounds Live',
  category: 'Live music',
  presenter: 'Palmwine Nights Collective presents',
  date: 'Saturday, 19 September 2026',
  time: '6:00 PM WAT',
  venue: 'The Good Beach, Lagos',
  address: '10B Trinity Avenue, Oniru, Lagos',
  ticketType: 'Regular admission',
  attendeeName: 'Ada Ọmọ Okafor',
  price: '₦8,500',
  priceLabel: 'Unit price',
  displayCode: 'NT-260919-08427',
  orderReference: 'ORDER-TEST-2026',
  position: 'Ticket 1 of 1',
};

void test('loading ticket delivery artwork does not require the native renderer', () => {
  const moduleUrl = new URL('./ticket-email-artwork.ts', import.meta.url).href;
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === 'sharp') throw new Error('Native renderer unavailable');
        return nextResolve(specifier, context);
      },
    });
    const { renderTicketEmailArtwork } = await import(${JSON.stringify(moduleUrl)});
    assert.deepEqual(await renderTicketEmailArtwork([]), []);
    await assert.rejects(
      renderTicketEmailArtwork([{ displayCode: 'NT-TEST' }]),
      /Native renderer unavailable/,
    );
  `,
  ]);
});

void test('renders the issued ticket as an email-ready PNG attachment', async () => {
  const [ticket] = await renderTicketEmailArtwork([fixture]);
  const image = Buffer.from(ticket.content, 'base64');

  assert.equal(ticket.filename, 'NT-260919-08427.png');
  assert.equal(ticket.contentType, 'image/png');
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.ok(image.length > 10_000);
});

void test('ticket text and QR still render when no system fonts are installed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'naija-email-fonts-'));
  try {
    const fontDirectory = join(directory, 'empty-fonts');
    mkdirSync(fontDirectory);
    const fontConfig = join(directory, 'fonts.conf');
    writeFileSync(
      fontConfig,
      `<fontconfig><dir>${fontDirectory}</dir></fontconfig>`,
    );
    const moduleUrl = new URL('./ticket-email-artwork.ts', import.meta.url)
      .href;
    const image = Buffer.from(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      const { renderTicketEmailArtwork } = await import(${JSON.stringify(moduleUrl)});
      const [ticket] = await renderTicketEmailArtwork([JSON.parse(process.argv[1])]);
      process.stdout.write(ticket.content);
    `,
          JSON.stringify(fixture),
        ],
        {
          env: {
            ...process.env,
            FONTCONFIG_FILE: fontConfig,
            PANGOCAIRO_BACKEND: 'fontconfig',
          },
          encoding: 'utf8',
          maxBuffer: 5 * 1024 * 1024,
        },
      ),
      'base64',
    );
    const readImage = sharp as unknown as (image: Buffer) => {
      ensureAlpha(): {
        raw(): {
          toBuffer(options: { resolveWithObject: true }): Promise<{
            data: Buffer;
            info: { width: number; height: number };
          }>;
        };
      };
    };
    const { data, info } = await readImage(image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8ClampedArray(data);
    const qr = jsQR(pixels, info.width, info.height);
    assert.equal(qr?.data, fixture.displayCode);

    // The event title occupies this region; glyph ink must remain visible even
    // in a deployment with an empty font directory.
    let titleInk = 0;
    for (let y = 125; y < 185; y += 1) {
      for (let x = 52; x < 1000; x += 1) {
        const offset = (y * info.width + x) * 4;
        if (
          pixels[offset] < 70 &&
          pixels[offset + 1] < 70 &&
          pixels[offset + 2] < 100
        )
          titleInk += 1;
      }
    }
    assert.ok(
      titleInk > 8_000,
      `Event title is missing (${titleInk} dark pixels)`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
