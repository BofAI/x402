import { defineConfig } from "tsup";
const base = {
  entry: {
    index: "src/index.ts",
    "trc20-approval-resource-sponsoring/index": "src/trc20-approval-resource-sponsoring/index.ts",
    "trc20-approval-resource-sponsoring/client": "src/trc20-approval-resource-sponsoring/client.ts",
    "trc20-approval-resource-sponsoring/facilitator":
      "src/trc20-approval-resource-sponsoring/facilitator.ts",
    "trc20-approval-resource-sponsoring/resourceService":
      "src/trc20-approval-resource-sponsoring/resourceService.ts",
  },
  dts: { resolve: false },
  external: [/@x402\/core(?:\/.*)?$/, /@bankofai\/x402-tron(?:\/.*)?$/],
  splitting: true,
  sourcemap: true,
  target: "es2020",
};
export default defineConfig([
  { ...base, format: "esm", outDir: "dist/esm", clean: true },
  { ...base, format: "cjs", outDir: "dist/cjs", clean: true },
]);
