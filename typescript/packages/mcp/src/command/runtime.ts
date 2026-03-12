/* eslint-disable jsdoc/require-jsdoc */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { createPublicClient, http } from "viem";
import { TronWeb } from "tronweb";
import {
  x402Client,
  type PaymentPolicy,
  type SelectPaymentRequirements,
} from "@bankofai/x402-core/client";
import { wrapFetchWithPayment } from "@bankofai/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner, eip3009ABI } from "@bankofai/x402-evm";
import {
  ExactTronScheme,
  createClientTronSigner,
  transferWithAuthorizationABI,
} from "@bankofai/x402-tron";

type NetworkName = "mainnet" | "nile" | "shasta" | "bsc" | "bsc-testnet";

const TRON_RPC_URLS: Record<Extract<NetworkName, "mainnet" | "nile" | "shasta">, string> = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
  shasta: "https://api.shasta.trongrid.io",
};

const EVM_NETWORKS = {
  bsc: {
    chainId: "eip155:56",
    chain: bsc,
    defaultRpcUrl: "https://bsc-dataseed.bnbchain.org",
  },
  "bsc-testnet": {
    chainId: "eip155:97",
    chain: bscTestnet,
    defaultRpcUrl: "https://bsc-testnet.bnbchain.org",
  },
} as const;

type CliBalanceOptions = Pick<ParsedCliOptions, "network" | "asset" | "token" | "pair">;
type SupportedNetwork = keyof typeof TRON_RPC_URLS | keyof typeof EVM_NETWORKS;

const DEFAULT_PAYMENT_ASSETS: Partial<
  Record<
    SupportedNetwork,
    {
      asset: string;
      symbol: string;
    }
  >
> = {
  mainnet: {
    asset: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    symbol: "USDT",
  },
  nile: {
    asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    symbol: "USDT",
  },
  shasta: {
    asset: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
    symbol: "USDT",
  },
};

export type ParsedCliOptions = Record<string, string>;

function readJsonFile(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function getConfigFiles(): string[] {
  return [
    path.join(process.cwd(), "x402-config.json"),
    path.join(os.homedir(), ".x402-config.json"),
  ];
}

function findConfigValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const envValue = process.env[key];
    if (typeof envValue === "string" && envValue.length > 0) {
      return envValue;
    }
  }

  for (const file of getConfigFiles()) {
    const config = readJsonFile(file);
    if (!config) {
      continue;
    }
    for (const key of keys) {
      const configKey = key.toLowerCase();
      const value = config[configKey] ?? config[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }

  return undefined;
}

export function parseCliOptions(argv: string[]): ParsedCliOptions {
  const options: ParsedCliOptions = {};
  const aliasMap: Record<string, string> = {
    X: "method",
    d: "data",
    q: "query",
    h: "headers",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      if (!options.url) {
        options.url = arg;
      }
      continue;
    }

    const key = arg.startsWith("--") ? arg.slice(2) : (aliasMap[arg.slice(1)] ?? arg.slice(1));
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      options[key] = value;
      i += 1;
    } else {
      options[key] = "true";
    }
  }
  return options;
}

