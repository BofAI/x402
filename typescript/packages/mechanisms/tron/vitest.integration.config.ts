import { resolve } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => ({
  test: {
    // Integration .env lives alongside the integration tests.
    env: loadEnv(mode, resolve(process.cwd(), "test/integrations"), ""),
    include: ["test/integrations/**/*.test.ts"], // Only include integration tests
    fileParallelism: false, // Prevent race conditions on tx nonces
  },
  plugins: [tsconfigPaths({ projects: ["."] })],
}));
