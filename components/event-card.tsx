import { ArrowUpRight, MapPin } from 'lucide-react';
import type { Event } from '@/lib/events';
import { eventPrice, formatNaira } from '@/lib/events';

export function EventCard({
  event,
  compact = false,
}: {
  event: Event;
  compact?: boolean;
}) {
  return (
    <a
      href={`/events/${event.slug}`}
      className={`group overflow-hidden border border-[#241b3f]/10 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-emerald-400/50 hover:shadow-[0_22px_60px_rgba(66,42,94,.14)] ${compact ? 'grid grid-cols-[7.5rem_minmax(0,1fr)]' : 'block'}`}
    >
      <div
        className={`relative overflow-hidden bg-[#151b18] ${compact ? 'h-full min-h-36' : 'aspect-[4/3]'}`}
      >
        <img
          src={event.image}
          alt={`${event.title} event`}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent opacity-70" />
        <span
          className={`absolute bg-black/75 py-1 text-xs font-bold text-white backdrop-blur ${compact ? 'left-2 top-2 px-2' : 'left-4 top-4 px-3'}`}
        >
          {event.category}
        </span>
        {event.soldOut && (
          <span
            className={`absolute bg-emerald-500 px-2 py-1 text-[10px] font-bold text-emerald-950 ${compact ? 'bottom-2 left-2' : 'right-4 top-4'}`}
          >
            Sold out
          </span>
        )}
      </div>
      <div className={compact ? 'p-3.5' : 'p-5'}>
        <p
          className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold uppercase tracking-wide text-emerald-700`}
        >
          {event.displayDate.replace(/ 2026$/, '')} · {event.time}
        </p>
        <h3
          className={`${compact ? 'mt-1.5 text-lg' : 'mt-2 text-xl'} font-extrabold tracking-tight text-[#241b3f] transition group-hover:text-emerald-700`}
        >
          {event.title}
        </h3>
        {!compact && (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <MapPin className="h-4 w-4 shrink-0" />
            {event.venue}, {event.city}
          </p>
        )}
        <div
          className={`${compact ? 'mt-2.5 pt-2.5' : 'mt-5 pt-4'} flex items-center justify-between border-t border-[#241b3f]/10`}
        >
          <span className="text-sm font-bold text-slate-700">
            {event.soldOut
              ? 'Join the waitlist'
              : `${eventPrice(event) === 0 ? '' : 'From '}${formatNaira(eventPrice(event))}`}
          </span>
          <span
            className={`grid place-items-center bg-emerald-500 text-emerald-950 transition group-hover:bg-emerald-300 ${compact ? 'h-8 w-8' : 'h-9 w-9'}`}
          >
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </a>
  );
}
