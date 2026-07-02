# TypeScript 与 typescript_new 差异审计范围

## 1. 对比基线

- 基线：`9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new`
- 目标：当前分支 `review-0702` 的 `HEAD:typescript`，当前 HEAD 为 `bdd783a`
- 对比方式：树对树对比，不包含当前工作区未跟踪文档文件
- 建议复现命令：

```bash
git diff --shortstat 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new HEAD:typescript
git diff --stat 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new HEAD:typescript
git diff --name-status 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new HEAD:typescript
```

已确认总体差异规模：

```text
1122 files changed, 22533 insertions(+), 86184 deletions(-)
```

## 2. 审计范围结论

本次审计范围应以“当前 `typescript` 相对 `9c172...:typescript_new` 的行为变化和可发布产物变化”为主，而不是重新审计被删除包的内部实现。

P0 审计范围：

1. 包命名空间迁移：`@x402/*` 到 `@bankofai/x402-*`。
2. 已删除包的兼容性影响：`packages/http/paywall`、`aptos`、`avm`、`hedera`、`stellar`、`svm`、`site`。
3. core 运行时变更：观测日志、paywall fallback、钱包导出、资源服务器告警路径。
4. HTTP 适配器：axios、express、fastify、fetch、hono、next 的包名迁移和支付中间件行为。
5. EVM 机制：agent wallet、batch settlement、exact、upto、auth capture 相关变更。
6. TRON 机制：exact、upto、gasfree、batch settlement、facilitator/client/server 相关新增与变更。
7. MCP 包：包名迁移、client/server/utils 的行为兼容性。
8. extensions 包：各扩展域的导入迁移、类型导出和运行时生命周期。

P1 审计范围：

1. README、CHANGELOG、示例代码中的包名、支持链、安装命令一致性。
2. 测试文件中的导入迁移是否完整。
3. 根脚本、turbo 配置、workspace 发布配置是否覆盖所有保留包。
4. legacy 包是否仍保持预期的兼容接口。

默认不作为本轮深度审计范围：

1. 已删除 `site` 的页面功能和视觉实现。
2. 已删除链包内部算法正确性；本轮只审计“删除这些链以后是否仍有引用、文档承诺、测试脚本或运行时入口残留”。

## 3. 包级变化清单

| 基线包 | 当前状态 | 审计判断 |
| --- | --- | --- |
| `@x402/core` | 重命名为 `@bankofai/x402-core` | P0，核心协议、类型、资源服务器入口必须重点审计。 |
| `@x402/extensions` | 重命名为 `@bankofai/x402-extensions` | P0，扩展注册和导入路径需要验证。 |
| `@x402/axios` | 重命名为 `@bankofai/x402-axios` | P0，客户端支付 header 注入和 retry 路径需要验证。 |
| `@x402/express` | 重命名为 `@bankofai/x402-express` | P0，服务端 402 生成、verify/settle 生命周期需要验证。 |
| `@x402/fastify` | 重命名为 `@bankofai/x402-fastify` | P0，同 express。 |
| `@x402/fetch` | 重命名为 `@bankofai/x402-fetch` | P0，fetch wrapper 兼容性需要验证。 |
| `@x402/hono` | 重命名为 `@bankofai/x402-hono` | P0，同 express。 |
| `@x402/next` | 重命名为 `@bankofai/x402-next` | P0，Next middleware 和 route handler 运行时差异需要验证。 |
| `@x402/paywall` | 当前 `typescript` 本地包已删除 | P0，高风险：core 和 README 指向 `@bankofai/x402-paywall`，但当前树内没有对应包。 |
| `@x402/mcp` | 重命名为 `@bankofai/x402-mcp` | P0，MCP server/client 支付协商需要验证。 |
| `@x402/evm` | 重命名为 `@bankofai/x402-evm` | P0，仍是核心机制包。 |
| `@x402/tron` | 重命名为 `@bankofai/x402-tron` | P0，当前版本新增和变更较多，应重点审计。 |
| `@x402/aptos` | 删除 | P0，审计删除影响和残留引用。 |
| `@x402/avm` | 删除 | P0，审计删除影响和残留引用。 |
| `@x402/hedera` | 删除 | P0，审计删除影响和残留引用。 |
| `@x402/stellar` | 删除 | P0，审计删除影响和残留引用。 |
| `@x402/svm` | 删除 | P0，审计删除影响和残留引用。 |
| `x402-*` legacy 包 | 基本保留原包名 | P1，确认 legacy 包是否仍指向正确的新命名空间或保持兼容。 |

