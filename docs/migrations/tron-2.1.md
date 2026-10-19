# TRON SDK 2.1 迁移说明

目标正式版本为 `2.1.0`，目前处于发布准备阶段；两个包发布并验证后再安装该版本。
当前集成测试可使用 `2.1.0-beta.2`。历史实验版本 `3.0.0-beta.1` 不再作为后续版本线。

## 安装与兼容范围

```sh
# 正式发布后的目标组合
npm install @x402/core@2.28.0 @bankofai/x402-tron@2.1.0
# 仅资源代付需要
npm install @bankofai/x402-tron-extensions@2.1.0
# 根据应用角色选择官方 HTTP / MCP 集成
npm install @x402/fetch@2.28.0 @x402/express@2.28.0
```

2.1 延续项目的版本线，但从 2.0 升级需要迁移源码。协议仍为 x402 v2，保留
`exact`、`upto`、`batch-settlement`、`exact_gasfree` 四种支付方案及现有钱包工厂；
这不代表旧 Core 实例与新机制可以混用。同一支付调用链须使用官方 Core 2.28.0，
HTTP/MCP 适配也须配套升级。`@x402/core` 是机制包的精确 peer dependency。

扩展包精确依赖同版本机制包。应同时升级两个 TRON 包，避免混用 beta 与正式版。
普通支付仅需机制包与官方 Core，不需要资源扩展，也没有 Agent Wallet 运行时依赖。

## 导入调整

| 2.0 调用位置 | 2.1 调用位置 |
| --- | --- |
| `@bankofai/x402-core/client` | `@x402/core/client` |
| `@bankofai/x402-core/server`、`facilitator`、`types`、`http` | `@x402/core` 对应子入口 |
| `@bankofai/x402-fetch` 中的 `x402Client` | `@x402/core/client` |
| `@bankofai/x402-fetch` 中的 `wrapFetchWithPayment` | `@x402/fetch` |
| `@bankofai/x402-express` / `x402-mcp` | `@x402/express` / `@x402/mcp`，Core 类从其角色子入口导入 |
| 机制根入口中的资源 runtime、coordinator、策略、资源链适配与类型 | `@bankofai/x402-tron-extensions` |
| 旧通用扩展包中的 TRON 声明、schema、扩展工厂 | `@bankofai/x402-tron-extensions` |
| 机制内部的资源 Approval 预签、专用校验 | 扩展包公开入口 |
| 旧 Core 的 TRON 日志配置 | `@bankofai/x402-tron` 的 `setLogger`、`noopLogger` |

钱包工厂、钱包结构类型和支付方案继续从机制包导入。公共 RPC 和交易工具分别从
`@bankofai/x402-tron/rpc`、`@bankofai/x402-tron/transactions` 导入。
`/exact/extensions` 保留机制与扩展间的公共契约，不包含资源执行 runtime。

扩展包公开根入口、`/trc20-approval-resource-sponsoring`，以及该入口下的
`/client`、`/facilitator`、`/resourceService`；全部支持 ESM 和 CommonJS。
不要导入未公开的 `src/` 或 `dist/` 内部路径。

旧 Core 的 `createResourceServer`、`createFacilitator` 是本仓库的日志封装，
迁移为官方 `new x402ResourceServer(facilitatorClient)`、`new x402Facilitator()`；
需要日志时显式注册对应生命周期 hook。

## 普通支付与钱包

```ts
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientTronSigner, TRON_NILE } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";

const signer = await createClientTronSigner(wallet, { network: TRON_NILE, rpcUrl });
const client = new x402Client().register(TRON_NILE, new ExactTronScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);
```

`wallet` 由应用持有，继续满足 `ClientTronWallet` / `FacilitatorTronWallet` 结构契约。
工厂仍为异步函数，参数顺序为钱包、网络/RPC 配置；签名服务也可以直接实现 signer 契约。
Agent Wallet 3 的 `{ family: "tron", transaction }` 签名结果会被解包，兼容旧版签名交易对象、
JSON 字符串及原始签名；EVM artifact 或错误的 TRON transaction 封装会被拒绝。

仅 TIP-712 签名的 signer 只能覆盖所需签名能力已具备的支付路径。余额/allowance 查询需要
`readContract`；自动 Approval 还需要交易签名。未提供 allowance 能力时由应用预先完成授权，
不能把签名成功当作已经获得链上 allowance。

网络输出继续使用十进制 CAIP-2：主网 `tron:728126428`、Nile `tron:3448148188`、
Shasta `tron:2494104990`；旧十六进制标识仍作为输入别名接受。

