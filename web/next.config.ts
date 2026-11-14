import type { NextConfig } from "next";

// Pure front-end demo: `next build` emits a static site into ./out.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
