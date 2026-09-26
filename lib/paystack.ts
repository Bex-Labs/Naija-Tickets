const PAYSTACK_API_URL = 'https://api.paystack.co';
const REFERENCE_PATTERN = /^[A-Za-z0-9.=-]{8,100}$/;

type PaystackEnvelope<T> = {
  status: boolean;
  message: string;
  data: T;
};

export type PaystackInitialization = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerification = {
  id: number | string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  channel?: string | null;
  gateway_response?: string | null;
};

export type PaystackBank = {
  name: string;
  code: string;
  active: boolean;
  country: string;
  currency: string;
  type: string;
};

export type PaystackResolvedAccount = {
  account_number: string;
  account_name: string;
  bank_id?: number;
};

export type PaystackSubaccount = {
  subaccount_code: string;
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  active: boolean;
};

function getPaystackSecretKey() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error('Paystack is not configured.');
  return secret;
}

async function paystackRequest<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${getPaystackSecretKey()}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${PAYSTACK_API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  const payload = (await response.json()) as PaystackEnvelope<T>;
  if (!response.ok || !payload.status) {
    throw new Error(
      payload.message || 'Paystack could not complete the request.',
    );
  }
  return payload;
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountKobo: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  orderReference: string;
  subaccountCode?: string;
  transactionChargeKobo?: number;
}) {
  const split = paystackSplitFields(
    input.subaccountCode,
    input.transactionChargeKobo,
  );
  const payload = await paystackRequest<PaystackInitialization>(
    '/transaction/initialize',
    {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: String(input.amountKobo),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...split,
        metadata: {
          order_reference: input.orderReference,
          product: 'Naija Tickets',
        },
      }),
    },
  );
  return payload;
}

export function paystackSplitFields(
  subaccountCode?: string,
  transactionChargeKobo?: number,
) {
  if (!subaccountCode && transactionChargeKobo === undefined) return {};
  if (
    !subaccountCode ||
    !/^ACCT_[A-Za-z0-9]+$/.test(subaccountCode) ||
    !Number.isSafeInteger(transactionChargeKobo) ||
    (transactionChargeKobo as number) < 0
  ) {
    throw new Error('The Paystack split configuration is invalid.');
  }
  return {
    subaccount: subaccountCode,
    transaction_charge: transactionChargeKobo,
  };
}

export async function listNigerianPaystackBanks() {
  const payload = await paystackRequest<PaystackBank[]>(
    '/bank?country=nigeria&currency=NGN&perPage=100',
  );
  return payload.data
    .filter((bank) => bank.active && bank.currency === 'NGN')
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function resolveNigerianBankAccount(input: {
  bankCode: string;
  accountNumber: string;
}) {
  const query = new URLSearchParams({
    bank_code: input.bankCode,
    account_number: input.accountNumber,
  });
  return paystackRequest<PaystackResolvedAccount>(`/bank/resolve?${query}`);
}

export async function createOrUpdatePaystackSubaccount(input: {
  currentSubaccountCode?: string | null;
  businessName: string;
  bankCode: string;
  accountNumber: string;
  contactEmail: string;
  contactPhone?: string | null;
}) {
  return paystackRequest<PaystackSubaccount>(
    input.currentSubaccountCode
      ? `/subaccount/${encodeURIComponent(input.currentSubaccountCode)}`
      : '/subaccount',
    {
      method: input.currentSubaccountCode ? 'PUT' : 'POST',
      body: JSON.stringify({
        business_name: input.businessName,
        settlement_bank: input.bankCode,
        account_number: input.accountNumber,
        percentage_charge: 0,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone || undefined,
        description: 'Automatic ticket settlement from Naija Tickets',
      }),
    },
  );
}

export async function deactivatePaystackSubaccount(subaccountCode: string) {
  if (!/^ACCT_[A-Za-z0-9]+$/.test(subaccountCode)) {
    throw new Error('The Paystack subaccount code is invalid.');
  }
  return paystackRequest<PaystackSubaccount>(
    `/subaccount/${encodeURIComponent(subaccountCode)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ active: false }),
    },
  );
}

export async function verifyPaystackTransaction(reference: string) {
  if (!isValidPaystackReference(reference)) {
    throw new Error('The payment reference is invalid.');
  }
  return paystackRequest<PaystackVerification>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
}

export async function getPaystackRefund(refundId: string) {
  if (!/^[0-9]{1,20}$/.test(refundId)) {
    throw new Error('The Paystack refund ID is invalid.');
  }
  return paystackRequest<unknown>(`/refund/${refundId}`);
}

export function isValidPaystackReference(value: string) {
  return REFERENCE_PATTERN.test(value);
}

export function getTrustedAppOrigin(requestUrl: string) {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new Error('APP_URL must use HTTPS outside local development.');
    }
    return url.origin;
  }

  const requestOrigin = new URL(requestUrl);
  if (
    requestOrigin.hostname === 'localhost' ||
    requestOrigin.hostname === '127.0.0.1'
  ) {
    return requestOrigin.origin;
  }
  throw new Error('APP_URL is not configured.');
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function constantTimeEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifyPaystackWebhookSignature(
  rawPayload: string | ArrayBuffer,
  suppliedSignature: string,
) {
  if (!/^[a-f0-9]{128}$/i.test(suppliedSignature)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getPaystackSecretKey()),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    typeof rawPayload === 'string'
      ? new TextEncoder().encode(rawPayload)
      : rawPayload,
  );
  return constantTimeEqual(hex(signature), suppliedSignature.toLowerCase());
}

export async function sha256Hex(value: string | ArrayBuffer) {
  return hex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof value === 'string' ? new TextEncoder().encode(value) : value,
    ),
  );
}
