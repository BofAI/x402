---
title: EVM 当前行为与 TRON 可借鉴能力分析
date: 2026-08-27
status: analysis
scope:
  - typescript/packages/mechanisms/evm
  - typescript/packages/mechanisms/tron
baseline: main@3be4d46b (v1.1.0)
tags:
  - evm
  - tron
  - exact
  - upto
  - batch-settlement
  - settlement-pending
---

# EVM 当前行为与 TRON 可借鉴能力分析

> 本文是实现差异与演进建议，不是协议规范。协议 wire format 和 scheme 定义以仓库根目录 `specs/` 为准。

## 1. 结论摘要

TRON 已经对齐 EVM 的主要协议骨架：`exact`、`upto`、`batch-settlement`、TIP-712/Permit2、facilitator witness 和累计 voucher；同时拥有 TRON 特有的 `exact_gasfree`。因此下一阶段不应优先复制更多目录或类，而应同步 EVM 已经形成的安全边界和异常处理语义。

建议按以下优先级推进：

| 优先级 | 能力 | 判断 |
| --- | --- | --- |
| P0 | 统一 `settlement_pending` 与交易哈希保留语义 | 应直接借鉴 EVM 的通用 receipt 状态机 |
| P0 | exact/upto/batch 验证阶段链上模拟、合约存在性检查、fail-closed | 当前 TRON 存在 optimistic verify，应尽快收紧 |
| P0 | batch-settlement channelId 绑定、验证后原子预留、并发清理 | 大部分逻辑与链无关，可按 EVM 实现移植 |
| P1 | batch 文件/Redis 持久化 | 可复用 EVM 设计，但必须先完成 channelId 安全校验 |
| P1 | 默认资产反向查询和未知 decimals 处理 | 小改动，高正确性收益 |
| P1/P2 | Permit2 approval sponsoring | 借鉴扩展模型，不能直接复制 EVM 预签交易格式 |
| P2 | auth-capture | 需先有 TVM escrow/collector 合约和审计，不能只移植 SDK client |
| 不直接移植 | ERC-1271、ERC-6492、ERC-7702、EVM calldata suffix | 属于 EVM 账户或 calldata 语义，应设计 TRON 等价能力 |

## 2. 分析基线与说明

- 当前分支：`main`
- 当前提交：`3be4d46b`
- 发布标签：`v1.1.0`
- 分析日期：2026-08-27
- 判断来源：当前 `src/`、`package.json` 导出和单元测试，而不是单独依赖 README/TODO。

EVM 的 `README.md` 和 `TODO.md` 已落后于当前实现。例如 TODO 仍把 Permit2、upto 记为计划项，但源码和导出已经包含 Permit2、upto、batch-settlement 和 auth-capture client。因此后续能力盘点必须以代码和测试为准。

验证基线：

```text
@bankofai/x402-evm:  38 files / 830 tests passed
@bankofai/x402-tron: 19 files / 157 tests passed
```

上述测试均通过。测试数量本身不代表质量结论，但 TRON 当前确实缺少 EVM 已覆盖的 pending receipt、链上模拟、非法 channelId、并发 reservation 和存储失败等回归场景。

## 3. 当前 EVM 的主要行为

### 3.1 exact

客户端根据 `requirements.extra.assetTransferMethod` 选择支付路径：

- `eip3009`：签署 `TransferWithAuthorization`；
- `permit2`：签署带 `to + validAfter` witness 的 `PermitWitnessTransferFrom`；
- 未指定时默认 `eip3009`，用于兼容旧 facilitator；
- 授权的 `validAfter` 固定为 `0`，减少客户端时钟、队列延迟和区块时间差造成的失败；
- Permit2 allowance 不足时，依次尝试 EIP-2612 gas sponsoring 和预签 ERC-20 approval sponsoring，最后才使用已有 allowance 的直接 settle。

服务端负责：

- 价格解析和默认资产选择；
- 为 token 附带 `assetTransferMethod`、EIP-712 name/version 等元数据；
- 声明 ATM 对应的 payment flow；
- 未知资产的 decimals 返回 `undefined`，防止 `$...` settlement override 使用错误精度。

facilitator 验证包含：

- scheme、network、recipient、token、spender、amount 和时间窗口；
- EOA、EIP-1271、ERC-6492、ERC-7702 对应的严格签名路径；
- token 地址必须存在已部署 bytecode；
- 默认执行真实 settle 调用模拟；
- 根据 allowance、balance、nonce、proxy deployment、signature 等信息诊断模拟失败；
- settle 前重新验证，广播后使用统一 receipt helper 判断终态。

EIP-3009 receipt 存在 logs 时，还会要求出现符合 token、from、to、amount 的 ERC-20 `Transfer` 事件，避免“交易未 revert 但实际没有转账”的静默成功。

