import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.blitzrechnung.de',
      },
    ],
  },
  // Force the bundled PDF assets (fonts + sRGB ICC) into every API serverless
  // function so pdf-generator's runtime readFileSync resolves on Vercel instead
  // of relying on automatic file tracing.
  outputFileTracingIncludes: {
    '/api/**': ['./lib/assets/**/*'],
  },
};

export default nextConfig;
