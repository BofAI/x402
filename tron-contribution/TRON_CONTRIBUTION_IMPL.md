# TRON exact scheme — 实施手册

> 决策依据见 [TRON_CONTRIBUTION_ANALYSIS.md](TRON_CONTRIBUTION_ANALYSIS.md)
> 提案内容见 [TRON_PROPOSAL.md](TRON_PROPOSAL.md)
> 代码模板见 [TRON_CONTRIBUTION_CODE.md](TRON_CONTRIBUTION_CODE.md)

---

## 1. 执行路线

```
                    ┌─────────────────────────────┐
                    │ TIP-3009 (TRON 社区)         │
                    │ 并行推进，不阻塞 SDK 贡献     │
                    └────────────┬────────────────┘
                                 │
Issue ──► PR1 (Spec) ──► PR2 (TypeScript) ──► PR3 (Python)
                │                │
                └── 本地开发 PR2 ──┘
```

| 步骤 | 产出 | 分支 | 依赖 |
|------|------|------|------|
| **TIP-3009** | TRON 社区提案 + 参考合约 | — | 不阻塞，并行 |
| **Step 1** | Spec PR | `feature/tron-exact-spec` | Issue 已开 |
| **Step 2** | TypeScript `@x402/tron` | `feature/tron-exact-ts` | PR1 review 期间本地开发 |
| **Step 3** | Python `x402[tron]` | `feature/tron-exact-py` | PR2 合并后 |

---

## 2. TIP-3009：TRON 授权转账标准

### 为什么需要 TIP-3009

TRON 上没有对标 EIP-3009 的标准。现状：

| 链 | 标准 | Token 支持 |
|----|------|-----------|
| **EVM** | EIP-3009（2019 年 Ethereum 标准） | USDC V2+, Circle 所有 token |
| **TRON** | **无对标标准** | TRON USDT 只有 15 个基础 TRC-20 函数，无 `transferWithAuthorization` |

没有标准 → token 发行方没有动力实现 → 没有 token 支持 → SDK 无法上生产。

### TIP-3009 与 EIP-3009 的关系

TIP-3009 是 EIP-3009 在 TRON 上的适配，核心接口完全相同：

```solidity
// 完全复用 EIP-3009 的函数签名
function transferWithAuthorization(
    address from, address to, uint256 value,
    uint256 validAfter, uint256 validBefore, bytes32 nonce,
    uint8 v, bytes32 r, bytes32 s
) external;

function authorizationState(address authorizer, bytes32 nonce)
    external view returns (bool);
```

差异只在签名层：
- EIP-3009 用 EIP-712 签名
- TIP-3009 用 TIP-712 签名（TRON 对 EIP-712 的实现，`chainId = block.chainid & 0xffffffff`）

### 提案内容

**提交到：** [tronprotocol/tips](https://github.com/tronprotocol/tips)

**标题：** `TIP-3009: Transfer With Authorization for TRC-20 Tokens`

**核心内容：**

1. **Abstract** — 在 TRC-20 token 合约中增加 `transferWithAuthorization` 函数，允许通过离线签名授权转账，无需付款方持有 TRX（gas-free）
2. **Motivation** — x402 支付协议需要、跨链兼容性（和 EIP-3009 token 互操作）、减少链上交易（一步完成授权+转账）
3. **Specification** — 函数签名（同 EIP-3009）、TIP-712 签名构造、domainSeparator 构造（含 chainId 截断规则）、nonce 管理（每 nonce 只能用一次）
4. **Reference Implementation** — Solidity 合约代码，基于 Circle 的 FiatTokenV2 适配 TRON
5. **Security Considerations** — 重放攻击防护（chainId + nonce）、签名前端验证

### 参考合约

部署到 Nile testnet 供 x402 SDK 测试：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TRC20WithAuthorization is ERC20 {
    // EIP-712 domain
    bytes32 public DOMAIN_SEPARATOR;

    // transferWithAuthorization typehash
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    // nonce → used
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name_)),
            keccak256(bytes("1")),
            block.chainid,  // TIP-712: 可能需要 & 0xffffffff
            address(this)
        ));
    }

    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp > validAfter, "not yet valid");
        require(block.timestamp < validBefore, "expired");
        require(!authorizationState[from][nonce], "nonce already used");

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from, to, value, validAfter, validBefore, nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered == from, "invalid signature");

        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}
