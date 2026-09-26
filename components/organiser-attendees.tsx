'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  attendeePageSize,
  attendeeStatuses,
  type Attendee,
} from '@/lib/organiser-attendees';
import type { GroupBooking } from '@/lib/group-bookings';
import type { OrganiserEvent } from '@/lib/organiser-types';

export function OrganiserAttendees({
  events,
  initialEventId,
}: {
  events: OrganiserEvent[];
  initialEventId: string;
}) {
  const [eventId, setEventId] = useState(initialEventId || events[0]?.id || '');
  const [search, setSearch] = useState('');
  const [field, setField] = useState('attendee_name');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    attendees: Attendee[];
    total: number;
    groups?: Pick<
      GroupBooking,
      | 'id'
      | 'ticketName'
      | 'buyerName'
      | 'admissions'
      | 'registered'
      | 'remaining'
      | 'checkedIn'
    >[];
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const selectedEventId = eventId || events[0]?.id || '';

  useEffect(() => {
    if (!selectedEventId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setResult(null);
      setError('');
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session)
          throw new Error('Your session has expired. Log in again.');
        const params = new URLSearchParams({
          eventId: selectedEventId,
          search,
          field,
          status,
          page: String(page),
        });
        const response = await fetch(`/api/organiser/attendees?${params}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          attendees: Attendee[];
          total: number;
          groups?: Pick<
            GroupBooking,
            | 'id'
            | 'ticketName'
            | 'buyerName'
            | 'admissions'
            | 'registered'
            | 'remaining'
            | 'checkedIn'
          >[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(body.error || 'Unable to load attendees.');
        if (!controller.signal.aborted) setResult(body);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load attendees.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedEventId, search, field, status, page, reload]);

  const change = (setter: (value: string) => void, value: string) => {
    setResult(null);
    setLoading(true);
    setter(value);
    setPage(1);
  };
  const inputClass =
    'mt-2 min-h-11 w-full border border-[#241b3f]/20 bg-white px-3 text-sm';
  return (
    <div className="animate-rise">
      <p className="eyebrow">Guest management</p>
      <h1 className="mt-2 text-4xl font-black tracking-[-.04em]">Attendees</h1>
      <p className="mt-3 text-sm text-slate-600">
        View issued tickets and entry status. Attendee details are restricted to
        your event’s organisers.
      </p>
      {!events.length ? (
        <p className="mt-8">
          No events yet. Create an event to start managing attendees.
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-bold">
              Event
              <select
                className={inputClass}
                value={selectedEventId}
                onChange={(e) => change(setEventId, e.target.value)}
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              Search by
              <select
                className={inputClass}
                value={field}
                onChange={(e) => change(setField, e.target.value)}
              >
                <option value="attendee_name">Attendee name</option>
                <option value="attendee_email">Email</option>
                <option value="display_code">Ticket code</option>
              </select>
            </label>
            <label className="text-sm font-bold">
              Search attendees
              <input
                className={inputClass}
                type="search"
                maxLength={200}
                value={search}
                placeholder="Enter search text"
                onChange={(e) => change(setSearch, e.target.value)}
              />
            </label>
            <label className="text-sm font-bold">
              Ticket status
              <select
                className={inputClass}
                value={status}
                onChange={(e) => change(setStatus, e.target.value)}
              >
                <option value="">All statuses</option>
                {attendeeStatuses.map((value) => (
                  <option key={value} value={value}>
                    {value === 'used'
                      ? 'Checked in'
                      : value === 'valid'
                        ? 'Valid · not checked in'
                        : value === 'cancelled'
                          ? 'Cancelled'
                          : 'Refunded'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="mt-4 min-h-11 px-3 text-sm font-bold underline"
            onClick={() => {
              setResult(null);
              setLoading(true);
              setReload((value) => value + 1);
            }}
          >
            Refresh list
          </button>
          <div aria-live="polite" className="mt-4 text-sm">
            {loading ? (
              'Loading attendees…'
            ) : error ? (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            ) : result ? (
              `${result.total} matching ticket${result.total === 1 ? '' : 's'}`
            ) : null}
          </div>
          {!loading && result?.groups?.length ? (
            <section className="mt-6">
              <h2 className="text-xl font-black">Group bookings</h2>
              <div className="mt-3 overflow-x-auto border border-[#241b3f]/10 bg-white">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    Group registration and entry totals
                  </caption>
                  <thead className="bg-[#fff3d8]">
                    <tr>
                      {[
                        'Group ticket',
                        'Buyer',
                        'Admissions',
                        'Registered',
                        'Awaiting registration',
                        'Checked in',
                      ].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className="whitespace-nowrap p-4"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.groups.map((group) => (
                      <tr
                        key={group.id}
                        className="border-t border-[#241b3f]/10"
                      >
                        <td className="p-4 font-bold">{group.ticketName}</td>
                        <td className="p-4">{group.buyerName}</td>
                        <td className="p-4">{group.admissions}</td>
                        <td className="p-4">{group.registered}</td>
                        <td className="p-4">{group.remaining}</td>
                        <td className="p-4">{group.checkedIn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {!loading && result && (
            <>
              {!result.attendees.length ? (
                <p className="mt-6 border border-dashed border-[#241b3f]/20 p-8 text-center">
                  {search || status
                    ? 'No attendees match these filters.'
                    : 'No issued tickets to show.'}
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto border border-[#241b3f]/10 bg-white">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      Attendee tickets for{' '}
                      {
                        events.find((event) => event.id === selectedEventId)
                          ?.title
                      }
                    </caption>
                    <thead className="bg-[#fff3d8]">
                      <tr>
                        {[
                          'Attendee',
                          'Ticket type',
                          'Ticket code',
                          'Status',
                        ].map((label) => (
                          <th
                            key={label}
                            scope="col"
                            className="whitespace-nowrap p-4"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.attendees.map((attendee) => (
                        <tr
                          key={attendee.id}
                          className="border-t border-[#241b3f]/10"
                        >
                          <td className="p-4">
                            <p className="font-bold">
                              {attendee.attendee_name}
                            </p>
                            <p className="mt-1 break-all text-slate-600">
                              {attendee.attendee_email}
                            </p>
                          </td>
                          <td className="p-4">{attendee.ticketType}</td>
                          <td className="whitespace-nowrap p-4 font-mono">
                            {attendee.display_code}
                          </td>
                          <td className="whitespace-nowrap p-4">
                            {attendee.status === 'used'
                              ? 'Checked in'
                              : attendee.status === 'valid'
                                ? 'Valid · not checked in'
                                : attendee.status === 'cancelled'
                                  ? 'Cancelled'
                                  : 'Refunded'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <button
                  className="min-h-11 px-3 font-bold disabled:opacity-40"
                  disabled={page <= 1}
                  onClick={() => {
                    setResult(null);
                    setLoading(true);
                    setPage(page - 1);
                  }}
                >
                  Previous
                </button>
                <span>
                  Page {page} of{' '}
                  {Math.max(1, Math.ceil(result.total / attendeePageSize))}
                </span>
                <button
                  className="min-h-11 px-3 font-bold disabled:opacity-40"
                  disabled={page * attendeePageSize >= result.total}
                  onClick={() => {
                    setResult(null);
                    setLoading(true);
                    setPage(page + 1);
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
