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
    canvas.width = 800;
    canvas.height = 2000;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser cannot export this ticket.');
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, 800, 2000);
    ctx.fillStyle = '#079669';
    ctx.fillRect(0, 0, 800, 115);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText('Naija Tickets', 48, 73);
    ctx.fillStyle = '#241b3f';
    let y = 175;
    for (const [value, font] of [
      [details.eventTitle, 'bold 32px sans-serif'],
      [details.eventDate, '22px sans-serif'],
      [details.venue, '22px sans-serif'],
      [`${details.ticketType} · Admit one`, 'bold 24px sans-serif'],
      [details.attendeeName, 'bold 26px sans-serif'],
    ]) {
      ctx.font = font;
      let line = '';
      for (const word of value.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 704 && line) {
          ctx.fillText(line, 48, y, 704);
          y += 39;
          line = word;
        } else line = next;
      }
      ctx.fillText(line, 48, y, 704);
      y += 57;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(230, y + 10, 340, 340);
    ctx.drawImage(image, 250, y + 30, 300, 300);
    ctx.fillStyle = '#241b3f';
    ctx.font = 'bold 25px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(details.displayCode, 400, y + 395);
    ctx.font = '20px sans-serif';
    ctx.fillText('Show this QR code at the entrance.', 400, y + 440);
    const cropped = document.createElement('canvas');
    cropped.width = 800;
    cropped.height = y + 485;
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
    <div className="no-print mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void share()}
        className="inline-flex min-h-11 items-center gap-2 border border-emerald-600/30 bg-white px-3 text-xs font-bold text-emerald-800 disabled:opacity-50"
      >
        <Share2 className="h-4 w-4" />
        {busy ? 'Preparing…' : 'Share ticket'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void share(true)}
        className="ml-2 inline-flex min-h-11 items-center gap-2 border border-emerald-600/30 bg-white px-3 text-xs font-bold text-emerald-800 disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        Save ticket
      </button>
      {notice && (
        <output className="mt-2 block text-xs text-slate-600">{notice}</output>
      )}
    </div>
  );
}
