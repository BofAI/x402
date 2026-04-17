# TRON exact scheme — 代码参考

> 本文档是 [TRON_CONTRIBUTION_IMPL.md](TRON_CONTRIBUTION_IMPL.md) 的代码附录。
>
> 包含 `@x402/tron` 各文件的具体代码模板，供实现阶段参考。

---

## 1. `constants.ts`

```typescript
export const TRON_MAINNET = "tron:mainnet";
export const TRON_NILE    = "tron:nile";
export const TRON_SHASTA  = "tron:shasta";

export const CHAIN_IDS: Record<string, number> = {
  [TRON_MAINNET]: 728126428,
  [TRON_NILE]:    3448148188,
  [TRON_SHASTA]:  2494104990,
};

export const RPC_URLS: Record<string, string> = {
  [TRON_MAINNET]: "https://api.trongrid.io",
  [TRON_NILE]:    "https://nile.trongrid.io",
  [TRON_SHASTA]:  "https://api.shasta.trongrid.io",
};

export const DEFAULT_STABLECOINS: Record<string, {
  address: string; name: string; version: string; decimals: number;
}> = {
  [TRON_NILE]:    { address: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj", name: "Tether USD", version: "1", decimals: 6 },
  [TRON_MAINNET]: { address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", name: "Tether USD", version: "1", decimals: 6 },
  [TRON_SHASTA]:  { address: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs", name: "Tether USD", version: "1", decimals: 6 },
};

export const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
} as const;

// --- Permit2 合约地址（SUN.io 部署, https://github.com/sun-protocol/sunswap-permit2） ---
export const PERMIT2_ADDRESSES: Record<string, string> = {
  [TRON_MAINNET]: "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9",
  [TRON_NILE]:    "TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx",
};

// --- Permit2Helper 合约地址（SUN.io 部署） ---
export const PERMIT2_HELPER_ADDRESSES: Record<string, string> = {
  [TRON_MAINNET]: "TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL",
  [TRON_NILE]:    "TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h",
};

// --- Fee/Energy 配置（对标 AVM MAX_REASONABLE_FEE） ---
export const DEFAULT_FEE_LIMIT_TRX = 100;  // 100 TRX (转 sun: 100_000_000)
export const DEFAULT_FEE_LIMIT_SUN = DEFAULT_FEE_LIMIT_TRX * 1_000_000;

// --- CAIP-2 网络数组（对标 AVM CAIP2_NETWORKS） ---
export const TRON_NETWORKS = [TRON_MAINNET, TRON_NILE, TRON_SHASTA] as const;
```

---

## 2. `types.ts`

```typescript
// --- EIP-3009 payload ---
export type ExactTronEip3009Payload = {
  signature?: `0x${string}`;
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
  };
};

// --- Permit2 payload ---
export type ExactTronPermit2Payload = {
  signature?: `0x${string}`;
  permit: {
    permitted: { token: `0x${string}`; amount: string };
    nonce: string;
    deadline: string;
  };
  transferDetails: {
    to: `0x${string}`;
    requestedAmount: string;
  };
};

// --- Union type ---
export type ExactTronPayloadV2 = ExactTronEip3009Payload | ExactTronPermit2Payload;

// --- Type guards ---
export function isEip3009Payload(p: unknown): p is ExactTronEip3009Payload {
  return typeof p === "object" && p !== null && "authorization" in p;
}

export function isPermit2Payload(p: unknown): p is ExactTronPermit2Payload {
  return typeof p === "object" && p !== null && "permit" in p && "transferDetails" in p;
}
```

---

## 3. `signer.ts`

