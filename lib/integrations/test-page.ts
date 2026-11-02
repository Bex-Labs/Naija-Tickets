// Public hosted links only. Never include API keys or private session URLs.
export function hostedLinkTestPage(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/checkout\/link\/nt_link_[a-f0-9]{32}$/.test(url.pathname) ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname))
    )
  )
    throw new Error('Use a public Buy Tickets link.');
  const href = url.href
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My ticket button</title>
<style>body{margin:0;background:#fffbf1;color:#241b3f;font:16px/1.6 system-ui}main{max-width:440px;margin:12vh auto;padding:28px}h1{line-height:1.1}a{display:inline-block;padding:12px 24px;border-radius:8px;background:#008f66;color:white;font-weight:700;text-decoration:none}p{color:#526071}</style></head>
<body><main><h1>My event website</h1><p>Choose tickets and pay securely with Naija Tickets.</p><a href="${href}">Buy Tickets</a><p>Your payment result and tickets appear in checkout. Returning here alone does not confirm a purchase.</p></main></body></html>`;
}
