# TypeScript 版架构设计与代码结构审计

审计日期：2026-07-02  
审计分支：`review-0702`  
审计基线：`bdd783a`  
审计范围：`typescript/` 下 v1.0 TypeScript SDK，包括 `core`、HTTP 适配器、mechanism、extensions、MCP 和 `packages/legacy` 的结构关系。  

本文聚焦架构设计、模块边界、代码组织、复杂度和可维护性风险，不重复安全审计中的链上签名、支付校验和输入安全细节。

## 1. 总体结论

TypeScript 版整体架构方向是合理的：`core` 作为协议编排层，EVM/TRON 等 mechanism 作为支付机制实现，Express/Hono/Fastify/Next/fetch/Axios 作为传输适配器，extensions 作为横切能力。这种分层避免了 `core` 直接依赖具体链和框架，发布形态也按使用场景拆成多个 npm 包。

主要问题不是分层方向错误，而是实现复杂度已经集中到几个核心文件和重复适配器流程中：

- `x402ResourceServer.ts` 1661 行，承担 scheme 注册、extension 注册、支付要求构建、verify、settle、hook 调度和取消通知。
- `x402HTTPResourceServer.ts` 1245 行，承担 HTTP 路由匹配、challenge 生成、payment header 解析、验证编排、settlement 编排、paywall 生成和错误响应。
- Express/Hono/Fastify/Next 各自实现初始化、Bazaar 懒加载、验证后业务 handler 执行、响应捕获、结算、失败回退和取消通知。
- `extensions` 包把 Bazaar、SIWX、offer/receipt、payment identifier、gas sponsoring、builder-code 等不同领域集中在一个包里，发布和依赖耦合偏强。
- `packages/legacy` 与新版 `packages/http/*`、`packages/core` 并存，测试和包名上有较大重叠，容易造成修复遗漏和 review 噪音。

结论：架构可继续演进，但建议在 v1.0 稳定前优先压缩 adapter 重复逻辑、明确 extension 生命周期契约、建立统一适配器契约测试，并给 legacy 范围建立清晰冻结策略。

## 2. 架构分层审计

### 2.1 当前分层

| 层级 | 主要目录 | 责任 | 审计判断 |
| --- | --- | --- | --- |
| 协议核心层 | `typescript/packages/core` | payment envelope、schema、client、resource server、facilitator、HTTP 公共编排 | 边界方向正确，但核心类过大 |
| HTTP 适配层 | `typescript/packages/http/*` | Express、Hono、Fastify、Next、fetch、Axios 接入 | API 清晰，但服务端适配器重复生命周期逻辑 |
| 支付机制层 | `typescript/packages/mechanisms/evm`、`typescript/packages/mechanisms/tron` | 具体链、scheme、签名、settlement 实现 | 与 core 解耦较好，导出面较细 |
| 扩展层 | `typescript/packages/extensions` | Bazaar、SIWX、offer/receipt、payment identifier、gas sponsoring 等 | 能力丰富，但单包聚合过重 |
| MCP 层 | `typescript/packages/mcp` | MCP `_meta` 支付传输和 wrapper | 与 HTTP 独立，但 client 文件较大 |
| Legacy 层 | `typescript/packages/legacy/*` | 旧版兼容包 | 需要冻结边界和迁移策略 |

### 2.2 依赖方向

当前依赖方向总体健康：

- `core` 只定义协议和编排接口，不直接依赖 EVM/TRON。
- mechanism 包依赖 `@bankofai/x402-core`，实现 `client/server/facilitator` 角色。
- HTTP 适配器依赖 `@bankofai/x402-core`，对外重导出 `x402ResourceServer`、`x402HTTPResourceServer` 等入口。
- extensions 依赖 `@bankofai/x402-core`，通过 extension hook 接入资源服务器生命周期。

需要关注的依赖点：

- Express/Hono/Fastify/Next 适配器为了 Bazaar 自动注册动态导入 `@bankofai/x402-extensions/bazaar`，这使 HTTP 适配器和某个具体 extension 产生运行时耦合。
- `extensions` 根包导出多个扩展域，依赖 `viem`、`jose`、`siwe`、`tweetnacl`、`ajv` 等，安装某个轻量扩展时仍可能带来较重依赖面。
- legacy 与新版包同时存在，包名和概念高度相近，容易让应用误用或文档引用混乱。

