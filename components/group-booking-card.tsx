'use client';
import { useState } from 'react';
import { Check, Circle, Copy, MessageCircle } from 'lucide-react';
import type { GroupBooking } from '@/lib/group-bookings';

export function GroupBookingCard({
  booking,
  active = true,
}: {
  booking: GroupBooking;
  active?: boolean;
}) {
  const [notice, setNotice] = useState('');
  const inviteUrl = () =>
    new URL(booking.invitePath, window.location.origin).toString();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl());
      setNotice('Group link copied.');
    } catch {
      setNotice('Copy the group link from the field below.');
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
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex min-h-11 items-center gap-2 bg-[#241b3f] px-4 text-sm font-bold text-white"
            >
              <Copy className="h-4 w-4" />
              Copy Link
            </button>
            <button
              type="button"
              onClick={() =>
                window.open(
                  `https://wa.me/?text=${encodeURIComponent(`Join our ${booking.ticketName} group and claim your ticket: ${inviteUrl()}`)}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              }
              className="inline-flex min-h-11 items-center gap-2 bg-emerald-500 px-4 text-sm font-bold text-emerald-950"
            >
              <MessageCircle className="h-4 w-4" />
              Share on WhatsApp
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
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Each member, including you if attending, claims one ticket through
            this link.
          </p>
        </>
      )}
      {notice && (
        <output className="mt-3 block text-sm text-emerald-800">
          {notice}
        </output>
      )}
      <ul className="mt-5 space-y-2 border-t border-[#241b3f]/10 pt-4 text-sm">
        {booking.members.map((member) => (
          <li key={member.id} className="flex items-center gap-2">
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
          </li>
        ))}
      </ul>
    </section>
  );
}
