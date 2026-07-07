/**
 * x402 MCP client — dual-chain (BSC testnet + TRON Nile), env-driven targets.
 *
 * Connects to an MCP server over SSE and calls its tools. When the paid tool
 * returns a 402, the SDK pays automatically. Which chains/tokens to exercise —
 * and in what order — is controlled by `PAY_TARGETS`; the paid tool is called
 * once per target. A mutable selector pins the payment pipeline to the current
 * target, so EVM and TRON (and per-token, e.g. USDT vs USDD) each settle exactly
 * once. Each chain registers only when its agent-wallet resolves. Per-chain setup
 * lives in `src/chains/`.
 *
 * PAY_TARGETS — comma-separated, one paid call per entry, in order:
 *   <network>[@<token>]   network: "eip155:97"/"tron:0xcd8690dc" (or "eip155"/"tron");
 *   token: symbol (DHLU on EVM; USDT/USDD on TRON) or an asset address; omit ⇒
 *   the network's first advertised token.
 *   (`@` not `#` — dotenv treats `#` as a comment.)
 *   Unset ⇒ each configured chain once.
 *
 * Pair with `servers/mcp` and `facilitator/basic`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { x402Client, wrapMCPClientWithPayment } from "@bankofai/x402-mcp";

import { evmSchemes } from "./chains/evm.js";
import { tronSchemes } from "./chains/tron.js";

const SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:4023";

// Friendly token symbol → asset address, mirroring what `servers/mcp` advertises.
const TOKEN_ADDRESSES: Record<string, string> = {
  DHLU: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816", // eip155:97, ERC-3009
  USDC: "0x64544969ed7EBf5f083679233325356EbE738930", // eip155:97, permit2
  USDT: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // tron:0xcd8690dc, permit2
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

const evm = await evmSchemes();
const tron = await tronSchemes();
const schemes = [...evm, ...tron];
if (schemes.length === 0) {
  console.error("❌ No wallet configured for EVM or TRON (see agent-wallet setup).");
  process.exit(1);
}

// When set, the selector pins payment to this target; the loop rotates it.
let target: PayTarget | null = null;
const paymentClient = new x402Client((_x402Version, accepts) => {
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
for (const s of schemes) {
  paymentClient.register(s.network, s.client);
}

// Default (PAY_TARGETS unset): each configured chain once.
let targets = parsePayTargets();
if (targets.length === 0) {
  if (evm.length > 0) targets.push({ raw: "eip155", prefix: "eip155:" });
  if (tron.length > 0) targets.push({ raw: "tron", prefix: "tron:" });
}
for (const t of targets) {
  if (t.prefix.startsWith("eip155") && evm.length === 0) {
    console.error(`❌ target "${t.raw}" needs an EVM wallet, but none is configured.`);
    process.exit(1);
  }
  if (t.prefix.startsWith("tron") && tron.length === 0) {
    console.error(`❌ target "${t.raw}" needs a TRON wallet, but none is configured.`);
    process.exit(1);
  }
}

const mcpClient = new Client({ name: "x402-mcp-dual-chain-client", version: "1.0.0" });
const x402Mcp = wrapMCPClientWithPayment(mcpClient, paymentClient, {
  autoPayment: true,
  onPaymentRequested: async context => {
    console.log(`\n💰 Payment required for tool: ${context.toolName} (target ${target?.raw})`);
    return true; // approve
  },
});

const transport = new SSEClientTransport(new URL(`${SERVER_URL}/sse`));
await x402Mcp.connect(transport);
console.log(`✅ Connected to MCP server at ${SERVER_URL}`);

const tools = await x402Mcp.listTools();
console.log(
  "📋 Tools:",
  tools.tools.map(t => t.name).join(", "),
);

// Free tool — no payment.
const ping = await x402Mcp.callTool("ping");
console.log("\n🆓 ping →", ping.content[0]?.text, `(paymentMade=${ping.paymentMade})`);

// Paid tool — once per target.
for (const t of targets) {
  target = t;
  const weather = await x402Mcp.callTool("get_weather", { city: "San Francisco" });
  console.log(`\n💰 [${t.raw}] get_weather →`, weather.content[0]?.text);
  console.log("   paymentMade:", weather.paymentMade);
  if (weather.paymentResponse) {
    console.log("   settlement success:", weather.paymentResponse.success);
    if (weather.paymentResponse.transaction) {
      console.log("   tx:", weather.paymentResponse.transaction);
    }
  }
}

await x402Mcp.close();
process.exit(0);