## 3. 核心模块审计

### 3.1 `x402ResourceServer`

文件：`typescript/packages/core/src/server/x402ResourceServer.ts`

角色：

- 管理 facilitator client。
- 注册 scheme/network server。
- 注册 resource server extension。
- 构建 `PaymentRequired`。
- 执行 verify/settle 生命周期 hook。
- 调用 facilitator verify/settle。
- 创建 verified payment cancellation dispatcher。

优点：

- scheme 注册与 facilitator 支持表分离，便于多网络、多 scheme 支持。
- `createPaymentRequiredResponse` 对 scheme enrich 和 extension enrich 设置了 mutation policy，避免扩展随意改写支付核心字段。
- verify/settle 生命周期支持 abort、skip、recover、cancel，扩展能力完整。

结构风险：

- 文件职责过多，1661 行已经超过“单一编排类”的舒适范围。
- hook 来源有 manual hook、scheme hook、extension hook，执行顺序和权限边界需要跨多个类型、policy、server 方法理解。
- extension 错误多数以 warn 方式处理，哪些 hook failure 应阻断、哪些可忽略，需要有更明确的生命周期表。

建议：

- 拆出 `SchemeRegistry`、`ExtensionRegistry`、`VerifyPipeline`、`SettlePipeline`、`PaymentRequiredBuilder`。
- 在文档和类型层明确 hook 顺序、可变字段、失败策略和 recover 优先级。
- 为每个 pipeline 建立独立单元测试，减少对大类行为测试的依赖。

### 3.2 `x402HTTPResourceServer`

文件：`typescript/packages/core/src/http/x402HTTPResourceServer.ts`

角色：

- 编译 route config。
- 判断请求是否需要支付。
- 从 HTTP header 解析 payment payload。
- 生成 402 challenge 或 paywall HTML。
- 调用 core verify。
- 返回 `payment-verified` 给框架适配器。
- 在 handler 成功后执行 settlement。

优点：

- 把 HTTP 层通用流程集中在一个类里，框架适配器不用重复 payment header 解析和 challenge 生成。
- `initialize()` 同时执行 facilitator support 同步和 route config 校验。
- `processSettlement()` 支持通过响应 header 传入 settlement override，适合动态价格和部分结算。
- `normalizePath()` 保留 `%2F`、`%5C`，避免 encoded path separator 造成保护路由绕过。

结构风险：

- 同时承担 route matcher、paywall、header encoding、settlement failure response、extension transport hook 等职责，文件过大。
- route pattern 由自定义 regex 编译，必须持续追踪 Express/Hono/Fastify/Next 的真实路由语义。
- `generatePaywallHTML()` 通过可选 `require("@bankofai/x402-paywall")` 加载 paywall，属于 CJS 风格运行时探测，在纯 ESM 或 bundler 环境中需要持续验证。

建议：

- 拆出 `RouteMatcher`、`PaymentChallengeFactory`、`SettlementResponseFactory`、`PaywallRenderer`。
- 把 route matcher 作为独立公共测试目标，建立每个适配器的 route 语义对照测试。
- 明确 paywall 依赖策略：要么作为显式 peer dependency，要么让用户必须注册 `PaywallProvider`。

### 3.3 HTTP 服务端适配器

文件：

- `typescript/packages/http/express/src/index.ts`
- `typescript/packages/http/hono/src/index.ts`
- `typescript/packages/http/fastify/src/index.ts`
- `typescript/packages/http/next/src/index.ts`

共同流程：

1. 可选注册 paywall provider。
2. 根据 route 判断是否需要初始化 facilitator。
3. 懒加载 Bazaar extension。
4. 调用 `processHTTPRequest()`。
5. 未支付或支付无效时返回 402。
6. 支付验证成功后执行业务 handler。
7. 捕获业务响应 body/header。
8. 如果业务响应状态码 `>= 400`，取消已验证支付，不 settle。
9. 如果业务成功，调用 `processSettlement()`。
10. settlement 成功后附加 payment response header，失败则不返回受保护资源。

优点：

