/**
 * Records block hashes that have already paid for a resource, so one send
 * block cannot be redeemed twice. Use a shared, durable implementation when
 * several facilitator processes serve the same `payTo`.
 */
export interface NanoUsedBlockStore {
  /**
   * Check whether a block hash has been redeemed.
   *
   * @param hash - Uppercase block hash.
   * @returns Whether the hash was already redeemed.
   */
  has(hash: string): boolean | Promise<boolean>;

  /**
   * Atomically mark a block hash as redeemed.
   *
   * @param hash - Uppercase block hash.
   * @returns `true` when newly marked, `false` when it was already present.
   */
  add(hash: string): boolean | Promise<boolean>;
}

/** Process-local {@link NanoUsedBlockStore}, suitable for a single process. */
export class InMemoryNanoUsedBlockStore implements NanoUsedBlockStore {
  private readonly hashes = new Set<string>();

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
   * Mark a block hash as redeemed.
   *
   * @param hash - Uppercase block hash.
   * @returns `true` when newly marked, `false` when it was already present.
   */
  add(hash: string): boolean {
    if (this.hashes.has(hash)) {
      return false;
    }
    this.hashes.add(hash);
    return true;
  }
}