### 3.2 upto

`upto` 只使用 Permit2：

- `permitted.amount` 是授权上限；
- witness 包含 `to`、`facilitator`、`validAfter`；
- 只有 witness 绑定的 facilitator 可以调用代理合约 settle；
- verify 阶段以最大授权金额验证签名和最坏情况可结算性；
- settle 阶段允许实际金额小于等于上限；
- 实际金额为 `0` 时直接返回成功，不发送链上交易；
- 同样支持 EIP-2612、ERC-20 approval sponsoring、链上模拟和 `settlement_pending`。

### 3.3 batch-settlement

EVM batch-settlement 的生命周期是：

```text
首次/补充 deposit
  -> 多次离线累计 voucher
  -> server 本地验证并记账
  -> facilitator 批量 claim
  -> receiver settle
  -> 剩余余额 cooperative refund
```

当前实现的重要行为：

- client 支持 deposit policy、自定义 deposit strategy、payerAuthorizer 委托、状态恢复和协作退款；
- server 支持内存、文件和 Redis/Valkey 存储；
- server 可在缓存链上状态仍新鲜时本地验证 EOA voucher，减少 facilitator RPC；
- 同一 channel 的请求通过 pending reservation 串行化；
- channelId 在访问存储前必须验证为规范 `bytes32`，并重新计算确认它与 `channelConfig + network` 绑定；
- `onBeforeVerify` 只读取快照，不修改存储；
- facilitator 验证成功后，`onAfterVerify` 再原子写入 reservation；
- 并发 busy、过期 reservation、stale cumulative base、handler failure、extension abort 都有清理规则；
- deposit、claim、settle、refund 均区分 revert 和 `settlement_pending`。

### 3.4 auth-capture

当前 EVM 仅发布 auth-capture client：

- client 构造 payer-agnostic `PaymentInfo` hash；
- 支持 EIP-3009 或 Permit2 预授权；
- 目标语义是资金进入 escrow 后再 capture、void 或 refund；
- 当前包尚未包含 auth-capture server/facilitator 完整闭环。

因此它可以作为 TRON 未来 escrow 方案的协议设计参考，但不能当作现成的可移植完整能力。

## 4. TRON 已经对齐或更适合保留的能力

TRON 当前已经实现：

- `exact` 的 TIP-712 TransferWithAuthorization 与 Permit2；
- `upto` 的三字段 facilitator witness 和部分金额结算；
- `batch-settlement` 的 deposit、voucher、claim、settle、refund 主生命周期；
- `validAfter = 0`；
- mainstream TRC-20 默认选择 Permit2；
- client 自动检查 Permit2 allowance，必要时发送一次 `approve(Permit2, MAX_UINT256)`；
- wallet-only signer factory、permissionId、多签 transaction signing；
- packed block receipt 查询，避免把 preconfirm 的临时 `REVERT` 当成最终结果；
- `exact_gasfree`、GasFree provider 校验和 relayer settle。

这些能力不应为了表面对称而替换成 EVM 模型。特别是 GasFree 是 TRON 的网络原生优势，应与 Permit2 路径并存。

## 5. P0：统一 settlement receipt 状态机

### 5.1 当前差异

TRON 的 `pollTransactionPacked` 已返回三种状态：

```text
success | reverted | pending
```

但 exact、upto 和 batch facilitator 目前普遍使用：

```ts
if (receipt.status !== "success") {
  return { success: false, errorReason: "invalid_transaction_state", transaction: tx };
}
```

这会把“交易已广播、暂时无法确认”错误地当成终态失败。调用方若据此重新付款或重发 settle，可能产生重复处理或错误恢复决策。

### 5.2 建议行为

抽取 TRON 通用 `waitAndReturnSettleResponse`，与 EVM 统一语义：

| 条件 | 返回 |
| --- | --- |
| txid 无效、为空或明显是占位值 | 终态失败，不返回 pending |
| receipt 为 `success` 且效果校验通过 | `success: true` |
| receipt 明确为 `reverted` | 终态失败，保留 txid |
| receipt wait 超时、RPC 异常、receipt 后处理异常 | `settlement_pending`，保留 txid |

所有已广播路径都应复用：

- exact EIP-3009 / Permit2；
- upto Permit2；
- batch deposit / claim / settle / refund；
- client 一次性 Permit2 approve，如调用侧需要向用户表达 pending。

### 5.3 验收测试

- receipt 超时返回 `settlement_pending` 和原 txid；
- RPC 抛错返回 `settlement_pending`；
- 明确 revert 返回 scheme-specific terminal error；
- 空 txid/无效 txid 不得返回 pending；
- receipt 成功但效果校验抛错时返回 pending，而不是误报成功。

## 6. P0：验证阶段链上模拟与 fail-closed

### 6.1 当前风险

