import type { NextConfig } from "next";

const researchApi = (process.env.AQUA_RESEARCH_API_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");
const nextConfig: NextConfig = {
  images: { unoptimized: true },
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${researchApi}/api/:path*` }];
  },
};

export default nextConfig;
