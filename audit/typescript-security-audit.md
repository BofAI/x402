# TypeScript 版安全审计报告

审计对象：`typescript/`

审计基准：`review-0702` 分支，`bdd783a`

审计方式：按 `codex-security:security-scan` 的 scoped-path 流程执行。已运行能力预检，结果为 `ready`；生成了 `typescript/` 的确定性候选清单，共 517 个源文件候选。由于当前回合内无法逐文件完成 517 个文件的 full-file exhaustive 审计，本报告对高风险运行面进行了重点审查，并把未逐文件完成的范围明确列为 Deferred。不要把本文理解为完整无遗漏的第三方审计结论。

## 威胁模型摘要

该 TypeScript 实现属于 x402 支付协议库与适配层，主要资产包括：

- 用户钱包授权、支付 payload、签名与 nonce。
- 服务端受保护资源的访问控制与结算语义。
- facilitator verify/settle 结果与链上结算状态。
- MCP tool 调用中的自动付款决策。
- 扩展协议数据，例如 SIWX、offer-receipt、builder-code、bazaar。
- legacy paywall HTML 中的浏览器执行环境。

主要信任边界：

- 客户端 SDK 与不可信 HTTP/MCP server 返回的 `PaymentRequired`。
- HTTP framework middleware 与真实 route handler 响应之间的边界。
- 扩展 payload 中客户端可控字段与服务端声明字段之间的边界。
- JWS `kid` / DID 解析与 verifier 服务器出站网络之间的边界。
- legacy paywall HTML 中服务端插入的数据与浏览器脚本解析器之间的边界。

最高优先级漏洞族：

- 支付绕过、提前结算、结算失败仍交付资源。
- 自动付款导致恶意服务端诱导签名/付款。
- auth-only / SIWX 签名复用或 replay。
- SSRF、XSS、签名验证语义误用。
- 链上 amount/token/receiver/nonce/deadline/domain 绑定错误。

## 总体结论

未发现 EVM/TRON 机制层中明确可导致直接盗款的高影响漏洞；子代理审查显示 EIP-3009、Permit2、upto、batch-settlement 的签名、amount、token、receiver、deadline、domain 与状态机控制整体较完整。

但 TypeScript 版仍存在多项需要修复或文档化的安全问题：

- 4 个 High：MCP 默认自动付款、Next proxy 提前结算、legacy paywall XSS、offer-receipt `did:web` SSRF。
- 4 个 Medium / Medium-High：SIWX URI 绑定过宽与 nonce 默认不防重放、offer/receipt verify 语义不足、session-token 端点可被滥用、builder-code attribution 可被客户端伪造。
- 1 个 Medium：Fastify `reply.raw` 保护路径可能无法触发结算生命周期。

发布建议：**不建议在未处理 High 问题前发布为稳定版本。**

## High

### H-01 MCP client 默认自动付款可被恶意 MCP server 诱导

位置：

- `typescript/packages/mcp/src/client/x402MCPClient.ts:189`
- `typescript/packages/mcp/src/client/x402MCPClient.ts:547`
- `typescript/packages/mcp/src/client/x402MCPClient.ts:559`
- `typescript/packages/mcp/src/client/x402MCPClient.ts:580`
- `typescript/packages/mcp/src/types/mcp.ts:157`

问题：

`x402MCPClient` 默认 `autoPayment: true`，默认 `onPaymentRequested` 为 `() => true`。当 MCP server 或 tool 返回 payment-required 结果时，客户端会直接调用 `createPaymentPayload(paymentRequired)`，然后把付款 payload 放进 `_meta["x402/payment"]` 重试 tool。

攻击路径：

1. 用户或 agent 连接恶意/被入侵的 MCP server。
2. MCP server 对任意 tool 返回伪造的 `PaymentRequired`。
3. 默认配置下客户端自动批准付款。
4. 钱包签名并向攻击者控制的 `payTo` 支付。

影响：