## 4. 重点风险点

### 4.1 paywall 包删除但仍被引用

当前 `packages/http/paywall` 已从 `typescript` 树删除。与此同时，HTTP 适配器 README 仍建议安装 `@bankofai/x402-paywall`，core 的 HTTP resource server 也将可选 require 从 `@x402/paywall` 改为 `@bankofai/x402-paywall`。

审计问题：

1. `@bankofai/x402-paywall` 是否由外部仓库或外部包发布提供。
2. 如果该包不存在，文档中的安装命令和高级配置链接会失效。
3. fallback HTML 是否足以替代 paywall UI，是否会改变用户可支付性。
4. `next` README 仍示例导入 `@bankofai/x402-paywall/svm`，但当前 `svm` 机制包也已删除，应确认这是历史文档残留还是外部 paywall 仍支持 SVM。

### 4.2 多链机制包删除

当前版本删除了 `aptos`、`avm`、`hedera`、`stellar`、`svm` 五个机制包及其测试。根 package 脚本中的 integration filter 也从多链收敛到 `core`、`evm`、`tron`。

审计问题：

1. 产品支持矩阵是否明确只保留 EVM 和 TRON。
2. core 的 scheme/network 类型是否仍暴露被删除链。
3. README、示例、测试、包导出是否仍引用被删除链。
4. 删除链包后，跨链聚合逻辑是否仍能正确处理 unsupported scheme/network。
5. integration 测试范围收窄是否导致核心协议回归无法被捕获。

### 4.3 包命名空间整体迁移

保留包从 `@x402/*` 迁移到 `@bankofai/x402-*`，同时部分版本从 `2.15.0` 重置为 `1.0.0-beta.0`，并新增 `publishConfig`。

审计问题：

1. 源码、测试、README、示例中是否仍残留旧 `@x402/*` 导入。
2. package `exports` 是否完整覆盖 CJS、ESM、types。
3. 包间依赖是否全部迁移到新命名空间。
4. 发布版本重置是否会影响消费者升级路径、peer dependency、lockfile 解析。
5. legacy 包是否仍能作为兼容层使用。

### 4.4 core 运行时新增 observability

core 新增 `packages/core/src/observability`，并将部分 `console.warn` 替换为 `log.warn`。HTTP resource server 的 paywall fallback require 也一起变化。

审计问题：

1. 日志默认开关、环境变量、输出格式是否符合生产预期。
2. 日志是否包含 payment header、payer、payee、tx hash、authorization 等敏感或可关联信息。
3. `log.warn` 是否在浏览器、Node、edge runtime 中都可用。
4. paywall require 失败路径是否只降级，不应导致 protected endpoint 崩溃。
5. `./wallets` 新导出是否会扩大 API 面并带来错误使用风险。

### 4.5 EVM 机制新增 agent wallet 与批量结算路径

EVM 仍是当前 TypeScript 实现的核心机制包之一，并新增 agent wallet adapter、chains adapter 以及 batch settlement 相关测试。

审计问题：

1. agent wallet 生成的 payment payload 是否与普通 wallet 完全等价。
2. chain/network 映射是否与 core 支持矩阵一致。
3. batch settlement 的 partial failure、refund network、重复 settlement、并发重放是否处理完整。
4. exact 与 upto 两类 scheme 的 amount、asset、network 校验是否保持一致。
5. auth capture 的授权边界是否仍只允许预期 facilitator 执行。

### 4.6 TRON 机制大幅扩展

TRON 包在当前树中是新增/扩展最多的机制包之一，涉及 exact、upto、gasfree、batch settlement、facilitator、client、server 等多条路径。

审计问题：

1. TRON 地址、asset、network、chain id 的解析是否严格。
2. gasfree 与普通转账的签名域、授权域、过期时间是否不可混淆。
3. batch settlement 的顺序、失败隔离、重复提交和退款路径是否完整。
4. facilitator verify 与 settle 是否共享相同校验逻辑，避免 verify 通过但 settle 失败。
5. 测试是否覆盖 mainnet/testnet、不支持 token、金额精度和边界值。

### 4.7 MCP 与 HTTP 入口兼容性

MCP 包和 HTTP adapters 是外部集成入口，命名空间迁移可能影响消费者直接导入。

审计问题：

