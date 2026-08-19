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
 *     <network>  matched by prefix: "eip155:97" / TRON_NILE (or "eip155" / "tron"
 *                when no token is specified)
 *     <token>    symbol (DHLU/USDC/USDT/USDD) or an asset address; omit ⇒ that
 *                network's first advertised token
 *   e.g. PAY_TARGETS=eip155:97@DHLU,TRON_NILE@USDT,TRON_NILE@USDD
 *   (`@` not `#` — dotenv treats `#` as a comment.)
 *   Unset ⇒ each configured chain once, with its first advertised token.
 */
import { TRON_NILE, TRON_MAINNET, TRON_SHASTA } from "@bankofai/x402-tron";
import {
  type Network,
  x402Client,
  wrapFetchWithPayment,
} from "@bankofai/x402-fetch";

import { registerEvm } from "./chains/evm.js";
import { registerTron } from "./chains/tron.js";

const RESOURCE_URL =
  process.env.RESOURCE_URL || "http://localhost:4021/weather";

// Friendly token symbol → asset address, mirroring what `servers/express`
// advertises. Lets PAY_TARGETS name tokens by symbol instead of address.
// Indexed by chain family so the same symbol can resolve differently per
// network (e.g. USDT on eip155:97 vs TRON_NILE are different contracts).
const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  "eip155:97": {
    DHLU: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // eip155:97, ERC-3009
    USDC: "0x64544969ed7EBf5f083679233325356EbE738930", // eip155:97, permit2
    USDT: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // eip155:97, permit2
  },
  "eip155:56": {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
  },
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
    network: "eip155:97" as const,
    asset: TOKEN_ADDRESSES["eip155:97"]!.DHLU!,
    maxAmountPerPayment: "1000",
  },
  {
    network: "eip155:97" as const,
    asset: TOKEN_ADDRESSES["eip155:97"]!.USDT!,
    maxAmountPerPayment: "1000000000000000",
  },
  {
    network: "eip155:56" as const,
    asset: TOKEN_ADDRESSES["eip155:56"]!.USDC!,
    maxAmountPerPayment: "1000000000000000",
  },
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

/** Parse the PAY_TARGETS env var into targets (empty when unset). */
function parsePayTargets(): PayTarget[] {
  const raw = process.env.PAY_TARGETS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [prefix, token] = entry.split("@", 2);
      return {
        raw: entry,
        prefix: prefix!.trim(),
        asset: token ? resolveToken(prefix!.trim(), token.trim()) : undefined,
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
    (a) =>
      a.network.startsWith(t.prefix) &&
      (!t.asset || a.asset.toLowerCase() === t.asset.toLowerCase()),
  );
  if (!match) {
    throw new Error(`server offered no payment option matching "${t.raw}"`);
  }
  return match;
}).setSpendControls({ allowedAssets: EXAMPLE_SPEND_CONTROL_ASSETS });

const evm = await registerEvm(client);
const tron = await registerTron(client);

// Default (PAY_TARGETS unset): each configured chain once, first token.
let targets = parsePayTargets();
if (targets.length === 0) {
  if (evm) targets.push({ raw: "eip155", prefix: "eip155:" });
  if (tron) targets.push({ raw: "tron", prefix: "tron:" });
}
if (targets.length === 0) {
  console.error(
    "❌ No wallet configured for EVM or TRON (see agent-wallet setup).",
  );
  process.exit(1);
}

// A target's chain must have a configured wallet, or selection can't satisfy it.
for (const t of targets) {
  const needsEvm = t.prefix.startsWith("eip155");
  const needsTron = t.prefix.startsWith("tron");
  if (needsEvm && !evm) {
    console.error(
      `❌ target "${t.raw}" needs an EVM wallet, but none is configured.`,
    );
    process.exit(1);
  }
  if (needsTron && !tron) {
    console.error(
      `❌ target "${t.raw}" needs a TRON wallet, but none is configured.`,
    );
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
    throw new Error(
      `request for target "${t.raw}" failed with HTTP ${res.status}`,
    );
  }
}
