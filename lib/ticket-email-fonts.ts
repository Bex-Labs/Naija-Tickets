import type { Font, PathCommand } from 'opentype.js';
import fontData from '../assets/ticket-fonts/noto-sans.json' with { type: 'json' };

let fonts: Promise<{ regular: Font; bold: Font }> | undefined;

function loadFonts() {
  return (fonts ??= import('opentype.js').then(({ default: opentype }) => ({
    regular: opentype.parse(
      Uint8Array.from(Buffer.from(fontData.regular, 'base64')).buffer,
    ),
    bold: opentype.parse(
      Uint8Array.from(Buffer.from(fontData.bold, 'base64')).buffer,
    ),
  })));
}

function attribute(attributes: string, name: string, fallback: string) {
  return (
    new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1] ?? fallback
  );
}

function decodedText(text: string) {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return text.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_, entity: string) => entities[entity],
  );
}

function pathData(commands: PathCommand[]) {
  // Round numerically so tiny floating-point residues cannot become NaN in SVG.
  const point = (x: number, y: number) =>
    `${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`;
  return commands
    .map((command) => {
      switch (command.type) {
        case 'Z':
          return 'Z';
        case 'M':
        case 'L':
          return `${command.type}${point(command.x, command.y)}`;
        case 'Q':
          return `Q${point(command.x1, command.y1)} ${point(command.x, command.y)}`;
        case 'C':
          return `C${point(command.x1, command.y1)} ${point(command.x2, command.y2)} ${point(command.x, command.y)}`;
      }
    })
    .join('');
}

// This converts only the controlled <text>/<tspan> markup emitted by our ticket
// renderer. The resulting PNG needs no system fontconfig or Core Text support.
export async function outlineTicketEmailText(svg: string) {
  const { regular, bold } = await loadFonts();
  return svg.replace(
    /<text\b([^>]*)>([\s\S]*?)<\/text>/g,
    (_, attributes: string, body: string) => {
      const size = Number(attribute(attributes, 'font-size', '16'));
      const weight = Number(attribute(attributes, 'font-weight', '400'));
      const font = weight >= 700 ? bold : regular;
      const x = Number(attribute(attributes, 'x', '0'));
      let y = Number(attribute(attributes, 'y', '0'));
      const spacing = Number(attribute(attributes, 'letter-spacing', '0'));
      const anchor = attribute(attributes, 'text-anchor', 'start');
      const fill = attribute(attributes, 'fill', '#241b3f');

      function linePath(text: string, lineX: number) {
        const glyphs = Array.from(
          decodedText(text).normalize('NFC'),
          (character) => font.charToGlyph(character),
        );
        const scale = size / font.unitsPerEm;
        const advances = glyphs.map(
          (glyph, index) =>
            (glyph.advanceWidth || 0) * scale +
            (index < glyphs.length - 1
              ? font.getKerningValue(glyph, glyphs[index + 1]) * scale + spacing
              : 0),
        );
        const width = advances.reduce((total, advance) => total + advance, 0);
        const offset =
          anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;
        let cursor = lineX - offset;
        const paths = glyphs
          .map((glyph, index) => {
            const path = pathData(
              glyph.getPath(cursor, y, size, {}, font).commands,
            );
            cursor += advances[index];
            return path;
          })
          .join('');
        return `<path d="${paths}"/>`;
      }

      const spans = [...body.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
      const paths = spans.length
        ? spans
            .map((span) => {
              y += Number(attribute(span[1], 'dy', '0'));
              return linePath(
                span[2],
                Number(attribute(span[1], 'x', String(x))),
              );
            })
            .join('')
        : linePath(body, x);
      return `<g fill="${fill}">${paths}</g>`;
    },
  );
}
