'use client';

import { Camera, ScanLine, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  entryMessages,
  type EntryEvent,
  type EntryResult,
} from '@/lib/event-entry';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const inputClass =
  'mt-2 min-h-12 w-full border border-slate-400 bg-white px-3 py-2 text-[#241b3f] placeholder:text-slate-500 focus:outline-2 focus:outline-emerald-600';
const buttonClass =
  'inline-flex min-h-12 items-center justify-center gap-2 bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50';

async function entryRequest<T>(path: string, init?: RequestInit) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error('Sign in to access event entry.');
  const response = await fetch(`/api/entry/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    cache: 'no-store',
  });
  const result = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !result)
    throw new Error(
      result?.error ||
        'Unable to confirm the result. Check your connection and try again.',
    );
  return result;
}

export function EventEntry() {
  const [events, setEvents] = useState<EntryEvent[]>([]);
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<EntryResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [email, setEmail] = useState('');
  const [staffMessage, setStaffMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestVersion = useRef(0);
  const event = events.find((item) => item.id === eventId);

  const loadEvents = useCallback(async () => {
    const data = await entryRequest<{ events: EntryEvent[] }>('events');
    setEvents(data.events);
    setEventId((current) =>
      data.events.some((item: EntryEvent) => item.id === current)
        ? current
        : data.events.find((item: EntryEvent) => item.status === 'published')
            ?.id ||
          data.events[0]?.id ||
          '',
    );
  }, []);

  useEffect(() => {
    let active = true;
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      try {
        if (data.session) await loadEvents();
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : 'Unable to load events.',
          );
      } finally {
        if (active) setLoading(false);
      }
    });
    const { data: listener } = client.auth.onAuthStateChange((authEvent) => {
      if (authEvent === 'SIGNED_OUT') {
        requestVersion.current += 1;
        setSignedIn(false);
        setEvents([]);
        setEventId('');
        setResult(null);
        setCamera(false);
      }
    });
    return () => {
      active = false;
      requestVersion.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [loadEvents]);

  const verify = useCallback(
    async (ticketCode: string, admit = false) => {
      const version = ++requestVersion.current;
      setCamera(false);
      setBusy(true);
      setError('');
      setResult(null);
      try {
        const data = await entryRequest<EntryResult>('verify', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            code: ticketCode,
            action: admit ? 'admit' : 'verify',
          }),
        });
        if (version === requestVersion.current) setResult(data);
      } catch (err) {
        if (version === requestVersion.current)
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to confirm entry. Verify again.',
          );
      } finally {
        if (version === requestVersion.current) setBusy(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            'Camera scanning requires HTTPS and a supported browser. Enter the ticket code below.',
          );
        const { default: jsQR } = await import('jsqr');
        if (stopped) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stop();
          return;
        }
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context)
          throw new Error(
            'Camera scanning is unavailable. Enter the ticket code below.',
          );
        const scan = () => {
          if (stopped) return;
          if (video.readyState >= 2 && video.videoWidth) {
            canvas.width = Math.min(video.videoWidth, 960);
            canvas.height = Math.round(
              (video.videoHeight * canvas.width) / video.videoWidth,
            );
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const qr = jsQR(pixels.data, pixels.width, pixels.height);
            if (qr?.data) {
              stop();
              setCode(qr.data);
              void verify(qr.data);
              return;
            }
          }
          timer = setTimeout(scan, 180);
        };
        scan();
      } catch (err) {
        if (!stopped) {
          setError(
            err instanceof Error
              ? `${err.message} You can enter the ticket code manually.`
              : 'Allow camera access or enter the code manually.',
          );
          setCamera(false);
        }
        stop();
      }
    })();
    return stop;
  }, [camera, verify]);

  async function updateStaff(staffId?: string) {
    setBusy(true);
    setStaffMessage('');
    try {
      await entryRequest<{ success: boolean }>('staff', {
        method: staffId ? 'DELETE' : 'POST',
        body: JSON.stringify({ eventId, email, staffId }),
      });
      await loadEvents();
      setEmail('');
      setStaffMessage(
        staffId
          ? 'Staff access removed.'
          : 'Staff member assigned. They can sign in and open Event entry.',
      );
    } catch (err) {
      setStaffMessage(
        err instanceof Error ? err.message : 'Unable to update staff.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-[70vh] max-w-4xl px-5 py-10 sm:py-14">
      <p className="eyebrow">Venue access</p>
      <h1 className="mt-3 flex items-center gap-3 text-3xl font-black sm:text-4xl">
        <ScanLine className="h-8 w-8 text-emerald-700" /> Event entry
      </h1>
      <p className="mt-3 text-slate-600">
        Verify a ticket, check the guest details, then admit the guest.
      </p>
      {loading ? (
        <output className="mt-8 block">
          Loading your events…
        </output>
      ) : !signedIn ? (
        <a href="/login?next=/entry" className={`${buttonClass} mt-8`}>
          Sign in to verify tickets
        </a>
      ) : (
        <>
          {error && (
            <p
              role="alert"
              className="mt-6 border border-red-300 bg-red-50 p-4 text-red-800"
            >
              {error}
            </p>
          )}
          {!events.length ? (
            <div className="mt-8 border border-slate-300 bg-white p-6">
              <h2 className="font-bold">No assigned events</h2>
              <p className="mt-2 text-sm text-slate-600">
                Ask the organiser to assign your account email to an event.
              </p>
              <button
                className={`${buttonClass} mt-4`}
                onClick={() => {
                  setError('');
                  void loadEvents().catch((err) => setError(err.message));
                }}
              >
                Refresh events
              </button>
            </div>
          ) : (
            <>
              <label
                className="mt-8 block text-sm font-bold"
                htmlFor="entry-event"
              >
                Event
              </label>
              <select
                id="entry-event"
                value={eventId}
                disabled={busy}
                className={inputClass}
                onChange={(e) => {
                  requestVersion.current += 1;
                  setEventId(e.target.value);
                  setCamera(false);
                  setResult(null);
                  setCode('');
                  setError('');
                  setStaffMessage('');
                }}
              >
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} ·{' '}
                    {new Date(item.starts_at).toLocaleDateString('en-NG')} ·{' '}
                    {item.status}
                  </option>
                ))}
              </select>
              {event?.status !== 'published' ? (
                <p className="mt-4 text-sm text-amber-800">
                  This event is not open for entry. Only published events accept
                  tickets.
                </p>
              ) : (
                <section
                  className="mt-6 border border-slate-300 bg-white p-5 sm:p-7"
                  aria-label="Ticket scanner"
                >
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => {
                      setCamera(!camera);
                      setResult(null);
                      setError('');
                    }}
                  >
                    <Camera className="h-5 w-5" />
                    {camera ? 'Stop camera' : 'Scan QR code'}
                  </button>
                  {camera && (
                    <div className="mt-4">
                      <video
                        ref={videoRef}
                        muted
                        playsInline
                        aria-label="Ticket scanning camera"
                        className="max-h-80 w-full bg-black object-contain"
                      />
                      <p className="mt-2 text-sm text-slate-600">
                        Point the camera at the ticket QR code.
                      </p>
                    </div>
                  )}
                  <form
                    className="mt-6"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void verify(code);
                    }}
                  >
                    <label htmlFor="ticket-code" className="text-sm font-bold">
                      Ticket code
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <input
                        id="ticket-code"
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value);
                          setResult(null);
                        }}
                        className={inputClass}
                        placeholder="NT-123456ABCDEF"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={100}
                        required
                        disabled={busy}
                      />
                      <button
                        className={`${buttonClass} shrink-0`}
                        disabled={busy || !code.trim()}
                      >
                        {busy ? 'Checking…' : 'Verify ticket'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Enter the code printed below the QR code, or use a
                      handheld scanner.
                    </p>
                  </form>
                  {result && (
                    <div
                      aria-live="polite"
                      className={`mt-6 border p-5 ${result.outcome === 'admitted' ? 'border-emerald-500 bg-emerald-50' : result.outcome === 'valid' ? 'border-sky-300 bg-sky-50' : 'border-red-300 bg-red-50'}`}
                    >
                      <h2 className="text-lg font-black">
                        {entryMessages[result.outcome]}
                      </h2>
                      {result.attendeeName && (
                        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                          <dt>Guest</dt>
                          <dd className="font-bold break-words">
                            {result.attendeeName}
                          </dd>
                          <dt>Ticket</dt>
                          <dd>{result.ticketType}</dd>
                          <dt>Event</dt>
                          <dd>{result.eventTitle}</dd>
                          <dt>Code</dt>
                          <dd className="font-mono">{result.displayCode}</dd>
                          <dt>Admissions</dt>
                          <dd>
                            {result.admissionsUsed} / {result.admissionLimit}
                          </dd>
                          {result.checkedInAt && (
                            <>
                              <dt>Checked in</dt>
                              <dd>
                                {new Date(result.checkedInAt).toLocaleString(
                                  'en-NG',
                                )}
                              </dd>
                            </>
                          )}
                        </dl>
                      )}
                      {result.outcome === 'valid' && (
                        <>
                          <p className="mt-4 text-sm">
                            This guest has not been checked in yet.
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            className={`${buttonClass} mt-3`}
                            onClick={() =>
                              void verify(result.displayCode!, true)
                            }
                          >
                            <UserCheck className="h-5 w-5" />
                            Admit guest
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="mt-4 block min-h-11 text-sm font-bold underline"
                        onClick={() => {
                          setCode('');
                          setResult(null);
                          setError('');
                        }}
                      >
                        Next ticket
                      </button>
                    </div>
                  )}
                </section>
              )}
              {event?.canManageStaff && (
                <section
                  className="mt-8 border border-slate-300 bg-white p-5 sm:p-7"
                  aria-label="Entry staff"
                >
                  <h2 className="text-xl font-black">Entry staff</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Assign a confirmed account to scan tickets for this event.
                    Staff can open Event entry from their account.
                  </p>
                  <form
                    className="mt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void updateStaff();
                    }}
                  >
                    <label htmlFor="staff-email" className="text-sm font-bold">
                      Staff account email
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <input
                        id="staff-email"
                        type="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="staff@example.com"
                        className={inputClass}
                        disabled={busy}
                      />
                      <button
                        className={`${buttonClass} shrink-0`}
                        disabled={busy}
                      >
                        Assign staff
                      </button>
                    </div>
                  </form>
                  {staffMessage && (
                    <output className="mt-4 block text-sm">
                      {staffMessage}
                    </output>
                  )}
                  {event.staff.length ? (
                    <ul className="mt-5 divide-y divide-slate-200">
                      {event.staff.map((member) => (
                        <li
                          key={member.id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <span>{member.name}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void updateStaff(member.id)}
                            className="min-h-11 text-sm font-bold text-red-700 underline"
                          >
                            Remove
                            <span className="sr-only"> {member.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-5 text-sm text-slate-500">
                      No additional staff assigned. You already have entry
                      access as the organiser.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