```

### 执行计划

| 步骤 | 内容 | 时间线 |
|------|------|--------|
| 1. 写 TIP 草稿 | 参照 TIP-712 格式，内容如上 | 和 Step 1 (Spec PR) 并行 |
| 2. 部署参考合约到 Nile | TRC20WithAuthorization，通过 TronIDE/tronbox 部署 | 和 Step 2 开发并行 |
| 3. 提交到 tronprotocol/tips | PR 到 tips 仓库 | Step 1 提交后 |
| 4. 在 x402 Issue/Spec 中引用 TIP-3009 | 增强说服力 | TIP PR 提交后 |

---

## 3. 合约

### Permit2 — 已部署（我们自己的）

我们（SUN.io）已在 TRON 主网部署了 Permit2 合约，基于 Uniswap Permit2 + TIP-712 签名，2026-02-05 上线。

| 网络 | 合约地址 | 状态 |
|------|---------|------|
| **主网** | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` | 生产运行中，配合 Universal Router |
| **Nile** | 待确认 | 如无则自行部署同一套合约 |
| **Shasta** | 待确认 | 如无则自行部署同一套合约 |

> Atum-Labs 也曾部署一个开源版本（`TJhMXTHQHeQyMD7TcKQFqAePNgG4b31H9m`），仓库已不可访问。

### TRC20WithAuthorization — 需要部署

| 网络 | 用途 | 状态 |
|------|------|------|
| **Nile** | eip3009 路径开发测试 | 需部署（参考合约代码见上文） |
| **主网** | 未来 TIP-3009 采纳后使用 | 后续 |

### 部署顺序

```
1. 确认 Nile 上是否已有我们的 Permit2 → 如无则部署
2. Nile 上部署 TRC20WithAuthorization → 用于 eip3009 路径开发测试
3. 两条路径并行开发
```

---

## 4. TRC-20 Token 处理策略

### 问题与方案

TRON 现有主流 token（USDT）不支持 `transferWithAuthorization`。EVM 上也有同样的问题（MegaETH、Mezo），Foundation 的处理方式是双路径：

```
paymentRequirements.extra.assetTransferMethod:
  ├── "eip3009" → transferWithAuthorization 直接转账（需 token 支持）
  └── "permit2" → Permit2 合约代理转账（任何 TRC-20 都可用）
```

**TRON 完全对齐 EVM 的双路径，两个都做：**

| assetTransferMethod | 适用 Token | 合约 | 流程 |
|-------------------|-----------|------|------|
| `eip3009` | 实现了 TIP-3009 的 token | TRC20WithAuthorization（自部署） | Client 签 TIP-712 授权 → Facilitator 调 `transferWithAuthorization` |
| `permit2` | **所有标准 TRC-20**（USDT 等） | SUN.io Permit2（已部署） | Client 签 Permit2 签名 → Facilitator 调 Permit2 `transferFrom` |

### EVM Permit2 的三层 approve fallback（TRON 差异）

| 层级 | EVM 做法 | TRON 对标 |
|------|---------|----------|
| 1. EIP-2612 permit | token 有 `permit()` → gasless approve | TRC-20 如有 `permit()` → 同样 gasless |
| 2. Approval sponsoring | facilitator 代付 approve gas | **不可行** — TRC-20 `approve()` 要求 `msg.sender` 是 token owner，facilitator 无法代替用户调用 |
| 3. 手动 approve | 用户自己发 `approve(PERMIT2, MAX)` | 用户自己发 `approve(PERMIT2, MAX)` |

> **TRON 关键差异：** EVM 的 Approval Sponsoring 依赖 facilitator 代发用户已签名的 approve 交易（meta-transaction）。TRON 没有原生 meta-transaction 支持，`approve()` 的 `msg.sender` 必须是签名发起人自己，因此 **Layer 2 在 TRON 上不可行**。实际 fallback 只有两层：EIP-2612 permit（如 token 支持）→ 手动 approve。

