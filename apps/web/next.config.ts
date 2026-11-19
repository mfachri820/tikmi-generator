import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (see their "main" field), so
  // Next.js needs to transpile them itself rather than expecting built JS.
  transpilePackages: ["@tikmi/scoring", "@tikmi/template", "@tikmi/db", "@tikmi/ltdbb"],
};

export default nextConfig;
