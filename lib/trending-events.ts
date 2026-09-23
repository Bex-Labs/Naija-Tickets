import type { Event } from './events.ts';

export function compareTrendingEvents(left: Event, right: Event) {
  return (
    (right.ticketsSold || 0) - (left.ticketsSold || 0) ||
    Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
    left.date.localeCompare(right.date) ||
    left.slug.localeCompare(right.slug)
  );
}

export function selectTrendingEvents(
  events: Event[],
  limit = 4,
  today = new Date().toLocaleDateString('en-CA'),
) {
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  return [...events]
    .filter((event) => event.date >= today && event.organiserVerified === true)
    .sort(compareTrendingEvents)
    .filter((event) => {
      if (
        (event.id ? seenIds.has(event.id) : false) ||
        seenSlugs.has(event.slug)
      ) {
        return false;
      }
      if (event.id) seenIds.add(event.id);
      seenSlugs.add(event.slug);
      return true;
    })
    .slice(0, Math.max(0, limit));
}
