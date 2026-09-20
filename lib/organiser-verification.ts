export type VerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected';

export function validIdentityReference(
  accountType: 'individual' | 'organisation',
  value: string,
) {
  return accountType === 'individual'
    ? /^[0-9]{11}$/.test(value)
    : /^[A-Za-z0-9][A-Za-z0-9 /-]{2,39}$/.test(value);
}

export function organiserFacingReference(
  accountType: 'individual' | 'organisation',
  value: string,
) {
  return accountType === 'individual'
    ? { registrationReference: '', referenceLast4: value.slice(-4) }
    : { registrationReference: value, referenceLast4: '' };
}

export type OrganiserVerificationState = {
  organiserName: string;
  accountType: 'individual' | 'organisation';
  verified: boolean;
  status: VerificationStatus;
  legalName: string;
  registrationReference: string;
  referenceLast4: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  decisionUnread: boolean;
};

export type VerificationRequest = {
  organiserId: string;
  name: string;
  accountType: 'individual' | 'organisation';
  contactEmail: string;
  phone: string;
  verifiedAt: string | null;
  legalName: string;
  registrationReference: string;
  status: VerificationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string;
};
