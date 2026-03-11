import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@bankofai/x402-core",
    "@bankofai/x402-evm",
    "@bankofai/x402-svm",
    "@bankofai/x402-aptos",
    "@bankofai/x402-stellar",
    "@bankofai/x402-next",
    "@bankofai/x402-extensions",
  ],
};

export default nextConfig;