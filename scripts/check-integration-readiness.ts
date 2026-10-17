import { readFile } from 'node:fs/promises';
import { integrationReadiness } from '../lib/integrations/readiness.ts';
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !/^[A-Za-z0-9_./-]+[.]json$/.test(args[0])))
  throw new Error('Optional argument must be a local acceptance JSON path.');
let evidence: unknown = {};
try {
  evidence = JSON.parse(
    await readFile(
      args[0] ||
        new URL('../docs/integrations-acceptance.json', import.meta.url),
      'utf8',
    ),
  );
} catch {
  /* Missing/invalid evidence remains pending. */
}
const report = integrationReadiness(process.env, evidence);
console.info(JSON.stringify(report, null, 2));
process.exitCode = report.ready ? 0 : 1;
