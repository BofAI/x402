# TypeScript 版核心功能正确性与完备性逐项审计

审计日期：2026-07-02  
审计分支：`review-0702`  
审计基线：`bdd783a`  
审计范围：`typescript/` 下 v1.0 TypeScript 主实现。`typescript/packages/legacy/*` 仅作为兼容层风险背景，不作为主路径逐项展开。  
审计方法：静态阅读源码、核对单元/集成测试覆盖点、对照前置架构与运行路径文档。  
验证限制：尝试执行 `pnpm --dir typescript --filter @bankofai/x402-core test`，但当前环境无 `pnpm`，命令返回 `zsh:1: command not found: pnpm`。因此本文结论基于源码和测试用例静态证据，不包含本机测试通过证明。

## 1. 总览结论

TS 版核心功能整体正确性较好：支付要求构建、402 challenge、client 自动支付、服务端 verify、业务成功后 settle、失败 cancel、extension mutation policy、MCP 支付 wrapper、EVM/TRON mechanism 的关键路径都有明确实现和测试覆盖。

完备性风险主要集中在边界契约，而不是主路径缺失：

- HTTP 服务端适配器各自实现 settlement lifecycle，缺少一套共享 conformance tests。
- `syncFacilitatorOnStart=false` 或手动绕过 `initialize()` 时，配置错误可能从“启动期配置错误”退化为“请求期异常”。
- `x402ResourceServer.buildPaymentRequirements()` 仍保留未注册 scheme 返回空 requirements 的 TODO fallback。
- facilitator support 表对 wildcard network 的支持缺少直接测试，且 `getSupportedKind()` 中存在精确 `kind.network === network` 的二次筛选。
- hook 异常多数采用 warn-and-continue，适合非关键观测 hook，但对认证/授权类 extension 可能形成 fail-open 语义。
- streaming/raw/large response 的 settlement body 捕获行为尚未形成统一支持矩阵。

## 2. 审计状态说明

| 状态 | 含义 |
| --- | --- |
| 通过 | 主路径实现完整，测试覆盖直接，未发现明显正确性缺口 |
| 基本通过 | 主路径正确，但存在边界覆盖不足或契约需要补强 |
| 有缺口 | 存在明确正确性风险、未完成实现、或容易导致调用方误用 |

## 3. 核心功能逐项审计

### 3.1 ResourceServer 初始化与 facilitator support 同步

相关源码：

- `typescript/packages/core/src/server/x402ResourceServer.ts:560`
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:443`
- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts`
- `typescript/packages/core/test/unit/http/x402HTTPResourceServer.initialize.test.ts`

功能目标：

- 从一个或多个 facilitator client 拉取 supported kinds。
- 构建 `version -> network -> scheme -> supported response/facilitator client` 映射。
- 多 facilitator 时让靠前 client 拥有优先级。
- HTTP server 初始化时校验 route config 的 scheme 注册和 facilitator 支持。

正确性判断：基本通过。

证据：

- 测试覆盖了多 facilitator、失败后继续、全部失败时报错、重新初始化清空旧映射。
- HTTP 初始化测试覆盖了 missing scheme、missing facilitator、合法 routes、数组 accepts、单 route config。

完备性缺口：

- 如果用户设置 `syncFacilitatorOnStart=false` 且没有手动调用 `initialize()`，route 校验不会提前执行，请求期才暴露错误。
- support 映射支持 network pattern lookup，但 `getSupportedKind()` 找到 supported response 后又用 `kind.network === network` 精确筛选；如果 facilitator 宣告的是 `eip155:*` 这类 wildcard kind，请求 `eip155:8453` 可能取不到 kind。当前测试没有直接覆盖 resource server support 表 wildcard 场景。

建议：

- 增加 `syncFacilitatorOnStart=false` 的文档警告和测试：用户必须显式 `await httpServer.initialize()`。
- 增加 `getSupportedKind(2, "eip155:8453", "exact")` 命中 `kind.network="eip155:*"` 的测试，并据结果修正实现或明确不支持 wildcard facilitator advertisement。

### 3.2 PaymentRequirements 构建

相关源码：

