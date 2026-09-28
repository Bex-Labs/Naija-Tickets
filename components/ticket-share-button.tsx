'use client';

import { useState } from 'react';
import { Download, Printer, Share2 } from 'lucide-react';

// Export the displayed artwork itself, never redraw it or share an order URL.
// That keeps the design identical and shares only this attendee's admission.
export async function ticketImage(artworkId: string, displayCode: string) {
  const artwork = document.getElementById(artworkId);
  if (!(artwork instanceof SVGSVGElement))
    throw new Error('The ticket is not ready. Please try again.');
  const width = artwork.viewBox.baseVal.width;
  const height = artwork.viewBox.baseVal.height;
  const source = new XMLSerializer().serializeToString(artwork);
  const url = URL.createObjectURL(
    new Blob([source], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('The ticket image could not be prepared.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width * 3;
    canvas.height = height * 3;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot export this ticket.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('The ticket image could not be saved.')),
        'image/png',
      ),
    );
    return new File([blob], `${displayCode}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function TicketShareButton({
  artworkId,
  eventTitle,
  attendeeName,
  displayCode,
  canShare = true,
}: {
  artworkId: string;
  eventTitle: string;
  attendeeName: string;
  displayCode: string;
  canShare?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const share = async (downloadOnly = false) => {
    setBusy(true);
    setNotice('');
    try {
      const file = await ticketImage(artworkId, displayCode);
      if (
        !downloadOnly &&
        navigator.share &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: `${eventTitle} — ${attendeeName}`,
        });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(
          downloadOnly
            ? 'Ticket saved.'
            : 'Ticket saved. You can send this image to your guest.',
        );
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
  const print = () => {
    document
      .querySelectorAll('.issued-ticket-record[data-print-selected]')
      .forEach((record) => record.removeAttribute('data-print-selected'));
    document.body.dataset.printTicket = artworkId;
    const record = document
      .getElementById(artworkId)
      ?.closest('.issued-ticket-record');
    record?.setAttribute('data-print-selected', 'true');
    const clear = () => {
      delete document.body.dataset.printTicket;
      record?.removeAttribute('data-print-selected');
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    try {
      window.print();
    } catch {
      clear();
      setNotice('Printing is unavailable. Save your ticket instead.');
    }
  };
  const buttonClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50';
  return (
    <fieldset className="no-print mt-4 flex min-w-0 flex-wrap items-center justify-end gap-3">
      <legend className="sr-only">Actions for {attendeeName}’s ticket</legend>
      <button
        type="button"
        onClick={print}
        className={`${buttonClass} border-emerald-700/20 bg-white text-emerald-800 hover:bg-emerald-50`}
      >
        <Printer className="h-4 w-4" />
        Print ticket
      </button>
      {canShare && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void share()}
            className={`${buttonClass} border-emerald-700/20 bg-white text-emerald-800 hover:bg-emerald-50`}
          >
            <Share2 className="h-4 w-4" />
            {busy ? 'Preparing…' : 'Share ticket'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void share(true)}
            className={`${buttonClass} border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}
          >
            <Download className="h-4 w-4" />
            Save ticket
          </button>
        </>
      )}
      {notice && (
        <output className="w-full text-right text-sm text-slate-600">
          {notice}
        </output>
      )}
    </fieldset>
  );
}
