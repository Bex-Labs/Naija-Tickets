// End timestamps include their timezone, so overnight and multi-day events
// remain available until their actual finish time.
export function eventHasEnded(endsAt: string, now = Date.now()) {
  const end = Date.parse(endsAt);
  return !Number.isFinite(end) || end <= now;
}
