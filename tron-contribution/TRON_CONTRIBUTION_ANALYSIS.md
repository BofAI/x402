# TRON exact scheme — 决策备忘录

> **目的：** 记录关键决策和依据。
>
> 提案内容见 [TRON_PROPOSAL.md](TRON_PROPOSAL.md)，代码实施见 [TRON_CONTRIBUTION_IMPL.md](TRON_CONTRIBUTION_IMPL.md)。

## 决策摘要

| 决策项 | 结论 | 依据 |
|-------|------|------|
| 包架构 | 独立 `@x402/tron` | Foundation 5/5 链都是独立包，不侵入 `@x402/evm` |
| assetTransferMethod | `eip3009` + `permit2` 都做 | eip3009 覆盖 TIP-3009 token，permit2 覆盖现有 TRC-20（USDT 等） |
| 参照模板 | `@x402/avm`（Algorand，PR #1560） | 唯一只有 exact + 无 v1 + 有 errors.ts + 已 merged 的非 EVM 包 |
| Token 风险 | 主网 USDT 不支持 `transferWithAuthorization` | 通过 Permit2 合约解决，并行推 TIP-3009 |
| Permit2 合约 | 我们（SUN.io）已部署（`TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9`） | 自家合约，2026-02-05 上线 |
| 推进路线 | D：Foundation SDK + TIP-3009 并行 | 互相背书，最快推进 |
| 提交时机 | 现在提 Issue，不等加入基金会 | Issue 就是敲门砖，贡献即加入（见 §6） |

---

## 1. 方案对比：独立 `@x402/tron` vs 扩展 `@x402/evm`

### 方案 A: 在 `@x402/evm` 里加 TRON 支持

TRON 和 EVM 在协议层共享 ERC-3009 签名结构，直觉上应该放一起。但逐文件分析后发现实现层完全不兼容：

| 改动点 | 现状 | TRON 需要 | 风险 |
|-------|------|----------|------|
| **`utils.ts:getEvmChainId()`** | 只接受 `eip155:` 前缀 | 加 `tron:` 分支，查表返回 chain ID | 低 |
| **`signer.ts:ClientEvmSigner`** | `address: \`0x${string}\`` 写死 20 字节 hex | Base58 (`T...`) 无法塞进 `0x` 类型。放宽为 `string` → 丢失所有 EVM 用户的类型安全；泛型 → 全量改动 | **极高** |
| **`signer.ts:FacilitatorEvmSigner`** | `readContract({abi, functionName, args})`, `writeContract(...)`, `verifyTypedData(...)`, `getCode(...)`, `waitForTransactionReceipt({hash})` | `readContract({functionSelector, parameter[]})`, `writeContract({functionSelector, parameter[], feeLimit})`, 无 verifyTypedData, 无 getCode, `waitForConfirmation(txId)` — **5 个方法签名全面不兼容** | **极高** |
| **`exact/facilitator/eip3009.ts`** | 依赖 viem `getAddress()`, `isAddressEqual()`, `parseErc6492Signature()`；ERC-1271 smart wallet 验签 ~40 行；ERC-6492 检测 ~20 行 | TRON 无 ERC-1271/ERC-6492，这些全是死代码。需要 `if (isTron)` 跳过或大规模重构 | 高 |
| **`eip3009-utils.ts`** | `simulateEip3009Transfer()` 用 Multicall3 批量调用；`diagnoseFailure()` 用 Multicall3 批量诊断；`executeTransfer()` 用 viem `parseSignature` + `writeContract` | TRON 无 Multicall3，需逐个 `triggerConstantContract`；执行用 `triggerSmartContract`。**三个核心函数都不可复用** | 高 |
| **`shared/rpc.ts`** | viem `createPublicClient()` / `PublicClient` | TronWeb 实例，API 完全不同。需并行维护两套 RPC 工厂 | 高 |
| **`package.json`** | `dependencies: { viem, zod }` | 加 `tronweb` (+5MB)，所有 EVM 用户都要下载，即使从不用 TRON | 中 |

**方案 A 总结：**

| 维度 | 评估 |
|------|------|
| 可复用代码 | ~65 行（EIP-712 types + createNonce + createValidityWindow） |
| 需改动的现有文件 | 8-12 个核心文件 + 全部测试 |
| 类型安全 | 破坏（地址类型必须放宽或泛化） |
| Signer 接口 | 必须重写（5 个方法签名不兼容） |
| 对 EVM 用户 | 有影响（类型变化 + 依赖增加 + 死代码路径） |
| Review 难度 | 高（改动面广，需 EVM + TRON 双专家） |
| 合并概率 | 低（违反 Foundation "一链一包" 架构惯例，5/5 现有链都独立） |

