import { BadgeCheck } from 'lucide-react';

export function VerifiedOrganiserBadge({ verified }: { verified?: boolean }) {
  if (!verified) return null;
  return (
    <BadgeCheck
      className="inline-block h-5 w-5 shrink-0 fill-emerald-500 text-white"
      aria-label="Verified organiser"
    />
  );
}
