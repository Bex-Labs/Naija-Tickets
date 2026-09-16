import type { Metadata } from 'next';
import { OrganiserAccess } from '@/components/organiser-access';

export const metadata: Metadata = {
  title: 'Organiser workspace | Naija Tickets',
  description: 'Apply as an organiser and manage event approvals.',
};
export default function OrganiserPage() {
  return <OrganiserAccess />;
}
