import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);

void test('print stylesheet preserves ticket colors in a compact A4 layout', () => {
  assert.match(css, /@media print/);
  assert.match(css, /size:\s*A4 portrait/);
  assert.match(css, /print-color-adjust:\s*exact/);
  assert.match(
    css,
    /\.ticket-artwork\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/,
  );
  assert.doesNotMatch(
    css.slice(css.indexOf('@media print')),
    /issued-ticket__title|issued-ticket__details/,
  );
});

void test('print stylesheet hides screen chrome and starts a new page after every second ticket', () => {
  assert.match(css, /\.no-print/);
  assert.match(css, /\.payment-status-page > header/);
  assert.match(
    css,
    /\.issued-ticket-record:nth-of-type\(2n\):not\(:last-child\)/,
  );
  assert.match(css, /page-break-after:\s*always/);
  assert.match(css, /page-break-inside:\s*avoid/);
});

void test('printing one ticket excludes other admissions and all action buttons', () => {
  assert.match(
    css,
    /body\[data-print-ticket\] \.issued-ticket-record:not\(\[data-print-selected\]\)/,
  );
  assert.match(css, /\.no-print[\s\S]*?display: none !important/);
});
