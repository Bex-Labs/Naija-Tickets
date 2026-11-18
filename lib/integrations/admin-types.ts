export type AdminIntegrationRow = {
  id: string;
  name: string;
  organiserId: string;
  organiserName: string;
  status: 'active' | 'disabled';
  removedAt?: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  createdAt: string;
  activeKeys: number;
  assignedEvents: number;
  requests24h: number;
  errors24h: number;
  pendingDeliveries: number;
  exhaustedDeliveries: number;
};
export type AdminIntegrationOverview = {
  applications: AdminIntegrationRow[];
  totals: {
    applications: number;
    suspended: number;
    requests24h: number;
    errors24h: number;
    exhaustedDeliveries: number;
  };
  resourceMode: 'test' | 'live';
  asOf: string;
  nextCursor: string | null;
};
export type AdminIntegrationActivity = {
  hosted?: import('./hosted-report.ts').HostedReport | null;
  requests: {
    id: string;
    keyId: string;
    route: string;
    status: number;
    errorCode: string | null;
    durationMs: number;
    createdAt: string;
  }[];
  audit: {
    id: string;
    action: string;
    createdAt: string;
    actorId: string | null;
    adminActorId: string | null;
    environment: string | null;
    keyId: string | null;
    endpointId: string | null;
    outcome: string | null;
  }[];
  nextCursor: string | null;
};
