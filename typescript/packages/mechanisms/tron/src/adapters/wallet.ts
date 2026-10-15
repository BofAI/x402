import { utils as tronUtils } from "tronweb";
import type { TronWeb } from "tronweb";
import {
  toClientTronSigner,
  toFacilitatorTronSigner,
  readTronContract,
  type ClientTronSignerWithRpc,
  type ClientTronWallet,
  type CreateClientTronSignerOptions,
  type TronAuthorizerSignerLike,
  type FacilitatorTronSigner,
  type FacilitatorTronWallet,
  type FacilitatorTronSignerOptions,
} from "../signer";
import { DEFAULT_FEE_LIMIT_SUN, PERMIT2_ADDRESSES, erc20ApproveAbi } from "../constants";
import { buildTronWeb } from "../rpc";
import { tronAddressToEvm } from "../utils";
import { normalizeTronNetwork, tronNetworksEqual } from "../network";
import { createTrc20ApprovalPolicy } from "../approvalPolicy";
import {
  buildAndSignContract,
  buildSignAndBroadcast,
  type WriteCapableTronWeb,
} from "../transactions/contracts";
import { serializeSignedTronTransaction } from "../transactions/signatures";
import { resolveConfirmationTimeoutMs, pollTransactionPacked } from "../transactions/receipt";
import { ensurePermit2Allowance, MAX_UINT256, APPROVE_FEE_LIMIT_SUN } from "./allowance";

type TronContractAbi = Parameters<TronWeb["contract"]>[0];
type TronContract = {
  methods: Record<
    string,
    ((...args: readonly unknown[]) => { call(): Promise<unknown> }) | undefined
  >;
};

/**
 * Creates a ClientTronSigner from a {@link ClientTronWallet}. The TronWeb client
 * (contract reads + approve broadcast) is built internally from `opts.network`.
 *
 * Wallet-only: the private key never enters the SDK. To sign with a raw key
 * (dev/test), wrap it in a wallet first.
 *
 * The returned signer always exposes {@link ClientTronSigner.ensureAllowance}
 * (used by the permit2 flow to broadcast the one-time `approve(Permit2)`, mirroring
 * the Python client). If the wallet cannot sign transactions, it throws only when
 * an approve is actually required — sign-only / pre-approved wallets still work.
 *
 * @param wallet - The wallet that signs typed data (and optionally transactions).
 * @param opts - Target network (+ optional RPC / API key / allowance mode).
 * @returns A ClientTronSigner backed by the wallet.
 *
 * @example
 * ```typescript
 * const signer = await createClientTronSigner(wallet, { network: "tron:3448148188" });
 * client.register("tron:*", new ExactTronScheme(signer));
 * ```
 */
export async function createClientTronSigner(
  wallet: ClientTronWallet,
  opts: CreateClientTronSignerOptions,
): Promise<ClientTronSignerWithRpc> {
  const tronWeb = buildTronWeb(opts.network, { rpcUrl: opts.rpcUrl, apiKey: opts.apiKey });
  const address = await wallet.getAddress();
  const base = toClientTronSigner(
    {
      address,
      // agent-wallet strips the 0x prefix, so a raw wallet breaks the
      // `0x${string}` contract; re-add it here so callers and ExactTronScheme
      // get a conforming signature without their own adapter. Mirrors
      // createClientEvmSigner.
      signTypedData: async args => {
        const sig = await wallet.signTypedData(args);
        return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
      },
    },
    tronWeb,
  );

  // Give the TronWeb instance a default issuer for builds/reads (no key needed).
  (tronWeb as unknown as WriteCapableTronWeb).setAddress(address);

  // ensureAllowance is always exposed: it reads the Permit2 allowance and, when
  // an approve is needed, broadcasts it via the wallet's signTransaction (the
  // permit2 path uses this; eip3009 never calls it). If the wallet can't sign
  // transactions, it throws a clear error only when an approve is actually
  // required — pre-approved sign-only wallets still work.
  const signTransaction = wallet.signTransaction?.bind(wallet);
  const approvalPolicy = opts.approvalPolicy ?? createTrc20ApprovalPolicy();

  return {
    ...base,
    network: normalizeTronNetwork(opts.network),
    approvalPolicy,
    ensureAllowance: async allowanceArgs => {
      if (!tronNetworksEqual(opts.network, allowanceArgs.network))
        throw new Error("approval_signer_network_mismatch");
      return ensurePermit2Allowance(
        {
          tronWeb,
          ownerAddress: address,
          signTransaction,
          readContract: args => readTronContract(base, args),
          approvalPolicy,
        },
        {
          ...allowanceArgs,
          network: normalizeTronNetwork(allowanceArgs.network),
          mode: allowanceArgs.mode ?? opts.allowanceMode,
        },
      );
    },
    ...(signTransaction
      ? {
          signPermit2Approval: async (args: {
            token: string;
            network: string;
            minimumLifetimeSeconds: number;
          }) => {
            if (!tronNetworksEqual(opts.network, args.network))
              throw new Error("approval_signer_network_mismatch");
            const network = normalizeTronNetwork(args.network);
            const permit2Address = PERMIT2_ADDRESSES[network];
            if (!permit2Address) {
              throw new Error(`No Permit2 contract address configured for network ${args.network}`);
            }
            const signed = await buildAndSignContract(
              tronWeb,
              address,
              signTransaction,
              {
                address: args.token,
                abi: erc20ApproveAbi as unknown as readonly Record<string, unknown>[],
                functionName: "approve",
                args: [permit2Address, MAX_UINT256],
              },
              {
                feeLimit: APPROVE_FEE_LIMIT_SUN,
                minimumLifetimeSeconds: args.minimumLifetimeSeconds,
              },
            );
            return serializeSignedTronTransaction(signed);
          },
        }
      : {}),
  };
}

