export const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'group.admissions_reserved',
  'ticket.issued',
  'ticket.checked_in',
  'refund.completed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
export type WebhookEndpoint = {
  id: string;
  environment: 'test' | 'live';
  url: string;
  enabled: boolean;
  events: WebhookEventType[];
  revision: number;
  createdAt: string;
  retiredAt: string | null;
};
export type WebhookDelivery = {
  id: string;
  endpointId: string;
  eventId: string;
  type: WebhookEventType;
  status: 'pending' | 'delivering' | 'succeeded' | 'exhausted';
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  history: {
    attempt: number;
    startedAt: string;
    completedAt: string | null;
    httpStatus: number | null;
    outcome: string | null;
  }[];
};
export type WebhookDashboard = {
  endpoints: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
  nextCursor: string | null;
};
