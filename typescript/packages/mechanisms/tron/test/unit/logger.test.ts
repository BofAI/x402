import { afterEach, describe, expect, it, vi } from "vitest";
import * as tron from "../../src";

afterEach(() => {
  tron.resetLogger?.();
  vi.restoreAllMocks();
});

describe("TRON package logger", () => {
  it("routes an already imported log handle through the current sink", () => {
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    tron.setLogger(sink);
    tron.log.info("payment", { network: "tron:3448148188" });
    expect(sink.info).toHaveBeenCalledWith("payment", { network: "tron:3448148188" });
    tron.setLogger(tron.noopLogger);
    tron.log.info("silenced");
    expect(sink.info).toHaveBeenCalledTimes(1);
  });
  it("restores the default console sink", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    tron.setLogger(tron.noopLogger);
    tron.resetLogger();
    tron.log.info("restored");
    expect(info).toHaveBeenCalledWith("restored");
  });
});
