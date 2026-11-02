import type { NanoUsedBlockStore } from "./usedBlocks";

/**
 * The subset of a SQLite database {@link SqliteNanoUsedBlockStore} uses. Both
 * `better-sqlite3` and `node:sqlite`'s `DatabaseSync` fit; the package loads
 * neither, the program opens the database and passes it in.
 */
export interface NanoSqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
}

/**
 * Durable {@link NanoUsedBlockStore} on SQLite. One table, `x402_nano_used_blocks`,
 * with the block hash as PRIMARY KEY and the commitment UNIQUE, so one block
 * pays once and one payment is credited once, across restarts and across
 * processes sharing the file. Run the connection with `PRAGMA synchronous = FULL`
 * so a commit a power cut can undo is not a block accepted twice.
 */
export class SqliteNanoUsedBlockStore implements NanoUsedBlockStore {
  readonly persistent = true;
  private readonly select;
  private readonly insert;

  /**
   * Creates the table when missing.
   *
   * @param db - An open SQLite database.
   */
  constructor(db: NanoSqliteDatabase) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS x402_nano_used_blocks (" +
        "block_hash TEXT PRIMARY KEY, commitment TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    );
    this.select = db.prepare("SELECT 1 AS found FROM x402_nano_used_blocks WHERE block_hash = ?");
    this.insert = db.prepare(
      "INSERT INTO x402_nano_used_blocks (block_hash, commitment, created_at) VALUES (?, ?, ?)",
    );
  }

  /**
   * Check whether a block hash has been redeemed.
   *
   * @param hash - Uppercase block hash.
   * @returns Whether the hash was already redeemed.
   */
  has(hash: string): boolean {
    return this.select.get(hash) !== undefined;
  }

  /**
   * Record a block as paid.
   *
   * @param hash - Uppercase block hash.
   * @param commitment - The block's commitment account.
   * @returns `true` when newly recorded, `false` when the hash or commitment exists.
   */
  add(hash: string, commitment: string): boolean {
    try {
      this.insert.run(hash, commitment, Math.floor(Date.now() / 1000));
      return true;
    } catch (error) {
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (
        String(code ?? "").startsWith("SQLITE_CONSTRAINT") ||
        /constraint failed/i.test(String(message ?? ""))
      ) {
        return false;
      }
      throw error;
    }
  }
}