```typescript
// --- Config 类型（对标 AVM ClientAvmConfig / FacilitatorAvmSignerConfig） ---
export type ClientTronConfig = {
  tronWeb?: TronWeb;        // 预配置的 TronWeb 实例（优先使用）
  fullHost?: string;        // TronGrid RPC URL
  apiKey?: string;          // TronGrid API Key
};

export type FacilitatorTronSignerConfig = {
  fullHost?: string;        // 自定义 RPC URL
  apiKey?: string;          // TronGrid API Key
};

// --- Client Signer 接口 ---
export type ClientTronSigner = {
  readonly address: string;  // Base58
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
};

// --- Facilitator Signer 接口 ---
export type FacilitatorTronSigner = {
  getAddresses(): readonly string[];
  readContract(args: {
    address: string;
    functionSelector: string;
    parameter: { type: string; value: unknown }[];
  }): Promise<unknown>;
  writeContract(args: {
    address: string;
    functionSelector: string;
    parameter: { type: string; value: unknown }[];
    feeLimit?: number;
  }): Promise<string>;
  waitForConfirmation(txId: string, timeout?: number): Promise<{ status: string }>;
};

// --- Factory 函数 ---
export function toClientTronSigner(privateKey: string, config?: ClientTronConfig): ClientTronSigner { ... }
export function toFacilitatorTronSigner(privateKey: string, config?: FacilitatorTronSignerConfig): FacilitatorTronSigner { ... }

// --- Type Guard（对标 AVM isAvmSignerWallet） ---
export function isTronSignerWallet(wallet: unknown): wallet is ClientTronSigner {
  return typeof wallet === "object" && wallet !== null
    && "address" in wallet && typeof (wallet as any).address === "string"
    && "signTypedData" in wallet && typeof (wallet as any).signTypedData === "function";
}
```

---

## 4. `utils.ts`

```typescript
// --- 地址转换 ---
export function tronToEvmHex(base58Address: string): `0x${string}` {
  const hex = TronWeb.address.toHex(base58Address);
  return `0x${hex.slice(2)}` as `0x${string}`;
}
export function evmHexToTron(hexAddress: string): string {
  const hex = hexAddress.startsWith("0x") ? hexAddress.slice(2) : hexAddress;
  return TronWeb.address.fromHex(`41${hex}`);
}
export function isTronAddress(addr: string): boolean { return TronWeb.isAddress(addr); }

// --- 网络工具（对标 AVM isAlgorandNetwork / isTestnetNetwork / getNetworkFromCaip2） ---
export function isTronNetwork(network: string): boolean { return network.startsWith("tron:"); }
export function isTestnetNetwork(network: string): boolean {
  return network === TRON_NILE || network === TRON_SHASTA;
}
export function getNetworkFromCaip2(caip2: string): "mainnet" | "nile" | "shasta" | null {
  if (caip2 === TRON_MAINNET) return "mainnet";
  if (caip2 === TRON_NILE) return "nile";
  if (caip2 === TRON_SHASTA) return "shasta";
  return null;
}
export function getTronChainId(network: string): number { /* 查 CHAIN_IDS 表 */ }

// --- 金额转换（对标 AVM convertToTokenAmount / convertFromTokenAmount） ---
export function convertToTokenAmount(decimalAmount: string, decimals: number): string {
  // "1.50" + 6 → "1500000"
  // "0.001" + 6 → "1000"
}
export function convertFromTokenAmount(atomicAmount: string | bigint, decimals: number): string {
  // "1500000" + 6 → "1.5"
}

// --- Nonce + 时间窗口 ---
export function createNonce(): `0x${string}` { /* crypto.getRandomValues(32) */ }
export function createValidityWindow(maxTimeoutSeconds: number) { /* now-600 ~ now+max */ }
```

---

## 5. `exact/client/scheme.ts` — 路由

```typescript
export class ExactTronScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  constructor(private readonly signer: ClientTronSigner) {}

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements) {
    const assetTransferMethod = requirements.extra?.assetTransferMethod ?? "eip3009";

    if (assetTransferMethod === "permit2") {
      return createPermit2Payload(this.signer, x402Version, requirements);
    }
    return createEIP3009Payload(this.signer, x402Version, requirements);
  }
}
```