1. MCP server 暴露的 tool/resource 是否仍与 payment flow 对齐。
2. MCP client 是否正确处理 402 challenge、重试和支付 header。
3. HTTP adapters 是否保持一致的错误结构和响应状态码。
4. Next runtime、edge runtime、Node runtime 的动态 require 或日志依赖是否兼容。

## 5. 建议审计执行清单

1. 残留导入扫描：

```bash
rg -n '@x402/' typescript --glob '!**/CHANGELOG.md'
rg -n '@bankofai/x402-paywall|@x402/paywall' typescript
```

2. 包发布结构验证：

```bash
find typescript/packages -maxdepth 3 -name package.json -print
```

逐个检查保留包的 `name`、`version`、`exports`、`dependencies`、`peerDependencies`、`publishConfig`。

3. 构建验证：

```bash
pnpm --dir typescript install
pnpm --dir typescript build
```

4. 测试验证：

```bash
pnpm --dir typescript test
pnpm --dir typescript test:integration
```

5. 入口 smoke test：

为每个保留包验证以下入口：

```text
@bankofai/x402-core
@bankofai/x402-core/wallets
@bankofai/x402-evm
@bankofai/x402-tron
@bankofai/x402-axios
@bankofai/x402-fetch
@bankofai/x402-express
@bankofai/x402-fastify
@bankofai/x402-hono
@bankofai/x402-next
@bankofai/x402-mcp
@bankofai/x402-extensions
```

6. 删除影响验证：

确认以下路径不存在后，所有源码和主动文档中也不再承诺这些包可用：

```text
typescript/packages/http/paywall
typescript/packages/mechanisms/aptos
typescript/packages/mechanisms/avm
typescript/packages/mechanisms/hedera
typescript/packages/mechanisms/stellar
typescript/packages/mechanisms/svm
typescript/site
```

## 6. 初始风险评级

| 风险 | 等级 | 理由 |
| --- | --- | --- |
| paywall 本地包删除但文档和 core 指向 `@bankofai/x402-paywall` | 高 | 如果外部包不存在或未发布，用户按文档安装会失败，运行时只能走 fallback。 |
| 多链机制包删除 | 高 | 这是产品支持矩阵级别变更，影响 API、文档、测试和下游用户。 |
| 命名空间迁移残留旧导入 | 高 | 任一源码残留旧包名都可能导致构建或运行时解析失败。 |
| integration 测试范围收窄 | 中 | 删除链包后合理，但也可能降低对 core 多机制抽象的回归覆盖。 |
| TRON 新增大面积支付路径 | 中 | 代码面扩大，涉及签名、结算、gasfree 和批量路径。 |
| observability 日志新增 | 中 | 需要确认敏感字段不会进入日志，且 runtime 兼容。 |
| README/CHANGELOG 迁移不一致 | 低到中 | 主要影响集成体验，但也可能暴露不存在的入口。 |

## 7. 当前已执行验证

已执行：

```bash
git cat-file -t 9c172bb29aca9aafc6da4b971183d9daee5f8698
git diff --shortstat 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new HEAD:typescript
git diff --name-status 9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new HEAD:typescript -- packages/http/paywall packages/mechanisms/aptos packages/mechanisms/avm packages/mechanisms/hedera packages/mechanisms/stellar packages/mechanisms/svm site
rg -n "@x402/paywall|@bankofai/x402-paywall" typescript/packages/core/src typescript/packages --glob package.json --glob README.md
command -v pnpm
```

验证结果：

1. commit `9c172bb29aca9aafc6da4b971183d9daee5f8698` 存在。
2. 树对树差异规模为 `1122 files changed, 22533 insertions(+), 86184 deletions(-)`。
3. `packages/http/paywall`、`aptos`、`avm`、`hedera`、`stellar`、`svm`、`site` 在当前目标树中为删除状态。
4. README 中仍存在多处 `@bankofai/x402-paywall` 安装和导入说明。
5. 当前环境未找到 `pnpm`，因此未执行 build/test/integration 验证。

## 8. 后续审计优先级

建议按以下顺序继续：

1. 先做残留引用审计，确认删除包和旧命名空间没有破坏构建。
2. 再做 package manifest 和 exports 审计，确认发布产物可被正常消费。
3. 然后审计 core、HTTP adapters、MCP 的公共入口行为。
4. 最后深入 EVM 和 TRON 支付机制，重点覆盖签名、金额、网络、settlement、refund、batch 和重放防护。
