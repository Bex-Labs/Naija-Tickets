import type { Font } from 'opentype.js';

type FontParser = (buffer: ArrayBuffer) => Font;

export function ticketFontParser(module: unknown): FontParser {
  const imported = module as
    | { parse?: unknown; default?: { parse?: unknown } }
    | null
    | undefined;
  // Node loads the CommonJS default; Vite uses the named ESM export.
  const parse = imported?.parse ?? imported?.default?.parse;
  if (typeof parse !== 'function')
    throw new Error('The ticket font parser is unavailable.');
  return parse as FontParser;
}
