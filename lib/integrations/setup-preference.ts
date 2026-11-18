import type { IntegrationApplication } from './types.ts';
export type IntegrationSetupPath = 'link' | 'api';
export const integrationSelectionKey = (viewer: string) =>
  `naija-tickets:integration-selection:${viewer}`;

export function restoredIntegrationSelection(
  apps: IntegrationApplication[],
  remembered: string | null,
) {
  if (remembered !== null) return apps.find((app) => app.id === remembered);
  return [...apps].sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
  )[0];
}
export function integrationSetupPath(
  app?: IntegrationApplication,
): IntegrationSetupPath {
  return app?.setupPath === 'api' ? 'api' : 'link';
}