### Client 路由（对标 EVM `exact/client/scheme.ts`）

```typescript
// EVM 的路由逻辑（我们要对标的）
const assetTransferMethod = requirements.extra?.assetTransferMethod ?? "eip3009";

if (assetTransferMethod === "permit2") {
  // Permit2 签名 + approve fallback
  return createPermit2Payload(signer, x402Version, requirements);
}
// 默认 EIP-3009
return createEIP3009Payload(signer, x402Version, requirements);
```

TRON 的 `ExactTronScheme.createPaymentPayload()` 需要实现同样的路由：
- `eip3009` → 现有的 TIP-712 签名流程
- `permit2` → Permit2 签名流程（参照 EVM `exact/client/permit2.ts`）

### 对比表

| 维度 | EVM | TRON |
|------|-----|------|
| 有 ERC-3009 的 token | `eip3009` 直接用 | `eip3009` 直接用（自部署 TIP-3009 token） |
| 无 ERC-3009 的 token | `permit2` via Permit2 合约 | `permit2` via 自部署 Permit2 合约 |
| USDT | `eip3009`（EVM USDT 支持 ERC-3009） | `permit2`（TRON USDT 不支持，走 Permit2） |
| Permit2 合约 | Uniswap 官方部署 | SUN.io 已部署（`TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9`） |
| approve 方式 | EIP-2612 / sponsoring / 手动 | EIP-2612 / 手动（无 sponsoring，`approve()` 要求 `msg.sender`） |

---

## 5. 支付流程

### EIP-3009 路径

```
Client                    Server                  Facilitator           TRON 链
  │── GET /api ──────────►  │                         │                    │
  │◄── 402 + requirements ──│  (Base58 地址,           │                    │
  │    assetTransferMethod   │   eip3009)              │                    │
  │                         │                         │                    │
  │ [Base58→hex] [构造 auth] [TIP-712 签名]            │                    │
  │                         │                         │                    │
  │── GET /api + PAYMENT ──►│                         │                    │
  │   (authorization 用 0x) │── POST /verify ────────►│                    │
  │                         │                         │ [ecrecover 验签]   │
  │                         │                         │ [Base58→hex 比对]  │
  │                         │                         │── triggerConstant ─►│
  │                         │◄── { isValid: true } ───│                    │
  │                         │── POST /settle ────────►│                    │
  │                         │                         │── triggerSmart ────►│
  │                         │                         │  transferWithAuth   │
  │                         │                         │◄── txid ───────────│
  │◄── 200 + content ───────│                         │                    │
```

### Permit2 路径

```
Client                    Server                  Facilitator           TRON 链
  │── GET /api ──────────►  │                         │                    │
  │◄── 402 + requirements ──│  (Base58 地址,           │                    │
  │    assetTransferMethod   │   permit2)              │                    │
  │                         │                         │                    │
  │ [Base58→hex] [构造 permit] [Permit2 TIP-712 签名]  │                    │
  │                         │                         │                    │
  │── GET /api + PAYMENT ──►│                         │                    │
  │   (permit + signature)  │── POST /verify ────────►│                    │
  │                         │                         │ [ecrecover 验签]   │
  │                         │                         │ [token allowance]  │
  │                         │                         │   to Permit2?      │
  │                         │◄── { isValid: true } ───│                    │
  │                         │── POST /settle ────────►│                    │
  │                         │                         │ [如需: token.permit]│
  │                         │                         │── triggerSmart ────►│
  │                         │                         │  permitTransferFrom │
  │                         │                         │◄── txid ───────────│
  │◄── 200 + content ───────│                         │                    │
```

**地址格式规则（两条路径通用）：**
- `paymentRequirements`（Server → Client）：全程 Base58（`T...`）
- `payload` 内部字段（签名后）：全程 EVM hex（`0x...`）
- Facilitator verify 时做 Base58 → hex 转换后比对

---