恶意 MCP server 可以诱导客户端自动付款。对 agent 场景尤其危险，因为 MCP server 本身就是不可信内容和工具边界。

建议：

- 将 `autoPayment` 默认值改为 `false`。
- 默认 `onPaymentRequested` 应拒绝，必须由调用方显式授权。
- 增加 max spend、payTo/network/scheme allowlist、tool allowlist、server identity binding。
- 在文档中把 MCP server 视为不可信支付请求方，而不是可信商户。

### H-02 Next.js `paymentProxy` 在真实 handler 成功前完成结算

位置：

- `typescript/packages/http/next/src/index.ts:148`
- `typescript/packages/http/next/src/index.ts:151`
- `typescript/packages/http/next/src/index.ts:152`
- `typescript/packages/http/next/src/utils.ts:171`
- `typescript/packages/http/next/src/utils.ts:190`
- legacy 同类限制已在 `typescript/packages/legacy/x402-next/src/index.ts:149` 注释说明

问题：

新版 `paymentProxyFromHTTPServer` 在 `payment-verified` 分支里对 `NextResponse.next()` 立即调用 `handleSettlement(...)`。middleware/proxy 阶段无法观察真实下游 route handler 的状态码、异常和响应 body。

攻击路径：

1. 用户发起付费请求并通过 verify。
2. `paymentProxy` 对空的 `NextResponse.next()` 结算。
3. 后续真实 route handler 返回 `4xx/5xx` 或抛错。
4. 用户已被结算，但资源未成功交付，cancellation dispatcher 也没有机会运行。

影响：

支付语义从“成功交付后结算”退化为“进入下游前结算”。这属于支付完整性问题，可能造成用户被错误扣款。

建议：

- 对 API route 推荐 `withX402`，并把 `paymentProxy` 明确标记为无法保证 pay-after-success 的前置门禁。
- 如果 `paymentProxy` 仍保留自动结算，需要重新设计到可观察真实 response 的层。
- 增加测试锁定：下游 handler `>=400` / throw 时不得结算。

### H-03 legacy paywall HTML 存在脚本注入风险

位置：

- `typescript/packages/legacy/x402/src/paywall/index.ts:22`
- `typescript/packages/legacy/x402/src/paywall/index.ts:61`
- `typescript/packages/legacy/x402/src/paywall/index.ts:65`
- `typescript/packages/legacy/x402/src/paywall/index.ts:67`
- `typescript/packages/legacy/x402-express/src/index.ts:215`
- `typescript/packages/legacy/x402-hono/src/index.ts:225`
- `typescript/packages/legacy/x402-next/src/utils.ts:175`

问题：

legacy paywall 将 `paymentRequirements`、`currentUrl`、`appName`、`appLogo`、`sessionTokenEndpoint` 等插入 `<script> window.x402 = ... </script>`。`escapeString()` 只处理引号、反斜杠和控制字符，不处理 `<`、`>`、`</script>`；`JSON.stringify(paymentRequirements)` 也不会阻止 HTML parser 提前结束 script 标签。

攻击路径：

1. 应用使用 legacy paywall。
2. 动态 route config、resource、description、appName 或 URL 派生字段混入 `</script><script>...</script>`。
3. 浏览器请求付费页面，服务器返回 402 HTML。
4. 攻击脚本在商户/paywall origin 下执行。

影响：

可劫持 paywall 页面、篡改支付 UX、诱导钱包操作或读取页面内状态。新版 fallback paywall 已改成静态 HTML，但 legacy 包仍有风险。

建议：

- 不要把 JSON 直接嵌入 script；使用 `<script type="application/json">` 并 HTML-escape `<` 为 `\u003c`。
- 对所有插入 script 的字符串执行 JS + HTML 双上下文转义。
- 为 legacy paywall 增加 `</script>` 回归测试。
- 文档中标注 legacy paywall 不应接收任何请求派生字段。

### H-04 offer-receipt JWS `did:web` 自动解析存在 SSRF 面

