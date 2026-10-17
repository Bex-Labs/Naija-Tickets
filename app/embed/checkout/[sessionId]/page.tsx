import type { Metadata } from 'next';
import { EmbeddedCheckout } from '@/components/embedded-checkout';
export const metadata: Metadata = {
  title: 'Secure checkout | Naija Tickets',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';
export default async function PopupCheckoutPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return <EmbeddedCheckout sessionId={(await params).sessionId} />;
}