---

## 6. `exact/client/eip3009.ts`

```typescript
export async function createEIP3009Payload(signer, x402Version, requirements) {
  const from = tronToEvmHex(signer.address);
  const to = tronToEvmHex(requirements.payTo);
  const authorization = { from, to, value: requirements.amount, ...createValidityWindow(...), nonce: createNonce() };

  const domain = { name, version, chainId: getTronChainId(...), verifyingContract: tronToEvmHex(requirements.asset) };
  const signature = await signer.signTypedData({ domain, types: authorizationTypes, ... });

  return { x402Version, payload: { authorization, signature } };
}
```

---

## 7. `exact/client/permit2.ts`

```typescript
export async function createPermit2Payload(signer, x402Version, requirements) {
  const permit2Address = requirements.extra?.permit2Address;
  const token = tronToEvmHex(requirements.asset);
  // spender = facilitator 地址（调用 permitTransferFrom 的人），不是 payTo
  // facilitator 地址从 requirements.extra.facilitator 获取
  const spender = tronToEvmHex(requirements.extra?.facilitator ?? requirements.payTo);

  const permit = {
    permitted: { token, amount: requirements.amount },
    nonce: generatePermit2Nonce(),  // 递增 nonce，不是随机 bytes32
    deadline: Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds,
  };
  const transferDetails = { to: tronToEvmHex(requirements.payTo), requestedAmount: requirements.amount };

  // Permit2 用不同的 EIP-712 类型签名
  const signature = await signer.signTypedData({
    domain: { name: "Permit2", chainId: getTronChainId(...), verifyingContract: tronToEvmHex(permit2Address) },
    types: permit2Types,
    primaryType: "PermitTransferFrom",
    message: { permitted: permit.permitted, spender, nonce: permit.nonce, deadline: permit.deadline },
  });

  return { x402Version, payload: { permit, transferDetails, signature } };
}
```

---

## 8. `exact/server/scheme.ts`

```typescript
export class ExactTronScheme implements SchemeNetworkServer {
  readonly scheme = "exact";
  private moneyParsers: MoneyParser[] = [];

  // 可链式注册自定义金额解析器（对标 AVM registerMoneyParser）
  registerMoneyParser(parser: MoneyParser): this {
    this.moneyParsers.push(parser);
    return this;
  }

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // 1. 尝试自定义 parser chain
    for (const parser of this.moneyParsers) {
      const result = parser(price);
      if (result !== null) return this.toAssetAmount(result, network);
    }
    // 2. 默认: "$0.01" → 10000 (6 decimals)
    return this.defaultMoneyConversion(price, network);
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: { scheme: string; network: string },
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    const stablecoin = DEFAULT_STABLECOINS[requirements.network];
    return {
      ...requirements,
      extra: {
        ...requirements.extra,
        name: stablecoin?.name ?? requirements.extra?.name,
        version: stablecoin?.version ?? requirements.extra?.version ?? "1",
        decimals: stablecoin?.decimals ?? 6,
        assetTransferMethod: requirements.extra?.assetTransferMethod ?? "eip3009",
      },
    };
  }
}
```

---

## 9. `exact/facilitator/scheme.ts` — 路由

```typescript
export class ExactTronScheme implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "tron:*";

  async verify(payload, requirements): Promise<VerifyResponse> {
    const assetTransferMethod = requirements.extra?.assetTransferMethod ?? "eip3009";

    if (assetTransferMethod === "permit2") {
      return verifyPermit2(this.signer, payload, requirements);
    }
    return verifyEip3009(this.signer, payload, requirements);
  }

  async settle(payload, requirements): Promise<SettleResponse> {
    const assetTransferMethod = requirements.extra?.assetTransferMethod ?? "eip3009";

    if (assetTransferMethod === "permit2") {
      return settlePermit2(this.signer, payload, requirements);
    }
    return settleEip3009(this.signer, payload, requirements);
  }
}
```

