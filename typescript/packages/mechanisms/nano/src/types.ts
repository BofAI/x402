/**
 * Payload for the Nano `exact` scheme. The payer publishes its own send
 * block, so the only thing to hand over is the block hash.
 */
export interface ExactNanoPayload {
  /** 64-character hex hash of the payer's published send block. */
  blockHash: string;
}

/**
 * Wallet used by the client scheme. It publishes a send block from the
 * payer's account and resolves with the block hash. Key handling, work
 * generation and broadcasting stay inside the wallet.
 */
export interface ClientNanoWallet {
  /** The payer's `nano_` address. */
  readonly address: string;

  /**
   * Publish a send block.
   *
   * @param params - The send to publish.
   * @param params.to - Destination `nano_` address (`payTo`).
   * @param params.amountRaw - Amount in raw.
   * @param params.network - Network identifier, e.g. `nano:mainnet`.
   * @returns The hash of the published send block.
   */
  send(params: { to: string; amountRaw: bigint; network: string }): Promise<string>;
}

/** `contents` of a `block_info` response with `json_block: "true"`. */
export interface NanoBlockContents {
  type: string;
  account?: string;
  previous?: string;
  representative?: string;
  balance?: string;
  link?: string;
  link_as_account?: string;
  destination?: string;
  signature?: string;
  work?: string;
  subtype?: string;
}

/** Response of the node RPC `block_info` action with `json_block: "true"`. */
export interface NanoBlockInfo {
  block_account: string;
  amount?: string;
  balance?: string;
  height?: string;
  local_timestamp?: string;
  successor?: string;
  confirmed?: string | boolean;
  contents: NanoBlockContents;
  subtype?: string;
}

/** Minimal Nano node RPC used by the facilitator. */
export interface NanoRpcClient {
  /**
   * Run `block_info` for a block hash.
   *
   * @param hash - Block hash.
   * @returns The block info.
   */
  blockInfo(hash: string): Promise<NanoBlockInfo>;
}

/**
 * Check whether a value is a 64-character hex block hash.
 *
 * @param value - Candidate hash.
 * @returns Whether the value is a block hash.
 */
export function isNanoBlockHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Fa-f]{64}$/.test(value);
}
