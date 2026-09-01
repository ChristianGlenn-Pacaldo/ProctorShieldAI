import type { NextConfig } from "next";

const isFrontend = process.env.FRONTEND_ONLY === 'true';

const nextConfig: NextConfig = {
  output: "standalone",
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