## 6. TypeScript `@x402/tron`

**分支：** `feature/tron-exact-ts`

**PR：** `feat(tron): add @x402/tron package with exact scheme implementation`

**模板：** `@x402/avm`（Algorand，PR #1560）

### 包结构

```
typescript/packages/mechanisms/tron/
├── package.json               # @x402/tron, subpath exports (client/server/facilitator)
├── tsconfig.json              # 复制 avm/
├── tsup.config.ts             # 复制 avm/
├── vitest.config.ts           # 复制 avm/
├── vitest.integration.config.ts
├── eslint.config.js           # 复制 avm/
├── .prettierrc                # 复制 avm/
├── .prettierignore            # 复制 avm/
├── README.md                  # 包说明 + 用法示例
├── src/
│   ├── index.ts               # 统一导出（按类别组织，对标 AVM 的 47+ 导出项）
│   ├── constants.ts           # 网络、chain ID、token、ABI、EIP-712 types、Permit2 ABI
│   ├── types.ts               # ExactTronPayloadV2 (eip3009 + permit2) + type guards
│   ├── signer.ts              # ClientTronSigner / FacilitatorTronSigner + factories
│   ├── utils.ts               # 地址转换 + nonce + validity
│   ├── shared/
│   │   ├── permit2.ts         # Permit2 签名构造 + 类型定义
│   │   └── extensions.ts      # EIP-2612 permit（无 approval sponsoring，TRON approve 要求 msg.sender）
│   └── exact/
│       ├── index.ts
│       ├── client/
│       │   ├── index.ts
│       │   ├── scheme.ts      # SchemeNetworkClient (路由 eip3009/permit2)
│       │   ├── eip3009.ts     # createEIP3009Payload
│       │   └── permit2.ts     # createPermit2Payload
│       ├── server/
│       │   ├── index.ts
│       │   └── scheme.ts      # SchemeNetworkServer
│       └── facilitator/
│           ├── index.ts
│           ├── scheme.ts      # SchemeNetworkFacilitator (路由 eip3009/permit2)
│           ├── eip3009.ts     # eip3009 verify + settle
│           ├── eip3009-utils.ts # ecrecover + simulate + diagnose
│           ├── permit2.ts     # permit2 verify + settle
│           └── errors.ts      # 两种路径的错误码
├── test/
│   ├── unit/
│   │   ├── types.test.ts              # type guard 严格校验
│   │   ├── signer.test.ts            # factory 创建 + isTronSignerWallet + config
│   │   ├── utils.test.ts             # 地址转换 + 金额转换 + 网络检查
│   │   ├── client-eip3009.test.ts
│   │   ├── client-permit2.test.ts
│   │   ├── facilitator-eip3009.test.ts
│   │   └── facilitator-permit2.test.ts
│   └── integrations/
│       ├── exact-tron-eip3009.test.ts  # Nile + 自部署 TIP-3009 token
│       └── exact-tron-permit2.test.ts  # Nile + 自部署 Permit2 + 标准 TRC-20
```

pnpm-workspace 通过 `packages/mechanisms/*` 自动注册。

### 工作量

| 模块 | 行数 | 难度 | 说明 |
|------|-----|------|------|
| constants.ts | ~150 | 低 | 网络/token/ABI + Permit2 ABI + 合约地址 |
| types.ts | ~60 | 低 | eip3009 payload + permit2 payload + type guards |
| signer.ts | ~120 | 中 | Client + Facilitator 接口 + TronWeb factories |
| utils.ts | ~80 | 低 | 地址转换 + nonce + validity |
| shared/permit2.ts | ~120 | 中 | Permit2 签名构造 + 类型（参照 EVM permit2.ts） |
| shared/extensions.ts | ~50 | 低 | EIP-2612 permit（无 approval sponsoring） |
| exact/client/scheme.ts + eip3009.ts + permit2.ts | ~120 | 中 | 路由 + 两种 payload 构造 |
| exact/server/scheme.ts | ~50 | 低 | parsePrice + enhanceRequirements |
| exact/facilitator/scheme.ts + eip3009.ts + permit2.ts | ~350 | **高** | 两种路径的 verify + settle |
| exact/facilitator/eip3009-utils.ts | ~100 | 中 | ecrecover + simulate + diagnose |
| exact/facilitator/errors.ts | ~50 | 低 | 两种路径的错误码 |
| index.ts | ~90 | 低 | 统一导出，按类别组织（对标 AVM 90 行） |
| 测试 | ~450 | 中 | types + signer + utils + client×2 + facilitator×2 + integration×2 |
| 配置 + README | ~280 | 低 | package.json (subpath exports) + 复制 avm 配置 + README |
| **合计** | **~2,080** | | 对标 AVM 2,010 行 + Permit2 路径额外 ~900 行 |