方案 A 唯一的优点是"ERC-3009 是一个族"的语义清晰，但为了 65 行复用去重写 signer 接口、破坏类型安全、加 5MB 依赖，ROI 极差。

### 方案 B: 独立 `@x402/tron` 包 — 推荐 ✅

| 维度 | 评估 |
|------|------|
| 需改动的现有文件 | **0 个**（纯新增） |
| 类型安全 | 完整（TRON 类型独立定义，Base58 地址、TronWeb 方法签名） |
| Signer 接口 | 为 TRON 量身设计，无需妥协 |
| 对 EVM 用户 | **零影响** |
| 依赖隔离 | `tronweb` 只在 `@x402/tron` 里，EVM 用户不用下载 |
| 代码重复 | ~65 行（EIP-712 types 10 行 + createNonce 5 行 + ExactPayload 15 行 + createValidityWindow 5 行 + verify 骨架 30 行） |
| Review 难度 | 低（自包含 PR，无跨包影响） |
| 合并概率 | 高（符合 Foundation 架构惯例：EVM/SVM/AVM/Aptos/Stellar 全部独立） |

### 对比结论

```
方案 A: 复用 65 行代码 → 改 8-12 个文件 + 重写 signer + 破坏类型安全 + 5MB 依赖 + 违反架构惯例
方案 B: 重复 65 行代码 → 改 0 个文件 + 零影响 + 符合架构惯例
```

**选方案 B。**

---

## 2. 为什么选 AVM 做模板

| 维度 | EVM | SVM | AVM | Aptos | Stellar |
|------|-----|-----|-----|-------|---------|
| 文件数 | 50 | 22 | **13** | 12 | 13 |
| 代码行 | 6,348 | 2,429 | **2,010** | 977 | 1,580 |
| scheme | exact+upto | exact | **exact** | exact | exact |
| 有 v1 | 有 | 有 | **无** | 无 | 无 |
| errors.ts | 有 | 无 | **有** | 无 | 无 |
| 已 merged | — | — | **PR #1560** | — | — |

AVM 是唯一满足全部条件的：只有 exact、无 v1 包袱、有 errors.ts、不依赖 viem、最近 merged。

照搬的是**骨架**（目录、配置、接口模式、CI），不是业务逻辑。

---

## 3. TRON Token 风险

**TRON 主网 USDT 不支持 `transferWithAuthorization`。**

验证结果（2026-04-16）：`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` 只有 15 个标准 TRC-20 函数，无 ERC-3009。Circle 已停止 TRON USDC。

| 影响 | 说明 |
|------|------|
| 开发测试 | 不受影响（Nile 上自部署测试 token） |
| Foundation 贡献 | SDK 仍有价值，需坦诚说明 |
| 生产部署 | 需等 token 支持 |

**路线 D（并行推进）：** 同时向 Foundation 提 SDK + 向 TRON 社区提 TIP-3009。TIP 定义标准，SDK 是第一个消费者，互相背书。

---

## 4. 合约策略

| 合约 | 用途 | 来源 |
|------|------|------|
| **Permit2** | 覆盖所有现有 TRC-20（USDT 等） | **SUN.io 已部署**，开源，基于 Uniswap Permit2 |
| **Permit2Helper** | Permit2 辅助合约 | SUN.io 部署，配合 Permit2 使用 |
| **TIP-3009 参考合约** | 实现 `transferWithAuthorization` 的 TRC-20 | 我们自己部署（Nile + 主网） |

### 合约地址

