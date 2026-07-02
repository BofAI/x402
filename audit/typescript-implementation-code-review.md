# TypeScript 实现 Code Review

审查对象：当前分支 `review-0702` 的 TypeScript 实现，重点覆盖 `typescript/packages/core` 与 HTTP 适配层 `express`、`hono`、`fastify`、`next`。

审查基准：`bdd783a2acbeec69f5af90c7e68ffcfeaa32db16`

审查方式：按 `superpowers:requesting-code-review` 流程进行静态代码审查。当前会话没有可用的 reviewer 子代理创建工具，因此本报告为本地单通道审查，没有并行子代理复核。

## 总体结论

整体架构清晰：核心支付校验、HTTP 抽象、框架适配层、结算钩子与扩展上下文之间的职责边界明确；Express/Hono/Next route handler 路径对“handler 失败不结算”的语义处理较完整；测试也覆盖了编码路径绕过、结算失败隐藏资源响应、facilitator 错误归一化等关键场景。

但当前实现仍有两个需要在合并或发布前处理的重要问题：

1. Next.js `paymentProxy` 在 middleware/proxy 阶段会对 `NextResponse.next()` 立即结算，无法等待真实 route handler 的最终响应。
2. Fastify `reply.raw` 防护逻辑的实现与注释承诺不一致，`raw.end()` 路径看起来不会主动触发 Fastify `onSend` 生命周期。

合并建议：**需要修复后再合并**。

## Critical

未发现明确 Critical 级别问题。

## Important

### 1. Next.js `paymentProxy` 会在下游 handler 成功前完成结算

位置：

- `typescript/packages/http/next/src/index.ts:148`
- `typescript/packages/http/next/src/index.ts:151`
- `typescript/packages/http/next/src/index.ts:152`
- `typescript/packages/http/next/src/utils.ts:171`
- `typescript/packages/http/next/src/utils.ts:183`
- `typescript/packages/http/next/src/utils.ts:190`

问题描述：

`paymentProxyFromHTTPServer` 在 `payment-verified` 分支中创建 `NextResponse.next()`，随后立即调用 `handleSettlement(...)`。`handleSettlement` 的语义是：如果传入 response 状态码 `< 400`，就读取 response body 并调用 `httpServer.processSettlement(...)`。

这意味着 `paymentProxy` 在 Next middleware/proxy 阶段用一个空的 `NextResponse.next()` 作为“成功响应”完成结算，而不是等待实际 API route 或页面 handler 执行完成。

对比同文件的 `withX402FromHTTPServer`：

- `typescript/packages/http/next/src/index.ts:332` 进入 `payment-verified`
- `typescript/packages/http/next/src/index.ts:336` 先执行 `routeHandler(request)`
- `typescript/packages/http/next/src/index.ts:337` handler 抛错时取消支付
- `typescript/packages/http/next/src/index.ts:344` 只在拿到真实 handler response 后调用 `handleSettlement`

影响：

- 下游 route 最终返回 `4xx/5xx` 时，`paymentProxy` 已经按 `NextResponse.next()` 的成功状态完成结算。
- 下游 route 抛错时，`paymentProxy` 无法调用 cancellation dispatcher。
- settlement extension 拿到的是空 response body 与 proxy response headers，而不是真实资源响应。
- 这与 `withX402` 文档中强调的“handler 返回成功响应后才结算”的支付语义不一致。

当前测试情况：

- `typescript/packages/http/next/src/index.test.ts:261` 只断言 `paymentProxy` 在 `payment-verified` 时会结算并返回 settlement header。
- `typescript/packages/http/next/src/index.test.ts:420` 覆盖了 `withX402` 对 handler `>= 400` 时不结算。
- 未看到 `paymentProxy` 覆盖“下游 handler 失败仍不应结算”的测试；由于 middleware/proxy 本身拿不到最终 route response，这个语义在当前设计下无法保证。

建议：

- 优先推荐在 Next.js 文档和导出 API 中把 `paymentProxy` 定位为“只做前置支付门禁，不能保证按最终响应结算”，并推荐生产 API route 使用 `withX402`。
- 如果 `paymentProxy` 仍要承诺 x402 的 pay-after-success 语义，则需要改变设计：结算必须移动到能观察真实 handler response 的位置，或者删除/弃用 proxy 模式的自动结算。
- 添加测试明确锁定两种 API 的差异：`withX402` 对 handler `>= 400` 不结算；`paymentProxy` 若保留当前语义，需要测试和文档同时说明它会在 route 执行前结算。

### 2. Fastify `reply.raw.end()` 防护路径可能不会触发 `onSend` 结算

位置：

- `typescript/packages/http/fastify/src/index.ts:123`
- `typescript/packages/http/fastify/src/index.ts:132`
- `typescript/packages/http/fastify/src/index.ts:185`
- `typescript/packages/http/fastify/src/index.ts:190`
- `typescript/packages/http/fastify/src/index.ts:381`
- `typescript/packages/http/fastify/src/index.ts:387`

问题描述：

`guardReplyRaw` 的注释写明：拦截 `writeHead/write/end/flushHeaders` 后，会“via reply.send on end”确保 Fastify 生命周期继续触发，从而进入 `onSend` 完成结算。

但实际实现中，`raw.end` 在 guard 激活时只做了三件事：

