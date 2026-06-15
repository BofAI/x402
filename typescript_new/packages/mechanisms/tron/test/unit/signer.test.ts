import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import { createClientTronSigner } from "../../src/signer";
import { createSignedTransfer, NOW, REQUIREMENTS } from "./helpers";

describe("TRON signer helpers", () => {
  it("shortens the default TronWeb expiration to maxTimeoutSeconds", async () => {
    const transaction = createSignedTransfer({ expiration: NOW + 120_000 });
    const adjusted = createSignedTransfer({ expiration: NOW + 60_000 });
    const tronWeb = {
      transactionBuilder: {
        triggerSmartContract: vi.fn(async () => ({
          result: { result: true },
          transaction,
        })),
        newTxID: vi.fn(async () => adjusted),
      },
      trx: {
        sign: vi.fn(async () => adjusted),
      },
    } as unknown as TronWeb;

    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const signer = createClientTronSigner(tronWeb, "1".padStart(64, "0"));
    const built = await signer.buildTransferTransaction(REQUIREMENTS, 50_000_000);

    expect(built).toBe(adjusted);
    expect(transaction.raw_data.expiration).toBe(NOW + 60_000);
    expect(tronWeb.transactionBuilder.newTxID).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
