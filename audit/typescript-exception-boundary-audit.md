# TypeScript 异常与边界处理审计报告

审计日期：2026-07-02

审计范围：依据 `docs/typescript-vs-typescript-new-audit-scope.md`，对比当前分支 `typescript/` 与 `commit:9c172bb29aca9aafc6da4b971183d9daee5f8698` 的 `typescript_new/`。本报告只审计异常传播、边界输入、hook 失败、HTTP/MCP adapter 在“已验证但未结算”状态下的处理一致性。

## 总体结论

当前 TypeScript 实现的主路径已经覆盖了常见异常：支付头解码失败会返回未支付响应，业务 handler 抛错或返回 4xx/5xx 时多数 adapter 会触发 `cancellationDispatcher.cancel`，结算失败会转换为 402 或 facilitator 错误响应。

主要风险集中在以下边界：

1. MCP hook 在已验证支付之后阻断或抛错时，存在未结算且未取消的状态。
2. HTTP adapter 在响应体读取、响应体转换、结算准备失败时，取消语义不一致。
3. 结算覆盖头、paywall provider、协议 header 解码边界以“忽略或强转”为主，异常可观测性和输入校验不足。
4. 资源服务端 extension/scheme hook 的异常策略是 warn-and-continue，若 hook 承载强制策略，默认行为偏 fail-open。

这些问题大多继承自 `typescript_new`，不是本次 package rename 直接引入；但它们仍属于本次审计范围内的有效异常/边界处理风险。

## 发现 1：MCP `onBeforeExecution` 阻断已验证支付时未触发取消

严重级别：High

迁移状态：继承自 `typescript_new`，当前分支未修复。

代码位置：

- `typescript/packages/mcp/src/server/paymentWrapper.ts:267` 调用 `verifyPayment`。
- `typescript/packages/mcp/src/server/paymentWrapper.ts:292` 在支付验证成功后创建 `cancellationDispatcher`。
- `typescript/packages/mcp/src/server/paymentWrapper.ts:313` 执行 `onBeforeExecution`。
- `typescript/packages/mcp/src/server/paymentWrapper.ts:316` 当 hook 返回 `false` 时直接返回 `createPaymentRequiredResult`。

运行路径：

1. MCP client 携带 `_meta["x402/payment"]` 调用付费 tool。
2. `verifyPayment` 返回 `isValid: true`。
3. wrapper 创建取消调度器，说明此时支付已进入“已验证、待执行/待结算”阶段。
4. `onBeforeExecution` 返回 `false`，wrapper 返回 402 风格的 MCP error result。
5. 当前路径未调用 `cancellationDispatcher.cancel`，也未调用 `settlePayment`。

影响：

对 `exact` 这类即时验证方案，影响可能只是客户端看到失败；对 batch、pre-authorization、reservation 类方案，验证成功后未取消可能留下未释放的授权、nonce、额度或 facilitator 侧 pending 状态。用户看到“执行被 hook 阻断”，但支付系统未收到明确取消信号。

现有测试：

- `typescript/packages/mcp/test/unit/server.test.ts:452` 覆盖了 `onBeforeExecution returns false`。
- 该测试只断言 handler 未执行、返回 error result，未断言 `dispatcher.cancel` 被调用。

建议修复：

在 `hookResult === false` 分支返回前调用：

```ts
await cancellationDispatcher.cancel({ reason: "handler_failed" });
```

如果需要更精确的语义，建议扩展 `VerifiedPaymentCancellationReason`，增加 `execution_blocked`，避免把 hook 阻断伪装成 handler 失败。

## 发现 2：MCP `onAfterExecution` 抛错会跳过取消和结算失败处理

严重级别：High

迁移状态：继承自 `typescript_new`，当前分支未修复。

代码位置：

- `typescript/packages/mcp/src/server/paymentWrapper.ts:329` 只包裹 tool handler 执行。
- `typescript/packages/mcp/src/server/paymentWrapper.ts:347` 执行 `onAfterExecution`。
- `typescript/packages/mcp/src/server/paymentWrapper.ts:351` 之后才检查 `result.isError` 并取消。
- `typescript/packages/mcp/src/server/paymentWrapper.ts:357` 之后才进入结算。

运行路径：

1. 支付验证成功。
2. tool handler 成功返回正常结果。
3. `onAfterExecution` 抛出异常。
4. 异常直接向外冒泡，不进入 `result.isError` 分支，不进入 `settlePaymentResult`。
5. 当前路径没有 `cancellationDispatcher.cancel`。

影响：

业务已经执行成功，但支付既未结算也未取消。对需要在执行失败时释放预授权的 scheme，这是状态一致性问题；对调用方则表现为 MCP 调用异常，无法从 `_meta` 获取明确 settlement/cancellation 结果。

