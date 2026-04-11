import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const appVersion = typeof packageJson.version === "string" && packageJson.version.trim().length > 0
  ? packageJson.version.trim()
  : "0.0.0";
const proxyTarget = process.env.API_PROXY_TARGET || "http://localhost:2455";
const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }
    return [
      { source: "/api/:path*", destination: `${proxyTarget}/api/:path*` },
      { source: "/v1/:path*", destination: `${proxyTarget}/v1/:path*` },
      { source: "/backend-api/:path*", destination: `${proxyTarget}/backend-api/:path*` },
      { source: "/health", destination: `${proxyTarget}/health` },
    ];
  },
};

export default nextConfig;
