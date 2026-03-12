import { describe, expect, it } from "vitest";
import {
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
} from "../../src/exact/client/permit2Helpers";
import { erc20AllowanceAbi } from "../../src/constants";

describe("TRON Permit2 helper APIs", () => {
  it("creates approval tx data for a configured network", () => {
    const tx = createPermit2ApprovalTx("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", "tron:nile");
    expect(tx.to).toBe("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf");
    expect(tx.data).toMatch(/^[0-9a-fA-F]+$/);
    expect(tx.data.length).toBeGreaterThan(8);
  });

  it("returns allowance read params for Permit2", () => {
    const params = getPermit2AllowanceReadParams({
      tokenAddress: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
      ownerAddress: "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR",
      network: "tron:nile",
    });

    expect(params.address).toBe("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf");
    expect(params.abi).toBe(erc20AllowanceAbi);
    expect(params.functionName).toBe("allowance");
    expect(params.args[0]).toBe("TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR");
  });
});
