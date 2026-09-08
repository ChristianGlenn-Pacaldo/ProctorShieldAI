import type { NextConfig } from "next";

const isFrontend = process.env.FRONTEND_ONLY === 'true';

function getConfiguredDevOrigin(): string | undefined {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return undefined;

  try {
    return new URL(appUrl).hostname;
  } catch {
    return undefined;
  }
}

const configuredDevOrigin = getConfiguredDevOrigin();

const nextConfig: NextConfig = {
  output: "standalone",
  ...(configuredDevOrigin ? { allowedDevOrigins: [configuredDevOrigin] } : {}),
  ...(isFrontend ? { distDir: '.next-frontend' } : {}),
  async rewrites() {
    if (isFrontend) {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:5000/api/:path*',
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
