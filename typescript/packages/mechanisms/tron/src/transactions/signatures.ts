import { utils as tronUtils } from "tronweb";

/**
 * Normalize a wallet's signTransaction result into a broadcastable signed tx.
 *
 * Accepts an Agent Wallet 3 TRON artifact, a signed-tx object, a JSON string of one, or a raw signature hex
 * (mirrors agent-wallet's TronWallet, which returns a JSON-encoded signed tx).
 *
 * @param result - The wallet's signTransaction return value.
 * @param unsigned - The original unsigned transaction.
 * @returns A transaction object ready to broadcast.
 */
export function normalizeSignedTronTransaction(
  result: string | Record<string, unknown>,
  unsigned: Record<string, unknown>,
): Record<string, unknown> {
  const normalizeSignatures = (transaction: Record<string, unknown>): Record<string, unknown> => {
    const signatures = transaction.signature;
    if (!Array.isArray(signatures)) return transaction;
    return {
      ...transaction,
      signature: signatures.map(signature => {
        if (typeof signature !== "string") return signature;
        const prefix = signature.startsWith("0x") ? "0x" : "";
        const hex = signature.slice(prefix.length);
        if (!/^[0-9a-fA-F]{130}$/.test(hex)) return signature;
        const recovery = Number.parseInt(hex.slice(-2), 16);
        if (recovery !== 27 && recovery !== 28) return signature;
        return `${prefix}${hex.slice(0, -2)}${(recovery - 27).toString(16).padStart(2, "0")}`;
      }),
    };
  };

  if (typeof result !== "string") {
    if (result.family === "evm") {
      throw new Error("TRON signTransaction returned an EVM signed transaction artifact");
    }
    if (result.family === "tron") {
      const transaction = result.transaction;
      if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
        throw new Error("TRON signTransaction returned a malformed transaction artifact");
      }
      return normalizeSignatures(transaction as Record<string, unknown>);
    }
    return normalizeSignatures(result);
  }
  const trimmed = result.trim();
  if (trimmed.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `signTransaction returned a malformed JSON string: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (Array.isArray((parsed as { signature?: unknown }).signature)) {
      return normalizeSignatures({ ...unsigned, ...parsed });
    }
    return normalizeSignatures(parsed);
  }
  return normalizeSignatures({ ...unsigned, signature: [trimmed.replace(/^0x/, "")] });
}

/**
 * Serialize a signed TRON transaction object into its complete protobuf wire bytes.
 *
 * @param transaction - Wallet-signed TRON transaction object.
 * @returns Complete signed Transaction protobuf as lowercase hex.
 */
export function serializeSignedTronTransaction(transaction: Record<string, unknown>): string {
  const signatures = transaction.signature;
  if (!Array.isArray(signatures) || signatures.length !== 1 || typeof signatures[0] !== "string") {
    throw new Error("TRON Approval requires exactly one transaction signature");
  }
  const signature = signatures[0].replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{130}$/.test(signature)) {
    throw new Error("TRON Approval signature must be 65-byte hexadecimal");
  }

  const transactionPb = tronUtils.transaction.txJsonToPb(transaction) as {
    addSignature(bytes: Uint8Array): void;
    serializeBinary(): Uint8Array;
  };
  transactionPb.addSignature(Uint8Array.from(tronUtils.code.hexStr2byteArray(signature)));
  return tronUtils.code.byteArray2hexStr(transactionPb.serializeBinary()).toLowerCase();
}
