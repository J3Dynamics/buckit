import type { NextConfig } from 'next';

// BUCKIT_STATIC=1 produces a static export for GitHub Pages (no API routes;
// the CI workflow removes app/api before building). Default build keeps the
// full server with /api/state and /api/events.
const isStatic = process.env.BUCKIT_STATIC === '1';

const nextConfig: NextConfig = isStatic
  ? {
      output: 'export',
      basePath: '/buckit',
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      // Bind-mounted volume (Windows/WSL2): inotify events don't propagate,
      // so dev file watching must poll for hot reload to work.
      webpack: (config, { dev }) => {
        if (dev) config.watchOptions = { poll: 800, aggregateTimeout: 200 };
        return config;
      },
    };

export default nextConfig;
