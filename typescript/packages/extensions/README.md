# `@bankofai/x402-tron-extensions`

TRON 资源代付独立扩展包。Beta 版本与机制包统一为 `3.0.0-beta.1`，使用官方
`@x402/core@2.28.0`，扩展精确依赖同版本机制包。

```sh
npm install @x402/core@2.28.0 @bankofai/x402-tron@3.0.0-beta.1 @bankofai/x402-tron-extensions@3.0.0-beta.1
```

机制包只维护支付机制、公共契约和交易工具。扩展包维护声明/schema、客户端预签、
Approval 交易校验、资源预算、能量/带宽委托、回收及 coordinator runtime。
基础支付无需安装本包，也不要求安装 Agent Wallet。

## 客户端注册

```ts
import { x402Client } from "@x402/core/client";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";
import { createClientTronSigner } from "@bankofai/x402-tron";
import { createTrc20ApprovalResourceSponsoringClientExtension } from "@bankofai/x402-tron-extensions";

const signer = await createClientTronSigner(wallet, { network: "tron:3448148188", rpcUrl });
const client = new x402Client()
  .register("tron:3448148188", new ExactTronScheme(signer))
  .registerExtension(createTrc20ApprovalResourceSponsoringClientExtension(signer));
```

服务端通过 `declareTrc20ApprovalResourceSponsoringExtension()` 声明扩展。
Facilitator 使用 `createTrc20ApprovalResourceSponsoringExtension(runtime)` 注册完整能力；
不能只手动注册 `{ key, runtime }`。runtime 可由
`createTrc20ResourceSponsoringRuntime({ network, resourceOwnerSigner, coordinator, allowedAssets, permissionId, ... })`
创建，也可以注入符合接口的实现。应用负责 Resource Owner 签名桥接、供应商和持久化存储。

客户端 before hook 校验声明版本和网络；机制创建最终授权，扩展根据实际授权金额
（batch 为实际存款额）决定是否预签。已有 allowance 或自费 fallback 成功时，最终 hook
移除未使用的资源声明。声明对象不会被修改，复用/并发调用彼此隔离。
未注册客户端扩展时，官方 Core 组合会返回 `trc20_approval_client_extension_not_registered`。
缺失 Facilitator 执行能力会返回 `sponsor_runtime_unavailable`。

## 迁移入口

- 资源工厂、coordinator、策略、资源链适配和专用类型，从机制根入口迁到本包根入口。
- 低层预签/专用校验从机制内部路径迁到本包公开入口。
- 支付机制与兼容钱包工厂继续使用 `@bankofai/x402-tron`。
- 通用 RPC 配置和交易工具使用机制包 `/rpc`、`/transactions`。
- 通用旧扩展包 `@bankofai/x402-extensions` 暂时位于 `packages/legacy/extensions`，供未迁移调用方使用。

本包提供根入口和 `trc20-approval-resource-sponsoring` 子入口，以及该子入口下的
`client`、`facilitator`、`resourceService`。所有入口支持 ESM/CJS。

## 验证与运行边界

```sh
pnpm --filter @bankofai/x402-tron build
pnpm --filter @bankofai/x402-tron-extensions build
pnpm --filter @bankofai/x402-tron-extensions test
pnpm --filter @bankofai/x402-tron-extensions test:consumer
```

独立消费验证使用两个 tarball、官方 Core 和严格 NodeNext（`skipLibCheck: false`），
测试 ESM/CJS 的真实 Approval 签名、扩展注册与普通付款。隔离测试还覆盖权限、预算、
失败回收、pending 保留和真实 Agent Wallet 签名。

生产必须提供持久化 coordinator，并持续调用 `runtime.reconcile()` 对账/恢复；
示例 `InMemoryTrc20SponsoringCoordinator` 只用于单进程验证。资源动作、Approval 或付款
结果不明时，沿用原 txID 对账，保留相应记录和资源，避免重复广播或重复代付。
M3 服务联调、真实测试网执行及持久化恢复仍需单独验收。
