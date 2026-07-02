# TypeScript 对比 typescript_new 代码审计报告

## 1. 审计对象

- 审计范围文档：`docs/typescript-vs-typescript-new-audit-scope.md`
- 基线：`9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new`
- 目标：当前分支 `review-0702` 的 `HEAD:typescript`
- 对比命令：

```bash
git diff 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new HEAD:typescript
```

总体差异：

```text
1122 files changed, 22533 insertions(+), 86184 deletions(-)
```

本报告聚焦差异引入的代码、发布、文档和兼容性风险。已删除链包内部实现不重新审计，只审计删除后的残留影响。

## 2. 结论摘要

当前 `typescript` 的源码级包名迁移基本完成：非测试、非文档源码中未发现旧 `@x402/*` 的实际运行时导入，主要残留是注释和 NOTICE。EVM/TRON 新增路径整体按 core 的 scheme/client/server/facilitator 抽象接入，TRON exact 和 batch-settlement 主路径具备 network、amount、recipient、signature、deadline、pending reservation 等校验。

主要问题集中在三类：

1. `paywall` 和已删除 SVM/AVM 等包的文档、安装和运行时策略未闭环。
2. `@bankofai/x402-next` 移除了 paywall optional peer，但 core 仍运行时动态加载 paywall。
3. 文档和贡献指南仍把已删除目录当成当前结构，容易误导集成和维护。

测试未运行：当前环境没有 `pnpm`，无法执行 `pnpm --dir typescript build/test/test:integration`。

## 3. 主要发现

### F-01 高：文档仍指导用户导入已删除的 SVM/paywall 包

证据：

- `typescript/packages/http/next/README.md:165` 仍导入 `@bankofai/x402-svm/exact/server`。
- `typescript/packages/http/next/README.md:201-203` 仍导入 `@bankofai/x402-paywall`、`@bankofai/x402-paywall/evm`、`@bankofai/x402-paywall/svm`。
- `typescript/packages/http/axios/README.md:124`、`typescript/packages/http/axios/README.md:148` 仍导入 `@bankofai/x402-svm`。
- `typescript/packages/core/README.md:285-286` 仍声明 `@bankofai/x402-svm` 和 `@bankofai/x402-avm` 是实现包。
- 当前树中已无 `typescript/packages/mechanisms/svm`、`typescript/packages/mechanisms/avm`、`typescript/packages/http/paywall`。

影响：

用户按 README 集成会安装或导入当前 workspace 不存在的包。对发布包消费者来说，如果这些包未由其他仓库发布，示例会直接失败；即使外部另有发布，也和当前仓库支持矩阵不一致。

建议：

1. 若当前 TypeScript 支持矩阵只保留 EVM/TRON，应把 README 示例全部改为 EVM/TRON。
2. 若 SVM/paywall 改为外部包，应在根 README、包 README 和 CONTRIBUTING 明确来源、版本和支持边界。
3. 给文档示例加一次 import smoke test，避免删除包后文档继续引用。

### F-02 中：paywall 本地包删除后，运行时动态 require 和包声明不一致

证据：

- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:1204-1221` 尝试 `require("@bankofai/x402-paywall")`，失败后吞掉异常并降级到 `FALLBACK_PAYWALL_HTML`。
- `typescript/packages/core/package.json:42-44` 只有 `zod` 运行时依赖，没有 `optionalDependencies` 或 peer 声明。
- `typescript/packages/http/next/package.json:45-47` 当前只声明 `next` peer；对比基线，`@x402/paywall` optional peer 和 `peerDependenciesMeta` 被删除。
- `typescript/packages/http/express/README.md:180` 链接到 `../paywall/README.md`，但当前 `packages/http/paywall` 已删除。

影响：

浏览器 paywall UI 变成“隐式外部可选包”。消费者从 package manifest 看不出需要安装 `@bankofai/x402-paywall`；如果包不存在、版本不兼容或 API 抛错，core 会静默降级为基础 HTML。这个 broad catch 会掩盖“包已安装但 API 坏了”和“包未安装”两类完全不同的问题。

建议：

1. 若 paywall 是外部可选包，应在相关 HTTP 包或 core 中声明 `peerDependencies` + `peerDependenciesMeta.optional`。
2. `require` 的 catch 应区分 `MODULE_NOT_FOUND` 和 paywall API 运行时异常；后者应至少 `log.warn`。
3. 删除或修复指向 `../paywall/README.md` 的本地相对链接。

### F-03 中：删除链包后，主动文档和 CONTRIBUTING 仍展示旧仓库结构

证据：

- `typescript/CONTRIBUTING.md:20-31` 仍展示 `packages/mechanisms/svm` 和 `packages/http/paywall`。
- `typescript/CONTRIBUTING.md:41-49` 仍把机制包描述为 `evm, svm`。
- `typescript/CONTRIBUTING.md:225-234` 仍保留 SVM、Stellar、Aptos 环境变量说明。
- `typescript/CONTRIBUTING.md:293-295` 仍说明 `packages/http/paywall/` 是当前 paywall 包。

影响：

维护者会按不存在的目录和脚本做开发，新增机制包时可能复制错误模板或配置。结合根 package 脚本已把 integration filter 收敛到 `@bankofai/x402-core`、`@bankofai/x402-evm`、`@bankofai/x402-tron`，CONTRIBUTING 的支持矩阵已经和实际 CI/工作区不同步。

建议：

1. 更新 CONTRIBUTING 的仓库结构为 core、extensions、mcp、http adapters、evm、tron、legacy。
2. 删除或标记 SVM/AVM/Aptos/Hedera/Stellar 为已移除/外部维护。
3. 补充 TRON 开发、测试和环境变量章节。

### F-04 中：Next route handler 包装路径存在既有 facilitator 错误边界不一致

证据：

- `typescript/packages/http/next/src/index.ts:111-120` 的 `paymentProxyFromHTTPServer` 对 `init()` 失败做了 `FacilitatorResponseError` 到 502 的转换。
- `typescript/packages/http/next/src/index.ts:308-321` 的 `withX402FromHTTPServer` 直接 `await init()` 和 `processHTTPRequest()`，没有同样的 try/catch。
- `typescript/packages/http/next/src/utils.ts:216-225` 只在 settlement 阶段捕获 `FacilitatorResponseError`。
- diff 复核显示这不是本次命名空间迁移新增的问题，但当前实现仍存在。

影响：

同一个 Next 包里，middleware 保护页面和 route handler 保护 API 对 facilitator 边界失败的响应不同。API route wrapper 可能抛出未格式化异常，表现为框架默认 500，而不是 SDK 统一的 502 JSON 响应。

建议：

给 `withX402FromHTTPServer` 的 `init()` 和 `processHTTPRequest()` 增加与 `paymentProxyFromHTTPServer` 相同的 `getFacilitatorResponseError()` 分支，并补测试。

### F-05 低到中：发布入口的 legacy 解析字段与条件 exports 存在兼容风险

证据：

- 多个保留包的 `package.json` 顶层字段仍类似 `main: ./dist/cjs/index.js`、`module: ./dist/esm/index.js`、`types: ./dist/index.d.ts`。
- 同一包的 `exports` 指向 `./dist/esm/index.mjs` 和 `./dist/cjs/index.js`，tsup 配置也按 `dist/esm`、`dist/cjs` 分目录输出。
- 示例：`typescript/packages/http/axios/package.json`、`typescript/packages/http/express/package.json`、`typescript/packages/http/fetch/package.json`。

影响：

现代 Node/bundler 会优先走 `exports`，通常不受影响。但旧 bundler、旧 TypeScript 或读取 `module/types` 顶层字段的工具，可能解析到不存在或非首选的文件。此问题在基线也部分存在，本次包名迁移和发布配置新增后更需要做发布 smoke test。

建议：

1. 构建后用 `npm pack --dry-run` 或等效脚本检查每个包的 `main/module/types/exports` 是否都指向实际文件。
2. 对每个保留包做 CJS、ESM、TypeScript types 三类 import smoke test。

## 4. 正向确认

### 4.1 源码包名迁移

扫描结果：

```bash
rg -n '@x402/' typescript --glob '!**/CHANGELOG.md' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/pnpm-lock.yaml' --files-with-matches
```

命中仅为：

```text
typescript/CLAUDE.md
typescript/packages/mechanisms/evm/NOTICE
typescript/packages/mechanisms/evm/src/adapters/agent-wallet.ts
```

其中 `agent-wallet.ts` 命中位于注释，不是运行时导入。非测试、非文档源码未发现旧 `@x402/*` 实际导入。

### 4.2 TRON exact 校验路径

`typescript/packages/mechanisms/tron/src/exact/facilitator/eip3009.ts`：

- `verifyEIP3009` 校验 scheme、network、TIP-712 domain、signature、recipient、validBefore、validAfter、amount。
- `settleEIP3009` 先调用 `verifyEIP3009`，再拆分签名并调用 `transferWithAuthorization`。

`typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts`：

- `verifyPermit2` 校验 scheme、network、Permit2/proxy 地址、spender、recipient、deadline、validAfter、amount、token、signature。
- `settlePermit2` 先调用 `verifyPermit2`，再调用 proxy `settle`。

未发现明显的 verify 通过但 settle 使用另一套字段的脱节。

### 4.3 TRON batch-settlement 并发控制

`typescript/packages/mechanisms/tron/src/batch-settlement/server/verify.ts` 和 `server/settle.ts`：

- verify 前会基于 channelId 建立 `pendingRequest`，并用 TTL 防止请求卡死。
- settle 前要求 pendingId 匹配，成功后清理 pending。
- `InMemoryChannelStorage.updateChannel` 提供单 JS runtime 内的 per-channel 锁。

限制：

`typescript/packages/mechanisms/tron/src/batch-settlement/server/storage.ts:35-39` 已明确说明内存存储只保证单 runtime 原子性，生产多实例需要 Redis/SQL/Durable Object 等后端。这是设计限制，不是代码缺陷，但应在用户文档中突出。

### 4.4 EVM agent wallet adapter

`typescript/packages/mechanisms/evm/src/adapters/agent-wallet.ts`：

- client signer 会绑定 `wallet.signTransaction`，避免方法脱离对象导致 `this` 丢失。
- typed-data 和 serialized transaction 都会补齐 `0x` 前缀。
- facilitator signer 使用 pending nonce、EIP-1559 fee、gas estimate，然后 wallet 签名并广播。

静态审计未发现明显的旧包导入或地址/签名前缀问题。

## 5. 已执行命令

```bash
sed -n '1,280p' docs/typescript-vs-typescript-new-audit-scope.md
git status --short --branch
rg -n '@x402/' typescript --glob '!**/CHANGELOG.md' --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/pnpm-lock.yaml' --files-with-matches
find typescript/packages -maxdepth 4 -name package.json -print
rg -n '@bankofai/x402-paywall|@x402/paywall|svmPaywall|avmPaywall' typescript --glob '!**/CHANGELOG.md' --glob '!**/pnpm-lock.yaml' --glob '!**/dist/**'
rg -n 'registerExactSvmScheme|ExactSvmScheme|x402-svm|x402-avm|x402-aptos|x402-hedera|x402-stellar|x402-paywall/svm' typescript/packages --glob '!**/CHANGELOG.md' --glob '!**/dist/**' --glob '!**/pnpm-lock.yaml'
git diff --unified=20 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new/packages/http/next/src/index.ts HEAD:typescript/packages/http/next/src/index.ts
git diff --unified=8 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new/packages/http/next/package.json HEAD:typescript/packages/http/next/package.json
```

## 6. 未执行验证

未执行以下命令，因为当前环境未找到 `pnpm`：

```bash
pnpm --dir typescript install
pnpm --dir typescript build
pnpm --dir typescript test
pnpm --dir typescript test:integration
```

建议补充这些验证后，再把本报告中的静态风险改为最终发布判断。
