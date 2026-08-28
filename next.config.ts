import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs"],
  outputFileTracingIncludes: {
    "/api/pdf": ["./lib/pdf/templates/**/*"],
  },
};

export default nextConfig;