async function findPrivateKey(type: "tron" | "evm"): Promise<string | undefined> {
  if (type === "tron") {
    if (process.env.TRON_CLIENT_PRIVATE_KEY) {
      return process.env.TRON_CLIENT_PRIVATE_KEY;
    }
    if (process.env.TRON_PRIVATE_KEY) {
      return process.env.TRON_PRIVATE_KEY;
    }
  } else {
    if (process.env.EVM_CLIENT_PRIVATE_KEY) {
      return process.env.EVM_CLIENT_PRIVATE_KEY;
    }
    if (process.env.BSC_CLIENT_PRIVATE_KEY) {
      return process.env.BSC_CLIENT_PRIVATE_KEY;
    }
    if (process.env.EVM_PRIVATE_KEY) {
      return process.env.EVM_PRIVATE_KEY;
    }
    if (process.env.ETH_PRIVATE_KEY) {
      return process.env.ETH_PRIVATE_KEY;
    }
  }

  if (process.env.PRIVATE_KEY) {
    return process.env.PRIVATE_KEY;
  }

  for (const file of getConfigFiles()) {
    const config = readJsonFile(file);
    if (!config) {
      continue;
    }

    if (type === "tron") {
      const key = config.tron_private_key ?? config.private_key;
      if (typeof key === "string" && key.length > 0) {
        return key;
      }
    } else {
      const key = config.evm_private_key ?? config.eth_private_key ?? config.private_key;
      if (typeof key === "string" && key.length > 0) {
        return key;
      }
    }
  }

  const mcporterPath = path.join(os.homedir(), ".mcporter", "mcporter.json");
  const mcporterConfig = readJsonFile(mcporterPath);
  const servers = mcporterConfig?.mcpServers;
  if (servers && typeof servers === "object") {
    for (const server of Object.values(servers)) {
      if (!server || typeof server !== "object") {
        continue;
      }

      const env = (server as { env?: Record<string, unknown> }).env;
      if (!env) {
        continue;
      }

      if (type === "tron" && typeof env.TRON_PRIVATE_KEY === "string") {
        return env.TRON_PRIVATE_KEY;
      }

      if (type === "evm") {
        if (typeof env.EVM_PRIVATE_KEY === "string") {
          return env.EVM_PRIVATE_KEY;
        }
        if (typeof env.ETH_PRIVATE_KEY === "string") {
          return env.ETH_PRIVATE_KEY;
        }
      }

      if (typeof env.PRIVATE_KEY === "string") {
        return env.PRIVATE_KEY;
      }
    }
  }

  return undefined;
}

async function findTronGridApiKey(): Promise<string | undefined> {
  if (process.env.TRON_GRID_API_KEY) {
    return process.env.TRON_GRID_API_KEY;
  }

  for (const file of getConfigFiles()) {
    const config = readJsonFile(file);
    const key = config?.tron_grid_api_key ?? config?.api_key;
    if (typeof key === "string" && key.length > 0) {
      return key;
    }
  }

  const mcporterPath = path.join(os.homedir(), ".mcporter", "mcporter.json");
  const mcporterConfig = readJsonFile(mcporterPath);
  const servers = mcporterConfig?.mcpServers;
  if (servers && typeof servers === "object") {
    for (const server of Object.values(servers)) {
      if (!server || typeof server !== "object") {
        continue;
      }

      const env = (server as { env?: Record<string, unknown> }).env;
      if (env && typeof env.TRON_GRID_API_KEY === "string") {
        return env.TRON_GRID_API_KEY;
      }
    }
  }

  return undefined;
}

