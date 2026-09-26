export const GROUP_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type GroupMember = {
  id: string;
  name: string | null;
  state: 'UNCLAIMED' | 'CLAIMED' | 'CHECKED_IN';
  status: string;
};

export type GroupBooking = {
  id: string;
  orderItemId: string;
  ticketName: string;
  buyerName: string;
  admissions: number;
  registered: number;
  remaining: number;
  checkedIn: number;
  invitePath: string;
  members: GroupMember[];
};

export function groupCounts(members: GroupMember[]) {
  return {
    registered: members.filter((member) => member.state !== 'UNCLAIMED').length,
    remaining: members.filter((member) => member.state === 'UNCLAIMED').length,
    checkedIn: members.filter((member) => member.state === 'CHECKED_IN').length,
  };
}

export function parseGroupClaim(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.name !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.phone !== 'string'
  )
    return null;
  const name = row.name.trim();
  const email = row.email.trim().toLowerCase();
  const phone = row.phone.trim();
  const digits = phone.replace(/\D/g, '');
  if (
    name.length < 2 ||
    name.length > 120 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    phone.length > 40 ||
    digits.length < 7 ||
    digits.length > 15
  )
    return null;
  return { name, email, phone };
}