位置：

- `typescript/packages/extensions/src/offer-receipt/signing.ts:831`
- `typescript/packages/extensions/src/offer-receipt/signing.ts:846`
- `typescript/packages/extensions/src/offer-receipt/did.ts:25`
- `typescript/packages/extensions/src/offer-receipt/did.ts:41`
- `typescript/packages/extensions/src/offer-receipt/did.ts:122`
- `typescript/packages/extensions/src/offer-receipt/did.ts:137`

问题：

`verifyOfferSignatureJWS` / `verifyReceiptSignatureJWS` 在未显式传入 `publicKey` 时，会从 JWS header 的 `kid` 解析 DID。`did:web` 会拼 URL 并直接 `fetch(url)`，当前没有域名 allowlist、私网地址拦截、DNS rebinding 防护、redirect 策略或 timeout。

攻击路径：

1. 攻击者提交包含 `kid: did:web:<attacker-controlled-host>` 的 JWS。
2. verifier 服务端调用 verify helper。
3. helper 解析 `kid` 并向该 host 请求 DID document。
4. 攻击者可诱导 verifier 访问内网、metadata 或受限网络目标。

影响：

形成 verifier 服务器 SSRF / 内网探测面。若部署环境可访问 metadata service、内部 admin service 或私有网络，会升级为高影响。

建议：

- 默认禁止自动解析 `did:web`，要求调用方显式传入 public key 或 resolver。
- 若保留解析，加入 allowlist、私网/localhost/link-local/cloud metadata 拦截、禁用 redirect、超时、响应大小限制。
- 在文档中标明 JWS `kid` 是不可信输入。

## Medium / Medium-High

### M-01 SIWX URI 只做 origin 前缀匹配，auth-only 路由可被跨路径签名复用

位置：

- `typescript/packages/extensions/src/sign-in-with-x/validate.ts:61`
- `typescript/packages/extensions/src/sign-in-with-x/validate.ts:63`
- `typescript/packages/extensions/src/sign-in-with-x/hooks.ts:133`
- `typescript/packages/extensions/src/sign-in-with-x/hooks.ts:154`
- `typescript/packages/extensions/src/sign-in-with-x/hooks.ts:169`

问题：

`validateSIWxMessage` 对 `message.uri` 只检查 `startsWith(expectedUrl.origin)`，没有要求 URI 与当前资源 URL 或当前 path 匹配。对于 `accepts: []` 的 auth-only 路由，`createSIWxRequestHook` 在签名有效后直接 `grantAccess`。

攻击路径：

1. 用户签了同一 origin 下其他路径的 SIWX 消息。
2. 攻击者在有效时间内拿到该 header。
3. 将 header 重放到另一个 auth-only 路由。
4. 由于 URI 只绑定 origin，不绑定资源路径，hook 授权通过。

影响：

同一域下 SIWX auth-only 资源之间缺少资源级绑定。若不同 path 代表不同权限边界，会形成认证/授权绕过。

建议：

- 将 URI 校验改为解析 URL 后比较 `origin + pathname`，或要求 `message.resources` 包含当前完整 resource URL。
- 不要使用字符串 `startsWith` 校验 URL；必须用 `new URL()` 后比较 origin、path、scheme。
- 增加测试：`https://api.example.com/foo` 的签名不能访问 `/admin`。

### M-02 SIWX nonce 防重放是可选的，默认 storage 不实现 nonce 记录

位置：

- `typescript/packages/extensions/src/sign-in-with-x/hooks.ts:145`
- `typescript/packages/extensions/src/sign-in-with-x/hooks.ts:160`
- `typescript/packages/extensions/src/sign-in-with-x/storage.ts:55`

问题：

hook 只有在 storage 实现 `hasUsedNonce` / `recordNonce` 时才做 replay 防护。默认 `InMemorySIWxStorage` 只记录 paid address，不记录 nonce。`validateSIWxMessage` 虽然支持 `checkNonce` 参数，但 request hook 没有传入。