function normalizeHexPrivateKey(privateKey: string): `0x${string}` {
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

function resolvePreferredNetwork(network?: string): string | undefined {
  if (!network) {
    return undefined;
  }

  if (network.startsWith("tron:") || network.startsWith("eip155:")) {
    return network;
  }

  switch (network) {
    case "mainnet":
    case "nile":
    case "shasta":
      return `tron:${network}`;
    case "bsc":
      return "eip155:56";
    case "bsc-testnet":
      return "eip155:97";
    default:
      return undefined;
  }
}

function normalizeSelectorValue(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function parsePairSelector(pair?: string): { network?: string; asset?: string } {
  if (!pair) {
    return {};
  }

  if (pair.includes("/")) {
    const [network, asset] = pair.split("/", 2);
    return {
      network: resolvePreferredNetwork(network) ?? network,
      asset,
    };
  }

  const parts = pair.split(":");
  if (parts.length >= 3) {
    return {
      network:
        resolvePreferredNetwork(parts.slice(0, -1).join(":")) ?? parts.slice(0, -1).join(":"),
      asset: parts.at(-1),
    };
  }

  if (parts.length === 2) {
    return {
      network: resolvePreferredNetwork(parts[0]) ?? parts[0],
      asset: parts[1],
    };
  }

  return {};
}

function matchesAssetSelector(assetSelector: string | undefined, asset: string): boolean {
  if (!assetSelector) {
    return true;
  }

  return normalizeSelectorValue(asset) === assetSelector;
}

function matchesPairSelector(
  pairSelector: string | undefined,
  requirement: { network: string; asset: string },
): boolean {
  if (!pairSelector) {
    return true;
  }

  const candidates = [
    `${requirement.network}:${requirement.asset}`,
    `${requirement.network}/${requirement.asset}`,
    `${requirement.network}-${requirement.asset}`,
  ].map(value => normalizeSelectorValue(value));

  return candidates.includes(pairSelector);
}

function createSelectionPolicy(args: {
  preferredNetwork?: string;
  preferredAsset?: string;
  preferredPair?: string;
  maxAmount?: bigint;
}): PaymentPolicy {
  return (_x402Version, accepts) => {
    const preferredAsset = normalizeSelectorValue(args.preferredAsset);
    const preferredPair = normalizeSelectorValue(args.preferredPair);
    const filtered = accepts.filter(req => {
      if (args.maxAmount !== undefined && BigInt(req.amount) > args.maxAmount) {
        return false;
      }

      if (args.preferredNetwork && req.network !== args.preferredNetwork) {
        return false;
      }

      if (!matchesAssetSelector(preferredAsset, req.asset)) {
        return false;
      }

      return matchesPairSelector(preferredPair, req);
    });

    if (filtered.length > 0) {
      return filtered;
    }

    const boundedAccepts =
      args.maxAmount !== undefined
        ? accepts.filter(req => BigInt(req.amount) <= (args.maxAmount as bigint))
        : accepts;

    if (args.preferredNetwork) {
      const networkOnly = boundedAccepts.filter(req => req.network === args.preferredNetwork);
      if (networkOnly.length > 0) {
        return networkOnly;
      }
    }

    return boundedAccepts.length > 0 ? boundedAccepts : accepts;
  };
}

function createPaymentSelector(): SelectPaymentRequirements {
  return (_x402Version, accepts) => {
    if (!accepts.length) {
      throw new Error("No payment requirements available");
    }

    return accepts[0];
  };
}

function buildTronWeb(fullHost: string, privateKey: string, apiKey?: string): TronWeb {
  const options: { fullHost: string; privateKey: string; headers?: Record<string, string> } = {
    fullHost,
    privateKey,
  };

  if (apiKey) {
    options.headers = {
      "TRON-PRO-API-KEY": apiKey,
    };
  }

  return new TronWeb(options);
}

function getBscRpcUrl(network: keyof typeof EVM_NETWORKS): string {
  if (network === "bsc") {
    return (
      process.env.BSC_MAINNET_RPC_URL ?? process.env.BSC_RPC_URL ?? EVM_NETWORKS.bsc.defaultRpcUrl
    );
  }

  return (
    process.env.BSC_TESTNET_RPC_URL ??
    process.env.BSC_RPC_URL ??
    EVM_NETWORKS["bsc-testnet"].defaultRpcUrl
  );
}

function buildPaymentClient(args: {
  tronKey?: string;
  evmKey?: string;
  tronGridApiKey?: string;
  preferredNetwork?: string;
  preferredAsset?: string;
  preferredPair?: string;
  maxAmount?: bigint;
}): x402Client {
  const client = new x402Client(createPaymentSelector());
  client.registerPolicy(
    createSelectionPolicy({
      preferredNetwork: args.preferredNetwork,
      preferredAsset: args.preferredAsset,
      preferredPair: args.preferredPair,
      maxAmount: args.maxAmount,
    }),
  );

  if (args.tronKey) {
    for (const [networkName, rpcUrl] of Object.entries(TRON_RPC_URLS)) {
      const tronWeb = buildTronWeb(rpcUrl, args.tronKey, args.tronGridApiKey);
      const signer = createClientTronSigner(tronWeb, args.tronKey);
      client.register(`tron:${networkName}`, new ExactTronScheme(signer));
    }
  }

  if (args.evmKey) {
    const account = privateKeyToAccount(normalizeHexPrivateKey(args.evmKey));

    for (const [networkName, networkConfig] of Object.entries(EVM_NETWORKS)) {
      const publicClient = createPublicClient({
        chain: networkConfig.chain,
        transport: http(getBscRpcUrl(networkName as keyof typeof EVM_NETWORKS)),
      });

      client.register(
        networkConfig.chainId,
        new ExactEvmScheme(toClientEvmSigner(account, publicClient)),
      );
    }
  }

  return client;
}

function parseInput(inputRaw?: string): unknown {
  if (!inputRaw) {
    return undefined;
  }

  try {
    return JSON.parse(inputRaw);
  } catch {
    return inputRaw;
  }
}

function sanitizeMessage(message: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => {
    if (!secret) {
      return result;
    }
    return result.split(secret).join("[REDACTED]");
  }, message);
}

function parseJsonObject(value: string | undefined, optionName: string): Record<string, string> {
  if (!value) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${optionName} must be a JSON object`);
  }

  return Object.fromEntries(Object.entries(parsed).map(([key, entry]) => [key, String(entry)]));
}

function appendQueryParams(url: string, queryRaw?: string): string {
  if (!queryRaw) {
    return url;
  }

  const params = parseJsonObject(queryRaw, "--query");
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    target.searchParams.set(key, value);
  });
  return target.toString();
}

function buildOutput(
  status: number,
  headers: Headers,
  body: unknown,
  paymentResponse?: unknown,
): Record<string, unknown> {
  return {
    status,
    headers: Object.fromEntries(headers.entries()),
    body,
    ...(paymentResponse ? { payment: paymentResponse } : {}),
  };
}

async function resolveKeys() {
  const tronKey = await findPrivateKey("tron");
  const evmKey = await findPrivateKey("evm");
  const tronGridApiKey = await findTronGridApiKey();
  return { tronKey, evmKey, tronGridApiKey };
}

export async function runStatus(): Promise<void> {
  const { tronKey, evmKey } = await resolveKeys();
  const result: Record<string, unknown> = {
    configured: {
      tron: Boolean(tronKey),
      evm: Boolean(evmKey),
    },
  };

  if (tronKey) {
    const tronWeb = buildTronWeb(TRON_RPC_URLS.nile, tronKey, process.env.TRON_GRID_API_KEY);
    const signer = createClientTronSigner(tronWeb, tronKey);
    result.tron = {
      address: signer.address,
      network: "tron:nile",
    };
  }

  if (evmKey) {
    const account = privateKeyToAccount(normalizeHexPrivateKey(evmKey));
    result.evm = {
      address: account.address,
      networks: Object.values(EVM_NETWORKS).map(network => network.chainId),
    };
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function getPreferredAsset(options: CliBalanceOptions): string | undefined {
  return parsePairSelector(options.pair).asset ?? options.asset ?? options.token;
}

function getDefaultPaymentAsset(
  network: SupportedNetwork,
): { asset: string; symbol?: string } | undefined {
  if (network === "bsc") {
    const asset =
      findConfigValue(["BSC_MAINNET_ASSET", "BSC_PAYMENT_ASSET"]) ??
      findConfigValue(["EVM_MAINNET_ASSET", "EVM_PAYMENT_ASSET"]);
    if (asset) {
      return { asset, symbol: "PAYMENT_TOKEN" };
    }
  }

  if (network === "bsc-testnet") {
    const asset =
      findConfigValue(["BSC_TEST_ASSET", "BSC_TESTNET_ASSET", "BSC_PAYMENT_ASSET"]) ??
      findConfigValue(["EVM_TEST_ASSET", "EVM_PAYMENT_ASSET"]);
    if (asset) {
      return { asset, symbol: "PAYMENT_TOKEN" };
    }
  }

  return DEFAULT_PAYMENT_ASSETS[network];
}

async function readTronTokenBalance(
  tronWeb: TronWeb,
  tokenAddress: string,
  owner: string,
): Promise<string> {
  const contract = await tronWeb.contract(transferWithAuthorizationABI, tokenAddress);
  const balance = await contract.balanceOf(owner).call();
  return balance.toString();
}

async function readEvmTokenBalance(
  networkName: keyof typeof EVM_NETWORKS,
  owner: `0x${string}`,
  tokenAddress: `0x${string}`,
): Promise<string> {
  const publicClient = createPublicClient({
    chain: EVM_NETWORKS[networkName].chain,
    transport: http(getBscRpcUrl(networkName)),
  });
  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: eip3009ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  return balance.toString();
}

export async function runBalance(options: CliBalanceOptions = {}): Promise<void> {
  const { tronKey, evmKey, tronGridApiKey } = await resolveKeys();
  const result: Record<string, unknown> = {};
  const pairSelector = parsePairSelector(options.pair);
  const preferredNetwork = resolvePreferredNetwork(options.network) ?? pairSelector.network;
  const preferredAsset = getPreferredAsset(options);

  if (tronKey) {
    const tronWeb = buildTronWeb(TRON_RPC_URLS.nile, tronKey, tronGridApiKey);
    const signer = createClientTronSigner(tronWeb, tronKey);
    const trxSun = await tronWeb.trx.getBalance(signer.address);
    const tronNetwork =
      preferredNetwork && preferredNetwork.startsWith("tron:")
        ? (preferredNetwork.slice("tron:".length) as keyof typeof TRON_RPC_URLS)
        : "nile";
    const tokenInfo =
      preferredAsset && (!preferredNetwork || preferredNetwork.startsWith("tron:"))
        ? { asset: preferredAsset }
        : getDefaultPaymentAsset(tronNetwork);
    result.tron = {
      address: signer.address,
      network: `tron:${tronNetwork}`,
      nativeSymbol: "TRX",
      nativeBalanceSun: String(trxSun),
      nativeBalance: (Number(trxSun) / 1_000_000).toString(),
    };

    if (tokenInfo?.asset) {
      const tokenTronWeb = buildTronWeb(TRON_RPC_URLS[tronNetwork], tronKey, tronGridApiKey);
      result.tron = {
        ...(result.tron as Record<string, unknown>),
        token: {
          asset: tokenInfo.asset,
          ...(tokenInfo.symbol ? { symbol: tokenInfo.symbol } : {}),
          balance: await readTronTokenBalance(tokenTronWeb, tokenInfo.asset, signer.address),
        },
      };
    }
  }

  if (evmKey) {
    const account = privateKeyToAccount(normalizeHexPrivateKey(evmKey));
    const balances: Record<string, unknown> = {};

    for (const [networkName, networkConfig] of Object.entries(EVM_NETWORKS)) {
      if (preferredNetwork && preferredNetwork !== networkConfig.chainId) {
        continue;
      }

      const publicClient = createPublicClient({
        chain: networkConfig.chain,
        transport: http(getBscRpcUrl(networkName as keyof typeof EVM_NETWORKS)),
      });
      const balance = await publicClient.getBalance({ address: account.address });
      const entry: Record<string, unknown> = {
        address: account.address,
        nativeSymbol: networkName === "bsc" ? "BNB" : "tBNB",
        nativeBalanceWei: balance.toString(),
        nativeBalance: balance.toString(),
      };

      const tokenInfo = preferredAsset
        ? { asset: preferredAsset }
        : getDefaultPaymentAsset(networkName as keyof typeof EVM_NETWORKS);

      if (tokenInfo?.asset) {
        entry.token = {
          asset: tokenInfo.asset,
          ...(tokenInfo.symbol ? { symbol: tokenInfo.symbol } : {}),
          balance: await readEvmTokenBalance(
            networkName as keyof typeof EVM_NETWORKS,
            account.address,
            tokenInfo.asset as `0x${string}`,
          ),
        };
      }

      balances[networkConfig.chainId] = entry;
    }

    result.evm = balances;
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export async function runPay(options: ParsedCliOptions): Promise<void> {
  const { tronKey, evmKey, tronGridApiKey } = await resolveKeys();

  const url = options.url;
  if (!url) {
    throw new Error("url is required");
  }

  if (!tronKey && !evmKey) {
    throw new Error(
      "configure TRON_PRIVATE_KEY or EVM_PRIVATE_KEY before invoking paid endpoints.",
    );
  }

  const preferredNetwork = resolvePreferredNetwork(options.network);
  const preferredAsset = options.asset ?? options.token;
  const preferredPair = options.pair;
  const maxAmount = options["max-amount"] ? BigInt(options["max-amount"]) : undefined;

  const client = buildPaymentClient({
    tronKey,
    evmKey,
    tronGridApiKey,
    preferredNetwork,
    preferredAsset,
    preferredPair,
    maxAmount,
  });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  let requestUrl = url;
  let method = (options.method ?? "GET").toUpperCase();
  let body: string | undefined;

  if (options.entrypoint) {
    const baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    requestUrl = `${baseUrl}/entrypoints/${options.entrypoint}/invoke`;
    method = "POST";
    body = JSON.stringify({ input: parseInput(options.data ?? options.input) ?? {} });
  } else if (options.input) {
    const parsed = parseInput(options.input);
    body = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } else if (options.data) {
    const parsed = parseInput(options.data);
    body = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  }

  requestUrl = appendQueryParams(requestUrl, options.query);
  const customHeaders = parseJsonObject(options.headers, "--headers");
  if (options["correlation-id"]) {
    customHeaders["x-correlation-id"] = options["correlation-id"];
  }

  const init: RequestInit = {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...customHeaders,
    },
    body,
  };

  try {
    console.error(`[x402] Requesting: ${method} ${requestUrl}`);
    if (preferredNetwork) {
      console.error(`[x402] Preferred network: ${preferredNetwork}`);
    }
    if (preferredAsset) {
      console.error(`[x402] Preferred asset:   ${preferredAsset}`);
    }
    if (preferredPair) {
      console.error(`[x402] Preferred pair:    ${preferredPair}`);
    }

    const response = await fetchWithPayment(requestUrl, init);
    const contentType = response.headers.get("content-type") ?? "";
    const paymentResponseHeader = response.headers.get("payment-response");
    let responseBody: unknown;

    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else if (contentType.includes("image/") || contentType.includes("application/octet-stream")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const tmpDir = os.tmpdir();
      const ext = contentType.includes("image/")
        ? contentType.split("/")[1]?.split(";")[0] || "bin"
        : "bin";
      const fileName = `x402_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = path.join(tmpDir, fileName);
      fs.writeFileSync(filePath, buffer);
      responseBody = {
        file_path: filePath,
        content_type: contentType,
        bytes: buffer.length,
      };
    } else {
      responseBody = await response.text();
    }

    process.stdout.write(
      JSON.stringify(
        buildOutput(
          response.status,
          response.headers,
          responseBody,
          paymentResponseHeader
            ? JSON.parse(Buffer.from(paymentResponseHeader, "base64").toString("utf8"))
            : undefined,
        ),
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    const secrets = [tronKey, evmKey].filter((value): value is string => Boolean(value));
    const message = sanitizeMessage(
      error instanceof Error ? error.message : "Unknown error",
      secrets,
    );
    console.error(`[x402] Error: ${message}`);
    process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
    process.exit(1);
  }
}