- `typescript/packages/core/src/server/x402ResourceServer.ts:655`
- `typescript/packages/core/src/server/x402ResourceServer.ts:755`
- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts`
- `typescript/packages/core/test/unit/http/x402HTTPResourceService.test.ts`

功能目标：

- 将 route/resource config 的 `scheme/payTo/price/network/maxTimeoutSeconds/extra` 转换为 `PaymentRequirements`。
- 支持动态 `price(context)` 和 `payTo(context)`。
- 使用 scheme server 的 `parsePrice()` 和 `enhancePaymentRequirements()`。
- 使用 facilitator supported kind 和 extensions enrich requirements。

正确性判断：基本通过。

证据：

- 测试覆盖 price parser 调用、scheme enhance 调用、默认/自定义 timeout、动态价格、动态收款地址、HTTP context 访问。
- EVM/TRON mechanism 各自测试了金额解析、默认 token、decimals、unsupported network、invalid money format、custom parser 等。

完备性缺口：

- `buildPaymentRequirements()` 在找不到 registered scheme 时返回空数组，并带有 TODO fallback 注释。这在已初始化 HTTP server 下会被 route 校验提前挡住，但如果直接调用 core 或跳过初始化，可能生成空 `accepts` 的 402 challenge。

建议：

- 将未注册 scheme 的 fallback 从 “warn + empty array” 改为显式 throw，或只允许在兼容模式下启用。
- 增加 direct core 使用场景测试：未注册 scheme 不应生成空 challenge。

### 3.3 PaymentRequired challenge 生成与 enrichment

相关源码：

- `typescript/packages/core/src/server/x402ResourceServer.ts:803`
- `typescript/packages/core/src/server/hookPolicy.ts`
- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts`
- `typescript/packages/core/test/unit/http/x402HTTPResourceServer.hooks.test.ts`

功能目标：

- 生成 v2 `PaymentRequired`。
- 包含 resource、accepts、error、extensions。
- scheme 和 extension 可 enrich response。
- 防止 scheme/extension 非授权修改核心支付条款。

正确性判断：通过。

证据：

- 测试覆盖基础 response、error、extensions 省略规则、accepts clone、不通过引用修改调用方数组。
- `hookPolicy.ts` 限制 scheme enrich 只能向 matching accepts 增加 `extra` 字段。
- extension enrich 只允许在空值时填充 `payTo/amount/asset`，不可改 `scheme/network/maxTimeoutSeconds`，不可删除或改写 baseline `extra`。
- 测试覆盖了非法改写 payTo、scheme enrichment 覆盖核心条款、settlement response core 字段改写等拒绝场景。

完备性缺口：

- hook policy 的行为主要通过 core 单元测试验证，第三方 extension 没有统一 conformance harness。

建议：

- 提供官方 extension conformance tests，让第三方扩展在发布前验证 mutation policy。

### 3.4 HTTP route matching 与保护范围

相关源码：

- `typescript/packages/core/src/http/x402HTTPResourceServer.ts`
- `typescript/packages/core/test/unit/http/x402HTTPResourceService.test.ts`
- `typescript/packages/http/express/src/encodedPathBypass.test.ts`
- `typescript/packages/http/hono/src/malformedPathBypass.test.ts`
- `typescript/packages/http/fastify/src/malformedPathBypass.test.ts`

功能目标：

- 支持 exact route、wildcard route、Express `:param`、Next `[param]`、HTTP method prefix。
- 对 malformed percent encoding 和 encoded slash/backslash 做安全处理。
- 未匹配 route 不要求支付。

正确性判断：基本通过。

证据：

- 测试覆盖 exact path、wildcard、`:param`、method prefix、wrong method、不匹配 route。
- 测试覆盖 trailing malformed `%`、`%c0`、多个 malformed sequences。
- `normalizePath()` 保留 `%2F/%5C`，避免 encoded separator 把多段路径藏进单 segment。
- Express/Hono/Fastify 有针对 path bypass 的回归测试。

完备性缺口：

- route matcher 是自定义 regex 编译器，不直接复用各框架 router 语义。
- 当前没有一套共享路由语义矩阵同时跑 Express/Hono/Fastify/Next。

建议：

- 建立跨框架 route conformance tests：大小写、尾斜杠、encoded slash、query/hash、method、动态段、wildcard 多段。

