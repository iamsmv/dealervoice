import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image on our Google Cloud VM.
  output: "standalone",
  experimental: {
    // Campaign CSV uploads are capped at 1 MB; leave room for the form's own overhead.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