### package.json 关键配置

```json
{
  "name": "@x402/tron",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "exports": {
    ".": { "import": "./dist/esm/index.mjs", "require": "./dist/cjs/index.js", "types": "./dist/cjs/index.d.ts" },
    "./exact/client": { "import": "./dist/esm/exact/client/index.mjs", "require": "./dist/cjs/exact/client/index.js" },
    "./exact/server": { "import": "./dist/esm/exact/server/index.mjs", "require": "./dist/cjs/exact/server/index.js" },
    "./exact/facilitator": { "import": "./dist/esm/exact/facilitator/index.mjs", "require": "./dist/cjs/exact/facilitator/index.js" }
  },
  "dependencies": {
    "@x402/core": "workspace:^",
    "tronweb": "^6.0.0",
    "ethers": "^6.0.0"
  }
}
```

### 核心实现

> 各文件的具体代码模板见 **[TRON_CONTRIBUTION_CODE.md](TRON_CONTRIBUTION_CODE.md)**。
> 以下只列关键设计点和工作量体现。

| 文件 | 职责 | 关键技术点 |
|------|------|-----------|
| `constants.ts` | 网络/token/ABI/合约地址 | Permit2 地址: Mainnet `TTJxU3P8rH...` / Nile `TCJjTtzwRJ...` |
| `types.ts` | eip3009 + permit2 payload 联合类型 | type guard 区分两种 payload |
| `signer.ts` | Client + Facilitator 接口 + factory | vs EVM: Base58 地址, `functionSelector` 替代 ABI, 无 `verifyTypedData`/`getCode` |
| `utils.ts` | 地址转换 + 金额 + 网络 | `tronToEvmHex()` / `evmHexToTron()` — 所有签名/验证都需要 |
| `shared/permit2.ts` | Permit2 EIP-712 类型 + 签名构造 | bitmap nonce（非 bytes32 随机），`PermitTransferFrom` 类型定义 |
| `shared/extensions.ts` | EIP-2612 permit | **无 approval sponsoring** — TRON `approve()` 要求 `msg.sender` |
| `exact/client/*.ts` | 路由 + 两种 payload 构造 | eip3009: TIP-712 签名; permit2: Permit2 签名, spender=facilitator |
| `exact/server/scheme.ts` | parsePrice + enhanceRequirements | MoneyParser chain（对标 AVM） |
| `exact/facilitator/*.ts` | 两种路径的 verify + settle | ecrecover 验签(非 ERC-1271), `triggerConstantContract` 模拟, `triggerSmartContract` 结算 |
| `exact/facilitator/errors.ts` | 20 个错误码 | 公共 8 + eip3009 专有 6 + permit2 专有 4 + 结算 2 |

### 代码来源

