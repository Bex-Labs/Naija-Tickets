type Account = {
  is_anonymous?: boolean;
  deleted_at?: string;
  user_metadata?: Record<string, unknown>;
};

// Older customers may still have an organiser membership from before the
// separate signup flows. Their explicit signup choice takes precedence.
export function isCustomerAccount(
  user: Account,
  hasOrganiserMembership: boolean,
) {
  if (user.is_anonymous || user.deleted_at) return false;
  const purpose = user.user_metadata?.account_purpose;
  if (purpose === 'customer') return true;
  if (purpose === 'organiser') return false;
  return !hasOrganiserMembership;
}
