import { beforeAll, describe, expect, it, vi } from "vitest";
import { TronWeb, utils as tronUtils } from "tronweb";
import { createClientTronSigner, type ClientTronSigner } from "../../../src/signer";
import { privateKeyTronWallet } from "../helpers";
import { buildTronWeb } from "../../../src/rpc";

// Factory builds TronWeb internally; mock the builder to inject the seeded one.
vi.mock("../../../src/rpc", () => ({ buildTronWeb: vi.fn() }));
import { getTronChainId, normalizeAddressForSigning, tronAddressToEvm } from "../../../src/utils";
import {
  computeChannelId,
  getBatchSettlementTip712Domain,
} from "../../../src/shared/batch-settlement/utils";
import { getBatchSettlementAddress } from "../../../src/shared/batch-settlement/constants";
import { signVoucher } from "../../../src/batch-settlement/client/voucher";
import { verifyBatchSettlementVoucherTypedData } from "../../../src/batch-settlement/facilitator/utils";
import type { ChannelConfig } from "../../../src/batch-settlement/types";
import type { FacilitatorTronSigner } from "../../../src/signer";

/**
 * Offline correctness checks for the TRON batch-settlement digest layer.
 *
 * Proves: (1) `computeChannelId` matches a manual reconstruction using the
 * on-chain `CHANNEL_CONFIG_TYPEHASH` (verified against the deployed Nile
 * contract), and (2) a client-signed voucher verifies via the facilitator path.
 */

const NETWORK = "tron:3448148188";
const PAYER_PK = "da146374a75310b9666e834ee4ad0866d6f4035967bfc76217c5a495fff9f0d0";

// Read on-chain from the deployed Nile contract (CHANNEL_CONFIG_TYPEHASH()).
const ONCHAIN_CHANNEL_CONFIG_TYPEHASH =
  "0x1c9a06ceab9b0ebbd3301dc56c9111bb6d9af421356dc9ccb3b7084c755db308";

const E = tronUtils.ethersUtils;
const abi = E.defaultAbiCoder ?? new E.AbiCoder();
const k = (hex: string): string => E.keccak256(hex);
const kstr = (s: string): string => E.keccak256(E.toUtf8Bytes(s));

/** Minimal facilitator signer exposing only `verifyTypedData` (via tronweb). */
function verifyOnlyFacilitatorSigner(): FacilitatorTronSigner {
  return {
    getAddresses: () => [],
    async readContract() {
      throw new Error("not used");
    },
    async verifyTypedData(args) {
      const recovered = tronUtils.typedData.verifyTypedData(
        args.domain,
        args.types,
        args.message,
        args.signature,
      );
      return tronAddressToEvm(args.address) === tronAddressToEvm(recovered);
    },
    async writeContract() {
      throw new Error("not used");
    },
    async waitForTransactionReceipt() {
      return { status: "success" };
    },
  };
}

describe("batch-settlement digest (TRON)", () => {
  let signer: ClientTronSigner;
  let config: ChannelConfig;

  beforeAll(async () => {
    const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io", privateKey: PAYER_PK });
    vi.mocked(buildTronWeb).mockReturnValue(tronWeb);
    signer = await createClientTronSigner(privateKeyTronWallet(tronWeb, PAYER_PK), {
      network: NETWORK,
    });
    config = {
      payer: normalizeAddressForSigning(signer.address),
      payerAuthorizer: normalizeAddressForSigning(signer.address),
      receiver: "0x3333333333333333333333333333333333333333",
      receiverAuthorizer: "0x4444444444444444444444444444444444444444",
      token: "0x5555555555555555555555555555555555555555",
      withdrawDelay: 900,
      salt: `0x${"00".repeat(32)}` as `0x${string}`,
    };
  });

  it("local CHANNEL_CONFIG_TYPEHASH matches the deployed Nile contract", () => {
    const typehash = kstr(
      "ChannelConfig(address payer,address payerAuthorizer,address receiver,address receiverAuthorizer,address token,uint40 withdrawDelay,bytes32 salt)",
    );
    expect(typehash).toBe(ONCHAIN_CHANNEL_CONFIG_TYPEHASH);
  });

  it("computeChannelId matches a manual EIP-712 reconstruction", () => {
    const chainId = getTronChainId(NETWORK);
    const contractHex = normalizeAddressForSigning(getBatchSettlementAddress(NETWORK));

    const DOMAIN_TYPEHASH = kstr(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    );
    const domainSeparator = k(
      abi.encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [DOMAIN_TYPEHASH, kstr("x402 Batch Settlement"), kstr("1"), chainId, contractHex],
      ),
    );

    const structHash = k(
      abi.encode(
        ["bytes32", "address", "address", "address", "address", "address", "uint40", "bytes32"],
        [
          ONCHAIN_CHANNEL_CONFIG_TYPEHASH,
          config.payer,
          config.payerAuthorizer,
          config.receiver,
          config.receiverAuthorizer,
          config.token,
          config.withdrawDelay,
          config.salt,
        ],
      ),
    );

    const expected = k(E.concat(["0x1901", domainSeparator, structHash]));
    expect(computeChannelId(config, NETWORK)).toBe(expected);
  });

  it("a client-signed voucher verifies via the facilitator path", async () => {
    const channelId = computeChannelId(config, NETWORK);
    const voucher = await signVoucher(signer, channelId, "1000", NETWORK);
    const facilitator = verifyOnlyFacilitatorSigner();

    const ok = await verifyBatchSettlementVoucherTypedData(
      facilitator,
      {
        channelId,
        maxClaimableAmount: voucher.maxClaimableAmount,
        payerAuthorizer: config.payerAuthorizer,
        payer: config.payer,
        signature: voucher.signature,
      },
      NETWORK,
    );
    expect(ok).toBe(true);
  });

  it("rejects a voucher verified against the wrong amount", async () => {
    const channelId = computeChannelId(config, NETWORK);
    const voucher = await signVoucher(signer, channelId, "1000", NETWORK);
    const facilitator = verifyOnlyFacilitatorSigner();

    const ok = await verifyBatchSettlementVoucherTypedData(
      facilitator,
      {
        channelId,
        maxClaimableAmount: "2000",
        payerAuthorizer: config.payerAuthorizer,
        payer: config.payer,
        signature: voucher.signature,
      },
      NETWORK,
    );
    expect(ok).toBe(false);
  });

  it("uses the verified Nile TIP-712 domain", () => {
    const domain = getBatchSettlementTip712Domain(NETWORK);
    expect(domain.name).toBe("x402 Batch Settlement");
    expect(domain.version).toBe("1");
    expect(domain.chainId).toBe(getTronChainId(NETWORK));
  });
});
