import type { Metadata } from 'next';
import { CustomerDashboard } from '@/components/customer-dashboard';
import { SiteFooter, SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'My tickets | Naija Tickets',
  description: 'View your Naija Tickets purchases and issued tickets.',
};

export default function AccountPage() {
  return (
    <div className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <SiteHeader />
      <CustomerDashboard />
      <SiteFooter />
    </div>
  );
}