### 3.5 HTTP 402 响应、paywall 与错误体

相关源码：

- `typescript/packages/core/src/http/x402HTTPResourceServer.ts`
- `typescript/packages/core/test/unit/http/x402HTTPResourceService.test.ts`
- `typescript/packages/http/express/src/fallbackPaywallXss.test.ts`

功能目标：

- 未支付或支付失败时返回 402/412。
- v2 challenge 通过 `PAYMENT-REQUIRED` header 传输。
- 浏览器请求返回 paywall HTML，API 请求返回 JSON 或自定义 body。
- fallback paywall 不反射不可信输入。

正确性判断：通过。

证据：

- 测试覆盖无支付时 payment-error、permit2 allowance 需要 412、失败 payload 传给 enrichment。
- fallback paywall 测试覆盖不反射 request URL、不反射 appName、不输出 data-requirements JSON。
- 各适配器测试覆盖 HTML/JSON 402、自定义 header 透传。

完备性缺口：

- `generatePaywallHTML()` 使用可选 `require("@bankofai/x402-paywall")` 动态加载，在纯 ESM/bundler 环境中需要集成验证。

建议：

- 对 Next/Edge、Vite、纯 ESM Node 环境增加 paywall provider 行为测试。

### 3.6 Payment payload 创建与 client requirement 选择

相关源码：

- `typescript/packages/core/src/client/x402Client.ts`
- `typescript/packages/core/test/unit/client/x402Client.test.ts`

功能目标：

- 根据 `PaymentRequired.accepts` 选择 client 支持的 requirement。
- 执行 payment policies 和 selector。
- 调用 matching scheme client 生成 payload。
- 合并 server extensions、scheme extensions、client extension enrichment。
- 支持 lifecycle hooks 和 failure recovery。

正确性判断：通过。

证据：

- 测试覆盖默认 selector、自定义 selector、policy 顺序、多 scheme、多 network、wildcard network、空 accepts、无匹配 scheme、所有 requirements 被 policy 过滤。
- 测试覆盖 scheme hooks、extension hooks、hook 顺序、failure hook recovery、payment response hook。
- v1/v2 注册都有覆盖。

完备性缺口：

- client extension merge 对对象型 extension 的 server info 保留较清晰；若 extension 值是 scalar 或数组，合并策略会由 client 覆盖 server value。server 侧 `validateExtensions()` 主要验证 `info` 子对象/整体 subset，建议扩展规范明确哪些 extension 必须使用 object/info 形态。

建议：

- 在 extension authoring 文档中要求服务器声明使用 object/info 结构，避免 scalar extension 被 client echo 覆盖语义。

### 3.7 HTTP client 自动支付：fetch/Axios

相关源码：

- `typescript/packages/http/fetch/src/index.ts`
- `typescript/packages/http/axios/src/index.ts`
- `typescript/packages/core/src/http/x402HTTPClient.ts`
- `typescript/packages/http/fetch/src/index.test.ts`
- `typescript/packages/http/axios/src/index.test.ts`

功能目标：

- 首次请求正常透传。
- 收到 402 后解析 challenge。
- 执行 payment-required hooks。
- 自动创建 payment payload。
- 带 payment header 重试。
- 解析 `PAYMENT-RESPONSE`，执行 response hooks。
- response hook recovery 时最多 fresh retry 一次。

正确性判断：通过。

证据：

- fetch 测试覆盖非 402 透传、402 后重试、防重复支付、v1 body、解析失败、payload 创建失败、空 body、invalid JSON、Request body clone、Request headers 保留。
- Axios 测试覆盖 response interceptor、非 402 pass-through、缺 config/headers、402 retry、防重复 retry、v1 body、retry error、header 序列化、一次 recovery retry、保留 caller `validateStatus`。
- `x402HTTPClient.processPaymentResult()` 覆盖 success/failure settlement header、402 challenge header、非 402 忽略 challenge。

完备性缺口：

- fetch 和 Axios 各自实现“402 -> payment -> retry -> recovery retry”状态机，未来新增 transport 容易行为漂移。

建议：

- 抽出 transport-neutral paid retry state machine，fetch/Axios 只保留 request adapter。

