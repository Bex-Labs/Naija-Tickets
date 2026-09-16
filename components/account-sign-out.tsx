'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function AccountSignOut() {
  const signOut = async () => {
    await getSupabaseBrowserClient().auth.signOut();
    window.location.href = '/login';
  };
  return (
    <button
      onClick={() => void signOut()}
      className="min-h-11 px-2 text-sm font-bold text-slate-600 hover:text-[#241b3f]"
    >
      Sign out
    </button>
  );
}
