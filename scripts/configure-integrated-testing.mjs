// Compatibility entry point. Single-project testing needs no separate test env.
if (process.argv.length > 2) {
  throw new Error(
    'Use npm run integrations:enable-testing in the main app. Separate sandbox environment arguments are no longer needed.',
  );
}
await import('./enable-single-project-testing.mjs');
