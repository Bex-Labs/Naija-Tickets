# Page loading repair — 25 October 2026

## Public website

Chrome reported a failed dynamic import of the optional `site-visitor-tracker` bundle. Because the root layout rendered that client component directly, React replaced the entire page with its global error screen. The asset returned HTTP 200 with valid JavaScript when checked independently; the precise browser/network cause of the failed download was not established.

The root layout now renders `OptionalSiteFeatures`. It loads the existing counter after mounting and catches a failed import. Browsing and checkout can continue when analytics cannot load. Existing visitor privacy checks and server permissions remain in the existing counter.

The repair was built on the isolated production source used for the earlier email repair, retaining the font fix and Test-payment configuration. It was deployed and promoted as `dpl_2qrEN1Brt9jLAuTqUvNhJ2zrVzPy` at `https://naija-tickets.vercel.app/`.

Verified in the same Chrome tab that previously crashed: the homepage stays visible, navigation to the event catalogue succeeds, and eight upcoming events load. The prior fatal import/React errors did not recur after deployment.

## Localhost

The original development process was blocked reading a generated font stylesheet. macOS marked that file `dataless`, meaning its content was unavailable locally. After refreshing fonts, the server also timed out reading `app/globals.css`, which had the same flag.

- Preserved the stalled font cache at `.vinext/fonts-stalled-20261025` and restored the matching clean font cache.
- Preserved the old dependencies at `.vinext/dependencies-stalled-20261025` and installed a clean dependency copy from the identical `package-lock.json`.
- Located 16 offloaded tracked files, including the main stylesheet and images. Restored only unchanged files using bytes matching their Git object hashes. Preserved old stubs under `.vinext/recovered-source-stubs/`; skipped no files, and retained all dirty working edits.
- Restarted the main `npm run dev` server on port 3000. HTTP requests return 200; a warm homepage request completed in 110 ms in the server log. The browser loads the homepage and its event cards.

The backups are inside the existing ignored and TypeScript-excluded `.vinext` folder. A development-only hydration warning identifies attributes injected by the installed Grammarly extension; it does not prevent the page loading.

## Checks

- Production build passed for the page-loading change.
- TypeScript passed for the isolated deployment source and the current main working source.
- Focused lint/formatting checks and all five visitor-counter tests passed.
- Public and local pages were verified in Chrome beyond the initial server-rendered shell, including loaded event records.
- Screenshot evidence: `outputs/loading-repair-20261025/public-home.png`.

This repair does not roll out the pending integration database migrations. The earlier verified ticket-email repair remains included.
