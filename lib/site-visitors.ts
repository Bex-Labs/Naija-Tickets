export type AdminVisitorAnalytics = {
  totalVisitors: number;
  visitorsToday: number;
  visitorsLast30Days: number;
  trackingStartedAt: string | null;
};

export const VISITOR_STORAGE_KEY = 'naija-tickets-visitor';
export const VISITOR_DAY_STORAGE_KEY = 'naija-tickets-visitor-day';

export function visitorTrackingEnabled(
  environment: string | undefined,
  deploymentEnvironment?: string,
) {
  return (
    environment === 'production' &&
    !['preview', 'development'].includes(deploymentEnvironment || '')
  );
}

export function isValidVisitorId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  );
}

export function shouldCountVisitor(pathname: string) {
  return (
    pathname.startsWith('/') &&
    !['/admin', '/organiser', '/entry', '/api'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  );
}

export function visitorDay(date = new Date()) {
  // WAT is UTC+1 throughout the year. This matches the database's Lagos day.
  return new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function hashVisitorId(visitorId: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `naija-tickets-visitor:${visitorId.toLowerCase()}`,
    ),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function readVisitorId(request: Request): Promise<string | null> {
  if (
    !request.headers.get('content-type')?.startsWith('application/json') ||
    Number(request.headers.get('content-length') || 0) > 256 ||
    !request.body
  )
    return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    const visitorId =
      body && typeof body === 'object' && 'visitorId' in body
        ? body.visitorId
        : null;
    return isValidVisitorId(visitorId) ? visitorId : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
