/**
 * x402 fetch client — chain-agnostic, EVM + TRON, env-driven targets.
 *
 * Registers EVM and TRON `exact` schemes (each gated on a configured wallet) and
 * wraps `fetch` so 402 challenges are paid automatically. Which chains/tokens to
 * pay — and in what order — is controlled by the `PAY_TARGETS` env var; each
 * target is paid exactly once. A mutable selector pins the payment-selection
 * pipeline to the current target's network + asset. This file imports no chain
 * SDK directly.
 *
 * PAY_TARGETS — comma-separated, one payment per entry, in order:
 *   <network>[@<token>]
 *     <network>  matched by prefix: "eip155:97" / "tron:nile" (or "eip155" / "tron")
 *     <token>    symbol (DHLU/USDC/USDT/USDD) or an asset address; omit ⇒ that
 *                network's first advertised token
 *   e.g. PAY_TARGETS=eip155:97@DHLU,tron:nile@USDT,tron:nile@USDD
 *   (`@` not `#` — dotenv treats `#` as a comment.)
 *   Unset ⇒ each configured chain once, with its first advertised token.
 */
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4021/weather";

// Friendly token symbol → asset address, mirroring what `servers/express`
// advertises. Lets PAY_TARGETS name tokens by symbol instead of address.
const TOKEN_ADDRESSES: Record<string, string> = {
  DHLU: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // eip155:97, ERC-3009
  USDC: "0x64544969ed7EBf5f083679233325356EbE738930", // eip155:97, permit2
  USDT: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // tron:nile, permit2
  USDD: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK", // tron:nile, permit2
};

/** A single payment to perform: a network prefix + optional asset address. */
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

// When set, the selector pins payment to this target; the loop rotates it so
// each target is paid exactly once.
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

const evm = await registerEvm(client);
const tron = await registerTron(client);

// Default (PAY_TARGETS unset): each configured chain once, first token.
let targets = parsePayTargets();
if (targets.length === 0) {
  if (evm) targets.push({ raw: "eip155", prefix: "eip155:" });
  if (tron) targets.push({ raw: "tron", prefix: "tron:" });
}
if (targets.length === 0) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

// A target's chain must have a configured wallet, or selection can't satisfy it.
for (const t of targets) {
  const needsEvm = t.prefix.startsWith("eip155");
  const needsTron = t.prefix.startsWith("tron");
  if (needsEvm && !evm) {
    console.error(`❌ target "${t.raw}" needs an EVM wallet, but none is configured.`);
    process.exit(1);
  }
  if (needsTron && !tron) {
    console.error(`❌ target "${t.raw}" needs a TRON wallet, but none is configured.`);
    process.exit(1);
  }
}

const fetchWithPay = wrapFetchWithPayment(fetch, client);

// Pay the resource once per target, in order.
for (const t of targets) {
  target = t;
  console.log(`\n→ [${t.raw}] GET ${RESOURCE_URL}`);
  const res = await fetchWithPay(RESOURCE_URL);
  console.log(`← ${res.status} ${res.statusText}`);
  console.log(JSON.stringify(await res.json(), null, 2));
}
