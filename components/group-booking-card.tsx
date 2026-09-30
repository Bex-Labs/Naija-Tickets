'use client';
import { useState, type SyntheticEvent } from 'react';
import { Check, Circle, Copy, MessageCircle, UserPlus } from 'lucide-react';
import type { GroupBooking } from '@/lib/group-bookings';
import { Input } from '@/components/ui/input';

export function GroupBookingCard({
  booking,
  active = true,
}: {
  booking: GroupBooking;
  active?: boolean;
}) {
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'share' | 'add'>('share');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inviteUrl = () =>
    new URL(booking.invitePath, window.location.origin).toString();
  const copy = async (path: string, message: string) => {
    try {
      await navigator.clipboard.writeText(
        new URL(path, window.location.origin).toString(),
      );
      setNotice(message);
    } catch {
      setNotice(
        'Could not copy the link. Open it and copy it from your browser.',
      );
    }
  };
  const shareOnWhatsApp = (path: string, message: string) => {
    const url = new URL(path, window.location.origin).toString();
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`,
      '_blank',
      'noopener,noreferrer',
    );
  };
  const addMember = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !event.currentTarget.reportValidity()) return;
    const fields = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        `/api/group-bookings/${booking.invitePath.split('/').at(-1)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: fields.get('name'),
            email: fields.get('email'),
            phone: fields.get('phone'),
          }),
        },
      );
      const body = (await response.json()) as {
        ticketPath?: string;
        error?: string;
      };
      if (!response.ok || !body.ticketPath)
        throw new Error(body.error || 'Could not add this member.');
      // Reload the buyer's order so concurrent claims and the private ticket
      // links are read back from the database, not guessed from local state.
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not add this member.',
      );
      setSaving(false);
    }
  };
  return (
    <section className="no-print mt-5 border border-emerald-500/25 bg-white p-5 sm:p-6">
      <h3 className="text-xl font-black">{booking.ticketName}</h3>
      <p className="mt-1 text-sm font-bold">{booking.admissions} admissions</p>
      <p className="mt-4 text-sm font-bold text-emerald-800">
        {booking.registered} of {booking.admissions} members registered
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {booking.remaining} tickets waiting to be claimed · {booking.checkedIn}{' '}
        checked in
      </p>
      {active && (
        <>
          {booking.remaining > 0 && (
            <div className="mt-5">
              <p className="text-sm font-bold">
                How would you like to add members?
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={mode === 'share'}
                  onClick={() => {
                    setMode('share');
                    setError('');
                  }}
                  className={`min-h-12 border px-4 text-left text-sm font-bold transition ${mode === 'share' ? 'border-emerald-600 bg-emerald-50 text-emerald-950' : 'border-[#241b3f]/15 bg-white'}`}
                >
                  Members enter their details
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'add'}
                  onClick={() => {
                    setMode('add');
                    setError('');
                  }}
                  className={`min-h-12 border px-4 text-left text-sm font-bold transition ${mode === 'add' ? 'border-emerald-600 bg-emerald-50 text-emerald-950' : 'border-[#241b3f]/15 bg-white'}`}
                >
                  I’ll enter their details
                </button>
              </div>
              {mode === 'share' ? (
                <div className="mt-4">
                  <p className="text-sm text-slate-600">
                    Send this group link to each member. They’ll claim their own
                    ticket.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        void copy(booking.invitePath, 'Group link copied.')
                      }
                      className="inline-flex min-h-11 items-center gap-2 bg-[#241b3f] px-4 text-sm font-bold text-white"
                    >
                      <Copy className="h-4 w-4" /> Copy group link
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        shareOnWhatsApp(
                          booking.invitePath,
                          `Join our ${booking.ticketName} group and claim your ticket:`,
                        )
                      }
                      className="inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-4 text-sm font-bold text-emerald-950"
                    >
                      <MessageCircle className="h-4 w-4" /> Share on WhatsApp
                    </button>
                  </div>
                  <label className="mt-3 block text-xs font-bold">
                    Group registration link
                    <input
                      readOnly
                      aria-label="Group registration link"
                      onFocus={(event) => {
                        event.currentTarget.value = inviteUrl();
                        event.currentTarget.select();
                      }}
                      defaultValue={booking.invitePath}
                      className="mt-2 min-h-10 w-full border border-[#241b3f]/20 bg-[#fffaf0] px-3 text-xs font-normal"
                    />
                  </label>
                </div>
              ) : (
                <form
                  onSubmit={(event) => void addMember(event)}
                  className="mt-4 space-y-3"
                >
                  <p className="text-sm text-slate-600">
                    Enter one member at a time. Their admission is assigned
                    immediately; then share their private ticket link below.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label
                      htmlFor={`group-name-${booking.id}`}
                      className="text-xs font-bold"
                    >
                      Full name
                      <Input
                        id={`group-name-${booking.id}`}
                        name="name"
                        required
                        minLength={2}
                        maxLength={120}
                        autoComplete="off"
                        disabled={saving}
                        className="auth-input mt-2 w-full"
                      />
                    </label>
                    <label
                      htmlFor={`group-email-${booking.id}`}
                      className="text-xs font-bold"
                    >
                      Email
                      <Input
                        id={`group-email-${booking.id}`}
                        name="email"
                        type="email"
                        required
                        maxLength={254}
                        autoComplete="off"
                        disabled={saving}
                        className="auth-input mt-2 w-full"
                      />
                    </label>
                    <label
                      htmlFor={`group-phone-${booking.id}`}
                      className="text-xs font-bold"
                    >
                      Phone number
                      <Input
                        id={`group-phone-${booking.id}`}
                        name="phone"
                        type="tel"
                        required
                        minLength={7}
                        maxLength={40}
                        autoComplete="off"
                        disabled={saving}
                        className="auth-input mt-2 w-full"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex min-h-11 items-center gap-2 bg-[#ff6b4a] px-4 text-sm font-bold text-white disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" />{' '}
                    {saving ? 'Adding member…' : 'Add member and create ticket'}
                  </button>
                  {error && (
                    <p role="alert" className="text-sm text-red-700">
                      {error}
                    </p>
                  )}
                </form>
              )}
              <p className="mt-3 text-xs leading-5 text-slate-500">
                You can use both options for the remaining admissions. Each
                email or phone number can claim only one ticket in this group.
              </p>
            </div>
          )}
        </>
      )}
      {notice && (
        <output className="mt-3 block text-sm text-emerald-800">
          {notice}
        </output>
      )}
      <ul className="mt-5 space-y-2 border-t border-[#241b3f]/10 pt-4 text-sm">
        {booking.members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            {member.state === 'UNCLAIMED' ? (
              <Circle className="h-4 w-4 text-slate-400" />
            ) : (
              <Check className="h-4 w-4 text-emerald-700" />
            )}
            {member.state === 'UNCLAIMED'
              ? 'Waiting for member'
              : `${member.name} — ${member.state === 'CHECKED_IN' ? 'Checked in' : 'Claimed'}`}
            {['cancelled', 'refunded'].includes(member.status) && (
              <span className="text-red-700">({member.status})</span>
            )}
            {active && member.ticketPath && (
              <span className="ml-auto flex flex-wrap items-center gap-3">
                <a
                  href={member.ticketPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-emerald-800 underline underline-offset-2"
                >
                  View ticket
                </a>
                <button
                  type="button"
                  onClick={() =>
                    void copy(
                      member.ticketPath!,
                      `Ticket link for ${member.name} copied.`,
                    )
                  }
                  className="inline-flex items-center gap-1 font-bold text-emerald-800 hover:underline"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy ticket link
                </button>
                <button
                  type="button"
                  onClick={() =>
                    shareOnWhatsApp(
                      member.ticketPath!,
                      `${member.name}, here is your ${booking.ticketName} ticket:`,
                    )
                  }
                  className="inline-flex items-center gap-1 font-bold text-emerald-800 hover:underline"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