现有测试：

- `typescript/packages/mcp/test/unit/server.test.ts:480` 只覆盖 `onAfterExecution` 正常调用。
- 未覆盖 `onAfterExecution` 抛错后的取消语义。

建议修复：

将 `onAfterExecution` 包进 try/catch。若 hook 抛错，应至少调用取消调度器并返回明确错误；更推荐把 hook 异常纳入统一 settlement failure/result 结构：

```ts
try {
  await config.hooks.onAfterExecution(afterExecContext);
} catch (error) {
  await cancellationDispatcher.cancel({
    reason: "handler_failed",
    error: error instanceof Error ? error : new Error(String(error)),
  });
  throw error;
}
```

如不希望 hook 异常阻断结算，应显式记录并继续，但这必须在 API 文档中声明为 fail-open 策略。

## 发现 3：HTTP adapter 响应体读取/转换失败时取消语义不一致

严重级别：Medium-High

迁移状态：继承自 `typescript_new`，当前分支未修复。

关键代码位置：

- Hono：`typescript/packages/http/hono/src/index.ts:229` 在 settlement try/catch 外执行 `res.clone().arrayBuffer()`。
- Next：`typescript/packages/http/next/src/utils.ts:181` 在 try/catch 内读取 response body，但 catch 只返回 402。
- Fastify：`typescript/packages/http/fastify/src/index.ts:434` 在 try/catch 内转换 body，catch 只返回 402。
- Express：`typescript/packages/http/express/src/index.ts:307` 在 try/catch 内拼接 body，catch 只返回 402。

运行路径：

1. 支付验证成功。
2. 业务 handler 返回 2xx 响应。
3. adapter 准备读取响应体，作为 extension/settlement 的 `responseBody`。
4. 响应 clone、arrayBuffer、Buffer 转换或 buffered chunk 转换失败。
5. Hono：异常发生在 settlement try/catch 外，直接向上冒泡，且未取消。
6. Next/Fastify/Express：异常被 catch 并转换成 402，但未触发 `cancellationDispatcher.cancel`。

影响：

“业务已成功执行但结算准备失败”的路径没有稳定的取消行为。对 batch/pre-authorization 方案，这可能导致 pending 授权无法释放。Hono 的问题更明显，因为异常甚至不会进入本地 settlement error response 分支。

正向观察：

- handler 抛错路径已有取消：Hono `typescript/packages/http/hono/src/index.ts:206`，Express `typescript/packages/http/express/src/index.ts:271`，Fastify `typescript/packages/http/fastify/src/index.ts:485`。
- handler 返回 `status >= 400` 路径已有取消：Hono `typescript/packages/http/hono/src/index.ts:220`，Express `typescript/packages/http/express/src/index.ts:287`，Fastify `typescript/packages/http/fastify/src/index.ts:425`，Next `typescript/packages/http/next/src/utils.ts:171`。

建议修复：

1. 将 Hono 的 `res.clone().arrayBuffer()` 纳入 settlement try/catch。
2. 在所有 adapter 的“结算准备失败”catch 中调用 `cancellationDispatcher.cancel`。
3. 最好引入统一 helper，例如 `handleVerifiedPaymentFailure(cancellationDispatcher, reason, error)`，避免 adapter 间语义漂移。
4. 补充 Hono/Next/Fastify/Express 对 response body 读取失败的单测，断言会取消已验证支付。

## 发现 4：`Settlement-Overrides` 头 malformed 时被静默忽略，可能退回全额结算

严重级别：Medium

迁移状态：继承自 `typescript_new`，当前分支保留该行为。

代码位置：

- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:711` 从响应头读取 `Settlement-Overrides`。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:717` 执行 `JSON.parse`。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:719` catch 后直接忽略 malformed header。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:725` 继续调用 `settlePayment`。

现有测试：

- `typescript/packages/core/test/unit/http/x402HTTPResourceService.test.ts:1147` 明确传入 `"not-valid-json{{{"`。
- `typescript/packages/core/test/unit/http/x402HTTPResourceService.test.ts:1151` 断言 malformed header 被忽略并使用原始 amount。

影响：

这是已测试的设计行为，但边界风险较高：如果 route handler 原意是进行 partial settlement，而 header 序列化错误、代理篡改、框架重复写 header 或 header 被截断，当前实现会悄悄回退到原始 `PaymentRequirements.amount`，可能造成比业务预期更高的结算金额。

建议修复：

将 malformed override 视为结算准备失败，至少返回 402 settlement failure；或者提供显式配置：

- strict 模式：malformed override 直接失败，不结算。
- compatibility 模式：维持现状，但记录 warning，并在响应中清理该内部 header。

