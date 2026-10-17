import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleHostedExample } from './handler.mjs';
const port = Number(process.env.PORT || 3010);
const server = createServer(async (req, res) => {
  try {
    const origin = new URL(process.env.NT_PARTNER_ORIGIN);
    const body = req.method === 'POST' ? Readable.toWeb(req) : undefined;
    const request = new Request(new URL(req.url, origin), {
      method: req.method,
      headers: req.headers,
      ...(body ? { body, duplex: 'half' } : {}),
    });
    const response = await handleHostedExample(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Example unavailable.');
  }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () =>
  console.info('Hosted checkout example listening on port ' + port),
);
