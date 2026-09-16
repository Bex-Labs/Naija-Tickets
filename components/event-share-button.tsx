'use client';

import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

export function EventShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: `See ${title} on Naija Tickets`,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      window.prompt('Copy this event link', url);
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      aria-label={copied ? 'Event link copied' : 'Share event'}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 border border-[#241b3f]/10 bg-white px-3 text-sm font-bold transition hover:border-emerald-400 hover:bg-emerald-50"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-700" />
      ) : (
        <Share2 className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {copied ? 'Link copied' : 'Share'}
      </span>
    </button>
  );
}
