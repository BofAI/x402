import { TronWeb, utils as tronUtils } from "tronweb";
import { tronAddressToEvm } from "./utils";

/**
 * Signer interface for TRON client operations.
 *
 * The client signer creates TIP-712 signatures for TransferWithAuthorization
 * or Permit2 PermitWitnessTransferFrom.
 * Addresses can be in TRON Base58Check or EVM hex format;
 * they are normalized to EVM hex for signing.
 */
export interface ClientTronSigner {
  /**
   * The TRON address (Base58Check format) or EVM hex address of the signer.
   */
  address: string;

  /**
   * Sign EIP-712/TIP-712 typed data.
   * The domain and message addresses should already be in EVM hex format.
   */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;

  /**
   * Read data from a smart contract.
   */
  readContract(args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

/**
 * Signer interface for TRON facilitator operations.
 *
 * The facilitator signer verifies TIP-712 signatures and executes
 * on-chain contract calls for payment settlement.
 */
export interface FacilitatorTronSigner {
  /**
   * Get all facilitator addresses (for multi-address/load-balanced setups).
   */
  getAddresses(): readonly string[];

  /**
   * Read data from a smart contract.
   */
  readContract(args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;

  /**
   * Verify a TIP-712 typed data signature.
   * Returns true if the signature was made by the specified address.
   */
  verifyTypedData(args: {
    address: string;
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
  }): Promise<boolean>;

  /**
   * Execute a contract write call.
   */
  writeContract(args: {
    address: string;
    abi: readonly Record<string, unknown>[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<string>;

  /**
   * Wait for a transaction to be confirmed on-chain.
   */
  waitForTransactionReceipt(args: { hash: string }): Promise<{ status: string }>;
}

type ReadContractCapable = Pick<ClientTronSigner, "readContract">;
type TronContractAbi = Parameters<TronWeb["contract"]>[0];
type TronContractMethod = (...args: readonly unknown[]) => {
  call(): Promise<unknown>;
  send(): Promise<string | { txid?: string }>;
};
type TronContract = {
  methods: Record<string, TronContractMethod | undefined>;
};
type TronTxInfo = {
  receipt?: {
    result?: string;
  };
};

/**
 * Normalizes a TRON private key to the hex format expected by TronWeb helpers.
 *
 * @param privateKey - The private key, with or without a `0x` prefix.
 * @returns The hex private key without a `0x` prefix.
 */
function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/^0x/, "");
}

/**
 * Resolves the default TRON address for a TronWeb instance and private key.
 *
 * @param tronWeb - The TronWeb instance to inspect.
 * @param privateKey - The facilitator or client private key.
 * @returns The base58 TRON address associated with the signer.
 */
function resolveBase58Address(tronWeb: TronWeb, privateKey: string): string {
  const configuredAddress = tronWeb.defaultAddress?.base58;
  if (typeof configuredAddress === "string" && configuredAddress.length > 0) {
    return configuredAddress;
  }
  const resolved = tronWeb.address.fromPrivateKey(normalizePrivateKey(privateKey));
  if (!resolved || typeof resolved !== "string") {
    throw new Error("Unable to derive TRON address from private key.");
  }
  return resolved;
}

/**
 * Composes a ClientTronSigner from a signer-like object and an optional TronWeb instance.
 *
 * Use this when your signer can sign typed data but does not expose a contract read helper.
 * If `signer.readContract` is missing, `tronWeb` is required and will be used to satisfy reads.
 *
 * @param signer - The signer-like object to adapt.
 * @param tronWeb - An optional TronWeb instance used to supply contract reads.
 * @returns A fully-formed ClientTronSigner.
 */
export function toClientTronSigner(
  signer: Omit<ClientTronSigner, "readContract"> & {
    readContract?: ClientTronSigner["readContract"];
  },
  tronWeb?: TronWeb,
): ClientTronSigner {
  const readContract =
    signer.readContract ??
    (tronWeb
      ? async (args: Parameters<ReadContractCapable["readContract"]>[0]) => {
          const contract = (await tronWeb.contract(
            args.abi as unknown as TronContractAbi,
            args.address,
          )) as unknown as TronContract;
          const method = contract.methods[args.functionName];
          if (!method) {
            throw new Error(`Method ${args.functionName} not found on contract ${args.address}`);
          }
          return method(...args.args).call();
        }
      : undefined);

  if (!readContract) {
    throw new Error(
      "toClientTronSigner requires either a signer with readContract or a TronWeb instance.",
    );
  }

  return {
    address: signer.address,
    signTypedData: args => signer.signTypedData(args),
    readContract,
  };
}

/**
 * Wraps a single-address facilitator client into a FacilitatorTronSigner.
 *
 * This matches the EVM helper shape and is useful when your facilitator already
 * implements the TRON write/read/verify methods but exposes only `address`.
 *
 * @param signer - The facilitator-like signer to adapt.
 * @returns A FacilitatorTronSigner with a `getAddresses()` implementation.
 */
export function toFacilitatorTronSigner(
  signer: Omit<FacilitatorTronSigner, "getAddresses"> & { address: string },
): FacilitatorTronSigner {
  return {
    ...signer,
    getAddresses: () => [signer.address],
  };
}

/**
 * Creates a ClientTronSigner directly from a TronWeb instance and private key.
 *
 * @param tronWeb - The TronWeb instance used for signing and reads.
 * @param privateKey - The private key used to sign typed data.
 * @returns A ClientTronSigner backed by TronWeb.
 */
export function createClientTronSigner(tronWeb: TronWeb, privateKey: string): ClientTronSigner {
  const address = resolveBase58Address(tronWeb, privateKey);

  return toClientTronSigner(
    {
      address,
      async signTypedData(args) {
        const cleanKey = normalizePrivateKey(privateKey);
        const signature = await tronWeb.trx._signTypedData(
          args.domain,
          args.types,
          args.message,
          cleanKey,
        );
        return signature as `0x${string}`;
      },
    },
    tronWeb,
  );
}

/**
 * Creates a FacilitatorTronSigner directly from a TronWeb instance and private key.
 *
 * @param tronWeb - The TronWeb instance used for reads, verification, and writes.
 * @param privateKey - The private key whose address is used as the facilitator identity.
 * @returns A FacilitatorTronSigner backed by TronWeb.
 */
export function createFacilitatorTronSigner(
  tronWeb: TronWeb,
  privateKey: string,
): FacilitatorTronSigner {
  const address = resolveBase58Address(tronWeb, privateKey);

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
      const recovered = tronUtils.typedData.verifyTypedData(
        args.domain,
        args.types,
        args.message,
        args.signature,
      );

      return tronAddressToEvm(args.address) === tronAddressToEvm(recovered);
    },
    async writeContract(args) {
      const contract = (await tronWeb.contract(
        args.abi as unknown as TronContractAbi,
        args.address,
      )) as unknown as TronContract;
      const method = contract.methods[args.functionName];
      if (!method) {
        throw new Error(`Method ${args.functionName} not found on contract ${args.address}`);
      }
      const txId = await method(...args.args).send();
      return typeof txId === "string" ? txId : ((txId as { txid?: string }).txid ?? String(txId));
    },
    async waitForTransactionReceipt(args) {
      const maxAttempts = 30;
      const delayMs = 1000;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const receipt = (await tronWeb.trx.getTransactionInfo(args.hash)) as TronTxInfo | null;
        const result = receipt?.receipt?.result;

        if (result === "SUCCESS") {
          return { status: "success" };
        }
        if (result && result !== "SUCCESS") {
          return { status: "reverted" };
        }

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      return { status: "pending" };
    },
  });
}