---

## 10. `exact/facilitator/eip3009.ts`

```typescript
export async function verifyEip3009(signer, payload, requirements): Promise<VerifyResponse> {
  // 1. EIP-712 domain (name, version) 校验
  // 2. recipient: tronToEvmHex(payTo) == authorization.to
  // 3. amount: authorization.value == requirements.amount
  // 4. time: validBefore > now+6s, validAfter <= now
  // 5. signature: ecrecoverFromTypedData → must match authorization.from
  // 6. simulation: simulateTransfer → diagnoseFailure on fail
}

export async function settleEip3009(signer, payload, requirements): Promise<SettleResponse> {
  // 1. re-verify
  // 2. parseSignatureVRS → writeContract("transferWithAuthorization", ...)
  // 3. waitForConfirmation
}
```

---

## 11. `exact/facilitator/permit2.ts`

```typescript
export async function verifyPermit2(signer, payload, requirements): Promise<VerifyResponse> {
  // 1. permit2Address 存在性校验
  // 2. recipient: tronToEvmHex(payTo) == transferDetails.to
  // 3. amount: permit.permitted.amount == requirements.amount
  // 4. deadline: permit.deadline > now
  // 5. signature: ecrecover Permit2 签名 → must match owner
  // 6. token 对 Permit2 的 approve 检查: token.allowance(owner, permit2Address) >= amount
  // 7. 如 token allowance 不足：检查 extensions 中是否有 eip2612Permit（无 approval sponsoring）
}

export async function settlePermit2(signer, payload, requirements): Promise<SettleResponse> {
  // 1. re-verify
  // 2. 如有 eip2612Permit extension → 先执行 token.permit()
  // 3. writeContract(permit2Address, "permitTransferFrom(..)")
  // 4. waitForConfirmation
}
```

---

## 12. `exact/facilitator/eip3009-utils.ts`

```typescript
// ecrecover: ethers.verifyTypedData() 恢复签名者
export function ecrecoverFromTypedData(payload, requirements): `0x${string}` { ... }

// VRS 拆分: 65 字节签名 → { v, r, s }
export function parseSignatureVRS(signature): { v, r, s } { ... }

// 链上模拟: triggerConstantContract("transferWithAuthorization", ...)
export async function simulateTransfer(signer, asset, payload): Promise<boolean> { ... }

// 失败诊断 (无 Multicall3, 逐个查): authorizationState → balanceOf → 错误码
export async function diagnoseFailure(signer, asset, payload, requirements) { ... }
```

---

## 13. `shared/permit2.ts`

```typescript
// Permit2 EIP-712 类型定义
export const permit2Types = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender",   type: "address" },
    { name: "nonce",     type: "uint256" },
    { name: "deadline",  type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token",  type: "address" },
    { name: "amount", type: "uint256" },
  ],
} as const;

// Permit2 合约地址从 constants.ts 导入（唯一定义处）
import { PERMIT2_ADDRESSES } from "../constants";

// 构造 Permit2 签名消息
export function buildPermit2SignatureData(...) { ... }

// nonce 管理: Permit2 用 bitmap nonce（不是 ERC-3009 的 bytes32 随机 nonce）
// 参见 SignatureTransfer.sol: bitmapPositions(nonce) → (wordPos, bitPos)
export function generatePermit2Nonce(): string { ... }
```

---

## 14. `shared/extensions.ts`

```typescript
// 参照 EVM shared/extensions.ts
// TRON 差异: 无 approval sponsoring（approve() 要求 msg.sender = owner）

// 尝试签 EIP-2612 permit (如果 token 支持 permit 函数)
export async function trySignEip2612PermitExtension(signer, requirements, ...) { ... }

// 注意: EVM 有 trySignErc20ApprovalExtension (facilitator 代付 approve gas)
// TRON 不实现此功能 — TRC-20 approve() 要求 msg.sender 是 token owner
// 用户需自行发 approve(PERMIT2, MAX) 交易
```

