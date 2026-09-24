export function accountHomeFromMetadata(metadata: Record<string, unknown>) {
  return metadata.account_purpose === 'customer' ? '/account' : '/organiser';
}

export function authenticatedDestination(
  requestedPath: string | null,
  accountHome = '/account',
) {
  if (!requestedPath) return accountHome;
  if (
    requestedPath === '/account' ||
    requestedPath === '/organiser' ||
    requestedPath === '/entry'
  ) {
    return requestedPath;
  }
  if (requestedPath.startsWith('/checkout/')) return requestedPath;
  return accountHome;
}
