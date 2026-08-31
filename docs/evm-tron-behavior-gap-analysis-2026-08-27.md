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
| P0 | 统一 `settlement_pending` 与交易哈希保留语义 | SDK 默认等待 90 秒且可配置；持久化和自动对账由 facilitator 服务负责 |
| P0 | exact/upto/batch 验证阶段链上模拟、合约存在性检查、fail-closed | 当前 TRON 存在 optimistic verify，应尽快收紧 |
| P0 | batch-settlement channelId 绑定、验证后原子预留、并发清理 | 大部分逻辑与链无关，可按 EVM 实现移植 |
| P1 | batch 文件/Redis 持久化 | 可复用 EVM 设计，但必须先完成 channelId 安全校验 |
| P1 | 默认资产反向查询和未知 decimals 处理 | 小改动，高正确性收益 |
| 已实现 | TRC-20 Approval resource sponsoring | 已采用 TRON-specific 预签交易、TAPOS/expiration 校验和资源委托恢复模型 |
| P2 | auth-capture | 需先有 TVM escrow/collector 合约和审计，不能只移植 SDK client |
| 不直接移植 | ERC-1271、ERC-6492、ERC-7702、EVM calldata suffix | 属于 EVM 账户或 calldata 语义，应设计 TRON 等价能力 |

## 2. 分析基线与说明

- 分析基线分支：`main`
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

TRON receipt 等待预算必须可配置，并保持当前默认行为：

```ts
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 90_000;

createFacilitatorTronSigner(wallet, {
  network,
  confirmationTimeoutMs: 90_000,
});
```

- 未配置时默认等待 90 秒；
- 部署方可以按其 HTTP 和网关 deadline 调低或调高；
- 单次 RPC 异常在剩余预算内继续重试，不立即判定 pending；
- 预算耗尽且已有合法 txid 时返回 `settlement_pending`；
- 广播被拒绝、txid 为空或不是规范 64 位十六进制字符串时终态失败；
- `settlement_pending` 是非终态结果，调用方不得因此创建新支付或重播原交易。

确认层级继续采用当前 packed receipt，以较低延迟获得 `SUCCESS`/`REVERT`；等待 solidified receipt 可以作为未来的高安全配置，但不作为本阶段默认行为。

所有已广播路径都应复用：

- exact EIP-3009 / Permit2；
- upto Permit2；
- batch deposit / claim / settle / refund；
- client 一次性 Permit2 approve，如调用侧需要向用户表达 pending。

### 5.3 SDK 与 facilitator 服务的责任边界

`x402` SDK 保持无状态，只负责：

- 广播交易并取得 txid；
- 在可配置预算内等待 receipt；
- 区分 `success`、`reverted` 和 `settlement_pending`；
- 保留并校验 txid；
- 返回 receipt logs，供 scheme 校验实际链上效果；
- 绝不因为 receipt 未知而重新广播交易。

SDK 不负责数据库、settlement 历史查询、后台 worker、多实例任务锁、重启恢复或交易状态 HTTP API。SDK 无法也不应根据数据库判断一笔授权是否已有 pending；该判断只能由调用 SDK 的 facilitator 服务完成。

持久化和自动对账属于部署侧 facilitator 服务。BankofAI 的实现位于独立的 `x402-facilitator` 仓库，该服务已经提供 settlement 数据库和 `GET /payments/tx/{hash}`。第一版不新增通用 x402 `/status` 协议，而是在该服务中增强现有能力：

1. exact/upto `/settle` 在调用 SDK 前，从 payload 提取 `network + scheme + asset + payer + nonce` authorization identity 并查询 settlement；
2. 已有 `pending` 时直接重建并返回原 `settlement_pending + txid`，已有 `success` 时直接返回原成功结果，不再次调用 SDK；已有带 txid 的 `reverted/failed` 也返回原终态，只有没有 txid 的广播前失败允许重试；
3. 没有已有记录时才调用 SDK settle；SDK 返回 `settlement_pending + txid` 时保存 `status = pending`，不能保存成普通 `failed`；
4. 后台 reconciliation worker 持续查询原 txid，绝不重播；
5. receipt 成功且效果校验通过后更新为 `success`；
6. receipt 明确 revert 后更新为 `reverted`；
7. RPC 暂时不可用或交易仍未打包时保持 `pending` 并退避重试；
8. 调用方通过现有 `GET /payments/tx/{hash}` 查询最终状态；查询 pending 记录时可以执行一次惰性刷新；
9. worker 在服务重启后重新扫描数据库中的 pending；多实例可以重复执行只读 receipt 查询，但状态更新必须使用 `WHERE id = ? AND status = 'pending'` 之类的 compare-and-set，不能覆盖已经写入的终态；
10. receipt 超过运营告警阈值仍无法确认时保持 pending，不因本地 TTL 自动改成失败；只有明确 revert、可靠的未落链证据，或 receipt 与预期效果明确不匹配等确定性证据才能写入失败终态；
11. 数据库保存失败不能改变链上事实；响应仍保留 txid，同时记录高优先级告警，供调用方继续查询链上状态。

