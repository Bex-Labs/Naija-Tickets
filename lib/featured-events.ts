import type { Event } from './events.ts';

function compareEvents(left: Event, right: Event) {
  return (
    left.date.localeCompare(right.date) || left.slug.localeCompare(right.slug)
  );
}

export function selectFeaturedEvents(events: Event[], limit = 3) {
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  return [...events]
    .sort(compareEvents)
    .filter((event) => {
      if (
        !event.featured ||
        event.organiserVerified !== true ||
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

export function selectUpcomingEvents(
  events: Event[],
  featuredLimit = 3,
  upcomingLimit = 4,
) {
  const featured = selectFeaturedEvents(events, featuredLimit);
  const featuredIds = new Set(
    featured.flatMap((event) => (event.id ? [event.id] : [])),
  );
  const featuredSlugs = new Set(featured.map((event) => event.slug));
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  return [...events]
    .sort(compareEvents)
    .filter((event) => {
      if (
        (event.id ? featuredIds.has(event.id) : false) ||
        featuredSlugs.has(event.slug) ||
        (event.id ? seenIds.has(event.id) : false) ||
        seenSlugs.has(event.slug)
      ) {
        return false;
      }
      if (event.id) seenIds.add(event.id);
      seenSlugs.add(event.slug);
      return true;
    })
    .slice(0, Math.max(0, upcomingLimit));
}
