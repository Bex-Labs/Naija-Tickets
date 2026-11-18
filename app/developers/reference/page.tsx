import { publicIntegrationSpec } from '@/lib/integrations/public-spec';
export const metadata = { title: 'API reference' };
const errors = [
  ['400', 'Invalid fields, query, identifier or cursor'],
  ['401', 'Missing, revoked, expired or invalid key'],
  ['403', 'Missing permission or browser access denied'],
  ['404', 'Resource missing or not permitted'],
  ['409', 'Idempotency, reservation or state conflict'],
  ['410', 'Checkout/proof/replay expired'],
  ['413 / 415', 'Body too large or wrong content type'],
  ['429', 'Rate limited; honour Retry-After'],
  ['503', 'Disabled, isolated resources unavailable or configuration missing'],
];
export default function ApiReference() {
  const entries = Object.entries(publicIntegrationSpec.paths);
  return (
    <>
      <div className="max-w-3xl">
        <p className="eyebrow">Version 1</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
          API reference
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          Use your assigned deployment origin as the base URL. Secret-key
          endpoints are server-to-server. The public widget and OpenAPI routes
          have their own narrower browser rules. Integer monetary amounts are
          NGN kobo.
        </p>
        <a
          href="/api/v1/openapi.json"
          className="mt-4 inline-flex min-h-11 items-center bg-emerald-600 px-4 text-sm font-bold text-white"
        >
          Download OpenAPI 3.1
        </a>
        <p className="mt-3 text-xs leading-6 text-slate-500">
          The contract is assembled from implemented phase schemas. It excludes
          private administration and scheduler routes. Configuration/permissions
          and sandbox acceptance are separate from endpoint availability.
        </p>
      </div>
      <section className="mt-7 divide-y border-y border-[#241b3f]/15 bg-white">
        {entries.map(([path, value]) => {
          const item = value as Record<string, unknown>;
          return Object.entries(item)
            .filter(([method]) => ['get', 'post', 'options'].includes(method))
            .map(([method, raw]) => {
              const operation = raw as {
                summary?: string;
                description?: string;
                parameters?: {
                  name: string;
                  in: string;
                  required?: boolean;
                  description?: string;
                }[];
                security?: Record<string, unknown>[];
                responses?: Record<string, { description?: string }>;
              };
              return (
                <details
                  key={method + path}
                  className="group px-3 py-2 sm:px-5"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 py-3 text-left marker:hidden [&::-webkit-details-marker]:hidden">
                    <span
                      className={
                        'min-w-16 px-2 py-1 text-center font-mono text-xs font-bold ' +
                        (method === 'post'
                          ? 'bg-[#241b3f] text-white'
                          : 'bg-emerald-100 text-emerald-950')
                      }
                    >
                      {method.toUpperCase()}
                    </span>
                    <code className="min-w-0 flex-1 break-all text-xs font-bold sm:text-sm">
                      {path}
                    </code>
                    <span
                      aria-hidden="true"
                      className="text-lg text-emerald-800 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <div className="pb-5 text-sm leading-7">
                    <h2 className="font-black">{operation.summary}</h2>
                    <p className="mt-2 text-slate-600">
                      {operation.description ||
                        'See the downloadable schema for request and response fields.'}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-slate-600">
                      {operation.security?.length
                        ? 'Server credential / documented scope required'
                        : 'No secret API key; route-specific origin/proof checks apply'}
                    </p>
                    {!!operation.parameters?.length && (
                      <div className="mt-3 divide-y border-y">
                        {operation.parameters.map((parameter) => (
                          <div
                            key={parameter.in + parameter.name}
                            className="py-2 text-xs"
                          >
                            <code className="font-bold">{parameter.name}</code>
                            <span className="text-slate-500">
                              {' '}
                              · {parameter.in}
                              {parameter.required ? ' · required' : ''}
                            </span>
                            {parameter.description && (
                              <p className="mt-1 text-slate-600">
                                {parameter.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                      {Object.entries(operation.responses || {}).map(
                        ([status, response]) => (
                          <span key={status} title={response.description}>
                            <strong>{status}</strong>
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </details>
              );
            });
        })}
      </section>
      <section className="mt-8 max-w-4xl">
        <h2 className="text-2xl font-black">Responses and errors</h2>
        <pre className="mt-4 whitespace-pre-wrap break-all bg-[#241b3f] p-4 text-xs leading-6 text-emerald-100">
          {
            '{ "data": { … }, "meta": { "request_id": "…" } }\n{ "error": { "code": "INSUFFICIENT_SCOPE", "message": "…", "request_id": "…" } }'
          }
        </pre>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          Secret-key lists include meta.next_cursor. Save request IDs for
          support; omit secrets, QR/contact data and private links. Widget
          configuration uses its documented data envelope and X-Request-ID
          header.
        </p>
        <dl className="mt-4 divide-y border-y">
          {errors.map(([status, text]) => (
            <div
              key={status}
              className="grid grid-cols-[5rem_1fr] gap-3 py-2 text-sm"
            >
              <dt className="font-mono font-bold">{status}</dt>
              <dd className="text-slate-600">{text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
