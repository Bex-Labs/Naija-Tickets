import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  hashVisitorId,
  readVisitorId,
  visitorTrackingEnabled,
} from '@/lib/site-visitors';

export async function POST(request: Request) {
  const respond = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    return respond({ error: 'Invalid request.' }, 403);
  }
  const visitorId = await readVisitorId(request);
  if (!visitorId) {
    return respond({ error: 'Invalid visitor identifier.' }, 400);
  }
  if (!visitorTrackingEnabled(process.env.NODE_ENV, process.env.VERCEL_ENV)) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    const { error } = await getSupabaseAdminClient().rpc(
      'record_site_visitor',
      {
        p_visitor_hash: await hashVisitorId(visitorId),
      },
    );
    if (error) throw error;
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'unavailable';
    console.warn('Visitor recording unavailable', { code });
    return respond({ error: 'Visitor recording is unavailable.' }, 503);
  }
}
