'use client';

import { Bell, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { CustomerNotification } from '@/lib/customer-account';

export function CustomerNotifications({
  userId,
  notifications,
}: {
  userId: string;
  notifications: CustomerNotification[];
}) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<CustomerNotification | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const storageKey = `naija-notifications-seen:${userId}`;

  useEffect(() => {
    const showTimer = window.setTimeout(() => {
      let stored: string[] = [];
      try {
        const value: unknown = JSON.parse(
          localStorage.getItem(storageKey) || '[]',
        );
        if (Array.isArray(value))
          stored = value.filter((id): id is string => typeof id === 'string');
      } catch {
        /* Notifications still work when browser storage is unavailable. */
      }
      setSeen(stored);
      const newest = notifications.find((item) => !stored.includes(item.id));
      let alreadyPreviewed = false;
      try {
        alreadyPreviewed =
          sessionStorage.getItem(`${storageKey}:preview`) === newest?.id;
        if (newest) sessionStorage.setItem(`${storageKey}:preview`, newest.id);
      } catch {
        /* A preview can still be shown without browser storage. */
      }
      setPeek(alreadyPreviewed ? null : (newest ?? null));
    }, 250);
    const timer = window.setTimeout(() => setPeek(null), 6000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(timer);
    };
  }, [notifications, storageKey]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        bell.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const unread = notifications.filter((item) => !seen.includes(item.id)).length;
  const toggle = () => {
    setOpen(!open);
    setPeek(null);
    if (!open) {
      const ids = notifications.map((item) => item.id);
      setSeen(ids);
      try {
        localStorage.setItem(storageKey, JSON.stringify(ids));
      } catch {
        /* Optional local read marker. */
      }
    }
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={bell}
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        className="relative grid h-11 w-11 place-items-center rounded-full border border-emerald-700/20 text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
          />
        )}
      </button>
      {open && (
        <section
          id={panelId}
          aria-label="Notifications"
          className="absolute right-0 top-14 z-30 w-[min(22rem,calc(100vw-4rem))] overflow-hidden rounded-xl border border-[#241b3f]/10 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="font-black">Notifications</h3>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => {
                setOpen(false);
                bell.current?.focus();
              }}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto overscroll-contain">
            {notifications.length ? (
              notifications.map((item) => (
                <li
                  key={item.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  {item.link ? (
                    <a
                      href={item.link}
                      className="block px-4 py-3 hover:bg-emerald-50"
                    >
                      <NotificationText item={item} />
                    </a>
                  ) : (
                    <div className="px-4 py-3">
                      <NotificationText item={item} />
                    </div>
                  )}
                </li>
              ))
            ) : (
              <li className="p-5 text-sm text-slate-500">
                No notifications yet.
              </li>
            )}
          </ul>
        </section>
      )}
      {peek && !open && (
        <output className="fixed bottom-5 right-5 z-40 flex w-[min(22rem,calc(100vw-2.5rem))] items-start gap-3 rounded-xl border border-emerald-200 bg-white p-4 shadow-lg">
          <Bell className="mt-1 h-5 w-5 shrink-0 text-emerald-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{peek.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">
              {peek.message}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification preview"
            onClick={() => setPeek(null)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </output>
      )}
    </div>
  );
}

function NotificationText({ item }: { item: CustomerNotification }) {
  return (
    <>
      <p className="text-sm font-bold">{item.title}</p>
      <p className="mt-1 text-sm leading-5 text-slate-600">{item.message}</p>
      <time
        dateTime={item.createdAt}
        className="mt-2 block text-xs text-slate-400"
      >
        {new Date(item.createdAt).toLocaleDateString('en-NG', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Africa/Lagos',
        })}
      </time>
    </>
  );
}
