/**
 * x402 batch-settlement client — chain-agnostic, EVM + TRON, env-driven targets.
 *
 * Registers the `batch-settlement` client scheme for each configured chain and
 * wraps `fetch` so 402 challenges are paid automatically. Which chains/tokens to
 * exercise — and in what order — is controlled by `PAY_TARGETS`; for each target
 * it fires a burst of N requests (first opens a payment channel via one on-chain
 * deposit; the rest are off-chain vouchers) and optionally refunds that channel's
 * remaining balance. A mutable selector pins the payment pipeline to the current
 * target. This file imports no chain SDK directly.
 *
 * PAY_TARGETS — comma-separated, one burst (+refund) per entry, in order:
 *   <network>[@<token>]   network: "eip155:97"/"tron:0xcd8690dc" (or "eip155"/"tron");
 *   token: symbol or asset address; omit ⇒ the network's first advertised token.
 *   (`@` not `#` — dotenv treats `#` as a comment.)
 *   Unset ⇒ each configured chain once.
 */
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";
import type { BatchClientOptions, RefundableScheme } from "./env.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4041/weather";
const NUMBER_OF_REQUESTS = Number(process.env.NUMBER_OF_REQUESTS ?? "3");
const REFUND_AFTER = process.env.REFUND_AFTER_REQUESTS === "true";
const REFUND_AMOUNT = process.env.REFUND_AMOUNT?.trim() || undefined;

const opts: BatchClientOptions = {
  salt: (process.env.CHANNEL_SALT?.trim() ||
    "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`,
  depositMultiplier: Number(process.env.DEPOSIT_MULTIPLIER ?? "5"),
};

// Friendly token symbol → asset address, mirroring what the server advertises.
const TOKEN_ADDRESSES: Record<string, string> = {
  DHLU: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // eip155:97, ERC-3009
  USDC: "0x64544969ed7EBf5f083679233325356EbE738930", // eip155:97, permit2 (default)
  USDT: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // tron:0xcd8690dc, permit2 (default)
  USDD: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK", // tron:0xcd8690dc, permit2
};

/** A single payment target: a network prefix + optional asset address. */
interface PayTarget {
  raw: string;
  prefix: string;
  asset?: string;
}

/** Resolve a token tag (symbol or address) to an asset address. */
function resolveToken(token: string): string {
  return TOKEN_ADDRESSES[token.toUpperCase()] ?? token;
}

/** Parse the PAY_TARGETS env var into targets (empty when unset). */
function parsePayTargets(): PayTarget[] {
  const raw = process.env.PAY_TARGETS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const [prefix, token] = entry.split("@", 2);
      return { raw: entry, prefix: prefix!.trim(), asset: token ? resolveToken(token.trim()) : undefined };
    });
}

// When set, the selector pins payment to this target; the loop rotates it.
let target: PayTarget | null = null;
const client = new x402Client((_x402Version, accepts) => {
  const t = target;
  if (!t) return accepts[0]!;
  const match = accepts.find(
    a => a.network.startsWith(t.prefix) && (!t.asset || a.asset.toLowerCase() === t.asset.toLowerCase()),
  );
  if (!match) {
    throw new Error(`server offered no payment option matching "${t.raw}"`);
  }
  return match;
});

const evmSchemes = await registerEvm(client, opts);
const tronSchemes = await registerTron(client, opts);
const evm = evmSchemes.length > 0;
const tron = tronSchemes.length > 0;
// Refundable channel handles, keyed by their CAIP-2 network label.
const refundable: RefundableScheme[] = [...evmSchemes, ...tronSchemes];

// Default (PAY_TARGETS unset): each configured chain once.
let targets = parsePayTargets();
if (targets.length === 0) {
  if (evm) targets.push({ raw: "eip155", prefix: "eip155:" });
  if (tron) targets.push({ raw: "tron", prefix: "tron:" });
}
if (targets.length === 0) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}
for (const t of targets) {
  if (t.prefix.startsWith("eip155") && !evm) {
    console.error(`❌ target "${t.raw}" needs an EVM wallet, but none is configured.`);
    process.exit(1);
  }
  if (t.prefix.startsWith("tron") && !tron) {
    console.error(`❌ target "${t.raw}" needs a TRON wallet, but none is configured.`);
    process.exit(1);
  }
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

// For each target: open a channel + fire N requests, then refund that channel.
for (const t of targets) {
  target = t;
  console.log(`\n→ [${t.raw}] ${NUMBER_OF_REQUESTS}× GET ${RESOURCE_URL}\n`);
  // Capture which network actually settled (from PAYMENT-RESPONSE) so we refund
  // only that channel — not every registered scheme.
  let usedNetwork: string | undefined;
  for (let i = 1; i <= NUMBER_OF_REQUESTS; i++) {
    const t0 = performance.now();
    const res = await fetchWithPay(RESOURCE_URL, { method: "GET" });
    usedNetwork ??= networkFromPaymentResponse(res);
    const body = await res.json();
    const secs = ((performance.now() - t0) / 1000).toFixed(3);
    console.log(`request ${i}/${NUMBER_OF_REQUESTS} — ${res.status} in ${secs}s`);
    console.log(JSON.stringify(body, null, 2));
  }

  if (REFUND_AFTER) {
    const scheme = refundable.find(s => s.label === usedNetwork);
    if (!scheme) {
      console.log("\n↩️  nothing to refund (no settled payment captured)");
    } else {
      console.log(
        REFUND_AMOUNT
          ? `\n↩️  refunding ${REFUND_AMOUNT} base units on ${scheme.label}`
          : `\n↩️  refunding remaining channel balance on ${scheme.label}`,
      );
      const result = await scheme.refund(RESOURCE_URL, REFUND_AMOUNT ? { amount: REFUND_AMOUNT } : {});
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

/**
 * Reads the settled network from a paid response's `PAYMENT-RESPONSE` header
 * via the SDK decoder, or `undefined` if absent/unparseable.
 *
 * @param res - The response returned by the payment-wrapped fetch.
 * @returns The CAIP-2 network string, or `undefined`.
 */
function networkFromPaymentResponse(res: Response): string | undefined {
  const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    return decodePaymentResponseHeader(header).network;
  } catch {
    return undefined;
  }
}
