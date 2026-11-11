
import type { NextConfig } from "next";

const backendUrl = (
  process.env.BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // Vercel Services handles API routing in production.
    if (process.env.VERCEL) {
      return [];
    }

    // Keep the local development API proxy.
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
