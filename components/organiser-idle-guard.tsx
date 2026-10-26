'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  createOrganiserIdleSession,
  ORGANISER_IDLE_STORAGE_KEY,
  type OrganiserIdleState,
} from '@/lib/organiser-idle-session';

export function OrganiserIdleGuard({
  session,
  children,
}: {
  session: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<OrganiserIdleState | null>(null);
  const [signOutError, setSignOutError] = useState('');
  const monitor = useRef<ReturnType<typeof createOrganiserIdleSession>>(null);
  const signingOut = useRef(false);
  const stayButton = useRef<HTMLButtonElement>(null);

  const signOut = useCallback(async () => {
    if (signingOut.current) return;
    signingOut.current = true;
    setSignOutError('');
    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut({
        scope: 'local',
      });
      if (error) throw error;
      window.location.replace('/login?next=/organiser&reason=inactivity');
    } catch {
      setSignOutError(
        'Your workspace is locked. Check your connection and try signing out again.',
      );
    } finally {
      signingOut.current = false;
    }
  }, []);

  useEffect(() => {
    const idle = createOrganiserIdleSession({
      session,
      now: Date.now,
      read: () => window.localStorage.getItem(ORGANISER_IDLE_STORAGE_KEY),
      write: (value) =>
        window.localStorage.setItem(ORGANISER_IDLE_STORAGE_KEY, value),
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer as number | undefined),
      onState: setState,
      onExpire: () => void signOut(),
    });
    monitor.current = idle;
    let lastInput = 0;
    const activity = (event: Event) => {
      const now = Date.now();
      if (
        event.isTrusted &&
        document.visibilityState === 'visible' &&
        now - lastInput >= 1_000
      ) {
        lastInput = now;
        idle.activity();
      }
    };
    const check = () => idle.check();
    const storage = (event: StorageEvent) => {
      if (event.key === ORGANISER_IDLE_STORAGE_KEY || event.key === null)
        idle.check();
    };
    const events = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
    ];
    for (const name of events)
      window.addEventListener(name, activity, { passive: true, capture: true });
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', check);
    idle.start();
    return () => {
      idle.stop();
      monitor.current = null;
      for (const name of events)
        window.removeEventListener(name, activity, true);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', check);
    };
  }, [session, signOut]);

  if (!state || state.status === 'expired')
    return (
      <main className="grid min-h-screen place-items-center bg-[#fffaf0] px-5 text-[#241b3f]">
        <section className="w-full max-w-md border border-[#241b3f]/10 bg-white p-6 text-center">
          <h1 className="text-xl font-black">
            {state ? 'Your session has timed out' : 'Checking your session…'}
          </h1>
          {state && (
            <p className="mt-3 text-sm text-slate-600">
              You were inactive for 15 minutes. Sign in again to open your
              workspace.
            </p>
          )}
          {signOutError && (
            <>
              <p role="alert" className="mt-3 text-sm text-red-700">
                {signOutError}
              </p>
              <Button className="mt-4" onClick={() => void signOut()}>
                Try signing out again
              </Button>
            </>
          )}
        </section>
      </main>
    );

  return (
    <>
      {children}
      <AlertDialog open={state.status === 'warning'}>
        <AlertDialogContent
          initialFocus={stayButton}
          className="max-w-md bg-white text-[#241b3f]"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Are you still working?</AlertDialogTitle>
            <AlertDialogDescription>
              You will be signed out in {state.secondsRemaining} seconds due to
              inactivity. Stay signed in to keep working. Unsaved changes will
              be lost if you are signed out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => monitor.current?.expire()}>
              Sign out now
            </Button>
            <Button
              ref={stayButton}
              onClick={() => monitor.current?.activity(true)}
            >
              Stay signed in
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
