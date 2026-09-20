export type PayoutRecord = {
  id: string;
  organiserName: string;
  reference: string;
  status: 'pending' | 'approved' | 'processing' | 'paid' | 'failed';
  amountKobo: number;
  grossKobo: number;
  feesKobo: number;
  refundsKobo: number;
  periodStart: string;
  periodEnd: string;
  scheduledAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type OrganiserPayoutTracking = {
  grossSalesKobo: number;
  discountsKobo: number;
  refundsKobo: number;
  payoutFeesKobo: number;
  eligibleKobo: number;
  paidKobo: number;
  scheduledKobo: number;
  approvedKobo: number;
  pendingKobo: number;
  unallocatedKobo: number;
  payouts: PayoutRecord[];
};