TRON exact/upto Permit2 当前会分别读取 allowance 和 balance，但读取失败时继续验证：

```ts
try {
  // read allowance / balance
} catch {
  // proceed optimistically
}
```

exact EIP-3009 的 balance 读取同样会在失败后继续。结果是 RPC 故障、ABI 错误、普通账户伪装成 token 或 proxy 状态异常时，facilitator 仍可能返回 `isValid: true`，问题被推迟到广播阶段。

### 6.2 建议实现

1. 扩展 `FacilitatorTronSigner`：
   - 合约存在性查询；
   - `triggerConstantContract` 或等价 full-node 模拟调用；
   - receipt logs 返回。
2. exact/upto verify 在字段和签名校验后模拟真实 `settle`。
3. token 地址必须解析为已部署 TRC-20 合约，不能只是合法账户地址。
4. RPC 无法建立验证状态时 fail closed，返回稳定且不泄露敏感信息的错误码。
5. 对模拟失败做分层诊断：
   - allowance 不足；
   - balance 不足；
   - nonce 已使用；
   - deadline/validAfter；
   - spender/token/recipient mismatch；
   - proxy 未部署或调用失败；
   - 未知 simulation failure。
6. exact 结算成功后，从 `gettransactioninfobyid` 的 logs 校验预期 TRC-20 `Transfer` 事件。
7. malformed payload、地址或 BigInt 转换异常统一转换为稳定 `VerifyResponse`。

### 6.3 settle re-verify

可沿用 EVM 模型：

- 第一次公开 verify 默认执行模拟；
- settle 前重新验证签名和字段；
- 是否再次模拟由 facilitator 配置控制，避免重复 RPC 成本；
- 对高风险或长队列场景允许开启 `simulateInSettle`。

## 7. P0：移植 batch-settlement 并发与存储安全模型

### 7.1 当前差异

TRON `handleBeforeVerify` 当前会直接使用 payload 中的 `channelId` 调用 `storage.updateChannel()` 并写入 pending reservation，随后才进入 facilitator 验证。

EVM 当前行为是：

```text
校验 channelId 规范和 binding
  -> 读取 channel snapshot
  -> 进行本地或 facilitator verify
  -> verify 成功后原子 reserve
  -> handler/settle
  -> commit 或精确清理自己的 reservation
```

### 7.2 建议直接移植的控制面逻辑

- `isCanonicalChannelId`；
- `normalizeChannelId`；
- `channelIdBindingError`；
- `verificationStateUnavailable`；
- `reservationCommitted` request context；
- verify 前只读 snapshot；
- verify 后 `updateChannel` 中原子检查 busy/stale 并 reserve；
- `after_verify_aborted` 清理；
- 存储 get/update 抛错时 fail closed；
- corrective 402 enrichment 前重新校验 channelId；
- 清理时只删除 pendingId 与当前请求匹配的 marker，不能覆盖后来的 reservation。

链相关部分仍保留 TRON 实现：

- `computeChannelId` 使用 TIP-712 domain；
- Base58 地址统一转 EVM hex 后哈希；
- voucher 使用 TRON typed-data recover；
- 合约地址按 TRON network registry 解析。

### 7.3 必须补充的测试

- 非 `0x + 64 hex` channelId 在任何存储访问前拒绝；
- channelId 与 channelConfig 不匹配时拒绝；
- facilitator verify 返回 invalid 时存储字节级不变；
- 两个同 channel 并发请求只能有一个 reserve 成功；
- snapshot 与 reserve 之间 cumulative base 变化时返回 stale；
- 过期 reservation 可被替换；
- storage.get/update 抛错时 fail closed；
- extension 在 after-verify 阶段 abort 时清理 reservation；
- 清理旧请求不能删除新请求的 pending marker。

## 8. P1：持久化和资产元数据

### 8.1 batch storage

EVM 已提供：

- client file storage；
- server file storage；
- server Redis/Valkey storage。

这些存储协议与 chain 无关，建议抽成共享实现或按同一接口为 TRON 导出。顺序上必须先完成第 7 节的 channelId 验证，否则把不可信 channelId 映射到文件路径会扩大攻击面。

### 8.2 默认资产查询

TRON 当前 `findDefaultAsset` 使用 Base58 字符串精确比较，而其他路径同时接受 Base58、`41...` 和 `0x...` 地址形式。建议：

- reverse lookup 使用统一地址规范化；
- symbol 使用大小写无关比较；
- 默认资产与 token registry 保持单一数据源；
- 未知 token 的 `getAssetDecimals` 返回 `undefined`，不默认假设 6 位；
- 只有 display-only 场景可以由 core 回退到 6 位，实际 `$...` settlement override 必须知道精确 decimals。

## 9. 条件借鉴能力

### 9.1 Permit2 approval sponsoring

