import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { handleHostedExample } from './handler.mjs';

// A static Live Server does not load .env or execute backend code. This small
// server does both; all API requests and secrets remain on this server.
const files = {};
for (const name of ['.env', '.env.local']) {
  try {
    Object.assign(
      files,
      parseEnv(await readFile(new URL(name, import.meta.url), 'utf8')),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const env = { ...files, ...process.env };
env.NT_API_KEY ||= env.NAIJA_TEST_API_KEY || env.NAIJA_API_KEY || '';
env.NT_MODE ||= env.NT_API_KEY.startsWith('nt_live_') ? 'live' : 'test';
env.NT_API_ORIGIN ||=
  env.NAIJA_API_ORIGIN ||
  (env.NT_MODE === 'test' ? 'http://localhost:3000' : '');
env.NT_PARTNER_ORIGIN ||=
  env.PARTNER_ORIGIN || (env.NT_MODE === 'test' ? 'http://localhost:3010' : '');
const origin = new URL(env.NT_PARTNER_ORIGIN);
if (
  !env.NT_EXAMPLE_COOKIE_SECRET &&
  env.NT_MODE === 'test' &&
  ['localhost', '127.0.0.1'].includes(origin.hostname)
) {
  env.NT_EXAMPLE_COOKIE_SECRET = randomBytes(32).toString('base64url');
}
const port = Number(
  env.PORT || origin.port || (origin.protocol === 'https:' ? 443 : 80),
);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  (origin.port && Number(origin.port) !== port)
)
  throw new Error('PORT must match the port in NT_PARTNER_ORIGIN.');
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== origin.host) {
      res.writeHead(400);
      return res.end(
        'Open ' +
          origin.origin +
          ' using the exact hostname configured in NT_PARTNER_ORIGIN.',
      );
    }
    const body = req.method === 'POST' ? Readable.toWeb(req) : undefined;
    const request = new Request(new URL(req.url, origin), {
      method: req.method,
      headers: req.headers,
      ...(body ? { body, duplex: 'half' } : {}),
    });
    const response = await handleHostedExample(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503);
    res.end(
      'API checkout unavailable. Check .env.local and restart this server.',
    );
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(
  port,
  ['localhost', '127.0.0.1'].includes(origin.hostname)
    ? origin.hostname
    : '0.0.0.0',
  () =>
    console.info(
      'Developer API checkout: ' + origin.origin + (env.NT_EXAMPLE_PATH || '/'),
    ),
);
