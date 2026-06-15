import { describe, expect, it } from "vitest";
import * as tron from "../../src";

describe("@x402/tron exports", () => {
  it("exports mechanism helpers", () => {
    expect(tron.ExactTronScheme).toBeDefined();
    expect(tron.createClientTronSigner).toBeTypeOf("function");
    expect(tron.createFacilitatorTronClient).toBeTypeOf("function");
  });
});
