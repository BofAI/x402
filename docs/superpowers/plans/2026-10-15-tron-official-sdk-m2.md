# TRON 资源代付扩展独立包 M2 实施计划

> 使用 superpowers:executing-plans 在当前 worktree 逐项实施；沿用用户已确认方案和当前会话执行方式。

**目标：** 发布边界上分离 `@bankofai/x402-tron` 与 `@bankofai/x402-tron-extensions`，通过官方 Core 2.28.0 hooks/context 组合资源代付。

**设计依据：** https://github.com/boboliu-1010/tron-x402-docs/blob/main/README.md 的 M2；用户明确要求继续实施。

**约束：** 保留支付消息、签名和资源安全校验；机制包不依赖扩展包；扩展仅依赖机制公开入口和官方 Core；不运行真实链交易，不迁移外围服务、不发布版本。

## Task 1: 包结构与业务代码迁移

- [ ] 记录现有 TRON 与通用扩展测试基线。
- [ ] 将现有通用扩展包移至 `packages/legacy/extensions`，保留包名、workspace 和调用方；修正相对配置与测试路径。
- [ ] `packages/extensions` 改为 `@bankofai/x402-tron-extensions`，精确依赖官方 Core 2.28.0，依赖机制包公开 API。
- [ ] 迁移 resource runtime、coordinator、策略、资源链适配、声明、schema、Approval 专用验证至新包 `src/trc20-approval-resource-sponsoring/`。
- [ ] 迁移对应测试；删除机制根入口的资源业务导出，新增必要的通用 `/rpc`、`/transactions` 入口。
- [ ] 类型/构建验证后提交。

## Task 2: 官方客户端 hooks 与机制契约

- [ ] 添加失败测试：扩展声明但客户端未注册、allowance 足够、额度不足预签、缺少能力、并发请求及 batch 实际存款额度。
- [ ] 机制仅解析声明与本地准备标识，注册扩展通过 before hook 标识准备；未注册时明确报错。
- [ ] 扩展通过 after hook 读取最终授权金额、预签 Approval；已有 allowance/自费 fallback 时移除未使用声明，避免官方 Core 再合并导致伪扩展 payload。
- [ ] 机制通过 FacilitatorContext 调用已注册扩展的验证/执行契约；专用验签与资源工作流留在扩展包。
- [ ] 通过真实官方 Core 顺序、三类 Permit2 路径与纯基础支付回归后提交。

## Task 3: 打包消费、回归与文档

- [ ] 独立项目安装两个 tarball，验证基础包无需扩展/钱包，完整组合仅使用官方 Core。
- [ ] 严格 ESM/CJS 编译与运行检查所有入口、真实 Agent Wallet 隔离签名、资源启停、权限/预算拒绝、失败回收与 pending 保留。
- [ ] 新增 CI、Changeset、迁移说明和中文验证记录；运行 TRON、新扩展和过渡通用扩展的适当检查。
- [ ] 独立整分支审查；对重要问题先复现再修复。

## Review Focus

- 客户端 hooks 必须先阻止自费 approve，再处理最终授权金额；不得把 batch 路由价格当作存款额度。
- allowance 足够时未使用的声明不能留在最终付款 payload；不能修改调用方复用的服务端声明数据。
- 未注册、无执行能力、无效字段应明确拒绝；不能通过伪造声明绕过 allowance 检查。
- 扩展必须保留 network、owner、receiver、permission、budget 与完整交易绑定及 pending 资源保留/回收行为。
- 机制不得反向依赖扩展；跨 ESM/CJS 的构建入口应保持相同契约，资源业务实现不能残留机制发布包。
