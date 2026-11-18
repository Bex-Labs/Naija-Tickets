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
  if (
    /^\/integrations\/checkout\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      requestedPath,
    )
  )
    return requestedPath;
  return accountHome;
}
