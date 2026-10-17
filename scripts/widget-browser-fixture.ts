// Explicit local-only browser fixture. Never import this into application routes.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWidgetTestFixture } from '../lib/test-support/widget-database.ts';
import {
  widgetPageHandler,
  widgetCheckoutHandler,
} from '../lib/integrations/widget-html.ts';
import { widgetReadHandler } from '../lib/integrations/widget-api.ts';
import { hostedSecretDigest } from '../lib/integrations/checkout-access.ts';
if (
  process.env.NAIJA_WIDGET_BROWSER_FIXTURE !== '1' ||
  process.env.NODE_ENV === 'production'
)
  throw new Error('Run only the explicitly enabled local widget fixture.');
const parentOrigin = 'http://localhost:3015',
  apiOrigin = 'http://127.0.0.1:3016';
const fixture = await createWidgetTestFixture(parentOrigin, apiOrigin, 'test');
await fixture.configure();
const servers: ReturnType<typeof createServer>[] = [];
async function send(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function request(req: IncomingMessage, origin: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error('Fixture request too large.');
    chunks.push(chunk);
  }
  return new Request(origin + req.url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    ...(!['GET', 'HEAD'].includes(req.method || 'GET')
      ? { body: Buffer.concat(chunks) }
      : {}),
  });
}
const api = createServer((req, res) => {
  void (async () => {
    const r = await request(req, apiOrigin),
      url = new URL(r.url);
    if (url.pathname.startsWith('/embed/events/'))
      return send(
        await widgetPageHandler(fixture.deps, fixture.ids.event)(r),
        res,
      );
    if (url.pathname === '/integrations/widget-checkout') {
      console.info(
        JSON.stringify({
          fixtureHandoff: true,
          origin: r.headers.get('origin'),
          destination: r.headers.get('sec-fetch-dest'),
        }),
      );
      return send(await widgetCheckoutHandler(fixture.deps)(r), res);
    }
    if (url.pathname.startsWith('/api/integrations/widgets/'))
      return send(
        await widgetReadHandler(
          fixture.deps,
          fixture.app.widgetId,
          fixture.ids.event,
        )(r),
        res,
      );
    if (url.pathname.startsWith('/integrations/checkout/')) {
      const id = url.pathname.split('/').at(-1)!;
      const access = url.searchParams.get('access');
      if (access) {
        await fixture.db.query('select public.get_hosted_checkout($1,$2)', [
          id,
          await hostedSecretDigest(access),
        ]);
        return send(
          new Response(null, {
            status: 303,
            headers: {
              Location: url.pathname,
              'Set-Cookie': `nt_widget_fixture=${access}; HttpOnly; SameSite=Lax; Path=/integrations/checkout/`,
              'Cache-Control': 'no-store',
              'Referrer-Policy': 'no-referrer',
            },
          }),
          res,
        );
      }
      return send(
        new Response(
          '<!doctype html><html><head><title>Local widget handoff verified</title></head><body><h1>Checkout opened at the top level</h1><p>Local fixture only: the real hosted session was created in a disposable database. This page does not take a payment.</p></body></html>',
          {
            headers: {
              'Content-Type': 'text/html',
              'Cache-Control': 'no-store',
              'X-Frame-Options': 'DENY',
              'Content-Security-Policy': "frame-ancestors 'none'",
            },
          },
        ),
        res,
      );
    }
    if (
      [
        '/integrations/widget-v1.js',
        '/integrations/widget-frame-v1.js',
        '/integrations/widget-v1.css',
        '/favicon.svg',
      ].includes(url.pathname)
    )
      return send(
        new Response(
          await readFile(new URL('../public' + url.pathname, import.meta.url)),
          {
            headers: {
              'Content-Type': url.pathname.endsWith('.js')
                ? 'application/javascript'
                : url.pathname.endsWith('.css')
                  ? 'text/css'
                  : 'image/svg+xml',
            },
          },
        ),
        res,
      );
    return send(new Response('Not found', { status: 404 }), res);
  })().catch(() => {
    res.statusCode = 500;
    res.end('Fixture request failed.');
  });
});
const host = createServer((req, res) => {
  void (async () => {
    const path = new URL(req.url || '/', parentOrigin).pathname;
    if (!['/', '/done', '/example.js', '/example.css'].includes(path)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const filename = path.endsWith('.js')
      ? 'example.js'
      : path.endsWith('.css')
        ? 'example.css'
        : 'index.html';
    let content = await readFile(
      new URL('../examples/widget/' + filename, import.meta.url),
      'utf8',
    );
    if (filename === 'index.html')
      content = content
        .replace(
          'id="widget" placeholder=',
          `id="widget" value="${fixture.app.widgetId}" placeholder=`,
        )
        .replace(
          'id="event" required',
          `id="event" value="${fixture.ids.event}" required`,
        );
    res.setHeader(
      'Content-Type',
      filename.endsWith('.js')
        ? 'application/javascript'
        : filename.endsWith('.css')
          ? 'text/css'
          : 'text/html',
    );
    res.end(content);
  })().catch(() => {
    res.statusCode = 500;
    res.end('Fixture request failed.');
  });
});
const blocked = createServer((_req, res) => {
  const target = new URL('/embed/events/' + fixture.ids.event, apiOrigin);
  for (const [name, value] of Object.entries({
    widget: fixture.app.widgetId,
    environment: 'test',
    parent_origin: parentOrigin,
    return_url: parentOrigin + '/',
    channel: 'b'.repeat(32),
  }))
    target.searchParams.set(name, value);
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html><head><title>Unregistered embedding test</title></head><body><h1>Unregistered embedding website</h1><p>The registered-origin claim in this iframe URL must not bypass frame-ancestors.</p><iframe title="Blocked widget test" src="${target.href.replaceAll('&', '&amp;')}"></iframe></body></html>`,
  );
});
servers.push(api, host, blocked);
await new Promise<void>((resolve) => api.listen(3016, '127.0.0.1', resolve));
await new Promise<void>((resolve) => host.listen(3015, 'localhost', resolve));
await new Promise<void>((resolve) =>
  blocked.listen(3017, '127.0.0.1', resolve),
);
console.info(
  JSON.stringify({
    fixture: true,
    parentOrigin,
    apiOrigin,
    unregisteredOrigin: 'http://127.0.0.1:3017',
    widgetId: fixture.app.widgetId,
    eventId: fixture.ids.event,
  }),
);
async function shutdown() {
  for (const server of servers)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture.db.close();
  process.exit(0);
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
