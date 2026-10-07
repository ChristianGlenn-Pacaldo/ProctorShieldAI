import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

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
const allowedDevOrigins = Array.from(new Set([
  "localhost",
  "127.0.0.1",
  // Quick Tunnel hostnames rotate during physical-device testing. This option
  // is consumed only by the Next.js development server; production origins
  // remain governed by the deployed host and application security headers.
  "*.trycloudflare.com",
  ...(configuredDevOrigin ? [configuredDevOrigin] : []),
]));

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins,
  // Preserve face-api/COCO's single TensorFlow engine with modular packages.
  turbopack: {
    resolveAlias: {
      "@tensorflow/tfjs/dist/index.js": "./src/lib/tensorflow-browser.ts",
    },
  },
  webpack(config) {
    config.resolve.alias["@tensorflow/tfjs/dist/index.js$"] = fileURLToPath(
      new URL("./src/lib/tensorflow-browser.ts", import.meta.url),
    );
    return config;
  },
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
