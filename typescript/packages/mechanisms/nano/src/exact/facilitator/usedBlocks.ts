/**
 * Records the blocks that have paid, so one send block cannot be redeemed twice
 * and one payment cannot be credited by two blocks. A payment is identified by
 * its block hash and by its commitment (the `representative` the block carries),
 * and both are unique.
 *
 * Use a durable store shared by every facilitator process serving the same
 * `payTo`: a store that forgets on restart lets every old block be presented
 * again. {@link SqliteNanoUsedBlockStore} is a reference implementation.
 */
export interface NanoUsedBlockStore {
  /**
   * True when the store survives a restart. The facilitator refuses a store
   * that does not say so unless `allowInMemoryUsedBlocks` is set.
   */
  readonly persistent?: boolean;

  /**
   * Check whether a block hash has been redeemed.
   *
   * @param hash - Uppercase block hash.
   * @returns Whether the hash was already redeemed.
   */
  has(hash: string): boolean | Promise<boolean>;

  /**
   * Atomically record a block as paid: succeeds only when neither the hash nor
   * the commitment is present.
   *
   * @param hash - Uppercase block hash.
   * @param commitment - The block's commitment account (its `representative`).
   * @returns `true` when newly recorded, `false` when either was already present.
   */
  add(hash: string, commitment: string): boolean | Promise<boolean>;
}

/** Process-local {@link NanoUsedBlockStore}, for tests and single-process demos only. */
export class InMemoryNanoUsedBlockStore implements NanoUsedBlockStore {
  readonly persistent = false;
  private readonly hashes = new Set<string>();
  private readonly commitments = new Set<string>();

  /**
   * Check whether a block hash has been redeemed.
   *
   * @param hash - Uppercase block hash.
   * @returns Whether the hash was already redeemed.
   */
  has(hash: string): boolean {
    return this.hashes.has(hash);
  }

  /**
   * Record a block as paid.
   *
   * @param hash - Uppercase block hash.
   * @param commitment - The block's commitment account.
   * @returns `true` when newly recorded, `false` when either was already present.
   */
  add(hash: string, commitment: string): boolean {
    if (this.hashes.has(hash) || this.commitments.has(commitment)) {
      return false;
    }
    this.hashes.add(hash);
    this.commitments.add(commitment);
    return true;
  }
}
