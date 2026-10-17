export type HostedReport = {
  periodDays: number;
  asOf: string;
  channels: {
    source: string;
    purchases: number;
    admissions: number;
    ticketRevenueKobo: number;
    feesKobo: number;
    refundedKobo: number;
  }[];
  funnel: {
    source: string;
    created: number;
    completed: number;
    expired: number;
    cancelled: number;
    conversionPercent: number;
  }[];
  sessions: {
    id: string;
    eventId: string;
    createdAt: string;
    status: string;
    orderId: string | null;
    admissions: number;
    totalKobo: number | null;
    source: string;
  }[];
};
export function projectHostedReport(value: unknown): HostedReport | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as HostedReport;
  if (
    row.periodDays !== 30 ||
    typeof row.asOf !== 'string' ||
    !Array.isArray(row.channels) ||
    row.channels.length > 4 ||
    !Array.isArray(row.funnel) ||
    row.funnel.length > 3 ||
    !Array.isArray(row.sessions) ||
    row.sessions.length > 50
  )
    throw new Error('Invalid hosted report');
  const count = (n: unknown) => {
    const value = Number(n);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid sales value');
    return value;
  };
  const source = (s: string) => {
    if (!['direct', 'hosted_api', 'hosted_link', 'legacy_widget'].includes(s))
      throw new Error('Invalid sales channel');
    return s;
  };
  return {
    periodDays: 30,
    asOf: row.asOf,
    channels: row.channels.map((c) => ({
      source: source(c.source),
      purchases: count(c.purchases),
      admissions: count(c.admissions),
      ticketRevenueKobo: count(c.ticketRevenueKobo),
      feesKobo: count(c.feesKobo),
      refundedKobo: count(c.refundedKobo),
    })),
    funnel: row.funnel.map((f) => ({
      source: source(f.source),
      created: count(f.created),
      completed: count(f.completed),
      expired: count(f.expired),
      cancelled: count(f.cancelled),
      conversionPercent: Number(f.conversionPercent) || 0,
    })),
    sessions: row.sessions.map((s) => ({
      id: s.id,
      eventId: s.eventId,
      createdAt: s.createdAt,
      status: s.status,
      orderId: s.orderId,
      admissions: count(s.admissions),
      totalKobo: s.totalKobo === null ? null : count(s.totalKobo),
      source: source(s.source),
    })),
  };
}
