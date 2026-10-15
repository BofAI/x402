# TRON 官方 SDK 改造 M2 验证记录

日期：2026-10-15（Asia/Shanghai）。分支：`feat/tron-official-sdk`。
M2 基线：M1 完成提交 `a7f4bb0a`。
M2 实现提交：`9acbd732abdc3ad9e74f6b7b0d7d0119bd3d15f0`。

## 本次交付

- 新增独立包 `@bankofai/x402-tron-extensions`，代码位于 `typescript/packages/extensions`。
- 资源代付 runtime、coordinator、预算/权限策略、资源链适配、Approval 预签、schema 和完整交易验证迁入新包。
- 依赖方向为扩展包依赖机制包公开入口；机制包不依赖扩展包，也不包含资源代付业务实现。机制新增通用 `/rpc` 与 `/transactions` 入口。
- exact Permit2、upto Permit2、batch 存款通过官方 Core 2.28.0 的客户端扩展 hooks 组合代付；按最终授权/实际存款金额准备 Approval。
- 客户端必须显式注册扩展。网络不匹配在签名前拒绝；未注册、缺少签名/授权能力明确失败。已有 allowance、自费回退或仅 voucher 路径清理未使用声明，复用的服务端声明不被修改。
- Facilitator 必须使用新工厂注册验证/执行能力。旧 `{ key, runtime }` 对象需要迁移；完整 schema、签名、交易绑定和资源安全校验保留在扩展中。
- 通用 `@bankofai/x402-extensions` 保留为 `typescript/packages/legacy/extensions` 下的过渡 workspace 包。仅调整迁移所需的两处相对路径，业务文件保持不变。
- 新增独立消费 CI、Changeset 和中文迁移说明。Agent Wallet 仅用于开发测试，生产包不依赖它或旧 Core。

## 验证结果

在 worktree 的 `typescript/` 目录使用 pnpm 11.1.1 执行（本机通过 `npx --yes pnpm@11.1.1` 调用）：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @bankofai/x402-tron test` | 26 个文件、224 个测试通过 |
| `pnpm --filter @bankofai/x402-tron-extensions test` | 7 个文件、101 个测试通过 |
| `pnpm --filter @bankofai/x402-extensions test` | 10 个文件、532 个测试通过，与迁移前基线一致 |
| `pnpm --filter @bankofai/x402-tron exec tsc --noEmit` | 通过 |
| `pnpm --filter @bankofai/x402-tron-extensions exec tsc --noEmit` | 通过 |
| `pnpm --filter @bankofai/x402-tron build` | ESM、CJS 和声明构建通过 |
| `pnpm --filter @bankofai/x402-tron-extensions build` | ESM、CJS 和声明构建通过 |
| `pnpm --filter @bankofai/x402-extensions build` | 过渡包构建通过 |
| `pnpm --filter @bankofai/x402-tron --filter @bankofai/x402-tron-extensions lint:check` | 通过 |
| `pnpm --filter @bankofai/x402-tron --filter @bankofai/x402-tron-extensions format:check` | 通过 |
| `pnpm --filter @bankofai/x402-tron test:consumer` | 严格 ESM/CJS 编译、基础支付与机制包全部 20 个入口通过，无需安装扩展包 |
| `pnpm --filter @bankofai/x402-tron-extensions test:consumer` | 两个 tarball 独立安装、严格 ESM/CJS 编译、全部 25 个组合入口、真实离线 Approval 签名和代付组合通过 |
| `git diff --check` | 通过 |

独立消费项目使用 TypeScript 5.7.3、`strict: true`、`skipLibCheck: false`，检查产物依赖没有旧 Core、通用扩展包或 Agent Wallet。源码验证使用 TypeScript 5.9.2。
执行环境为 Node.js 25.6.0，实际安装 TronWeb 6.3.0、Agent Wallet 2.4.0，官方 Core 精确版本为 2.28.0。CI 使用 Node.js 22。

资源测试覆盖权限/预算拒绝、network/owner/token/spender 与交易绑定、重复协调、失败回收、pending 保留及 reconcile。客户端测试覆盖三种 Permit2 路径、batch 实际存款额度、声明复用与并发、缺少 RPC/签名能力、地址归一化和签名前网络校验。真实 Agent Wallet 通过隔离适配测试签名，打包消费使用离线真实 Approval 交易及签名；链状态、资源委托与结算执行由测试适配器提供。

针对扩展未注册、网络错误时先签名、十六进制地址不符合 schema 的失败测试，均先观察到失败，再完成实现并验证通过。Node.js 25 对现有 ESLint 配置模块格式的提示不影响检查退出状态。

## 独立审查

独立审查范围为 `a7f4bb0a..9acbd732`，覆盖完整 M2 改动及仓库要求的签名/结算安全边界，未发现需要修复的正确性或安全问题。

审查者机械核对了迁移文件，确认通用过渡包仅有两处相对路径变更，资源 runtime 和 Approval 验证器的迁移保持行为；核对了 Core 2.28.0 的真实 hooks 顺序、本地准备标识的传递与清理、单向依赖及 Facilitator 验证/执行分派。

审查者独立执行了 ESM/CJS 离线真实签名代付 fixture，并补测 ESM 机制与 CJS 扩展混用时 exact、upto、batch 的自费回退额度、缺少能力拒绝、已有 allowance 清理、voucher 清理、标识移除和声明不可变性，均通过。审查者没有重复运行实现阶段的完整单测和 tarball 安装检查。

## 后续范围

M3 仍需迁移外围服务至新工厂、对接真实资源提供方、执行真实测试网流程并验收生产持久化 coordinator 与跨服务恢复。M4 负责通用旧包退出及其调用方迁移。

本次没有执行真实链交易、整个 monorepo 的全量测试，也没有推送、合并或发布版本。离线验证通过不代表真实链、资源供应商或生产恢复能力已经验收。
