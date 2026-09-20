'use client';

import {
  CalendarDays,
  LayoutDashboard,
  Pencil,
  Plus,
  Wallet,
  Settings,
  Ticket,
  Users,
  Tag,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { OrganiserSalesAnalytics } from '@/components/organiser-sales-analytics';
import { OrganiserPayouts } from '@/components/organiser-payouts';
import { OrganiserPromoCodes } from '@/components/organiser-promo-codes';
import { OrganiserAttendees } from '@/components/organiser-attendees';
import { AccountSignOut } from '@/components/account-sign-out';
import { OrganiserSettings } from '@/components/organiser-settings';
import { OrganiserVerificationAlert } from '@/components/organiser-verification-alert';
import {
  OrganiserEventEditor,
  type EventEditorValue,
} from '@/components/organiser-event-editor';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrganiserEvent } from '@/lib/organiser-types';

type View =
  | 'overview'
  | 'events'
  | 'editor'
  | 'settings'
  | 'attendees'
  | 'promos'
  | 'payouts';
type OrganiserProfile = { name: string; description: string };

function blankEvent(profile?: OrganiserProfile): EventEditorValue {
  return {
    title: '',
    presenterLine: profile?.name ? `${profile.name} presents` : '',
    category: 'Concert',
    city: 'Lagos',
    venue: '',
    address: '',
    directionsUrl: '',
    date: '',
    time: '',
    endDate: '',
    endTime: '',
    timezoneLabel: 'WAT',
    salesStart: '',
    salesEnd: '',
    description: '',
    imageName: '',
    organiserDisplayName: profile?.name || '',
    organiserAbout: profile?.description || '',
    featured: false,
    schedule: [],
    policies: [],
    ticketTypes: [
      {
        clientKey: 'initial-ticket',
        name: 'General admission',
        description: '',
        priceNaira: 0,
        earlyBirdPriceNaira: null,
        earlyBirdEnd: '',
        quantityTotal: 100,
        quantitySold: 0,
        quantityReserved: 0,
        minPerOrder: 1,
        maxPerOrder: 6,
        inclusions: ['General admission'],
        active: true,
      },
    ],
  };
}