建议 facilitator settlement 状态至少区分：

```text
pending   已广播且有 txid，但链上效果未知
success   receipt 成功且效果校验通过
reverted  receipt 明确链上失败
failed    广播前失败，或 receipt 成功但明确未发生预期支付效果
```

batch-settlement 当前没有可用于 settlement 表查询的逐笔 nonce，不能套用 exact/upto 的 authorization identity 预查。第一版继续以 Resource Server 的 channel reservation 作为 batch 并发控制；`x402-facilitator` 只在获得 txid 后按 txid 持久化和对账，不为 batch 新增数据库 identity 字段。

第一版不通过数据库 migration 或分布式锁消除 exact/upto 的跨实例“同时查无记录”窗口。极端并发下可能广播两笔使用同一 authorization 的交易，但链上 nonce 保证至多一笔成功，另一笔终态 revert；这是第一版明确接受的资源浪费限制，不得描述为可能重复扣款。若后续要求广播本身 exactly-once，需要独立设计广播前 durable operation 和跨实例串行化。

第一版也明确接受“广播成功后、pending 记录入库前进程崩溃”的恢复窗口。reconciliation worker 只保证已经持久化为 pending 的记录可在重启后恢复；本阶段不为此增加 broadcast callback、预写 `settling` operation 或数据库 migration。交易广播日志必须保留 txid 并触发进程异常告警。若后续要求覆盖该窗口，应单独设计广播时 durable hook，而不能让 SDK 直接访问数据库。

Resource Server 不直接实现 TRON receipt 解析，也不自动重付；它保存 pending txid，并查询 facilitator 服务的交易记录。若未来需要让不同 facilitator 实现共享同一状态查询协议，再单独把该能力提升到 core 接口。

超时配置必须留出响应传输余量。通用 `HTTPFacilitatorClient` 默认请求超时从 90 秒调整为 120 秒，TRON confirmation timeout 保持默认 90 秒。部署时仍应满足：

```text
TRON confirmation timeout < Resource Server 到 facilitator 的 HTTP timeout < 外层网关 timeout
```

默认组合为 TRON confirmation timeout 90 秒、facilitator HTTP timeout 120 秒；外层网关必须更长。部署方覆盖任一值时仍需保留足够余量，否则调用方可能先收到 HTTP timeout，拿不到 facilitator 已持有的 txid。

### 5.4 `x402-facilitator` 第一版改动范围

第一版复用现有 `settlements` 表，不要求数据库迁移。当前表已经包含 `tx_hash`、`status`、`error_reason` 和 `created_at`，且 `status` 为 `VARCHAR`，足以保存 `pending`、`success`、`reverted` 和 `failed`。具体改动为：

- `src/server.ts`
  - exact/upto `/settle` 在调用 SDK 前查询已有 authorization settlement；pending/success 以及带 txid 的 reverted/failed 直接返回原结果；
  - batch 不执行 nonce-based 预查，继续依赖 Resource Server channel reservation；
  - `/settle` 将 `errorReason === "settlement_pending"` 映射为 `status = "pending"`，不再保存成 `failed`；
  - `GET /payments/tx/{hash}` 继续返回数据库记录；对 pending 记录可触发一次只读惰性刷新；
- `src/db/index.ts`
  - 复用 authorization identity 查询支持 exact/upto settle 前检查；
  - 增加批量读取 pending settlement 的查询；
  - 增加按 settlement id/txid 的 compare-and-set 终态更新，只允许 `pending -> success|reverted|failed`；
