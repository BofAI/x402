/**
 * x402 upto client — chain-agnostic, EVM + TRON, env-driven targets.
 *
 * Registers the `upto` client scheme for each configured chain and wraps `fetch`
 * so 402 challenges are paid automatically. Which chains/tokens to exercise — and
 * in what order — is controlled by `PAY_TARGETS`; for each target it fires N
 * usage-billed requests (each signs an authorization for up to the server's
 * advertised maximum; the server settles only the real usage it reports). A
 * mutable selector pins the payment pipeline to the current target. This file
 * imports no chain SDK directly.
 *
 * PAY_TARGETS — comma-separated, one run (N requests) per entry, in order:
 *   <network>[@<token>]   network: "eip155:97"/"tron:nile" (or "eip155"/"tron");
 *   token: symbol or asset address; omit ⇒ the network's first advertised token.
 *   (`@` not `#` — dotenv treats `#` as a comment.)
 *   Unset ⇒ each configured chain once.
 */
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4051/generate";
const NUMBER_OF_REQUESTS = Number(process.env.NUMBER_OF_REQUESTS ?? "3");

// Friendly token symbol → asset address, mirroring what the server advertises.
const TOKEN_ADDRESSES: Record<string, string> = {
  DHLU: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // eip155:97, ERC-3009
  USDC: "0x64544969ed7EBf5f083679233325356EbE738930", // eip155:97, permit2 (default)
  USDT: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // tron:nile, permit2 (default)
  USDD: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK", // tron:nile, permit2
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

const evm = (await registerEvm(client)).length > 0;
const tron = (await registerTron(client)).length > 0;

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

// For each target, fire N usage-billed requests.
for (const t of targets) {
  target = t;
  console.log(`\n→ [${t.raw}] ${NUMBER_OF_REQUESTS}× GET ${RESOURCE_URL}\n`);
  for (let i = 1; i <= NUMBER_OF_REQUESTS; i++) {
    const t0 = performance.now();
    const res = await fetchWithPay(RESOURCE_URL, { method: "GET" });
    const body = await res.json();
    const secs = ((performance.now() - t0) / 1000).toFixed(3);
    console.log(`request ${i}/${NUMBER_OF_REQUESTS} — ${res.status} in ${secs}s`);
    console.log(JSON.stringify(body, null, 2));
  }
}