## 资源代付的三端注册

客户端在普通支付注册后显式注册预签扩展：

```ts
import { createTrc20ApprovalResourceSponsoringClientExtension } from "@bankofai/x402-tron-extensions";

client.registerExtension(createTrc20ApprovalResourceSponsoringClientExtension(signer));
```

资源服务器在需要代付的路由中设置
`extensions: declareTrc20ApprovalResourceSponsoringExtension()`，声明工厂从扩展包导入。
Facilitator 用 `createTrc20ResourceSponsoringRuntime(...)` 构造 runtime，再通过
`facilitator.registerExtension(createTrc20ApprovalResourceSponsoringExtension(runtime))`
注册完整能力。手工注册 `{ key, runtime }` 无法替代这些工厂。

应用继续负责 Resource Owner 钱包、权限 ID、允许代付的资产、资源容量和预算配置。
未注册客户端扩展会返回 `trc20_approval_client_extension_not_registered`；缺失 Facilitator
执行能力会返回 `sponsor_runtime_unavailable`。普通支付不需要注册这些扩展。

`InMemoryTrc20SponsoringCoordinator` 只用于开发验证。生产部署须提供持久化 coordinator，
持续执行 `runtime.reconcile()`，并在重启后恢复未完成的委托、付款与回收任务。

## 预检、限额与 pending

- Upto 必需的 allowance 或余额 RPC 读取失败、返回错误数据时，明确返回
  `chain_read_failed`，不会继续结算广播。应修复 RPC 后重试预检。
- 官方 Core 的 `maxAmountPerPayment` 按实际授权金额检查：batch 使用本次 deposit，
  GasFree 使用 `value + maxFee`。默认 batch deposit 超过限额时会被拒绝，应配置合适的
  `depositStrategy` 或明确调整限额；累计 voucher 总额不等于新增 deposit。
- 保留 2.0 的 `settlement_pending` 语义：交易已广播但回执未知时，保存原交易 ID 对账，
  不要重发授权或把超时当作未扣款。资源动作未知时，同样保留记录和资源等待恢复。
- HTTP 超时属于应用集成配置。迁移到官方 HTTP/MCP 包后，必须重新核对其请求超时、
  pending 重试和资源交付策略；SDK 通过不表示外围服务的这些配置已经完成迁移。

## Facilitator 的 pending 存储

官方 Core 会对带有 txID 的 `settlement_pending` 自动重试一次。2.1 的 Facilitator
先保存原交易，再等待回执；相同 payment 与实际结算 requirements 的重试会恢复原交易，
跳过重新预检、资源代付和广播。batch 的 deposit/refund/settle 恢复原始金额和状态快照。
GasFree 已取得 relayer trace、尚无链上 hash 时，保留 `extra.gasfreeTraceId`，后续调用
查询同一任务，不再次 submit。没有 hash 的 pending 不触发 Core 的自动重试。

默认 `InMemoryTronPendingSettlementStore` 仅覆盖同一进程；未确认记录不会自动过期。
生产重启恢复或多副本需要持久化、共享的 `TronPendingSettlementStore`。接口从各
`/facilitator` 入口导出，包含 `get`、`set`、`delete` 和 `withLock`；记录是可序列化的
原 txID / relayer trace 与必要快照。`withLock` 必须在整个回调（包括等待回执）期间，
对所有副本持有同一 key 的排他锁；租约需要覆盖或续期到回调结束。

通过构造器的 `pendingSettlementStore` 选项注入实现：exact / upto 是第二个参数，
GasFree 是第三个参数，batch 是 signer、可选 authorizerSigner 后的第三个参数。
exact、GasFree 的注册工厂也接受同名配置。存储读取失败时在广播前拒绝；广播后保存
失败返回 `settlement_store_unavailable` 并保留已知 txID / trace。应用应先对账原任务，
避免在存储故障或进程退出后直接重新提交。资源 coordinator 与 pending 交易存储各自
负责自己的恢复记录，生产需要同时提供。

## 升级验证

先在隔离环境验证严格 TypeScript 编译、ESM/CJS 加载和三角色注册，再验证所需支付路径。
仓库 CI 包含两个真实 tarball 的独立消费测试；机制和扩展的版本必须一致，扩展包打包后
不得残留 `workspace:` 依赖。Nile 历史验收记录见 `docs/releases/2.1.0-beta.2-nile.md`，
该记录不是正式版已发布或生产持久化恢复已验收的声明。
