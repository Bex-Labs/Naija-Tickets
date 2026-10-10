type TicketEmailConfiguration = {
  [key: string]: string | undefined;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_APP_URL?: string;
  APP_URL?: string;
};

export function ticketEmailOrigin(
  config: TicketEmailConfiguration = process.env,
) {
  // A local Paystack callback can stay on localhost while emailed ticket links
  // point to the public app that uses the same Supabase project.
  const value = config.EMAIL_APP_URL?.trim() || config.APP_URL?.trim();
  if (!value) throw new Error('A public email link address is required.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A public HTTPS email link address is required.');
  }
  if (
    url.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('A public HTTPS email link address is required.');
  }
  return url.origin;
}

export function ticketEmailConfigured(
  config: TicketEmailConfiguration = process.env,
) {
  if (!config.RESEND_API_KEY?.trim() || !config.EMAIL_FROM?.trim())
    return false;
  try {
    ticketEmailOrigin(config);
    return true;
  } catch {
    return false;
  }
}