### 3.8 Payment matching 与 extension echo validation

相关源码：

- `typescript/packages/core/src/server/x402ResourceServer.ts:1266`
- `typescript/packages/core/src/server/x402ResourceServer.ts:1310`
- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts`

功能目标：

- v2 下 payload.accepted 必须保留 server advertised requirement。
- 允许 client 在 `accepted.extra` 添加 scheme-specific metadata。
- v1 兼容按 scheme/network 匹配。
- client echoed extension 不能改写 server advertised info。

正确性判断：通过。

证据：

- 测试覆盖 v2 exact match、additive accepted.extra、undefined transport omission、extra overwrite/omission 拒绝、property order 不影响。
- extension echo 测试覆盖客户端省略 extension、添加 client-only key、修改 server info 字段、删除 server info 字段等。

完备性缺口：

- extension echo validation 对“server extension 的非 info 字段是否必须保留”的规范需要文档明确。目前实现以 `info` 为可比对核心。

建议：

- 将 extension declaration 规范化为 `{ info, ...clientWritable? }`，并在 schema 中区分 server-owned 和 client-owned 字段。

### 3.9 服务端 verify 生命周期

相关源码：

- `typescript/packages/core/src/server/x402ResourceServer.ts:909`
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts`
- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts`

功能目标：

- 执行 beforeVerify hooks。
- 支持 abort、skip facilitator verify。
- 调用支持对应 version/network/scheme 的 facilitator client。
- 执行 afterVerify。
- verify failure 可由 hook recover。

正确性判断：基本通过。

证据：

- 测试覆盖 beforeVerify 执行、abort、skip、afterVerify 顺序、onVerifyFailure recovery、无 facilitator 报错、scheme/extension hooks only when declared。
- HTTP 层测试覆盖 verify delegate、invalid/missing payment 返回 402。

完备性缺口：

- beforeVerify hook 抛错时 warn 并继续 verify。对日志、指标类 hook 合理；对认证/授权类 extension 可能是 fail-open。
- fallback “无 specific facilitator 时尝试所有 facilitators”提高兼容性，但也让配置错误更晚暴露。

建议：

- 为 hook 增加 `critical` 或 `failClosed` 选项，认证/授权 extension 默认 fail closed。
- 在初始化阶段尽量消除需要 fallback-all-facilitators 的运行时路径。

### 3.10 业务 handler 成功后 settle 与失败 cancel

相关源码：

- `typescript/packages/core/src/server/x402ResourceServer.ts:1027`
- `typescript/packages/core/src/server/x402ResourceServer.ts:1062`
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:692`
- `typescript/packages/http/*/src/index.ts`
- `typescript/packages/mcp/src/server/paymentWrapper.ts`

功能目标：

- verify 成功后才执行业务 handler。
- handler throw 或返回错误状态时 cancel，不 settle。
- handler 成功后 settle。
- settlement 成功附加 response metadata/header。
- settlement 失败时不返回受保护资源。
- settlement override 支持固定金额、百分比和美元格式。

正确性判断：基本通过。

证据：

- core 测试覆盖 settle through facilitator、overrides、percent/dollar override、0 amount、原 requirements 不被 mutate、beforeSettle hooks 使用 override 后 requirements、payload enrichment、settlement response enrichment。
- Express/Hono/Fastify/Next 测试覆盖成功 settle、`>=400` 不 settle、handler throw cancel、settlement throws/returns false 返回 402、不泄漏 settlement override header。
- MCP wrapper 测试覆盖 tool handler error 不 settle、handler throw cancel、settlement failure 返回 402。

完备性缺口：

- 服务端 HTTP 适配器响应捕获方式不统一：Express monkey-patch response，Hono/Next clone `Response`，Fastify onSend/raw guard。
- streaming、SSE、超大响应、提前 flush headers、raw socket write 等行为没有统一支持矩阵。
- 各适配器测试重复但非共享，无法保证新增场景四个框架同步覆盖。

建议：

- 建立 adapter conformance suite。
- 明确支持的 response 类型：buffer/json/text/stream/raw，并对不支持类型提供显式错误或 opt-in。

### 3.11 Facilitator 路由与 hooks

相关源码：