| 目标文件 | BofAI 来源 | Foundation 参考 |
|---------|-----------|----------------|
| constants.ts | `config.ts` + `tokens.ts` | `evm/constants.ts` |
| types.ts | `types/payment.ts` | `evm/types.ts` |
| utils.ts | `address.ts:TronAddressConverter` | `evm/utils.ts` |
| signer.ts | `signers/signer.ts` | `evm/signer.ts` |
| shared/permit2.ts | 无 | `evm/shared/permit2.ts`（697 行，TRON 精简版） |
| shared/extensions.ts | 无 | `evm/shared/extensions.ts` |
| exact/client/scheme.ts | 无 | `evm/exact/client/scheme.ts`（路由结构） |
| exact/client/eip3009.ts | `nativeExactTron.ts` | `evm/exact/client/eip3009.ts` |
| exact/client/permit2.ts | 无 | `evm/exact/client/permit2.ts` |
| exact/server | 无 | `evm/exact/server/eip3009.ts` |
| exact/facilitator/scheme.ts | 无 | `evm/exact/facilitator/scheme.ts`（路由结构） |
| exact/facilitator/eip3009.ts | Python `facilitator.py` | `evm/exact/facilitator/eip3009.ts` |
| exact/facilitator/permit2.ts | 无 | `evm/exact/facilitator/permit2.ts` |

### 排除 BofAI 专有内容

- `exact_permit` / `exact_gasfree` scheme
- `@bankofai/agent-wallet` 依赖
- PaymentPermit / GasFree 合约地址和 ABI
- BofAI 专有 RPC / facilitator proxy URL

### 额外文件

| 文件 | 操作 |
|------|------|
| `.github/workflows/publish_npm_scoped_x402_tron.yml` | 复制 avm 版改包名 |
| `typescript/.changeset/tron-exact-support.md` | `pnpm changeset` |
| `examples/typescript/*/advanced/all_networks.ts` | 加 TRON |
| `e2e/src/networks/networks.ts` | 加 `tron` ProtocolFamily + Nile |

### 测试（对标 AVM 406 行 unit + 553 行 integration）

**单元测试：**

| 文件 | 测试内容 | 对标 AVM |
|------|---------|---------|
| `types.test.ts` | `isEip3009Payload()` / `isPermit2Payload()` 严格校验：valid/invalid/null/missing fields | `types.test.ts` (98 行) |
| `signer.test.ts` | `toClientTronSigner()` / `toFacilitatorTronSigner()` factory + `isTronSignerWallet()` + config | `signer.test.ts` (208 行) |
| `utils.test.ts` | 地址转换 + `convertToTokenAmount` / `convertFromTokenAmount` + 网络检查 | `index.test.ts` (100 行) |
| `client-eip3009.test.ts` | eip3009 payload 构造（mock signer） | — |
| `client-permit2.test.ts` | permit2 payload 构造（mock signer） | — |
| `facilitator-eip3009.test.ts` | verify 各 error path（23 个错误码） | — |
| `facilitator-permit2.test.ts` | verify 各 error path | — |

**集成测试 env vars（对标 AVM CLIENT_PRIVATE_KEY / FACILITATOR_PRIVATE_KEY / SERVER_ADDRESS）：**

| 变量 | 说明 | 必须 |
|------|------|------|
| `TRON_CLIENT_PRIVATE_KEY` | Client 私钥 (hex) | 是 |
| `TRON_FACILITATOR_PRIVATE_KEY` | Facilitator 私钥 (hex) | 是 |
| `TRON_GRID_API_KEY` | TronGrid API Key | 否（Nile 限速低可不用） |
| `TRON_EIP3009_TOKEN` | 自部署的 TRC20WithAuthorization 地址 (Base58) | 是 |
| `TRON_PERMIT2_ADDRESS` | 自部署的 Permit2 合约地址 (Base58) | permit2 测试需要 |
| `TRON_TRC20_TOKEN` | 标准 TRC-20 token 地址 (Base58, 用于 permit2 测试) | permit2 测试需要 |

**集成测试流程：**
1. `exact-tron-eip3009.test.ts` — x402Client → x402ResourceServer → x402Facilitator 完整流程，使用自部署 TIP-3009 token
2. `exact-tron-permit2.test.ts` — 同上，使用自部署 Permit2 + 标准 TRC-20 token

---

## 7. Python `x402[tron]`

**分支：** `feature/tron-exact-py`

**PR：** `feat(tron): add Python x402 TRON exact scheme implementation`

### 包结构

