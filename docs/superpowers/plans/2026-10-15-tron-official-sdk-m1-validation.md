# TRON 官方 SDK 改造 M1 验证记录

日期：2026-10-15（Asia/Shanghai）。分支：`feat/tron-official-sdk`。
基线：`origin/develop` 的 `e50e9f09149203a97e35110ee1cd64073487f30d`。

## 本次交付

- 四类 TRON 支付机制使用官方 `@x402/core@2.28.0` 的公开类型与运行实例。
- 官方 Core 作为精确 peer/dev 依赖并从构建产物中外部化；基础消费不安装旧 Core 或 Agent Wallet。
- 签名接口、钱包包装、交易构建、签名归一化、广播和回执处理分开维护。
- 纯签名支付按路径要求 RPC；钱包工厂保留确定的 RPC 能力与原调用形状。
- 钱包结构类型、日志接口迁入 TRON；新增 `/exact/extensions` 公开契约入口。
- 增加迁移说明、major Changeset 和独立消费 CI 步骤。

## 验证结果

在 worktree 的 `typescript/` 目录使用 pnpm 11.1.1 执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @bankofai/x402-tron test` | 31 个文件、312 个测试通过 |
| `pnpm --filter @bankofai/x402-tron exec tsc --noEmit` | 通过 |
| `pnpm --filter @bankofai/x402-tron build` | ESM、CJS 和声明构建通过 |
| `pnpm --filter @bankofai/x402-tron lint:check` | 通过 |
| `pnpm --filter @bankofai/x402-tron format:check` | 通过 |
| `pnpm --filter @bankofai/x402-tron test:consumer` | 严格 NodeNext ESM/CJS 消费、基础支付和全部 18 个入口通过 |
| `git diff --check` | 通过 |

独立消费项目使用 TypeScript 5.7.3、`strict: true` 和 `skipLibCheck: false`。
源码验证使用 TypeScript 5.9.2。执行环境 Node.js 25.6.0；本地安装的 TronWeb
为 6.3.0、Agent Wallet 为 2.4.0。CI 配置使用 Node.js 22。

测试覆盖真实官方 Core 注册、payload 创建、verify/settle 和扩展 context 分派；
GasFree、batch 存款、免链上交易 voucher 扣款、pending、取消、并发拦截、纠正响应、
退款，以及重建客户端和服务端后的存储状态恢复。真实 Agent Wallet 的本地隔离测试
覆盖 Permit2 签名、首次 approve、交易 JSON/恢复位归一化、结算权限和 Approval 预签。

原始基线在构建旧 Core 后为 26 个文件、290 个测试通过。
运行日志包含测试刻意触发的 RPC fallback 提示，以及 Node.js 25 对现有 ESLint
配置模块格式的提示；这些不影响检查退出状态。

## 独立审查与修复

独立审查范围为 `e50e9f09..fd680826`，发现两项 P2 问题：

1. 钱包工厂返回类型随最小 Signer 一起将 `readContract` 变成可选，破坏原有严格类型调用。
   已用 ESM/CJS 消费编译失败复现，增加 `ClientTronSignerWithRpc` 返回类型和组合重载后通过。
2. CommonJS 多入口各自包含日志状态，根入口的 `setLogger` 无法接管 GasFree 子入口日志。
   已在打包消费项目中复现自定义 sink 收不到日志，启用 CJS 共享 chunk 后通过。

审查建议补充的状态恢复测试也已加入。审查后的修改通过上述完整检查；未再安排第二轮独立审查。

## 尚未验收的范围

M2 的资源扩展独立拆包、M3 的外围服务迁移与真实测试网执行、M4 的旧包退出维护
尚未实施。本次链状态和 relayer 执行使用隔离测试服务；测试通过不代表真实链执行、
生产供应商、持久化 coordinator 或跨服务恢复已验收。没有运行整个 monorepo 的全量测试，
也没有合并、推送或发布候选版本。