- `typescript/packages/core/src/facilitator/x402Facilitator.ts`
- `typescript/packages/core/test/unit/facilitator/x402Facilitator.test.ts`
- `typescript/packages/core/test/unit/facilitator/x402Facilitator.hooks.test.ts`

功能目标：

- 注册 v1/v2 scheme facilitator。
- 支持多个 networks、pattern networks。
- verify/settle 路由到对应 scheme/network facilitator。
- 支持 facilitator extension context。
- 支持 before/after/failure hooks。

正确性判断：通过。

证据：

- 测试覆盖 register、registerV1、多 scheme、多 network、network pattern、无 version/scheme/network 报错、v1/v2 隔离。
- hooks 测试覆盖 beforeVerify、afterVerify、onVerifyFailure、beforeSettle、afterSettle、onSettleFailure。

完备性缺口：

- facilitator 自身 hooks 抛错策略不像 resource server 那样全部 catch/warn；这可能是合理 fail-closed，但需要文档明确与 resource server hook 策略不同。

建议：

- 在 lifecycle 文档中明确 facilitator hook exception 会阻断流程，resource server non-critical hook exception 多数 warn-and-continue。

### 3.12 EVM exact

相关源码：

- `typescript/packages/mechanisms/evm/src/exact/*`
- `typescript/packages/mechanisms/evm/test/unit/exact/*`
- `typescript/packages/mechanisms/evm/test/integrations/exact-evm.test.ts`

功能目标：

- 支持 EIP-3009、Permit2、ERC20 approval 相关 exact payment。
- 解析金额和默认 token。
- client 签名 payload。
- facilitator verify/settle。
- 支持 gas sponsoring 和 builder-code 等 extension。

正确性判断：通过。

证据：

- 测试覆盖 payload 结构、typed data domain、nonce/deadline、allowance check、Permit2 approval、gas sponsoring extension、RPC capability backfill、facilitator verify/settle、集成 exact flow。

完备性缺口：

- 主网链上行为依赖外部 RPC 和合约部署，静态测试不能完全证明生产网络可用。

建议：

- 保留 integration tests，并在 release CI 中使用受控 fork/RPC 环境跑关键链上路径。

### 3.13 EVM upto

相关源码：

- `typescript/packages/mechanisms/evm/src/upto/*`
- `typescript/packages/mechanisms/evm/test/unit/upto/*`

功能目标：

- 授权最高金额，实际 settlement 可按 override 部分扣款。
- facilitator address 绑定在 Permit2 witness。
- 校验 settlement amount 不超过授权上限。

正确性判断：通过。

证据：

- 测试覆盖 price parsing、18 decimals、custom parser、facilitatorAddress 注入/校验、client witness、deadline、nonce、Permit2 args、facilitator verify/settle。
- core settlement override 测试覆盖 percent/dollar/raw atomic amount。

完备性缺口：

- 与 HTTP adapter settlement override 的端到端跨框架测试仍建议补齐。

### 3.14 EVM batch-settlement

相关源码：

- `typescript/packages/mechanisms/evm/src/batch-settlement/*`
- `typescript/packages/mechanisms/evm/test/unit/batch-settlement/*`
- `typescript/packages/mechanisms/evm/test/integrations/batch-settlement-evm.test.ts`

功能目标：

- 支持 channel、deposit、voucher、claim、settle、refund。
- 管理 channel storage 和自动 claim/refund loop。
- 支持并发 update 和 server hook 状态维护。

正确性判断：基本通过。

证据：

- 测试覆盖 channel id、config validation、storage、Redis compare conflict retry、claim batch、settle、claimAndSettle、refund、auto-loop、stop flush、refund network selection。
- 集成测试覆盖 batch-settlement EVM flow。

完备性缺口：

- 这是状态最复杂的机制，生产正确性依赖 storage 原子性、定时任务和链上合约行为；单元测试覆盖很多，但仍建议增加 crash/restart/replay 场景。

建议：

- 增加持久化 storage 的故障恢复测试：进程中断后未 claim voucher、pending reservation、重复 claim、重复 refund。

### 3.15 EVM auth-capture

相关源码：

- `typescript/packages/mechanisms/evm/src/auth-capture/*`
- `typescript/packages/mechanisms/evm/test/unit/auth-capture/*`

