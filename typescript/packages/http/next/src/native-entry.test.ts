import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("native package entrypoints", () => {
  it("loads the built ESM entry without a bundler resolver", () => {
    const entry = new URL("../dist/esm/index.js", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(entry)})`],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