---

## 15. `exact/facilitator/errors.ts`

```typescript
// --- 公共 (8) ---
export const ErrInvalidScheme           = "invalid_exact_tron_scheme";
export const ErrInvalidVersion          = "invalid_exact_tron_invalid_version";
export const ErrNetworkMismatch         = "invalid_exact_tron_network_mismatch";
export const ErrRecipientMismatch       = "invalid_exact_tron_recipient_mismatch";
export const ErrInvalidSignature        = "invalid_exact_tron_signature";
export const ErrAmountMismatch          = "invalid_exact_tron_authorization_value";
export const ErrInsufficientBalance     = "invalid_exact_tron_insufficient_balance";
export const ErrFacilitatorTransferring = "invalid_exact_tron_facilitator_transferring";

// --- EIP-3009 专有 (6) ---
export const ErrMissingEip712Domain     = "invalid_exact_tron_missing_eip712_domain";
export const ErrValidBeforeExpired      = "invalid_exact_tron_payload_authorization_valid_before";
export const ErrValidAfterFuture        = "invalid_exact_tron_payload_authorization_valid_after";
export const ErrNonceAlreadyUsed        = "invalid_exact_tron_nonce_already_used";
export const ErrEip3009NotSupported     = "invalid_exact_tron_eip3009_not_supported";
export const ErrSimulationFailed        = "invalid_exact_tron_transaction_simulation_failed";

// --- Permit2 专有 (4) ---
export const ErrPermit2AddressMissing   = "invalid_exact_tron_permit2_address_missing";
export const ErrPermit2DeadlineExpired  = "invalid_exact_tron_permit2_deadline_expired";
export const ErrPermit2Allowance        = "invalid_exact_tron_permit2_allowance_insufficient";
export const ErrPermit2SignatureInvalid = "invalid_exact_tron_permit2_signature_invalid";

// --- 结算 (2) ---
export const ErrSettleFailed            = "invalid_exact_tron_transaction_failed";
export const ErrConfirmationFailed      = "invalid_exact_tron_confirmation_failed";
```

**共 20 个错误码**（AVM 有 23 个，TRON 少了 AVM 特有的 group_size/payment_index/fee_payer 等，多了 Permit2 的 4 个）。

---

## 16. `index.ts` 导出清单

```typescript
// --- Exact Scheme ---
export { ExactTronScheme } from "./exact/client/scheme";     // Client
export { ExactTronScheme as ExactTronServerScheme } from "./exact/server/scheme";  // Server
export { ExactTronScheme as ExactTronFacilitatorScheme } from "./exact/facilitator/scheme";  // Facilitator

// --- Signer ---
export type { ClientTronSigner, ClientTronConfig, FacilitatorTronSigner, FacilitatorTronSignerConfig } from "./signer";
export { toClientTronSigner, toFacilitatorTronSigner, isTronSignerWallet } from "./signer";

// --- Types ---
export type { ExactTronEip3009Payload, ExactTronPermit2Payload, ExactTronPayloadV2 } from "./types";
export { isEip3009Payload, isPermit2Payload } from "./types";

// --- Constants ---
export { TRON_MAINNET, TRON_NILE, TRON_SHASTA, TRON_NETWORKS, CHAIN_IDS, RPC_URLS,
         DEFAULT_STABLECOINS, PERMIT2_ADDRESSES, DEFAULT_FEE_LIMIT_SUN } from "./constants";

// --- Utils ---
export { tronToEvmHex, evmHexToTron, isTronAddress, isTronNetwork, isTestnetNetwork,
         getNetworkFromCaip2, getTronChainId, convertToTokenAmount, convertFromTokenAmount,
         createNonce, createValidityWindow } from "./utils";

// --- Errors ---
export * as Errors from "./exact/facilitator/errors";
```