功能目标：

- 创建 auth-capture payload。
- 支持 EIP-3009 和 Permit2。
- 使用 payer-agnostic nonce/salt。
- 绑定 capture authorizer、fee recipient 和 fee bps。

正确性判断：基本通过。

证据：

- 测试覆盖 type guards、nonce utilities、required extra 字段、salt freshness、domain binding、Permit2 nonce、unsupported version/network。

完备性缺口：

- 当前测试重点偏 client payload 和类型，facilitator/settlement 完整路径相对少于 exact/upto/batch。

建议：

- 增加 auth-capture facilitator verify/settle 和 fee 边界测试。

### 3.16 TRON exact / upto / gasfree / batch-settlement

相关源码：

- `typescript/packages/mechanisms/tron/src/exact/*`
- `typescript/packages/mechanisms/tron/src/upto/*`
- `typescript/packages/mechanisms/tron/src/gasfree/*`
- `typescript/packages/mechanisms/tron/src/batch-settlement/*`
- `typescript/packages/mechanisms/tron/test/unit/*`

功能目标：

- TRON token registry、TIP-712/EIP-3009、Permit2、GasFree、batch settlement。
- 支持 fee plumbing、allowance、wallet signer、RPC resolver。
- 支持 exact/upto/gasfree/batch 的 verify/settle。

正确性判断：通过。

证据：

- 测试覆盖 token lookup、decimals、price parsing、permit2 digest、upto end-to-end in-process、gasfree digest/flow/API、fee validation、client allowance、facilitator wallet、batch lifecycle、batch server hooks、flow integration。
- exact Permit2 和 GasFree 都有 in-process end-to-end 测试。

完备性缺口：

- README 中仍提示 TRON mainnet 地址为 placeholder，需要替换为审计部署地址；这属于部署完备性风险，不是代码主路径缺失。

建议：

- release 前增加 “mainnet constants 不得为 placeholder” 的 CI 检查。

### 3.17 Extensions：SIWX、offer/receipt、payment identifier、gas sponsoring、builder-code、Bazaar

相关源码：

- `typescript/packages/extensions/src/*`
- `typescript/packages/extensions/test/*.test.ts`
- `typescript/packages/extensions/test/integrations/builder-code.test.ts`

功能目标：

- 为 payment flow 增加 discovery、身份认证、凭证、支付标识、gas sponsoring、builder attribution 等横切能力。
- 通过 client/resource/facilitator hooks 接入 core 生命周期。

正确性判断：基本通过。

证据：

- SIWX 测试覆盖 EVM/Solana message、signature verify、nonce tracking、auth-only route、transport request hook、settlement record。
- offer/receipt 测试覆盖 JWS/EIP-712、JCS canonicalization、DID key/web/jwk、receipt extraction、offer matching、signature verify。
- payment identifier、gas sponsoring、builder-code 都有独立测试和集成测试。
- core hook policy 防止 extension 改写核心支付条款。

完备性缺口：

- extensions 单包聚合多个领域，生命周期契约靠类型和测试分散表达。
- HTTP adapter 对 Bazaar 特殊动态导入，说明 extension discovery 不是完全通用机制。
- hook 异常 fail-open/fail-closed 策略需要按 extension 类型明确。

建议：

- 建立 extension lifecycle spec 和 conformance harness。
- 将 Bazaar 自动加载抽象为通用 route extension resolver。

### 3.18 MCP server wrapper

相关源码：

- `typescript/packages/mcp/src/server/paymentWrapper.ts`
- `typescript/packages/mcp/test/unit/server.test.ts`

功能目标：

- MCP tool 无 payment 时返回 402 result。
- payment 在 `_meta["x402/payment"]` 中传输。
- verify 成功后执行 tool。
- tool 成功后 settle，并把 settlement response 放入 `_meta["x402/payment-response"]`。
- tool error/throw 不 settle，并触发 cancel。

正确性判断：通过。

证据：

- 测试覆盖 no payment、verify + execute、settle after success、preserve structuredContent、preserve existing metadata、handler error 不 settle、handler throw cancel、skipHandler、transport context、verify failure、settlement failure。
- wrapper 构造时拒绝空 accepts。

