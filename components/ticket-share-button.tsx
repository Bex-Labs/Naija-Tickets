'use client';

import { useState } from 'react';
import { Download, Share2 } from 'lucide-react';

type TicketDetails = {
  eventTitle: string;
  eventDate: string;
  venue: string;
  attendeeName: string;
  ticketType: string;
  displayCode: string;
};

// Export only this admission. Sharing the order URL would expose every ticket
// in the purchase to a group member.
async function ticketImage(qrId: string, details: TicketDetails) {
  const qr = document.getElementById(qrId);
  if (!qr) throw new Error('The ticket QR code is not available.');
  const qrUrl = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(qr)], {
      type: 'image/svg+xml',
    }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('The QR image could not be prepared.'));
      image.src = qrUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 2000;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser cannot export this ticket.');
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#079669';
    ctx.fillRect(0, 0, 1000, 72);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('Naija Tickets', 32, 47);
    ctx.fillStyle = '#241b3f';
    let y = 120;
    for (const [value, font] of [
      [details.eventTitle, 'bold 30px sans-serif'],
      [details.eventDate, '21px sans-serif'],
      [details.venue, '21px sans-serif'],
      [`${details.ticketType} · Admit one`, 'bold 23px sans-serif'],
      [details.attendeeName, 'bold 25px sans-serif'],
    ]) {
      ctx.font = font;
      let line = '';
      for (const word of value.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 560 && line) {
          ctx.fillText(line, 32, y, 560);
          y += 32;
          line = word;
        } else line = next;
      }
      ctx.fillText(line, 32, y, 560);
      y += 48;
    }
    const height = Math.max(500, y + 32);
    ctx.fillStyle = '#079669';
    ctx.fillRect(624, 72, 376, height - 72);
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(668, 108, 288, 288);
    ctx.drawImage(image, 684, 124, 256, 256);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 23px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(details.displayCode, 812, 430, 344);
    ctx.font = '17px sans-serif';
    ctx.fillText('Show this QR code at the entrance.', 812, 462, 344);
    const cropped = document.createElement('canvas');
    cropped.width = 1000;
    cropped.height = height;
    const croppedContext = cropped.getContext('2d');
    if (!croppedContext)
      throw new Error('Your browser cannot export this ticket.');
    croppedContext.drawImage(canvas, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      cropped.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('The ticket image could not be saved.')),
        'image/png',
      ),
    );
    return new File([blob], `${details.displayCode}.png`, {
      type: 'image/png',
    });
  } finally {
    URL.revokeObjectURL(qrUrl);
  }
}

export function TicketShareButton({
  qrId,
  ...details
}: TicketDetails & { qrId: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const share = async (downloadOnly = false) => {
    setBusy(true);
    setNotice('');
    try {
      const file = await ticketImage(qrId, details);
      if (
        !downloadOnly &&
        navigator.share &&
        navigator.canShare?.({ files: [file] })
      ) {
        setNotice('Choose where to share this individual ticket.');
        await navigator.share({
          files: [file],
          title: `${details.eventTitle} — ${details.attendeeName}`,
        });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice('Ticket image saved. Send this image to your guest.');
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        setNotice(
          error instanceof Error
            ? error.message
            : 'This ticket could not be shared.',
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="no-print flex flex-wrap justify-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void share()}
        className="inline-flex min-h-9 items-center gap-2 border border-emerald-600/30 bg-white px-2 text-[11px] font-bold text-emerald-800 disabled:opacity-50"
      >
        <Share2 className="h-4 w-4" />
        {busy ? 'Preparing…' : 'Share ticket'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void share(true)}
        className="inline-flex min-h-9 items-center gap-2 border border-emerald-600/30 bg-white px-2 text-[11px] font-bold text-emerald-800 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        Save ticket
      </button>
      {notice && (
        <output className="mt-2 block w-full text-xs text-emerald-50">
          {notice}
        </output>
      )}
    </div>
  );
}