对于金额覆盖本身，也建议在 `resolveSettlementOverrideAmount` 前做 schema 校验，确保 `amount` 是字符串且符合 raw atomic、percent、dollar 三类格式之一。

## 发现 5：`resolveSettlementOverrideAmount` 对金额边界依赖下游校验

严重级别：Medium

迁移状态：当前实现存在，需结合 scheme/facilitator 校验判断实际影响。

代码位置：

- `typescript/packages/core/src/server/x402ResourceServer.ts:208` 定义 `resolveSettlementOverrideAmount`。
- `typescript/packages/core/src/server/x402ResourceServer.ts:214` percent 格式允许任意整数百分比。
- `typescript/packages/core/src/server/x402ResourceServer.ts:223` dollar 格式使用 `parseFloat` 与 `10 ** decimals`。
- `typescript/packages/core/src/server/x402ResourceServer.ts:229` 其他输入按 raw atomic units 原样返回。

边界问题：

1. `"1000%"` 会解析为 10 倍金额；注释写明最终金额必须小于等于授权最大值，但本函数本身不校验。
2. `"$999999999999999999999"` 可能在 `number` 精度范围外产生不精确结果。
3. `"abc"` 这类 raw amount 被原样返回，实际失败点后移到 scheme/facilitator。

影响：

如果下游 scheme 严格校验 `effectiveRequirements.amount <= authorized amount`，风险主要是错误信息延迟和可观测性差；如果某个新 scheme 没有做完整校验，可能产生超额结算或异常崩溃。

建议修复：

在 core 层集中校验 resolved amount：

- 必须是十进制非负整数字符串。
- 必须 `<= BigInt(requirements.amount)`。
- percent 建议限制在 `0%` 到 `100%`。
- dollar 转 atomic units 避免 `number`/`parseFloat`，改用 decimal 字符串算法。

## 发现 6：paywall HTML 生成异常处理过宽且不对称

严重级别：Medium-Low

迁移状态：部分继承，当前分支把 optional require 从 `@x402/paywall` 改为 `@bankofai/x402-paywall`。

代码位置：

- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:1195` `customHtml` 直接返回。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:1200` custom `paywallProvider.generateHtml` 没有 try/catch。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:1205` optional package require 被 try/catch 包裹。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:1220` catch 吞掉所有异常并回退 fallback HTML。

边界问题：

1. custom provider 抛错会中断支付要求响应生成，可能把本应返回 402/HTML 的浏览器请求变成 500。
2. optional paywall 包的 catch 捕获所有异常，不只捕获模块不存在。如果包存在但内部渲染错误，也会被静默降级为 fallback HTML，隐藏真实问题。
3. 当前分支 require 的 `@bankofai/x402-paywall` 在本轮迁移审计中已被标记为缺失/未发布风险；这里的 catch-all 会让运行时只表现为“静默 fallback”。

建议修复：

1. custom provider 抛错时记录 warning 并 fallback，避免浏览器支付页 500。
2. optional require 只吞掉 `MODULE_NOT_FOUND` 且模块名匹配当前 optional dependency 的错误；其他错误应记录或抛出。
3. 如果 `@bankofai/x402-paywall` 暂未作为独立包发布，应更新 optional dependency 文档或恢复到实际存在的包名。

## 发现 7：HTTP header 解码只做 base64/JSON 解析，缺少 schema 边界校验

严重级别：Low-Medium

迁移状态：继承自 `typescript_new`，当前分支未修复。

代码位置：

- `typescript/packages/core/src/http/index.ts:27` `decodePaymentSignatureHeader`。
- `typescript/packages/core/src/http/index.ts:50` `decodePaymentRequiredHeader`。
- `typescript/packages/core/src/http/index.ts:73` `decodePaymentResponseHeader`。
- `typescript/packages/core/src/http/x402HTTPClient.ts:124` v1 fallback 只检查 `x402Version === 1`。

边界问题：

1. base64 合法且 JSON 可解析即可被强转为 `PaymentPayload`、`PaymentRequired` 或 `SettleResponse`。
2. v1 body 只要是 object 且 `x402Version === 1` 就被视作 `PaymentRequired`。
3. 缺字段、字段类型错误、超大数组、异常 scheme/network 等输入会被推迟到后续流程才失败，错误信息和失败位置不稳定。

影响：

服务端 `extractPayment` 会捕获解码异常并返回 unpaid 响应，这是正向行为；但“结构错误但 JSON 合法”的输入仍可能进入 scheme/facilitator 层，造成更难定位的异常、日志噪音或不一致错误响应。客户端处理恶意/损坏 402 响应时也可能得到泛化的 `Failed to parse payment requirements` 或后续 payment creation 错误。

建议修复：

在 decode 边界引入结构校验：

