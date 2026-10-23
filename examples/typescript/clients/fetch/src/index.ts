/**
 * TRON fetch client example using official x402 integrations.
 * TRON registration lives in src/chains/tron.ts; wallet keys remain in agent-wallet.
 */
import {
  normalizeTronNetwork,
  tronNetworksEqual,
  TRON_NILE,
  TRON_MAINNET,
  TRON_SHASTA,
} from "@bankofai/x402-tron";
import { type Network } from "@x402/core/types";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

import { registerTron } from "./chains/tron.js";

const RESOURCE_URL = process.env.RESOURCE_URL || "http://localhost:4021/weather";

// Friendly token symbol → asset address, mirroring what `servers/express`
// advertises. Lets PAY_TARGETS name tokens by symbol instead of address.
// Addresses are indexed by TRON network.
const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  [TRON_NILE]: {
    USDT: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // TRON_NILE, permit2
    USDD: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK", // TRON_NILE, permit2
  },
  [TRON_MAINNET]: {
    USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    USDD: "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
  },
  [TRON_SHASTA]: {
    USDT: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
  },
};

// These tokens are example-specific rather than SDK default assets. Opt them in
// explicitly and cap each payment at the amount advertised by servers/express.
// SDK default assets remain allowed under the default $1 spend limit.
const EXAMPLE_SPEND_CONTROL_ASSETS: Array<{
  network: Network;
  asset: string;
  maxAmountPerPayment: string;
}> = [
  {
    network: TRON_NILE,
    asset: TOKEN_ADDRESSES[TRON_NILE]!.USDD!,
    maxAmountPerPayment: "1000000000000000",
  },
  {
    network: TRON_MAINNET,
    asset: TOKEN_ADDRESSES[TRON_MAINNET]!.USDD!,
    maxAmountPerPayment: "1000000000000000",
  },
];

/** A single payment to perform: a network prefix + optional asset address. */
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

// When set, the selector pins payment to this target; the loop rotates it so
// each target is paid exactly once.
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
}).setSpendControls({ allowedAssets: EXAMPLE_SPEND_CONTROL_ASSETS });

const tron = await registerTron(client);

// Default (PAY_TARGETS unset): each configured chain once, first token.
let targets = parsePayTargets();
if (targets.length === 0) {
  if (tron) targets.push({ raw: "tron", prefix: "tron:" });
}
if (targets.length === 0) {
  console.error("❌ No wallet configured for TRON (see agent-wallet setup).");
  process.exit(1);
}

// A target's chain must have a configured wallet, or selection can't satisfy it.
for (const t of targets) {
  const needsTron = t.prefix.startsWith("tron");
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
  const body = await res.json();
  console.log(`← ${res.status} ${res.statusText}`);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    throw new Error(`request for target "${t.raw}" failed with HTTP ${res.status}`);
  }
}