- `src/settlement-reconciler.ts`（新增）
  - 定时扫描 pending，按 network 查询原 txid；
  - 只查询 receipt，绝不调用广播或 settlement；
  - RPC 异常或仍未打包时保留 pending，等待下一轮；
- `src/tron-receipt.ts`（新增或复用 SDK 导出的只读 primitive）
  - 封装 `wallet/gettransactioninfobyid` 查询和 `success|reverted|pending` 解析；
  - 复用与 SDK 一致的 txid、packed receipt 和效果校验语义；
  - receipt 成功后解码原广播交易的 target/calldata，并校验 receipt logs 是否实现该交易编码的 token、payer、recipient 和 amount；再用现有 settlement 的 asset、payer、amount 做可用的交叉校验，不新增数据库字段；
  - calldata/logs 暂时不完整时保持 pending，明确与预期效果不匹配时更新为 failed；
- `src/runtime.ts`、`src/index.ts`
  - 在数据库和网络配置就绪后启动 worker；
  - 在 shutdown 中先停止 worker，再关闭数据库连接；
- `src/config.ts` 与环境配置
  - 增加 worker enable、扫描间隔和 batch size 的有界配置；
- tests
  - 覆盖 pending 持久化、重启恢复、RPC 异常、终态更新、惰性刷新、多个 worker 条件更新和 no-rebroadcast。

第一版不持久化 worker lease、attempt count、`next_reconcile_at` 或 `updated_at`。多个实例重复查询同一 txid 是可接受的只读开销；compare-and-set 保证迟到结果不能把 `success/reverted` 改回 pending 或相互覆盖。不得在数据库事务或行锁内执行远程 RPC。

第一版也不持久化原始 `paymentRequirements.payTo` 或完整规范化支付效果。因此异步 worker 能证明“receipt logs 与 facilitator 实际广播的交易一致”，并能与已保存的 asset、payer、amount 交叉校验，但不能在进程重启后重新证明“广播交易中的 recipient 与最初 HTTP 请求完全一致”。同步 settle 路径仍应在内存中完成完整效果校验；若后续要求异步路径也恢复原始请求级证明，需要新增 `pay_to` 或 canonical effect 字段并执行显式 migration。

如果后续需要严格限制跨实例重复查询、指数退避、长期 pending 告警或详细审计，再通过显式 `ALTER TABLE`/版本化 migration 增加 lease、attempt、next retry 和 resolved timestamp 字段。仅修改 Drizzle schema 或 `CREATE TABLE IF NOT EXISTS` 不会升级已有生产表，因此这些能力不得在没有迁移的情况下假设字段存在。

### 5.5 验收测试

- 未配置时 receipt 等待预算为 90 秒，自定义 `confirmationTimeoutMs` 能正确覆盖；
- receipt 超时返回 `settlement_pending` 和原 txid；
- RPC 抛错返回 `settlement_pending`；
- 明确 revert 返回 scheme-specific terminal error；
- 空 txid/无效 txid 不得返回 pending；
- receipt 成功但效果校验抛错时返回 pending，而不是误报成功；
- pending 路径不得再次调用广播接口；
- exact/upto 已有 pending 或 success 时 facilitator 服务直接返回原记录，不调用 SDK settle；
- exact/upto 已有带 txid 的 reverted/failed 时返回原终态，不调用 SDK settle；没有 txid 的广播前失败不阻止后续重试；
- batch 不使用空 nonce 做 authorization 去重；
- 两个跨实例请求同时查无记录时，链上 authorization nonce 保证至多一笔成功；
- facilitator 服务将 pending 保存为 `pending` 而不是 `failed`；
- reconciliation 将 pending 原子推进为 `success`、`reverted` 或有确定性证据的 `failed`；
- receipt success 只有在原交易 target/calldata 与 logs 一致，且现有 settlement 字段的交叉校验通过后才能推进为 success；数据不完整时保持 pending，明确不匹配时推进为 failed；
- pending 超过运营告警阈值时告警但不因本地 TTL 自动失败；
- 多个 worker 可以重复只读查询，但只能有一个 compare-and-set 成功推进终态，且都不能重播交易；
- `GET /payments/tx/{hash}` 返回最新 reconciliation 状态；
- `HTTPFacilitatorClient` 默认 timeout 为 120 秒，并在 TRON 默认 90 秒 confirmation timeout 后收到包含 txid 的 pending 响应。

