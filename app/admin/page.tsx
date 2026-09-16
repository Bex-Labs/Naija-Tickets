import type { Metadata } from 'next';
import { LockKeyhole, Ticket } from 'lucide-react';
import { AdminLoginForm } from '@/components/admin-login-form';
import { AdminWorkspace } from '@/components/admin-workspace';
import { getAuthenticatedAdmin } from '@/lib/admin-request';

export const metadata: Metadata = {
  title: 'Admin workspace | Naija Tickets',
  description: 'Review organiser applications, events and roles.',
};
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const authenticated = await getAuthenticatedAdmin();

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf0] px-4 py-8 text-[#241b3f] sm:px-5 sm:py-12">
        <section className="w-full max-w-md border border-[#241b3f]/10 bg-white p-5 shadow-xl sm:p-10">
          <a
            href="/"
            className="flex min-h-11 w-fit items-center gap-2 text-xl font-black"
          >
            <span className="grid h-8 w-8 place-items-center bg-emerald-500 text-emerald-950">
              <Ticket className="h-4 w-4" />
            </span>
            Naija Tickets
          </a>
          <span className="mt-12 grid h-12 w-12 place-items-center bg-[#241b3f] text-white">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <p className="eyebrow mt-6">Restricted access</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-4xl">
            Administration
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            Enter the private administrator credentials to continue.
          </p>
          <AdminLoginForm />
        </section>
      </main>
    );
  }

  return <AdminWorkspace />;
}