```
python/x402/mechanisms/tron/
├── __init__.py
├── constants.py       # CAIP-2, chain ID, token, ABI, Permit2
├── types.py           # eip3009 + permit2 payload TypedDicts
├── signer.py          # Protocol definitions
├── signers.py         # tronpy 实现
├── utils.py           # 地址转换, nonce
├── shared/
│   ├── __init__.py
│   ├── permit2.py     # Permit2 签名构造 + 类型
│   └── extensions.py  # EIP-2612 + approval sponsoring
├── exact/
│   ├── __init__.py
│   ├── client.py      # SchemeNetworkClient (路由 eip3009/permit2)
│   ├── server.py      # SchemeNetworkServer
│   ├── facilitator.py # SchemeNetworkFacilitator (路由 eip3009/permit2)
│   ├── eip3009.py     # eip3009 verify + settle
│   └── permit2.py     # permit2 verify + settle
```

### 依赖

```toml
[project.optional-dependencies]
tron = ["tronpy>=4.0.0"]
```

### 来源

TypeScript 的 Python 镜像。BofAI Python 实现去掉 ChainAdapter 抽象层直接实现。

---

## 8. Open Questions

| # | 问题 | 状态 | 结论 |
|---|------|------|------|
| **Q1** | ecrecover 用什么库？`ethers` +1.5MB vs `@ethereumjs/util` 手动 hash | 待定 | **ethers** — 最可靠 |
| **Q2** | TronWeb v6 signTypedData API？`_signTypedData()` 还是手动 hash + sign？ | **已解决** | V4 开发中已验证 |
| **Q3** | triggerConstantContract 参数编码？TronWeb v6 自动还是手动？ | **已解决** | V4 开发中已验证 |
| **Q4** | TIP-712 chainId 截断？`block.chainid & 0xffffffff` — 现有 ID 是否已在 32-bit 范围内？ | 待实测 | Nile 实测确认 |
| **Q5** | TIP-3009 参考合约的 DOMAIN_SEPARATOR 中 chainId 应该用原值还是截断值？ | **已解决** | V4 开发中已验证 |
| **Q6** | SUN.io Permit2 的 `DOMAIN_SEPARATOR` 具体参数？ | **已解决** | 用 `block.chainid` **原值**（非截断）。见 [EIP712.sol](https://github.com/sun-protocol/sunswap-permit2/blob/main/contracts/EIP712.sol): `abi.encode(typeHash, nameHash, block.chainid, address(this))` |
| **Q7** | Permit2 的 `allowance()` 返回值？ | **已解决** | 返回 `(amount: uint160, expiration: uint48, nonce: uint48)`。`Permit2Helper.checkPermit2Allowance()` 封装了 amount/expiration/buffer 三重检查。见 [Permit2Helper.sol](https://github.com/sun-protocol/sunswap-permit2/blob/main/contracts/Permit2Helper.sol) |
| **Q8** | SUN.io Permit2 是否已部署到 Nile？ | **已解决** | 已部署。Permit2: `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx`，Permit2Helper: `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` |

---

## 9. 参考

**Foundation 仓库：**
- `CONTRIBUTING.md:132-189` — 3-PR 新链工作流
- `specs/schemes/exact/scheme_exact_evm.md` — EVM spec（结构参考）
- `typescript/packages/mechanisms/avm/` — AVM 包（模板）
- `typescript/packages/core/src/types/mechanisms.ts` — Foundation 核心接口

**先例：**
- PR #1560 Algorand — MERGED，完整独立包
- PR #1455 TON — OPEN，spec-only

**EVM 双路径参考（关键）：**
- `evm/src/exact/client/scheme.ts` — assetTransferMethod 路由（eip3009 / permit2）
- `evm/src/exact/client/permit2.ts` — Client Permit2 payload 构造
- `evm/src/exact/facilitator/permit2.ts` — Facilitator Permit2 verify + settle
- `evm/src/shared/permit2.ts` — Permit2 完整实现（697 行）
- `evm/src/shared/extensions.ts` — EIP-2612 / ERC-20 approval fallback（TRON 仅支持 EIP-2612，无 approval sponsoring）
- `evm/src/shared/defaultAssets.ts` — MegaETH/Mezo 的 permit2 配置