影响：

被截获的 `SIGN-IN-WITH-X` header 在 5 分钟默认窗口内可作为 bearer token 重放。HTTPS 能降低被截获概率，但日志、代理、浏览器扩展、agent 环境都可能让 header 泄露。

建议：

- storage 接口改为强制 nonce 记录，默认实现也应支持 TTL nonce。
- request hook 调用 `validateSIWxMessage(payload, resourceUri, { checkNonce })`。
- 先检查 nonce，再在授权成功前原子记录 nonce，避免并发 replay。

### M-03 Fastify `reply.raw.end()` 防护路径可能无法触发结算生命周期

位置：

- `typescript/packages/http/fastify/src/index.ts:123`
- `typescript/packages/http/fastify/src/index.ts:132`
- `typescript/packages/http/fastify/src/index.ts:185`
- `typescript/packages/http/fastify/src/index.ts:190`
- `typescript/packages/http/fastify/src/index.ts:381`
- `typescript/packages/http/fastify/src/index.ts:387`

问题：

注释声称 guard 会通过 `reply.send on end` 确保 Fastify `onSend` 生命周期运行；但 `raw.end` 实现只写 buffer 并返回 `this`，没有调用 `reply.send`、原始 `raw.end` 或 callback。

影响：

受保护 Fastify route 如果直接使用 `reply.raw.end(...)`，请求可能挂起，或绕过 `onSend` 结算/取消路径。该风险依赖应用使用 raw response，但框架适配层显式尝试支持它，说明它属于预期安全面。

建议：

- 增加真实 Fastify `app.inject` 集成测试覆盖 `reply.raw.writeHead/write/end/flushHeaders`。
- 修复 `raw.end`，显式触发 Fastify reply 生命周期，或文档声明不支持 `reply.raw`。

### M-04 offer/receipt verify 只验签，不验有效期、资源和签发者授权

位置：

- `typescript/packages/extensions/src/offer-receipt/signing.ts:532`
- `typescript/packages/extensions/src/offer-receipt/signing.ts:544`
- `typescript/packages/extensions/src/offer-receipt/signing.ts:733`
- `typescript/packages/extensions/src/offer-receipt/signing.ts:761`
- `typescript/packages/extensions/src/offer-receipt/signing.ts:791`
- `typescript/packages/extensions/src/offer-receipt/signing.ts:812`

问题：

offer 创建时包含 `validUntil`，但 `verifyOfferSignature*` 只恢复 signer / 校验 JWS，不检查 `validUntil >= now`、`resourceUrl` 是否匹配当前资源、receipt 新鲜度，或 signer 是否被授权为该资源签发者。注释说明“不验证 signer authorization”，但函数名 `verify*` 容易被调用方误用为完整验证。

影响：

依赖这些 helper 做准入判断的应用可能接受过期 offer、错误资源的 offer，或攻击者自己签发的结构正确凭证。

建议：

- 提供 `validateOffer(...)` / `validateReceipt(...)` 高层 API，同时检查签名、有效期、resource、issuer allowlist。
- 将现有函数重命名或文档强调为 `verifySignatureOnly`。

### M-05 legacy session-token 端点可被公开滥用

位置：

- `typescript/packages/legacy/x402-express/src/session-token.ts:31`
- `typescript/packages/legacy/x402-express/src/session-token.ts:44`
- `typescript/packages/legacy/x402-express/src/session-token.ts:63`
- `typescript/packages/legacy/x402-next/src/api/session-token.ts:31`
- `typescript/packages/legacy/x402-hono/src/session-token.ts:31`

问题：

legacy session-token handler 用服务端 `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` 为请求体中的任意 `addresses/assets` 调 Coinbase `/onramp/v1/token`。代码只检查 `addresses` 非空，没有 origin、auth、CSRF、rate limit、asset allowlist 或 address ownership 校验。

影响：