### 5.6 规范同步

`settlement_pending` 是跨服务可观察的非终态语义，不能只作为源码内部错误常量存在。阶段 A 必须同步更新：

- `specs/x402-specification-v2.md`：定义已广播但链上效果未知的非终态 settlement 结果；
- `specs/schemes/exact/scheme_exact_tron.md`：加入 `settlement_pending`、txid 保留和禁止重播；
- `specs/schemes/upto/scheme_upto_tron.md`：加入同样语义；
- `specs/schemes/batch-settlement/scheme_batch_settlement_tron.md`：加入 pending 与 channel reconciliation 规则；
- facilitator API 文档：说明 `GET /payments/tx/{hash}` 返回的 `pending|success|reverted|failed` 状态。

第一版保持现有 `SettleResponse` wire shape：`success: false`、`errorReason: "settlement_pending"`、`transaction: <txid>`，不新增通用 `/status` endpoint 或新的顶层状态字段。

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

沿用 EVM 的分路径默认值：

- 第一次公开 verify 默认执行模拟；
- settle 前始终重新验证签名和字段；
- exact settle re-verify 默认不重复模拟，`simulateInSettle = false`；
- upto settle re-verify 默认重复模拟，`simulateInSettle = true`；
- batch deposit/claim/settle/refund 在各自广播前执行模拟；
- facilitator 配置可以覆盖 exact/upto 默认值，但关闭模拟不能恢复 optimistic RPC error 行为；所有建立验证状态所需的 RPC 读取仍然 fail closed。

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

### 7.3 settlement pending 与 reservation

batch 链上操作已经广播但返回 `settlement_pending` 时，不能按普通 settle failure 立即清理 reservation，否则同一 channel 的新请求可能在原交易终态未知时进入；也不能只依赖普通 reservation TTL 到期后无条件释放。

Resource Server 应将 reservation 转换为可持久化的 reconciliation 状态，至少保存：

```text
channelId + pendingId + txid + operation + state=reconciling
```

后续处理规则：

- facilitator 交易状态仍为 `pending`：保持 channel busy；
- facilitator 状态变为 `success`：按原操作提交 channel 状态；
- facilitator 状态变为 `reverted`：仅释放 pendingId 匹配的 reservation；
- facilitator 状态变为 `failed`：保持 reconciling 并告警，第一版不自动 commit 或 release；当前单一 `failed` 状态不足以证明释放后一定不会与未知链上效果冲突；
- 查询 facilitator 失败：fail closed，继续保持 reconciling；
- 清理旧请求不得删除后来请求的 pending marker。

交易 receipt 的后台确认由 `x402-facilitator` 负责；channel reservation 的 commit/release 由拥有 batch storage 的 Resource Server 负责。facilitator worker 不直接修改 Resource Server 的 channel storage。

为避免 TRON mechanism 依赖 BankofAI 特定 HTTP API，`BatchSettlementTronSchemeServerConfig` 增加可注入的状态解析器：

```ts
settlementStatusResolver?: (
  network: Network,
  txid: string,
) => Promise<"pending" | "success" | "reverted" | "failed">;
```

SDK 只定义并调用该回调，不实现 `/payments/tx/{hash}` 客户端。部署应用负责用 `x402-facilitator` 的现有查询接口实现 resolver。为了向后兼容，该字段在类型上可选；一旦 batch 进入 reconciling 而 resolver 未配置，Resource Server 必须 fail closed、保持 channel busy 并记录配置告警，不能按 TTL 释放 reservation。

### 7.4 必须补充的测试

- 非 `0x + 64 hex` channelId 在任何存储访问前拒绝；
- channelId 与 channelConfig 不匹配时拒绝；
- facilitator verify 返回 invalid 时存储字节级不变；
- 两个同 channel 并发请求只能有一个 reserve 成功；
- snapshot 与 reserve 之间 cumulative base 变化时返回 stale；
- 过期 reservation 可被替换；
- storage.get/update 抛错时 fail closed；
- extension 在 after-verify 阶段 abort 时清理 reservation；
- 清理旧请求不能删除新请求的 pending marker；
- batch settle pending 时 reservation 转为 reconciling 而不是被清理；
- reconciliation success 后提交 channel 状态；
- reconciliation reverted 后精确释放原 reservation；
- reconciliation failed 时保持 reconciling，等待人工处置；
- RPC/服务查询失败时不得释放 reconciling reservation；
- resolver 未配置时保持 reconciling 并发出配置告警；
- reservation TTL 到期不能绕过未决 txid 的链上对账。

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