- 与框架集成方式符合各框架习惯。
- Express 对 `writeHead/write/end/flushHeaders` 做 buffer，Hono/Next 基于 `Response.clone()`，Fastify 使用 `onRequest/onSend` 和 raw guard。
- Next 文档已经明确 `withX402` 是 API route 推荐方式，`paymentProxy` 用于 page route，API route 使用 proxy 会对失败响应收费。

结构风险：

- 初始化、Bazaar 懒加载、错误响应、settlement 成功/失败处理在多个适配器重复实现。
- 各框架响应捕获语义不同，streaming、raw response、大响应体、提前 flush header 等场景行为不容易保持一致。
- Fastify 专门引入 `guardReplyRaw()`，Express patch response 方法，说明通用生命周期契约还没有被抽象出来。
- Next 同时提供 `paymentProxy` 和 `withX402`，语义差异大。`paymentProxy` middleware 无法观察最终 handler 响应，因此 API route 失败也可能被结算。

建议：

- 抽象一个 adapter contract，而不是继续复制 settlement orchestration：
  - `readRequestContext()`
  - `sendPaymentError()`
  - `runHandlerAndCaptureResponse()`
  - `commitSettlementSuccess()`
  - `commitSettlementFailure()`
  - `cancelVerifiedPayment()`
- 建立共享 conformance test matrix，所有服务端适配器必须通过：
  - 未支付返回 402。
  - invalid payment 返回 402。
  - verify 成功但 handler throw 时 cancel，不 settle。
  - handler 返回 `>= 400` 时 cancel，不 settle。
  - settlement 失败时不返回受保护资源。
  - settlement 成功时透传业务响应并附加 payment response header。
  - settlement override header 正确传入。
  - streaming/raw/large body 行为有明确结果。
- Next API 文档中把 `paymentProxy` 标注为 page/preflight gate，把 `withX402` 作为 API 默认入口。

### 3.4 Client 与 HTTP client

文件：

- `typescript/packages/core/src/client/x402Client.ts`
- `typescript/packages/core/src/http/x402HTTPClient.ts`
- `typescript/packages/http/fetch/src/index.ts`
- `typescript/packages/http/axios/src/index.ts`

优点：

- `x402Client` 只关心 payment requirement 选择、scheme client 调用和 client hook。
- fetch/Axios wrapper 负责 402 challenge 解析、生成 payment header、重试请求和 payment response hook。
- client extension enrichment 与 server extension 模型对应，协议扩展具备端到端能力。

结构风险：

- client 侧也有 manual hook、extension hook、payment response recovery 等流程，复杂度与 server hook 体系相呼应。
- fetch 和 Axios wrapper 分别实现重试和 response hook 恢复，后续新增 HTTP client 可能继续复制。

建议：

- 把 “收到 402 -> 解析 challenge -> 创建 payload -> 重试 -> 处理 payment response -> 有界恢复重试” 抽成 transport-neutral helper。
- fetch/Axios 仅保留 request/response 适配逻辑。

### 3.5 Mechanism 包

文件：

- `typescript/packages/mechanisms/evm`
- `typescript/packages/mechanisms/tron`

优点：

- EVM/TRON 按 scheme 和角色拆分导出，例如 `exact/client`、`exact/server`、`exact/facilitator`、`upto/*`、`batch-settlement/*`。
- `core` 不依赖链实现，新增链或 scheme 不需要修改核心协议层。
- package exports 较细，应用可按需导入。

结构风险：

- EVM 和 TRON 都存在 `exact`、`upto`、`batch-settlement` 等相似形态，若没有共享机制测试规范，容易出现行为漂移。
- TRON 包含 `gasfree`，EVM 包含 `auth-capture`，链特有能力会让机制层 API 逐渐分叉。

建议：

- 为所有 mechanism 建立统一 scheme behavior spec，例如金额解析、deadline、asset decimal、verify failure、settlement failure、extension enrichment。
- 链特有能力保留在子路径导出，避免污染根导出和 core 抽象。

### 3.6 Extensions 包

文件：

- `typescript/packages/extensions/src/index.ts`
- `typescript/packages/extensions/src/bazaar/*`
- `typescript/packages/extensions/src/sign-in-with-x/*`
- `typescript/packages/extensions/src/offer-receipt/*`
- `typescript/packages/extensions/src/payment-identifier/*`
- `typescript/packages/extensions/src/eip2612-gas-sponsoring/*`
- `typescript/packages/extensions/src/erc20-approval-gas-sponsoring/*`
- `typescript/packages/extensions/src/builder-code/*`