export function OrganiserWorkspace() {
  const [events, setEvents] = useState<OrganiserEvent[]>([]);
  const [view, setView] = useState<View>('overview');
  const [attendeeEventId, setAttendeeEventId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState<EventEditorValue>(() =>
    blankEvent(),
  );
  const [organiserProfile, setOrganiserProfile] = useState<OrganiserProfile>();
  const [editorNotice, setEditorNotice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    const loadEvents = async () => {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) return;
      const response = await fetch('/api/organiser/events', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const result = (await response.json()) as {
        events?: OrganiserEvent[];
        organiser?: OrganiserProfile;
        error?: string;
      };
      if (!response.ok) {
        setEditorNotice(result.error || 'We could not load your events.');
        return;
      }
      setOrganiserProfile(result.organiser);
      setEvents(result.events || []);
    };

    void loadEvents();
  }, []);
  const submitted = events.filter(
    (event) => event.status === 'submitted',
  ).length;
  const published = events.filter(
    (event) => event.status === 'published',
  ).length;
  const saveEvent = async (status: 'draft' | 'submitted') => {
    setIsSaving(true);
    setEditorNotice('');
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session)
        throw new Error('Your session has expired. Log in again.');
      const response = await fetch('/api/organiser/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...eventForm, id: editingId, status }),
      });
      const result = (await response.json()) as {
        events?: OrganiserEvent[];
        organiser?: OrganiserProfile;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || 'Event could not be saved.');
      setOrganiserProfile(result.organiser);
      setEvents(result.events || []);
      setEventForm(blankEvent(result.organiser));
      setEditingId(null);
      setView('events');
    } catch (error) {
      setEditorNotice(
        error instanceof Error ? error.message : 'Event could not be saved.',
      );
    } finally {
      setIsSaving(false);
    }
  };
  const editEvent = (event: OrganiserEvent) => {
    const { id, status: _status, reason: _reason, ...form } = event;
    setEditingId(id);
    setEventForm(form);
    setView('editor');
  };

  const nav = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'events', label: 'My events', icon: CalendarDays },
    { id: 'promos', label: 'Promo codes', icon: Tag },
    { id: 'payouts', label: 'Payouts', icon: Wallet },
    { id: 'attendees', label: 'Attendees', icon: Users },
    { id: 'editor', label: 'Create event', icon: Plus },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;
  return (
    <main className="min-h-screen bg-[#fffaf0] text-[#241b3f]">
      <div className="border-b border-[#241b3f]/10 bg-[#fff3d8] px-5">
        <div className="mx-auto flex h-18 max-w-[90rem] items-center justify-between">
          <a
            href="/"
            className="flex min-h-11 min-w-0 items-center gap-2 text-xl font-black"
          >
            <span className="grid h-8 w-8 place-items-center bg-emerald-500 text-emerald-950">
              <Ticket className="h-4 w-4" />
            </span>
            <span className="brand-wordmark hidden min-[360px]:inline">
              Naija Tickets
            </span>
          </a>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-bold uppercase tracking-wider text-emerald-400 sm:block">
              Organiser workspace
            </span>
            <AccountSignOut />
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-[90rem] md:grid-cols-[15rem_1fr]">
        <aside className="border-b border-[#241b3f]/10 p-4 md:min-h-[calc(100vh-72px)] md:border-b-0 md:border-r">
          <nav
            className="grid grid-cols-2 gap-2 md:grid-cols-1"
            aria-label="Organiser navigation"
          >
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setView(id);
                  if (id === 'editor') {
                    setEditingId(null);
                    setEventForm(blankEvent(organiserProfile));
                  }
                }}
                className={`flex items-center gap-3 px-3 py-3 text-left text-sm font-bold transition ${view === id ? 'bg-emerald-500 text-emerald-950' : 'text-slate-600 hover:bg-emerald-50 hover:text-[#241b3f]'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 p-5 sm:p-8 lg:p-10">
          <OrganiserVerificationAlert
            onOpenSettings={() => setView('settings')}
          />
          {view === 'overview' && (
            <div className="animate-rise">
              <p className="eyebrow">Good morning</p>
              <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
                Organiser overview
              </h1>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {[
                  ['Events', events.length],
                  ['Awaiting review', submitted],
                  ['Published', published],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border border-[#241b3f]/10 bg-white p-5"
                  >
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-3 text-3xl font-black">{value}</p>
                  </div>
                ))}
              </div>
              <OrganiserSalesAnalytics />
              <div className="mt-8 border border-[#241b3f]/10 bg-white p-6">
                <p className="text-sm font-black">Publishing workflow</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Save an event as a draft until every detail is ready, then
                  submit it for administrator review. Approved events appear on
                  the public site immediately.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setEventForm(blankEvent(organiserProfile));
                    setView('editor');
                  }}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-4 text-sm font-bold text-emerald-950"
                >
                  <Plus className="h-4 w-4" /> Create an event
                </button>
              </div>
            </div>
          )}
          {view === 'events' && (
            <div className="animate-rise">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="eyebrow">Event management</p>
                  <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">
                    My events
                  </h1>
                </div>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setEventForm(blankEvent(organiserProfile));
                    setView('editor');
                  }}
                  className="bg-emerald-500 px-4 py-3 text-sm font-black text-emerald-950"
                >
                  <Plus className="mr-2 inline h-4 w-4" />
                  New event
                </button>
              </div>
              {events.length ? (
                <div className="mt-8 divide-y divide-[#241b3f]/10 border-y border-[#241b3f]/10">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="grid gap-4 py-5 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 className="font-black">{event.title}</h2>
                          <span className="bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                            {event.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          {event.city} · {event.date} at {event.time}
                        </p>
                        {event.reason && (
                          <p className="mt-2 text-xs text-red-300">
                            Review note: {event.reason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => {
                            setAttendeeEventId(event.id);
                            setView('attendees');
                          }}
                          className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-700"
                        >
                          <Users className="h-4 w-4" /> Attendees
                        </button>
                        <button
                          onClick={() => editEvent(event)}
                          className="inline-flex items-center gap-2 text-sm font-bold text-emerald-400"
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-8 border border-dashed border-[#241b3f]/15 p-10 text-center">
                  <CalendarDays className="mx-auto h-7 w-7 text-emerald-400" />
                  <h2 className="mt-4 text-xl font-black">No events yet</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Create a draft and submit it when the details are ready.
                  </p>
                </div>
              )}
            </div>
          )}
          {view === 'editor' && (
            <OrganiserEventEditor
              editing={Boolean(editingId)}
              value={eventForm}
              notice={editorNotice}
              saving={isSaving}
              onChange={setEventForm}
              onSave={(status) => void saveEvent(status)}
            />
          )}
          {view === 'attendees' && (
            <OrganiserAttendees
              events={events}
              initialEventId={attendeeEventId}
            />
          )}
          {view === 'promos' && <OrganiserPromoCodes events={events} />}
          {view === 'payouts' && <OrganiserPayouts />}
          {view === 'settings' && <OrganiserSettings />}
        </section>
      </div>
    </main>
  );
}
