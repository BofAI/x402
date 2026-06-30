import { defineConfig } from "tsup";

const baseConfig = {
  entry: {
    index: "src/index.ts",
    "exact/index": "src/exact/index.ts",
    "exact/client/index": "src/exact/client/index.ts",
    "exact/server/index": "src/exact/server/index.ts",
    "exact/facilitator/index": "src/exact/facilitator/index.ts",
    "upto/index": "src/upto/index.ts",
    "upto/client/index": "src/upto/client/index.ts",
    "upto/server/index": "src/upto/server/index.ts",
    "upto/facilitator/index": "src/upto/facilitator/index.ts",
    "gasfree/index": "src/gasfree/index.ts",
    "gasfree/client/index": "src/gasfree/client/index.ts",
    "gasfree/server/index": "src/gasfree/server/index.ts",
    "gasfree/facilitator/index": "src/gasfree/facilitator/index.ts",
    "batch-settlement/index": "src/batch-settlement/index.ts",
    "batch-settlement/client/index": "src/batch-settlement/client/index.ts",
    "batch-settlement/server/index": "src/batch-settlement/server/index.ts",
    "batch-settlement/facilitator/index": "src/batch-settlement/facilitator/index.ts",
  },
  dts: {
    resolve: true,
  },
  sourcemap: true,
  target: "es2020",
};

export default defineConfig([
  {
    ...baseConfig,
    format: "esm",
    outDir: "dist/esm",
    clean: true,
  },
  {
    ...baseConfig,
    format: "cjs",
    outDir: "dist/cjs",
    clean: false,
  },
]);