如果应用直接公开该 endpoint，攻击者可消耗商户 CDP 配额、为任意地址生成 onramp session token，或滥用商户品牌上下文。

建议：

- 默认示例加入 origin/rate limit/CSRF 防护。
- 对 assets/blockchains 做服务端 allowlist。
- 可选要求 address ownership proof 或只为当前支付上下文中的地址发 token。

### M-06 builder-code attribution 可被客户端覆盖

位置：

- `typescript/packages/extensions/src/builder-code/server.ts:45`
- `typescript/packages/extensions/src/builder-code/client.ts:55`
- `typescript/packages/extensions/src/builder-code/facilitator.ts:89`
- `typescript/packages/extensions/src/builder-code/facilitator.ts:92`
- `typescript/packages/extensions/src/builder-code/facilitator.ts:108`

问题：

resource server 声明 `appCode`，但 facilitator 构建 ERC-8021 suffix 时读取的是客户端 payment payload 里的 `builder-code.info.a/s`，只做格式校验，未与服务端声明的 app code 绑定。

影响：

客户端可伪造或覆盖 attribution。若 builder-code 只用于统计，影响为数据污染；若用于分成/奖励，可能造成经济攻击。

建议：

- app attribution 应来自服务端声明或 PaymentRequired 中不可变字段。
- 客户端只能追加 wallet/service code，不能覆盖 app code。
- facilitator 在 settle 前校验 client payload 与 server declaration 一致。

## 已抑制或未提升为发现的风险面

- EVM/TRON exact、upto、Permit2、EIP-3009：子代理未发现可报告高影响问题；关键校验覆盖 scheme/network、domain、signature、recipient、amount、asset、deadline、facilitator 绑定。
- batch-settlement：channelId、channelConfig、voucher cumulative cap、pending reservation 与 refund/claim 状态机有较完整控制；未发现直接盗款路径。
- 新版 fallback paywall：`typescript/packages/core/src/http/x402HTTPResourceServer.ts:351` 使用静态 HTML，不反射 request/config；Express 有 XSS 回归测试。
- 路径匹配绕过：`normalizePath` 保留 `%2F/%5C`，Express/Hono/Fastify 均有 malformed path 或 encoded separator 测试覆盖。
- bazaar `iconUrl` SSRF：facilitator 侧有 http(s)、userinfo、localhost、IP literal、IDN 等过滤，未提升为候选。
- legacy fetch/axios 无限重试：存在单次 retry/标记控制，未见无限循环；跨 redirect header 泄露未在当前代码证据下确认。

## Deferred 覆盖项

以下范围未在当前回合内完成逐文件 full-file exhaustive 审计：

- `typescript/packages/legacy/**` 的全部历史兼容代码。
- `typescript/packages/mechanisms/**` 中除子代理重点路径外的全部工具函数与测试旁路。
- `typescript/packages/extensions/**` 中非高风险扩展分支。
- 所有 README 示例与部署配置的安全误用路径。

本次已覆盖的重点运行面：

- core/http 路由匹配、payment required、verify、settle 关键路径。
- HTTP adapters：Express、Hono、Fastify、Next、fetch、axios。
- MCP client/server payment wrapper。
- SIWX、offer-receipt、builder-code、bazaar 关键扩展。
- EVM/TRON exact、upto、batch-settlement 关键签名与结算路径。
- legacy paywall、session-token、Next middleware 关键安全路径。

## 验证记录

执行过的本地验证：

- `python3 .../config_preflight.py --profile security_scan ...`：结果 `ready`。
- `python3 .../generate_rank_input.py make-repo-rank-input --scope typescript`：生成 517 行候选清单。
- 使用 `rg` 和 `nl -ba ... | sed -n ...` 抽查源码证据。
- 使用 3 个只读子代理并行审查；其中 EVM/TRON 和 extensions/legacy 子代理完成，core/http 子代理超时后关闭，core/http 由主线程证据覆盖。

未执行完整测试套件，也未写入 PoC 或修改源码。
