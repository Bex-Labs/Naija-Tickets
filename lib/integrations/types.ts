export type IntegrationEnvironment = 'test' | 'live';
export const INTEGRATION_SCOPES = [
  'integration:read',
  'events:read',
  'tickets:read',
  'availability:read',
  'checkout:write',
  'external_events:write',
  'orders:read',
  'tickets:status',
  'attendees:read',
  'attendees:contact',
  'sales:read',
  'groups:read',
  'refunds:read',
  'entry:verify',
  'entry:check-in',
] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];
export type IntegrationDomain = {
  environment: IntegrationEnvironment;
  origin: string;
};
export type IntegrationKeyMetadata = {
  id: string;
  environment: IntegrationEnvironment;
  scopes: IntegrationScope[];
  display: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export type IntegrationApplication = {
  id: string;
  organiserId: string;
  name: string;
  status: 'active' | 'disabled';
  widgetId: string;
  createdAt: string;
  domains: IntegrationDomain[];
  eventIds: string[];
  keys: IntegrationKeyMetadata[];
};
export type IntegrationDashboard = {
  organisers: { id: string; name: string }[];
  integrations: IntegrationApplication[];
  events: { id: string; organiserId: string; title: string; status: string }[];
};
export type IntegrationContext = {
  keyId: string;
  integrationId: string;
  organiserId: string;
  environment: IntegrationEnvironment;
  scopes: IntegrationScope[];
  name: string;
  expiresAt: string;
};
