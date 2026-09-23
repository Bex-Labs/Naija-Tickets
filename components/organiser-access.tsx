'use client';

import { LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OrganiserWorkspace } from '@/components/organiser-workspace';
import { accountHomeFromMetadata } from '@/lib/auth-destination';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type AccessState = 'loading' | 'signed-out' | 'signed-in';

export function OrganiserAccess() {
  const [access, setAccess] = useState<AccessState>('loading');

  useEffect(() => {
    const client = getSupabaseBrowserClient();

    void client.auth.getSession().then(({ data }) => {
      if (
        data.session &&
        accountHomeFromMetadata(data.session.user.user_metadata) === '/account'
      ) {
        window.location.replace('/account');
        return;
      }
      setAccess(data.session ? 'signed-in' : 'signed-out');
    });

    const { data: listener } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (
          session &&
          accountHomeFromMetadata(session.user.user_metadata) === '/account'
        ) {
          window.location.replace('/account');
          return;
        }
        setAccess(session ? 'signed-in' : 'signed-out');
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  if (access === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf0] px-5 text-[#241b3f]">
        <p className="font-bold">Checking your account…</p>
      </main>
    );
  }

  if (access === 'signed-out') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf0] px-5 text-[#241b3f]">
        <section className="w-full max-w-md border border-[#241b3f]/10 bg-white p-8 text-center shadow-xl">
          <span className="mx-auto grid h-12 w-12 place-items-center bg-emerald-100 text-emerald-700">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <p className="eyebrow mt-6">Organiser access</p>
          <h1 className="mt-3 text-3xl font-black">Log in to continue</h1>
          <p className="mt-3 leading-7 text-slate-600">
            A confirmed Naija Tickets account is required to open the organiser
            workspace.
          </p>
          <a
            href="/login?next=/organiser"
            className="mt-7 inline-flex h-12 items-center justify-center bg-[#ff6b4a] px-6 font-black text-white"
          >
            Go to login
          </a>
        </section>
      </main>
    );
  }

  return <OrganiserWorkspace />;
}