完备性缺口：

- MCP wrapper 与 HTTP server 重复实现 verify -> handler -> settle/cancel 生命周期。

建议：

- 长期抽象通用 resource execution lifecycle，让 HTTP/MCP 共享同一套状态机。

### 3.19 MCP client 自动支付

相关源码：

- `typescript/packages/mcp/src/client/x402MCPClient.ts`
- `typescript/packages/mcp/test/unit/client.test.ts`
- `typescript/packages/mcp/test/integration/mcp-payment-flow.test.ts`

功能目标：

- free tool 透明透传。
- paid tool 收到 402 后自动 payment retry。
- 支持 autoPayment 开关、approval hook、onPaymentRequired hook。
- 支持 MCP `-32042` payment errors。
- 支持 core payment response hook recovery 一次 fresh retry。

正确性判断：基本通过。

证据：

- 测试覆盖 free tool、auto-pay、payment in `_meta`、autoPayment disabled、approval denied、before/after hooks、core payment response hooks、fresh retry、response format interoperability、`-32042` error handling。
- 集成测试覆盖 complete payment flow、approval hook、verification failure、settlement failure。

完备性缺口：

- `autoPayment` 默认 true，适合自动代理场景，但对真实付费工具可能需要更显式的用户确认策略。
- `getToolPaymentRequirements()` 通过实际调用工具探测，文档已警告有副作用，但调用方很容易误用。

建议：

- 在高层 API 中提供无副作用 discovery 入口；若协议限制无法做到，应把 side-effect warning 提升到 README 入口示例。
- 对默认 autoPayment 是否应为 true 做产品级确认；至少在示例中默认提供 approval hook。

### 3.20 Observability 与日志

相关源码：

- `typescript/packages/core/src/observability/*`
- `typescript/packages/core/test/unit/observability/*`

功能目标：

- 为 resource server 和 facilitator 输出结构化支付日志。
- 不影响 payment 主流程。

正确性判断：基本通过。

证据：

- 测试覆盖 resource server logging 和 facilitator logging。

完备性缺口：

- 日志字段是否满足生产排障、审计、隐私最小化，需要产品级规范支撑。

建议：

- 建立日志字段清单：必须字段、可选字段、禁止记录字段、PII/密钥/签名截断规则。

## 4. 主要发现

### F-01：未初始化运行路径会削弱配置错误的确定性

等级：中高  
相关功能：初始化、PaymentRequirements 构建、HTTP adapters  

`initialize()` 能够校验 missing scheme 和 missing facilitator，但当 `syncFacilitatorOnStart=false` 且调用方未手动初始化时，这些错误会推迟到请求期。`buildPaymentRequirements()` 未注册 scheme 还可能返回空 requirements。

影响：

- 保护路由配置错误不能在启动期稳定失败。
- 请求期可能返回 500/框架异常，而不是可诊断的 route configuration error。

建议：

- `syncFacilitatorOnStart=false` 时要求用户显式调用 `initialize()`，并在 README/API docs 写清楚。
- 考虑让 adapters 在首次 protected request 时仍执行一次 route validation，或提供 `deferFacilitatorSync` 与 `skipRouteValidation` 两个独立开关。

### F-02：未注册 scheme 返回空 requirements 是明确技术债

等级：中  
相关功能：PaymentRequirements 构建  

源码中有 “TODO: Remove this fallback once implementations are registered”。当前返回空数组的行为不利于正确性，因为空 `accepts` 的 challenge 对 client 不可支付。

建议：

- 默认 throw。
- 如需兼容，增加显式 `allowEmptyRequirementsForCompatibility` 之类配置。

### F-03：facilitator supported kind wildcard 行为缺少直接验证

等级：中  
相关功能：facilitator support、route initialization  

core utility 支持 wildcard network pattern，client/server scheme 注册也有 wildcard 测试。但 `x402ResourceServer.getSupportedKind()` 对 kind 二次筛选使用精确 network 相等，缺少 wildcard supported kind 测试。

建议：

- 增加 wildcard supported response 测试。
- 若期望支持 wildcard kind，二次筛选应使用 `networkMatchesPattern(kind.network, network)`。
- 若不支持 wildcard kind，应在 facilitator supported API 文档中声明必须返回 concrete networks。