优点：

- extension hook 类型较完整，覆盖 `PaymentRequired` enrich、verify、settle、settlement response enrich、transport hook。
- `hookPolicy.ts` 对核心支付字段做了不可变约束，降低 extension 破坏 payment terms 的风险。
- extensions 有独立测试，覆盖多个扩展域。

结构风险：

- 单包包含多个领域，依赖面和发布节奏耦合。
- HTTP 适配器对 Bazaar 进行特殊动态加载，说明 extension 发现和注册机制还不够通用。
- extension hook 能力较强，如果缺少统一生命周期说明，第三方扩展开发者很难判断哪些字段可以改、哪些错误会阻断请求。

建议：

- 长期拆成 `@bankofai/x402-extension-bazaar`、`@bankofai/x402-extension-siwx` 等独立包，或至少把重依赖 extension 作为 subpath + optional dependency 策略明确化。
- 提供 extension conformance test harness，强制验证 mutation policy、hook failure policy、settlement enrich policy。
- 把 Bazaar 自动注册改为通用 route extension resolver，避免 HTTP adapter 写死具体 extension。

### 3.7 MCP 包

文件：`typescript/packages/mcp`

优点：

- MCP 支付逻辑没有硬塞进 HTTP 适配器，协议边界较清晰。
- server wrapper 和 client wrapper 复用 core payment 模型。

结构风险：

- `x402MCPClient.ts` 1021 行，已经接近 HTTP 核心类复杂度。
- MCP 与 HTTP 都在处理“challenge -> payment -> retry/settlement response”流程，长期应共享更多协议编排逻辑。

建议：

- 将 MCP client 拆成 transport adapter、payment state machine、tool/resource metadata parser。
- 与 HTTP client 共享 payment retry/recovery state machine。

### 3.8 Legacy 包

文件：`typescript/packages/legacy/*`

现状：

- 存在 `x402`、`x402-express`、`x402-hono`、`x402-next`、`x402-fetch`、`x402-axios` 等旧包。
- 测试树中 legacy 与新版测试并存。

风险：

- 同名概念多套实现，安全修复、文档示例、API 语义容易遗漏一边。
- 新开发者和审计者需要额外判断哪些代码是主路径。
- CI 时间和 review 输出包含 legacy 噪音。

建议：

- 在根 README 和包 README 明确 legacy 冻结策略。
- legacy 只接受安全修复，不接受新 feature。
- 新版与 legacy 的导出、文档、examples 用明显命名隔离。
- 若需要继续支持 legacy，建立“同类安全修复必须同步检查 legacy”的 checklist。

## 4. 关键结构风险清单

| 编号 | 等级 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| A-01 | 高 | 服务端适配器重复实现 settlement lifecycle | 不同框架行为漂移，修复容易漏框架 | 建立 adapter contract 和共享 conformance tests |
| A-02 | 高 | `x402ResourceServer` 与 `x402HTTPResourceServer` 过大 | 核心变更风险高，审计成本高 | 拆分 registry、pipeline、matcher、response factory |
| A-03 | 中高 | extension 生命周期能力强但分散 | 第三方扩展难以正确实现，hook failure 策略难理解 | 输出正式 lifecycle 表和 extension harness |
| A-04 | 中高 | 自定义 route regex 需要模拟多框架语义 | 路由保护边界可能与真实框架 dispatch 不一致 | 增加跨框架路由匹配契约测试 |
| A-05 | 中 | Next `paymentProxy` 与 `withX402` 语义差异大 | API route 误用 proxy 可能导致失败响应也收费 | API 文档和类型命名进一步区分用途 |
| A-06 | 中 | 响应 body 捕获方式框架差异明显 | streaming、raw response、大 body 行为不可预期 | 明确支持矩阵，必要时提供 opt-in body capture |
| A-07 | 中 | extensions 单包过重 | 依赖膨胀，发布耦合 | 拆分扩展包或明确 optional dependency 策略 |
| A-08 | 中 | legacy 与新版并存 | 修复遗漏、文档混乱、review 噪音 | 冻结 legacy，建立迁移和同步修复策略 |
| A-09 | 低中 | client transport wrapper 也存在重复 state machine | 新 transport 易复制逻辑 | 抽出 transport-neutral payment retry helper |
| A-10 | 低中 | package exports 很细但文档入口需要更强导航 | 用户选择成本高 | 增加按角色安装和导入矩阵 |

