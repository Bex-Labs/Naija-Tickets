-- Store private organiser payout configuration separately from the public
-- organiser profile and capture the split used for each Paystack payment.

create table if not exists public.organiser_payout_accounts (
  organiser_id uuid primary key references public.organisers(id) on delete cascade,
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_subaccount_code text not null unique
    check (provider_subaccount_code ~ '^ACCT_[A-Za-z0-9]+$'),
  settlement_bank_code text not null check (settlement_bank_code ~ '^[0-9]{2,10}$'),
  settlement_bank_name text not null check (char_length(trim(settlement_bank_name)) between 2 and 120),
  settlement_account_name text not null check (char_length(trim(settlement_account_name)) between 2 and 160),
  settlement_account_last4 text not null check (settlement_account_last4 ~ '^[0-9]{4}$'),
  direct_settlement_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organiser_payout_accounts enable row level security;
revoke all on table public.organiser_payout_accounts from anon, authenticated;

alter table public.payments
  add column if not exists provider_subaccount_code text,
  add column if not exists platform_transaction_charge_kobo bigint
    check (platform_transaction_charge_kobo >= 0);

comment on table public.organiser_payout_accounts is
  'Private, service-role-only Paystack payout configuration. Full bank account numbers are never stored.';
comment on column public.payments.platform_transaction_charge_kobo is
  'The exact platform share supplied to Paystack transaction_charge for this payment.';