/**
 * Creates a TRON authorizer signer (address + typed-data signing) from a wallet —
 * e.g. the batch-settlement `receiverAuthorizer`. No TronWeb is built (signing is
 * offline); the address is resolved eagerly and the `0x` prefix re-added.
 *
 * @param wallet - The wallet that holds the authorizer key.
 * @returns A signer satisfying batch-settlement's `TronAuthorizerSigner`.
 */
export async function createAuthorizerTronSigner(
  wallet: ClientTronWallet,
): Promise<TronAuthorizerSignerLike> {
  const address = await wallet.getAddress();
  return {
    address,
    signTypedData: async args => {
      const sig = await wallet.signTypedData(args);
      return `0x${sig.replace(/^0x/, "")}` as `0x${string}`;
    },
  };
}

/**
 * Creates a FacilitatorTronSigner from a {@link FacilitatorTronWallet}. The
 * TronWeb client (reads / verification / writes) is built internally from
 * `opts.network`.
 *
 * The transaction is built, handed to the wallet to sign (the private key never
 * enters the SDK), then broadcast — mirroring the production facilitator that
 * resolves a keystore-backed wallet unlocked out-of-band. For dev/test, wrap a
 * key in a wallet yourself (e.g. via TronWeb's `trx.sign`).
 *
 * @param wallet - The wallet that signs settlement transactions.
 * @param opts - Target network (+ optional RPC / API key / fee limit / permission id).
 * @returns A FacilitatorTronSigner backed by the wallet.
 *
 * @example
 * ```typescript
 * const signer = await createFacilitatorTronSigner(wallet, { network: "tron:3448148188" });
 * facilitator.register("tron:3448148188", new ExactTronScheme(signer));
 * ```
 */
export async function createFacilitatorTronSigner(
  wallet: FacilitatorTronWallet,
  opts: FacilitatorTronSignerOptions,
): Promise<FacilitatorTronSigner> {
  const tronWeb = buildTronWeb(opts.network, { rpcUrl: opts.rpcUrl, apiKey: opts.apiKey });
  const address = await wallet.getAddress();
  const feeLimit = opts.feeLimit ?? DEFAULT_FEE_LIMIT_SUN;
  const confirmationTimeoutMs = resolveConfirmationTimeoutMs(opts.confirmationTimeoutMs);

  // Reads and tx building need a default issuer address; set it without a key.
  (tronWeb as unknown as WriteCapableTronWeb).setAddress(address);

  return toFacilitatorTronSigner({
    address,
    async readContract(args) {
      const contract = (await tronWeb.contract(
        args.abi as unknown as TronContractAbi,
        args.address,
      )) as unknown as TronContract;
      const method = contract.methods[args.functionName];
      if (!method) {
        throw new Error(`Method ${args.functionName} not found on contract ${args.address}`);
      }
      return method(...args.args).call();
    },
    async verifyTypedData(args) {
      const mutableTypes = Object.fromEntries(
        Object.entries(args.types).map(([name, fields]) => [name, [...fields]]),
      );
      const recovered = tronUtils.typedData.verifyTypedData(
        args.domain,
        mutableTypes,
        args.message,
        args.signature,
      );

      return tronAddressToEvm(args.address) === tronAddressToEvm(recovered);
    },
    async writeContract(args) {
      // Build the tx, let the wallet sign it (the key never enters the SDK),
      // then broadcast. Mirrors bankofai TronFacilitatorSigner.writeContract.
      return buildSignAndBroadcast(tronWeb, address, tx => wallet.signTransaction(tx), args, {
        feeLimit,
        ...(opts.permissionId != null ? { permissionId: opts.permissionId } : {}),
      });
    },
    async waitForTransactionReceipt(args) {
      // Match the EVM signer behavior: wait for a low-latency execution receipt,
      // not consensus finality. Callers receive settlement_pending on timeout.
      return pollTransactionPacked(tronWeb, args.hash, confirmationTimeoutMs);
    },
  });
}
