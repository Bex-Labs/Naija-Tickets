import { NextResponse } from 'next/server';
import { ensureOrganiser } from '@/lib/organiser-account';
import {
  createOrUpdatePaystackSubaccount,
  deactivatePaystackSubaccount,
  listNigerianPaystackBanks,
  resolveNigerianBankAccount,
} from '@/lib/paystack';
import {
  getAuthenticatedUser,
  getSupabaseAdminClient,
} from '@/lib/supabase/server';

const BANK_CODE_PATTERN = /^[0-9]{2,10}$/;
const ACCOUNT_NUMBER_PATTERN = /^[0-9]{10}$/;

type PayoutRow = {
  provider_subaccount_code: string;
  settlement_bank_code: string;
  settlement_bank_name: string;
  settlement_account_name: string;
  settlement_account_last4: string;
  direct_settlement_enabled: boolean;
  updated_at: string;
};

function publicPayout(row: PayoutRow | null) {
  if (!row) return null;
  return {
    bankCode: row.settlement_bank_code,
    bankName: row.settlement_bank_name,
    accountName: row.settlement_account_name,
    accountLast4: row.settlement_account_last4,
    enabled: row.direct_settlement_enabled,
    updatedAt: row.updated_at,
  };
}

async function payoutForOrganiser(organiserId: string) {
  const { data, error } = await getSupabaseAdminClient()
    .from('organiser_payout_accounts')
    .select(
      'provider_subaccount_code,settlement_bank_code,settlement_bank_name,settlement_account_name,settlement_account_last4,direct_settlement_enabled,updated_at',
    )
    .eq('organiser_id', organiserId)
    .maybeSingle();
  if (error) throw error;
  return data as PayoutRow | null;
}

async function authorisedOrganiser(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return null;
  return { user, organiserId: await ensureOrganiser(user) };
}

function accountInput(body: Record<string, unknown>) {
  const bankCode =
    typeof body.bankCode === 'string' ? body.bankCode.trim() : '';
  const accountNumber =
    typeof body.accountNumber === 'string'
      ? body.accountNumber.replace(/\s/g, '')
      : '';
  if (
    !BANK_CODE_PATTERN.test(bankCode) ||
    !ACCOUNT_NUMBER_PATTERN.test(accountNumber)
  ) {
    throw new Error('Choose a bank and enter a valid 10-digit account number.');
  }
  return { bankCode, accountNumber };
}

async function requestBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid request.');
  }
}

export async function GET(request: Request) {
  const auth = await authorisedOrganiser(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  try {
    const [banks, payout] = await Promise.all([
      listNigerianPaystackBanks(),
      payoutForOrganiser(auth.organiserId),
    ]);
    return NextResponse.json({
      banks: banks.map(({ name, code }) => ({ name, code })),
      payout: publicPayout(payout),
    });
  } catch (error) {
    console.error('Unable to load payout settings', error);
    return NextResponse.json(
      { error: 'Payout settings could not be loaded.' },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorisedOrganiser(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  try {
    const input = accountInput(await requestBody(request));
    const [resolved, banks] = await Promise.all([
      resolveNigerianBankAccount(input),
      listNigerianPaystackBanks(),
    ]);
    const bank = banks.find((item) => item.code === input.bankCode);
    if (!bank) throw new Error('The selected Nigerian bank is unavailable.');
    return NextResponse.json({
      verification: {
        accountName: resolved.data.account_name,
        accountLast4: input.accountNumber.slice(-4),
        bankCode: bank.code,
        bankName: bank.name,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The account could not be verified.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const auth = await authorisedOrganiser(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  try {
    const body = await requestBody(request);
    const input = accountInput(body);
    const confirmedAccountName =
      typeof body.confirmedAccountName === 'string'
        ? body.confirmedAccountName.trim()
        : '';
    const [resolved, banks, current, organiserResult] = await Promise.all([
      resolveNigerianBankAccount(input),
      listNigerianPaystackBanks(),
      payoutForOrganiser(auth.organiserId),
      getSupabaseAdminClient()
        .from('organisers')
        .select('name,contact_email,phone')
        .eq('id', auth.organiserId)
        .single(),
    ]);
    const accountName = resolved.data.account_name.trim();
    if (
      !confirmedAccountName ||
      accountName.localeCompare(confirmedAccountName, undefined, {
        sensitivity: 'base',
      }) !== 0
    ) {
      throw new Error('Verify the bank account again before connecting it.');
    }
    const bank = banks.find((item) => item.code === input.bankCode);
    if (!bank) throw new Error('The selected Nigerian bank is unavailable.');
    if (organiserResult.error) throw organiserResult.error;

    const subaccount = await createOrUpdatePaystackSubaccount({
      currentSubaccountCode: current?.provider_subaccount_code,
      businessName: organiserResult.data.name,
      bankCode: bank.code,
      accountNumber: input.accountNumber,
      contactEmail: organiserResult.data.contact_email,
      contactPhone: organiserResult.data.phone,
    });
    const { error: saveError } = await getSupabaseAdminClient()
      .from('organiser_payout_accounts')
      .upsert({
        organiser_id: auth.organiserId,
        provider: 'paystack',
        provider_subaccount_code: subaccount.data.subaccount_code,
        settlement_bank_code: bank.code,
        settlement_bank_name: bank.name,
        settlement_account_name: accountName,
        settlement_account_last4: input.accountNumber.slice(-4),
        direct_settlement_enabled: true,
        updated_at: new Date().toISOString(),
      });
    if (saveError) throw saveError;
    return NextResponse.json({
      payout: publicPayout(await payoutForOrganiser(auth.organiserId)),
    });
  } catch (error) {
    console.error('Unable to connect payout account', error);
    const message =
      error instanceof Error
        ? error.message
        : 'The payout account could not be connected.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authorisedOrganiser(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const admin = getSupabaseAdminClient();
  try {
    const current = await payoutForOrganiser(auth.organiserId);
    if (!current) return NextResponse.json({ disconnected: true });

    const { error: disableError } = await admin
      .from('organiser_payout_accounts')
      .update({
        direct_settlement_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('organiser_id', auth.organiserId);
    if (disableError) throw disableError;

    await deactivatePaystackSubaccount(current.provider_subaccount_code);

    const { error: deleteError } = await admin
      .from('organiser_payout_accounts')
      .delete()
      .eq('organiser_id', auth.organiserId);
    if (deleteError) throw deleteError;

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    console.error('Unable to disconnect payout account', error);
    return NextResponse.json(
      {
        error:
          'Direct settlement was stopped, but Paystack could not finish disconnecting the account. Please try again.',
      },
      { status: 502 },
    );
  }
}
