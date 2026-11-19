import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (see their "main" field), so
  // Next.js needs to transpile them itself rather than expecting built JS.
  transpilePackages: ["@tikmi/scoring", "@tikmi/template", "@tikmi/db", "@tikmi/parser", "@tikmi/ingest", "@tikmi/pjp-master", "@tikmi/sumber-bi"],
  experimental: {
    serverActions: {
      // "Unggah file PSP" posts the workbook(s) to a server action. Vercel caps a request at 4.5 MB.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