## 5. 代码结构指标

本次审计抽样统计：

| 文件 | 行数 | 判断 |
| --- | ---: | --- |
| `typescript/packages/core/src/server/x402ResourceServer.ts` | 1661 | 过大，核心职责集中 |
| `typescript/packages/core/src/http/x402HTTPResourceServer.ts` | 1245 | 过大，HTTP 编排职责集中 |
| `typescript/packages/mcp/src/client/x402MCPClient.ts` | 1021 | 过大，建议拆状态机 |
| `typescript/packages/http/fastify/src/index.ts` | 597 | 适配器复杂度偏高 |
| `typescript/packages/http/express/src/index.ts` | 489 | patch response 方法，维护成本高 |
| `typescript/packages/http/next/src/index.ts` | 444 | 两套 API 语义差异需继续强调 |
| `typescript/packages/http/hono/src/index.ts` | 392 | 相对较短，但仍复制 lifecycle |

测试文件数量：`127` 个 `*.test.ts`。覆盖面较宽，但架构风险更多来自“同一生命周期在多框架重复实现”，因此仅有数量不足以证明适配器行为一致。

## 6. 建议的目标架构

建议把当前结构演进为更明确的五层：

```text
Application / Framework
  -> Adapter Contract
    -> HTTP Payment Runtime
      -> Core Payment Runtime
        -> Scheme / Facilitator / Extension Runtime
```

### 6.1 Adapter Contract

每个服务端框架只实现小接口：

- 读取请求 path、method、headers、accept、user-agent。
- 发送 payment error。
- 执行业务 handler 并捕获 response status、headers、body。
- 提交 settlement 成功结果。
- 提交 settlement 失败结果。
- 处理 handler throw 和 handler failed cancellation。

### 6.2 HTTP Payment Runtime

集中实现：

- 初始化和 facilitator support 同步。
- route 匹配和 route config 校验。
- Bazaar 或其他 route extension 的通用解析。
- `processHTTPRequest()`。
- `processSettlement()`。
- settlement failure response。

### 6.3 Core Payment Runtime

集中实现：

- scheme registry。
- facilitator registry。
- extension registry。
- verify pipeline。
- settle pipeline。
- payment required builder。
- cancellation dispatcher。

### 6.4 Extension Runtime

集中定义：

- hook 顺序。
- hook 可变字段。
- hook 失败策略。
- enrich 合并策略。
- conformance test harness。

## 7. 推荐改造优先级

### P0：冻结行为，补契约测试

优先不改架构，先补测试锁定当前行为：

- 服务端 adapter conformance tests。
- route matcher 跨框架语义 tests。
- extension lifecycle tests。
- response body capture 支持矩阵 tests。

### P1：降低重复

- 提取 adapter lifecycle helper。
- 把 Express/Hono/Fastify/Next 的初始化、Bazaar 加载、settlement 成功/失败、cancellation 分支收敛。
- fetch/Axios 共享 payment retry helper。

### P2：拆核心大类

- `x402ResourceServer` 拆 registry 与 pipeline。
- `x402HTTPResourceServer` 拆 matcher、challenge factory、settlement response factory、paywall renderer。
- MCP client 拆 transport、metadata parser、payment state machine。

### P3：包结构治理

- legacy 冻结和迁移文档。
- extensions 拆包或 optional dependency 策略。
- 导入路径和安装矩阵文档。

## 8. 审计结论

TypeScript 版当前架构具备清晰的协议分层和多框架扩展能力，核心方向可以保留。当前最大技术债是“核心编排类过大”和“服务端适配器重复实现同一支付生命周期”。这类问题短期不一定表现为功能 bug，但会放大后续新增 scheme、extension、framework、settlement 变体时的回归风险。

建议把后续治理重点放在三件事：

1. 用共享 conformance tests 锁住所有服务端适配器行为。
2. 抽出 payment lifecycle runtime，减少框架适配器重复。
3. 把 extension 生命周期和可变字段策略正式文档化，并提供测试 harness。

完成以上三项后，当前 TypeScript 版会更适合作为稳定 SDK 基线继续扩展。
