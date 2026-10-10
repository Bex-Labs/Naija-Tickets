import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ command, isPreview }) => {
  const isVercel = process.env.VERCEL === '1';

  // Local development and Vercel both need Node.js for native ticket PNG rendering.
  // Keep the worker configuration available only for explicit Cloudflare builds.
  if (isVercel || process.env.NAIJA_RUNTIME !== 'cloudflare') {
    // Vinext's own Node dev runner handles RSC/HMR. Nitro supplies production
    // builds; its custom dev runner conflicts with the RSC middleware here.
    const productionPlugins =
      command === 'build' || isPreview
        ? (await import('nitro/vite')).nitro()
        : [];

    return {
      css: {
        postcss: {
          plugins: [tailwindcss()],
        },
      },
      ssr: { external: ['sharp'] },
      plugins: [vinext(), productionPlugins],
    };
  }

  // Explicit OpenAI Sites/Cloudflare environment
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: {
          name: 'rsc',
          childEnvironments: ['ssr'],
        },
        config: localBindingConfig,
      }),
    ],
  };
});
