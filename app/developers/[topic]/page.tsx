import { notFound } from 'next/navigation';
import { developerGuides } from '@/lib/integrations/developer-guides';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  return {
    title: Object.hasOwn(developerGuides, topic)
      ? developerGuides[topic].title
      : 'Guide unavailable',
  };
}
export default async function DeveloperGuidePage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  if (!Object.hasOwn(developerGuides, topic)) notFound();
  const guide = developerGuides[topic];
  return (
    <article className="max-w-4xl">
      <p className="eyebrow">Integration guide</p>
      <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight sm:text-5xl">
        {guide.title}
      </h1>
      <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
        {guide.intro}
      </p>
      <nav
        aria-label="On this page"
        className="mt-6 flex flex-wrap gap-x-4 border-y py-2"
      >
        {guide.sections.map((section, i) => (
          <a
            key={section.heading}
            href={'#step-' + i}
            className="py-2 text-xs font-bold text-emerald-800"
          >
            {section.heading}
          </a>
        ))}
      </nav>
      <div className="mt-8 space-y-9">
        {guide.sections.map((section, i) => (
          <section
            key={section.heading}
            id={'step-' + i}
            className="scroll-mt-6"
          >
            <h2 className="text-xl font-black sm:text-2xl">
              {section.heading}
            </h2>
            {section.body.map((text) => (
              <p key={text} className="mt-3 text-sm leading-7 text-slate-600">
                {text}
              </p>
            ))}
            {section.code && (
              <pre className="mt-4 max-w-full whitespace-pre-wrap break-words border border-[#241b3f]/10 bg-[#241b3f] p-4 font-mono text-xs leading-6 text-emerald-100 [overflow-wrap:anywhere] sm:p-5">
                <code>{section.code}</code>
              </pre>
            )}
          </section>
        ))}
      </div>
      <div className="mt-9 flex flex-wrap gap-5 border-t pt-5 text-sm font-bold text-emerald-800">
        <a className="min-h-11 py-3" href="/developers/reference">
          Browse the API reference →
        </a>
        <a className="min-h-11 py-3" href="/developers/readiness">
          Review deployment readiness →
        </a>
      </div>
    </article>
  );
}