EVM 有两条 allowance 补齐路径：

1. token 支持 EIP-2612 时，client 签 permit，facilitator 原子调用 `settleWithPermit`；
2. token 不支持 EIP-2612 时，client 提交预签 ERC-20 approval 交易，扩展 signer 广播 approval + settle。

TRON 可以借鉴扩展协商、验证和多交易执行接口，但不能直接复制第二条路径：TRON 交易包含 TAPOS、expiration 等短期链上下文，预签交易的有效期和重播模型不同于 EVM RLP 交易。

建议先调研：

- 目标 TRC-20 是否真实支持 `permit()`；
- relayer 是否能安全代付 approval；
- approval 与 settle 是否可通过代理合约原子完成；
- 预签 TRON transaction 在 HTTP 重试和队列延迟下的有效窗口；
- GasFree provider 是否能覆盖首次 allowance 建立。

mainstream TRON USDT/USDD 通常不支持 EIP-2612，因此该项优先级低于验证和 pending 语义。

### 9.2 auth-capture

可借鉴 EVM 的：

- payer-agnostic PaymentInfo hash；
- captureAuthorizer/operator 角色；
- capture/refund deadline；
- min/max fee 边界；
- authorize、capture、void、refund 生命周期。

但 TRON 需要独立完成：

- TVM escrow 和 token collector 合约；
- TIP-712 domain/address 规范；
- facilitator server 和 settle/cancel API；
- 合约审计与主网部署；
- GasFree/Permit2 两种入金路径的交互设计。

仅移植当前 EVM auth-capture client 会产生不可结算的半成品，因此不建议先做 SDK 表面兼容。

## 10. 不应直接复制的 EVM 能力

| EVM 能力 | 原因 | TRON 方向 |
| --- | --- | --- |
| ERC-1271 | EVM 合约签名标准 | 如需合约钱包，定义并验证 TVM 可执行的签名接口 |
| ERC-6492 | counterfactual smart wallet 部署与签名包装 | 使用 TRON 账户激活/GasFree account 生命周期 |
| ERC-7702 | EVM EOA delegation bytecode 语义 | 无直接等价物，不应模拟接口对称 |
| ERC-20 RLP approval extension | TRON 交易依赖 TAPOS/expiration | 设计 TRON-specific approval intent 或 relayer API |
| calldata suffix / builder code | 依赖 EVM calldata 与合约消费方式 | 先验证 TVM 合约调用是否允许并正确处理尾部数据 |

## 11. 推荐实施顺序

### 阶段 A：可靠性闭环

1. 新增 TRON receipt helper；
2. exact/upto/batch 全面采用 `settlement_pending`；
3. 扩展 receipt 返回 logs；
4. 增加 invalid txid、timeout、RPC error、revert 回归测试。

### 阶段 B：验证安全

1. signer 增加合约存在性和模拟接口；
2. exact EIP-3009 与 Permit2 fail-closed；
3. upto Permit2 fail-closed；
4. batch deposit/claim/settle/refund 模拟；
5. exact Transfer event 校验。

### 阶段 C：batch 状态机

1. port EVM channelId validation；
2. verify-before-reserve；
3. atomic busy/stale handling；
4. failure/abort cleanup；
5. 并发和存储失败测试。

### 阶段 D：产品能力

1. 文件/Redis storage；
2. 默认资产查询规范化；
3. TRON approval sponsoring 可行性验证；
4. auth-capture 合约和协议设计。

## 12. 关键源码索引

EVM：

- `typescript/packages/mechanisms/evm/src/exact/client/scheme.ts`
- `typescript/packages/mechanisms/evm/src/exact/facilitator/eip3009.ts`
- `typescript/packages/mechanisms/evm/src/exact/facilitator/permit2.ts`
- `typescript/packages/mechanisms/evm/src/upto/facilitator/permit2.ts`
- `typescript/packages/mechanisms/evm/src/shared/settleReceipt.ts`
- `typescript/packages/mechanisms/evm/src/batch-settlement/server/verify.ts`
- `typescript/packages/mechanisms/evm/src/batch-settlement/server/scheme.ts`
- `typescript/packages/mechanisms/evm/src/auth-capture/`

TRON：

- `typescript/packages/mechanisms/tron/src/signer.ts`
- `typescript/packages/mechanisms/tron/src/exact/facilitator/eip3009.ts`
- `typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts`
- `typescript/packages/mechanisms/tron/src/upto/facilitator/permit2.ts`
- `typescript/packages/mechanisms/tron/src/batch-settlement/server/verify.ts`
- `typescript/packages/mechanisms/tron/src/batch-settlement/server/scheme.ts`
- `typescript/packages/mechanisms/tron/src/shared/defaultAssets.ts`
- `typescript/packages/mechanisms/tron/src/shared/tokens.ts`
