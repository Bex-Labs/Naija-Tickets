// Use Web APIs so both Vinext and Vercel's routing runtime can execute this
// capability-to-cookie handoff without framework-specific request helpers.
export default function middleware(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  const match =
    /^\/integrations\/checkout\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(
      url.pathname,
    );
  const access = url.searchParams.get('access');
  if (
    request.method === 'GET' &&
    match &&
    access &&
    /^[a-f0-9]{64}$/.test(access)
  ) {
    url.search = '';
    headers.set('Location', url.href);
    headers.set(
      'Set-Cookie',
      `nt_hosted_${match[1].toLowerCase()}=${access}; HttpOnly; SameSite=Lax; Path=/integrations/checkout/${match[1]}; Max-Age=1800${url.protocol === 'https:' || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    return new Response(null, { status: 303, headers });
  }
  headers.set('x-middleware-next', '1');
  return new Response(null, { headers });
}
export const config = {
  matcher: ['/integrations/checkout/:path*', '/checkout/link/:path*'],
};