1. 标记 `guard.triggered = true`
2. 把 `end` 调用写入 `guard.buffer`
3. 返回 `this`

它没有调用 `reply.send(...)`，也没有调用原始 `raw.end(...)`，更没有执行 `end` callback。后续结算完全依赖 Fastify 自己进入 `onSend`。如果业务 handler 直接使用 `reply.raw.end(...)` 并结束执行，当前实现看起来不会主动推动 Fastify reply 流程进入 `onSend`。

影响：

- 受保护的 Fastify 路由如果直接写 `reply.raw.write(...)` / `reply.raw.end(...)`，请求可能挂起。
- 或者在某些 Fastify 路径下绕过 `onSend`，导致已验证支付没有结算、也没有取消。
- 注释声称的安全设计与代码行为不一致，维护者容易误判该路径已经被完整保护。

当前测试情况：

- `rg "reply\\.raw|raw\\.end|raw\\.write|guardReplyRaw|writeHead|flushHeaders" typescript/packages/http/fastify/src/index.test.ts` 只看到 mock 对象字段，没有看到直接覆盖 `reply.raw.end()` 的集成测试。

建议：

- 增加 Fastify 集成测试：受保护 route 中直接调用 `reply.raw.writeHead(...)`、`reply.raw.write(...)`、`reply.raw.end(...)`，断言请求能完成、settlement 被调用、body/header 被正确传给扩展。
- 修复实现，使 `raw.end` 在被拦截后显式触发 Fastify reply 生命周期。可以按注释承诺调用 `reply.send(bufferedPayload)`，或改成 Fastify 官方推荐的 preSerialization/onSend 可观测写法。
- 如果无法可靠支持 `reply.raw`，应在检测到 raw 写入时返回明确错误或文档声明不支持，而不是静默缓冲。

## Minor

### 1. `syncFacilitatorOnStart` 的行为与部分注释容易误导

位置：

- `typescript/packages/http/express/src/index.ts:93`
- `typescript/packages/http/express/src/index.ts:146`
- `typescript/packages/http/hono/src/index.ts:94`
- `typescript/packages/http/hono/src/index.ts:147`
- `typescript/packages/http/fastify/src/index.ts:271`
- `typescript/packages/http/next/src/utils.ts:61`
- `typescript/packages/http/next/src/index.ts:309`

问题描述：

多个适配层在创建 middleware/helper 时，如果 `syncFacilitatorOnStart = true`，会立即执行 `httpServer.initialize()` 并保存 promise。后续请求路径的注释又写着“Check if route requires payment before initializing facilitator”或“Only initialize when processing a protected route”。

从代码和测试看，当前更准确的行为是：

- 默认会在 middleware/helper 创建时启动 facilitator 初始化。
- 第一次命中受保护路由时等待该初始化结果。
- 初始化失败后允许后续 protected request 重试。

影响：

- 注释会让调用方误以为未命中 protected route 时完全不会触发 facilitator 网络请求。
- 对无保护路由比例很高、或希望懒初始化的服务，默认行为可能超出预期。

建议：

- 如果当前行为是设计目标，把注释改为“eagerly start initialization on construction, await only on protected routes”。
- 如果目标是严格懒初始化，则把 `let initPromise = syncFacilitatorOnStart ? httpServer.initialize() : null` 改为初始 `null`，只在 protected route 命中后创建 promise。
- 用测试明确锁定期望，避免后续改动再次引入语义漂移。

## 其他观察

- Express 和 Hono 路径在 handler 执行后通过 `res.end` / `await next()` 包裹 settlement，整体符合“资源成功生成后结算”的模式。
- Next `withX402` 路径对 handler throw 和 `status >= 400` 都有取消逻辑，语义上比 `paymentProxy` 更可靠。
- Fastify 的 `onError` hook 会对 handler throw 执行取消，这是正确方向；风险主要集中在直接使用 `reply.raw` 的绕行路径。
- 各适配层对 `FacilitatorResponseError` 的 502 处理比较一致，有利于调用方区分 facilitator 边界失败与普通 402。

## 建议补充测试

1. Next `paymentProxy`：明确测试并文档化它是否允许在下游 route 失败前结算。如果不允许，应先改设计再补测试。
2. Fastify `reply.raw`：增加真实 Fastify server 或 `app.inject` 集成测试，覆盖 `raw.writeHead/write/end/flushHeaders`。
3. 初始化策略：分别断言 middleware 创建时、未保护路由请求时、首次保护路由请求时 `httpServer.initialize()` 的调用次数。
4. 各适配层统一的失败取消语义：handler throw、handler 返回 `>=400`、settlement throw、settlement `success:false`。

## Ready To Merge?

结论：**No，建议修复 Important 问题后再合并或发布。**

理由：

- Next `paymentProxy` 当前可能在真实资源失败前完成支付结算，属于支付语义风险。
- Fastify `reply.raw` 防护实现缺少关键路径测试，且代码没有实现注释所描述的 `reply.send on end` 生命周期触发。
- Minor 注释问题不阻塞合并，但应和上述修复一起清理，降低后续维护误判。

## 验证记录

本次审查执行了以下本地检查：

- `git status --short --branch`
- `git rev-parse HEAD`
- `rg` 搜索 Next/Fastify 关键路径与测试覆盖
- `nl -ba ... | sed -n ...` 定位相关源码与测试证据

未执行完整测试套件；本报告是静态审查结论。