### F-04：hook 异常策略对安全/业务关键 extension 不够显式

等级：中  
相关功能：verify/settle/extension lifecycle  

Resource server 多数 hook exception 使用 warn-and-continue。该策略对 metrics、logging、best-effort enrichment 合理，但对 SIWX、policy gate、风控类 hook 可能导致 fail-open。

建议：

- 增加 critical/failClosed hook 注册能力。
- 官方 extension 按功能分类声明默认失败策略。

### F-05：HTTP adapter lifecycle 缺少共享契约测试

等级：中  
相关功能：Express/Hono/Fastify/Next settlement lifecycle  

各 adapter 自己测试了成功 settle、失败 cancel、settlement failed 不返回资源等行为，但不是共享测试套件。

建议：

- 建立统一 adapter conformance suite，所有 adapter 必须跑同一组用例。

### F-06：streaming/raw/large response 支持边界未完全定义

等级：中  
相关功能：settlement response capture  

settlement 可能需要 responseBody/responseHeaders。不同框架捕获方式差异较大，当前测试覆盖 Buffer/raw guard 部分场景，但缺少统一支持矩阵。

建议：

- 明确支持/不支持 streaming、SSE、file download、raw write。
- 对不可捕获响应，在 verify 后业务执行前要求应用选择“先 settle”或“禁用依赖 response body 的 extension”。

### F-07：MCP 自动支付默认开启需要更强产品约束

等级：低中  
相关功能：MCP client  

`autoPayment` 默认 true，测试也确认该行为。对 agent 自动调用付费工具的场景，默认自动支付可能不符合所有用户预期。

建议：

- 示例中始终配置 `onPaymentRequested` approval hook。
- 文档显式说明默认自动支付行为。

## 5. 测试覆盖总结

静态测试索引显示当前仓库约有 `127` 个 `*.test.ts`。按功能看：

| 功能域 | 覆盖判断 |
| --- | --- |
| core client | 覆盖充分 |
| core resource server | 覆盖充分 |
| HTTP resource server | 覆盖较充分 |
| Express/Hono/Fastify/Next adapters | 单包覆盖较充分，缺共享契约 |
| fetch/Axios client wrappers | 覆盖较充分，缺共享 transport state machine |
| core facilitator | 覆盖充分 |
| EVM mechanisms | 覆盖较充分 |
| TRON mechanisms | 覆盖较充分 |
| extensions | 覆盖较充分，但缺第三方 conformance harness |
| MCP | 覆盖较充分 |
| legacy | 不作为主路径评价 |

## 6. 优先级建议

P0：

- 去掉或隔离未注册 scheme 返回空 requirements 的 fallback。
- 补 `getSupportedKind()` wildcard supported kind 测试。
- 明确 `syncFacilitatorOnStart=false` 的初始化要求。

P1：

- 建立 HTTP adapter conformance suite。
- 定义 hook failure policy：critical hook fail closed，非关键 hook 可 warn-and-continue。
- 补 streaming/raw/large response 支持矩阵。

P2：

- 抽出 HTTP/MCP 共享的 verify -> execute -> settle/cancel lifecycle。
- 抽出 fetch/Axios/MCP client 共享的 payment retry/recovery state machine。
- 建立 extension conformance harness。

P3：

- 拆分或治理 extensions 单包依赖。
- 增加 release 前部署常量检查，尤其 TRON mainnet placeholder。
- 建立日志字段和隐私规范。

## 7. 最终判断

逐项审计后，TS 版核心功能的主路径是完整且有较多测试支撑的：支付挑战、payload 生成、验证、业务执行、结算、失败取消、扩展 enrichment、MCP 支付、EVM/TRON 机制均可形成闭环。

当前最值得优先处理的不是重写核心逻辑，而是收紧边界：

1. 配置错误必须尽量在启动期失败。
2. 各 HTTP adapter 必须共享同一套生命周期契约测试。
3. hook 失败策略必须按关键性区分 fail-open/fail-closed。
4. wildcard support、streaming response、MCP auto-payment 等边界行为必须文档化并补测试。

这些补齐后，TS 版可以更稳地作为 v1.0 SDK 主线继续演进。