- payment payload 使用已有 `validatePaymentPayload` 或等价 schema。
- payment required 使用 `PaymentRequired` schema，校验 `accepts` 非空、amount/network/scheme/resource 等字段。
- settlement response 校验 `success` 分支和 failure 分支必需字段。
- 对 v1 body fallback 复用同一 schema，避免只检查 `x402Version`。

## 发现 8：资源服务端 lifecycle hook 异常默认 fail-open

严重级别：Medium

迁移状态：继承自 `typescript_new`，当前分支保留该策略。

代码位置：

- `typescript/packages/core/src/server/x402ResourceServer.ts:929` 执行 `beforeVerify` hooks。
- `typescript/packages/core/src/server/x402ResourceServer.ts:951` `beforeVerify` hook 抛错时只 warning 并继续。
- `typescript/packages/core/src/server/x402ResourceServer.ts:1099` 执行 `beforeSettle` hooks。
- `typescript/packages/core/src/server/x402ResourceServer.ts:1141` 非 `SettleError` 的 `beforeSettle` hook 异常只 warning 并继续。

现有测试：

- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts:643` 覆盖 `beforeVerify` 抛错后 warn-and-continue。
- `typescript/packages/core/test/unit/server/x402ResourceServer.test.ts:894` 覆盖 `beforeSettle` 抛错后 warn-and-continue。

影响：

如果 hook 只做日志、审计或 enrichment，warn-and-continue 是合理的可用性策略。若 hook 承载风控、额度、allowlist、地理限制、业务授权等强制策略，异常会变成 fail-open：策略系统不可用时，支付验证/结算仍继续。

建议修复：

增加 hook 注册时的失败策略：

```ts
onBeforeVerify(hook, { onError: "abort" | "continue" })
onBeforeSettle(hook, { onError: "abort" | "continue" })
```

默认策略可保持兼容，但文档必须明确：当前默认是 fail-open。对安全/合规 hook，建议调用方配置 fail-closed。

## 已确认的正向边界处理

1. HTTP 支付头非法 base64 或 JSON parse 失败时，`extractPayment` 捕获异常并返回 unpaid，而不是让请求崩溃：`typescript/packages/core/src/http/x402HTTPResourceServer.ts:1027`。
2. HTTP handler 抛错时，主流 adapter 会取消已验证支付：Express、Hono、Fastify、Next 均有对应路径。
3. HTTP handler 返回 `>=400` 时，主流 adapter 会取消并移除内部 `Settlement-Overrides` header。
4. `processSettlement` 能把 `SettleError` 和普通异常转换为 settlement failure response：`typescript/packages/core/src/http/x402HTTPResourceServer.ts:752`。
5. MCP handler 抛错和返回 `isError` 时已有取消逻辑：`typescript/packages/mcp/src/server/paymentWrapper.ts:331`、`typescript/packages/mcp/src/server/paymentWrapper.ts:351`。
6. 路径 normalize 对 `%2F`、`%5C` 做了保留，避免 encoded slash 绕过单段路由匹配：`typescript/packages/core/src/http/x402HTTPResourceServer.ts:1159`。

## 建议优先级

P0：

1. 修复 MCP `onBeforeExecution === false` 未取消。
2. 修复 MCP `onAfterExecution` 抛错未取消/未结算。
3. 修复 Hono response body 读取异常在 settlement try/catch 外的问题。

P1：

1. 统一 HTTP adapter 在结算准备失败时的 cancellation 行为。
2. 对 malformed `Settlement-Overrides` 提供 strict fail 行为。
3. 为 `resolveSettlementOverrideAmount` 增加 core 层金额上界和格式校验。

P2：

1. 收紧 paywall optional require 的 catch 范围，并隔离 custom provider 异常。
2. 在 HTTP header decode/v1 fallback 边界增加 schema 校验。
3. 为 resource server lifecycle hook 提供 fail-open/fail-closed 配置。

## 建议补充测试

1. MCP：`onBeforeExecution` 返回 false 后应调用 cancellation dispatcher。
2. MCP：`onAfterExecution` 抛错后应调用 cancellation dispatcher，且不调用 settlement。
3. Hono：`res.clone().arrayBuffer()` 抛错时应取消已验证支付并返回稳定错误响应。
4. Next/Fastify/Express：body 转换失败时应取消已验证支付。
5. Core HTTP：malformed `Settlement-Overrides` 在 strict 模式下应失败，不应 fallback 到原始 amount。
6. Core HTTP：base64 合法但结构非法的 `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` 应在 decode 边界失败。

## 验证说明

本次审计为静态代码审计，未运行完整测试套件。当前环境中未发现可用的 `pnpm` 命令，因此没有执行 monorepo build/test。上述结论基于当前分支源码、既有单测和 `9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new` 对应文件的静态对比。
