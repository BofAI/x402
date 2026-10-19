/**
 * TRON upto client example using official x402 integrations.
 * TRON registration lives in src/chains/tron.ts; wallet keys remain in agent-wallet.
 */
import {
  normalizeTronNetwork,
  tronNetworksEqual,
  TRON_NILE,
  TRON_MAINNET,
  TRON_SHASTA,
} from "@bankofai/x402-tron";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

import { registerTron } from "./chains/tron.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4051/generate";
const NUMBER_OF_REQUESTS = Number(process.env.NUMBER_OF_REQUESTS ?? "3");

// Friendly token symbol → asset address, mirroring what the server advertises.
const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  [TRON_NILE]: {
    USDT: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // permit2 (default)
    USDD: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK", // permit2
  },
  [TRON_SHASTA]: {
    USDT: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", // permit2
  },
  [TRON_MAINNET]: {
    USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    USDD: "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
  },
};

/** A single payment target: a network prefix + optional asset address. */
interface PayTarget {
  raw: string;
  prefix: string;
  asset?: string;
}

/** Resolve a token tag (symbol or address) to an asset address. */
function resolveToken(prefix: string, token: string): string {
  const entry = TOKEN_ADDRESSES[prefix];
  if (!entry) {
    throw new Error(
      `Cannot resolve token "${token}": "${prefix}" is a family prefix. ` +
        `Use a full CAIP-2 network (e.g. ${TRON_NILE}) when specifying a token.`,
    );
  }
  const addr = entry[token.toUpperCase()];
  if (!addr) {
    throw new Error(
      `Unknown token symbol "${token}" for network "${prefix}". ` +
        `Use an asset address or a known symbol.`,
    );
  }
  return addr;
}

/** Match canonical TRON IDs and their deprecated hexadecimal aliases. */
function matchesNetwork(network: string, prefix: string): boolean {
  if (network.startsWith("tron:") && prefix.startsWith("tron:") && prefix !== "tron:") {
    return tronNetworksEqual(network, prefix);
  }
  return network.startsWith(prefix);
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
      if (prefix!.trim() !== "tron" && !prefix!.trim().startsWith("tron:")) {
        throw new Error(`Only TRON payment targets are supported: ${entry}`);
      }
      const normalizedPrefix = prefix!.trim().startsWith("tron:")
        ? normalizeTronNetwork(prefix!.trim())
        : prefix!.trim();
      return {
        raw: entry,
        prefix: normalizedPrefix,
        asset: token ? resolveToken(normalizedPrefix, token.trim()) : undefined,
      };
    });
}

// When set, the selector pins payment to this target; the loop rotates it.
let target: PayTarget | null = null;
const client = new x402Client((_x402Version, accepts) => {
  const t = target;
  if (!t) return accepts[0]!;
  const match = accepts.find(
    a =>
      matchesNetwork(a.network, t.prefix) &&
      (!t.asset || a.asset.toLowerCase() === t.asset.toLowerCase()),
  );
  if (!match) {
    throw new Error(`server offered no payment option matching "${t.raw}"`);
  }
  return match;
});

const tron = (await registerTron(client)).length > 0;

// Default (PAY_TARGETS unset): each configured chain once.
let targets = parsePayTargets();
if (targets.length === 0) {
  if (tron) targets.push({ raw: "tron", prefix: "tron:" });
}
if (targets.length === 0) {
  console.error("❌ No wallet configured for TRON (see agent-wallet setup).");
  process.exit(1);
}
for (const t of targets) {
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
    if (!res.ok) {
      throw new Error(
        `request ${i}/${NUMBER_OF_REQUESTS} for target "${t.raw}" failed with HTTP ${res.status}`,
      );
    }
  }
}