| 网络 | Permit2 | Permit2Helper |
|------|---------|---------------|
| **Mainnet** | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` | `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL` |
| **Nile** | `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx` | `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` |

**开源仓库：** https://github.com/sun-protocol/sunswap-permit2

**Permit2 已由我们（SUN.io）部署到主网和 Nile 测试网，** 基于 Uniswap Permit2 + TIP-712 签名，配合 Universal Router 使用，2026-02-05 上线。代码完全开源。Atum-Labs 也曾开源过一个版本（`TJhMXTHQHeQyMD7TcKQFqAePNgG4b31H9m`，仓库已 404）。

**两种 assetTransferMethod 同时支持：**
- `eip3009` — 用于实现了 TIP-3009 的 token（自部署的 + 未来采纳标准的）
- `permit2` — 用于所有现有 TRC-20（USDT 等），通过 SUN.io 部署的 Permit2 合约

这和 EVM 的处理方式完全一致（EVM 也是 eip3009 + permit2 双路径）。

---

## 5. 跨链全景

| 维度 | EVM | SVM | AVM | Aptos | Stellar | **TRON** |
|------|-----|-----|-----|-------|---------|----------|
| 转账模型 | ERC-3009/Permit2 | SPL Transfer | Atomic Group | Move function | Soroban auth | ERC-3009/Permit2 |
| 签名 | EIP-712 ECDSA | Ed25519 | Ed25519 | Ed25519 | Ed25519 | TIP-712 ECDSA |
| 地址 | `0x` hex | Base58 | Base32 | `0x` hex | `G-` | Base58 `T-` |
| Gas 代付 | Facilitator 调合约 | Facilitator 签 tx | Fee payer 原子组 | Fee payer 多签 | Fee bump | Facilitator 调合约 |
| 链 SDK | viem | @solana/web3.js | algokit-utils | @aptos-labs/ts-sdk | stellar-sdk | tronweb |
| 依赖合约特殊接口 | 是(ERC-3009)/否(Permit2) | 否 | 否 | 否 | 否 | 是(ERC-3009)/否(Permit2) |

TRON 和 EVM 的处理方式对齐：ERC-3009 路径依赖 token 合约特殊接口，Permit2 路径覆盖所有标准 TRC-20。Permit2 合约已由我们（SUN.io）部署到主网。

---

## 6. 提交时机与加入基金会策略

### 当前准备度

| 条件 | 状态 |
|------|------|
| 文档准备（Spec / Impl / Analysis） | ✅ 完成 |
| SUN.io Permit2 主网合约 | ✅ 已部署运行（2026-02-05） |
| BofAI SDK 生产验证 | ✅ 已上线 |
| BSC 互操作验证（Coinbase 官方 client/server） | ✅ 通过（2026-04-03） |

### "先加入再贡献" vs "贡献即加入"

开源社区的惯例是**先贡献代码/提案，再谈治理身份**。不需要等"正式加入基金会"这个动作才开始提交。Issue 和 PR 本身就是最好的入场方式。

| 策略 | 做法 | 评估 |
|------|------|------|
| A: 立即提 Issue | 现在提 Issue，占位 + 展示意图 | spec review 可能等，但先发优势明确 |
| B: Issue + Spec PR 一起 | 现在提 Issue 并同时提 Spec PR | 更有诚意，reviewer 直接看到完整方案 |
| C: 等加入基金会后再提 | 走完正式流程再提 | 失去先发优势，且"加入"流程本身不明确 |
| **D: Issue 探路 + 同步申请** | **现在提 Issue，同步联系维护者，并行推进** | **推荐** |

### 推荐：策略 D

**Issue 就是最好的敲门砖。**

1. **Issue 证明实力** — 生产级 Permit2 合约、已上线 SDK、互操作验证，比任何申请表都有说服力
2. **降低风险** — 如果 Foundation 对 TRON 方向有不同想法，在 Issue 阶段发现比写完代码再发现好
3. **建立关系** — Issue 讨论过程中自然和维护者建立联系，为后续 PR review 铺路
4. **竞争窗口** — TON 已提 spec PR (#1455, open)，Algorand 已 merged (#1560)，先提 = 先占位

### 执行顺序

```
现在
 ├─ 1. 提 Issue（用 TRON_PROPOSAL.md §1 内容）
 ├─ 2. 同步联系 Foundation 维护者（如有渠道）
 │
Issue 得到正面回应后
 ├─ 3. 提 PR1 Spec（用 TRON_PROPOSAL.md §2 内容）
 │
Spec review 期间
 ├─ 4. 本地开发 PR2 TypeScript（用 TRON_CONTRIBUTION_IMPL.md）
 ├─ 5. 如有正式加入基金会的流程，同步走
 │
Spec merged 后
 └─ 6. 提 PR2 TypeScript → PR3 Python
```

**核心原则：不等。贡献就是最好的入会申请。**

---

## 背景补充

### 协议层一致性

TRON ERC-3009 与 EVM 完全相同的签名结构和链上接口。TIP-712 对标 EIP-712，有一个 chainId 截断细节需验证（见实施文档 Q4）。

### 实现层差异

地址 Base58 vs `0x`、SDK TronWeb vs viem、CAIP-2 `tron:` vs `eip155:`、Chain ID 查表 vs 解析、无 ERC-1271/ERC-6492/Multicall3。
