import { beforeAll, describe, expect, it } from "vitest";
import { TronWeb } from "tronweb";
import { ExactGasFreeScheme as ClientScheme } from "../../src/gasfree/client/scheme";
import { ExactGasFreeScheme as FacilitatorScheme } from "../../src/gasfree/facilitator/scheme";
import { createClientTronSigner, createFacilitatorTronSigner } from "../../src/signer";
import { privateKeyTronWallet } from "./helpers";
import { tronAddressToEvm } from "../../src/utils";
import type { ExactGasFreePayload } from "../../src/types";
import type { GasFreeAddressInfo, GasFreeProvider } from "../../src/shared/gasfree/api";

/**
 * Offline GasFree round-trip: the client signs a GasFreeController PermitTransfer
 * (TIP-712) and the facilitator verifies it via verifyTypedData — no network, no
 * relayer. If the GASFREE_TYPES order, domain, or address conversion ever drift,
 * verification fails here before any real submission.
 */

const NETWORK = "tron:nile";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";
const FACIL_PK = "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291";
const PAY_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const ASSET = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"; // Nile USDT
// Derive valid Base58Check addresses from fixed keys.
const PROVIDER = TronWeb.address.fromPrivateKey(
  "0000000000000000000000000000000000000000000000000000000000000003",
) as string;
const GASFREE_ADDR = TronWeb.address.fromPrivateKey(
  "0000000000000000000000000000000000000000000000000000000000000004",
) as string;

function mockApi(account: GasFreeAddressInfo, providers: GasFreeProvider[]) {
  return {
    getAddressInfo: async () => account,
    getProviders: async () => providers,
    getNonce: async () => account.nonce,
    getStatus: async () => null,
    waitForSuccess: async () => ({ txnHash: "0xabc" }) as never,
    submit: async () => "trace-1",
  };
}

describe("GasFree TIP-712 digest round-trip", () => {
  let payload: ExactGasFreePayload;
  let payerHex: string;
  let facilitator: FacilitatorScheme;

  beforeAll(async () => {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PAYER_PK });
    const clientSigner = await createClientTronSigner(
      tronWeb,
      privateKeyTronWallet(tronWeb, PAYER_PK),
    );
    payerHex = tronAddressToEvm(clientSigner.address);

    const account: GasFreeAddressInfo = {
      accountAddress: clientSigner.address,
      gasFreeAddress: GASFREE_ADDR,
      active: true,
      allowSubmit: true,
      nonce: 7,
      assets: [
        {
          tokenAddress: ASSET,
          tokenSymbol: "USDT",
          transferFee: "10000",
          activateFee: "0",
          decimal: 6,
          frozen: 0,
        },
      ],
    };
    const providers = [{ address: PROVIDER }] as unknown as GasFreeProvider[];

    const client = new ClientScheme(clientSigner, {
      apiClients: { [NETWORK]: mockApi(account, providers) as never },
    });

    const requirements = {
      scheme: "exact_gasfree",
      network: NETWORK,
      asset: ASSET,
      amount: "1000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 600,
      extra: { fee: { feeTo: PROVIDER, feeAmount: "10000" } },
    } as never;

    const result = await client.createPaymentPayload(2, requirements, {
      extensions: { skipBalanceCheck: true },
    });
    payload = result.payload as ExactGasFreePayload;

    const facWallet = {
      address: TronWeb.address.fromPrivateKey(FACIL_PK) as string,
      signTransaction: async () => ({}),
    };
    const facSigner = createFacilitatorTronSigner(tronWeb, facWallet);
    facilitator = new FacilitatorScheme(
      facSigner,
      { [NETWORK]: mockApi(account, providers) as never },
      {
        feeTo: PROVIDER,
        baseFee: { USDT: "10000" },
      },
    );
  });

  it("produces a self-contained GasFree message", () => {
    expect(payload.gasfree.user).toBeTruthy();
    expect(payload.gasfree.serviceProvider).toBe(PROVIDER);
    expect(payload.gasfree.receiver).toBe(PAY_TO);
    expect(payload.gasfree.value).toBe("1000");
    expect(payload.gasfree.maxFee).toBe("10000");
    expect(payload.gasfree.version).toBe("1");
    expect(payload.gasfree.nonce).toBe("7");
    expect(payload.gasfreeAddress).toBe(GASFREE_ADDR);
    expect(payload.signature.startsWith("0x")).toBe(true);
  });

  it("signs with the payer address", () => {
    expect(tronAddressToEvm(payload.gasfree.user)).toBe(payerHex);
  });

  it("verifies via the facilitator", async () => {
    const requirements = {
      scheme: "exact_gasfree",
      network: NETWORK,
      asset: ASSET,
      amount: "1000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 600,
      extra: {},
    } as never;
    const result = await facilitator.verify(
      { accepted: requirements, payload } as never,
      requirements,
    );
    expect(result.isValid).toBe(true);
  });

  it("rejects a tampered amount", async () => {
    const tampered = { ...payload, gasfree: { ...payload.gasfree, value: "999999" } };
    const requirements = {
      scheme: "exact_gasfree",
      network: NETWORK,
      asset: ASSET,
      amount: "1000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 600,
      extra: {},
    } as never;
    const result = await facilitator.verify(
      { accepted: requirements, payload: tampered } as never,
      requirements,
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_gasfree_signature");
  });
});
