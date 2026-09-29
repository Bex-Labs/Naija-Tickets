'use client';
import { useEffect, useState } from 'react';

export function MobileTicketButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const section = document.getElementById('tickets');
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  return (
    <a
      href="#tickets"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 bg-emerald-500 px-5 py-4 text-center font-bold text-emerald-950 shadow-xl transition-[opacity,transform,visibility] duration-200 motion-reduce:transition-none lg:hidden ${visible ? 'visible translate-y-0 opacity-100' : 'invisible pointer-events-none translate-y-3 opacity-0'}`}
    >
      Choose tickets
    </a>
  );
}
