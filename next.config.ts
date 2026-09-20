import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Vinext inspects multipart requests before API dispatch. Allow the 5 MB
    // image limit plus multipart overhead; upload handlers still enforce 5 MB.
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default nextConfig;