## 9. 基线后进展与条件借鉴能力

### 9.1 TRC-20 Approval resource sponsoring（已实现）

本文分析基线之后，TRON 已实现 `trc20ApprovalResourceSponsoring` version 1。该实现没有复制 EVM RLP approval extension，而是采用 TRON-specific 完整签名交易和资源委托 saga：

- client 签署但不广播 `approve(canonicalPermit2, MAX_UINT256)`；
- facilitator 严格解析完整 protobuf、签名、owner、calldata、TAPOS、timestamp、expiration 和 fee limit；
- `/verify` 保持只读，`/settle` 在重复 mutable checks 后临时委托 Energy/Bandwidth；
- facilitator 广播 client 提供的原始签名交易，并要求节点返回的 txid 与本地计算一致；
- allowance 生效后继续 exact/upto settlement 或 batch Permit2 deposit；
- 资源回收通过独立 durable reconciliation 处理，不与本节的 payment receipt worker 混用。

version 1 支持 exact Permit2、upto Permit2 和 batch-settlement Permit2 deposit/top-up；不用于 EIP-3009、voucher、claim、settle 或 refund。默认 zero-first approval policy，不隐式插入 `approve(0)`。

该能力视为已完成的独立扩展，不再列入本路线图的可行性调研。它仍需遵守本章新增的 payment `settlement_pending` 语义，但 Approval、DelegateResource 和 UnDelegateResource 的多交易状态保留在扩展自己的 operation/recovery 模型中，不能把非支付 txid 写入 `SettleResponse.transaction`。

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

1. 为 TRON signer 增加可配置 `confirmationTimeoutMs`，默认 90 秒；
2. 新增 TRON receipt helper；
3. exact/upto/batch 全面采用 `settlement_pending` 并保留 txid；
4. 扩展 receipt 返回 logs；
5. 增加 invalid txid、timeout、RPC error、revert 和 no-rebroadcast 回归测试；
6. 在 `x402-facilitator` 将 pending 持久化为独立状态；
7. 在 `x402-facilitator` 增加 reconciliation worker，并复用 `/payments/tx/{hash}` 查询最终状态；
8. 第一版复用现有 settlement 字段和 compare-and-set，不引入数据库迁移；
9. exact/upto settle 前查询已有 pending/success 和带 txid 的失败终态；batch 继续依赖 Resource Server reservation；
10. 将 `HTTPFacilitatorClient` 默认 timeout 调整为 120 秒，并要求外层网关大于该值；
11. 同步更新 x402 v2、TRON exact/upto/batch specs 和 facilitator API 文档。

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
5. pending reservation 转换为 reconciling，并根据 facilitator 最终状态 commit/release；
6. 注入 `settlementStatusResolver`，未配置或查询失败时 fail closed；
7. 并发、存储失败和 reconciliation 测试。

### 阶段 D：产品能力

1. 文件/Redis storage；
2. 默认资产查询规范化；
3. auth-capture 合约和协议设计。

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
- `typescript/packages/mechanisms/tron/src/resource-sponsoring/`

协议规范：

- `specs/x402-specification-v2.md`
- `specs/schemes/exact/scheme_exact_tron.md`
- `specs/schemes/upto/scheme_upto_tron.md`
- `specs/schemes/batch-settlement/scheme_batch_settlement_tron.md`
- `specs/extensions/trc20_approval_resource_sponsoring.md`

Core 与部署服务：

- `typescript/packages/core/src/http/httpFacilitatorClient.ts`
- `x402-facilitator/src/server.ts`（独立仓库）
- `x402-facilitator/src/db/index.ts`（独立仓库）
- `x402-facilitator/src/db/schema.ts`（独立仓库）
- `x402-facilitator/src/runtime.ts`（独立仓库）
- `x402-facilitator/src/index.ts`（独立仓库）
- `x402-facilitator/src/settlement-reconciler.ts`（独立仓库，待新增）
- `x402-facilitator/src/tron-receipt.ts`（独立仓库，待新增）
