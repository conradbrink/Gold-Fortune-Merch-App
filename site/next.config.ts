import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root has its own lockfile; build this app from its own folder.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
