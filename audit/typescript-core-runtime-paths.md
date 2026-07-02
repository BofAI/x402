# TypeScript 核心功能运行路径逐行代码分析

本文档按 x402 TypeScript 版的核心运行路径组织，逐个说明关键函数的执行顺序、分支条件、错误处理和跨模块调用关系。每节都标注源码文件与行号，便于对照代码继续阅读。

关联的整体架构文档见 `docs/typescript-architecture.md`。

## 1. 总览：一次 HTTP 支付请求的主路径

一次典型 HTTP 请求会经过以下路径：

```text
fetch wrapper
  -> x402Client.createPaymentPayload
  -> mechanism client createPaymentPayload
  -> HTTP middleware
  -> x402HTTPResourceServer.processHTTPRequest
  -> x402ResourceServer.createPaymentRequiredResponse / verifyPayment
  -> Express/Hono/Fastify/Next handler
  -> x402HTTPResourceServer.processSettlement
  -> x402ResourceServer.settlePayment
  -> facilitator client
  -> x402Facilitator.verify / settle
  -> mechanism facilitator verify / settle
```

核心设计点：

- Client 在收到 `402` 后才创建支付 payload。
- Resource server 在执行业务 handler 前 verify。
- Resource server 在业务 handler 成功后 settle。
- 如果 handler 抛错或返回错误状态，已验证支付会被 cancel，而不是 settle。
- Extensions 通过 hooks 接入，但核心条款修改受 hook policy 限制。

## 2. Client 侧 HTTP 自动支付路径

源码：`typescript/packages/http/fetch/src/index.ts:41-162`

函数：`wrapFetchWithPayment(fetch, client)`

### 2.1 包装入口

行 41-44：

- 导出 `wrapFetchWithPayment`。
- 入参是原始 `fetch` 和一个 `x402Client` 或 `x402HTTPClient`。
- 这使调用方既可以传 core client，也可以传已经包装好的 HTTP client。

行 45：

- 如果传入的是 `x402HTTPClient`，直接复用。
- 否则用 `new x402HTTPClient(client)` 包一层 HTTP 编解码能力。
- 这里把“支付逻辑”和“HTTP header 编解码”分开。

行 47-49：

- 返回一个新的 async fetch 函数。
- `request` 是本次真实发出的请求。
- `clonedRequest` 用于后续付费重试；fetch request body 通常只能消费一次，所以必须 clone。

### 2.2 首次请求与 402 判断

行 51：

- 发出原始请求。

行 53-55：

- 如果响应不是 `402`，直接返回。
- 这保证 wrapper 对普通 API 是透明的，不改变非付费请求行为。

行 57：

- 记录收到 402，进入自动支付流程。

### 2.3 解析 PaymentRequired

行 60：

- 声明 `paymentRequired`，后续必须成功解析。

行 61-64：

- 进入解析 try/catch。
- `getHeader` 把 response header 读取方式适配给 `x402HTTPClient`。

行 65-74：

- 先尝试读取 body。
- 如果 body 是 JSON，就作为 v1 兼容格式候选。
- JSON 解析失败被忽略，因为 v2 可能只把 challenge 放在 `PAYMENT-REQUIRED` header 中。

行 76：

- 调用 `httpClient.getPaymentRequiredResponse(getHeader, body)`。
- 该方法优先解析 v2 header，必要时回退 v1 body。

行 77-80：

- 如果无法解析 challenge，抛出带上下文的新错误。
- 这类错误表示服务端返回了 402，但不是有效 x402 challenge。

### 2.4 预处理 hook 与自定义 header 重试

行 83-84：

- 执行 `httpClient.handlePaymentRequired(paymentRequired)`。
- HTTP client extension 可以在这里提供 headers，例如使用缓存支付或外部认证。

行 85-95：

- 如果 hook 返回 headers，则克隆请求、写入 headers、先重试一次。
- 如果这次不再是 402，直接返回 hook 的响应。
- 如果仍然是 402，继续进入正常支付创建流程。

### 2.5 创建并发送支付 payload

行 98-105：

- 调用 `client.createPaymentPayload(paymentRequired)`。
- 这里进入 core client 和 mechanism client。
- 失败时包一层 `Failed to create payment payload` 错误。

行 108：

- 将 `PaymentPayload` 编码成 HTTP payment header。
- v2 会生成 `PAYMENT-SIGNATURE`。
- v1 兼容会生成 `X-PAYMENT`。

行 111-113：

- 如果 cloned request 已经有支付 header，抛出 `Payment already attempted`。
- 这是防无限循环保护。

行 116-122：

- 写入 payment headers。
- 设置 `Access-Control-Expose-Headers`，让浏览器端可以读取 `PAYMENT-RESPONSE`。

行 125-129：

- 携带支付 header 第二次请求。
- 根据 `secondResponse.ok` 记录 info 或 warn。

### 2.6 处理付费请求结果与恢复重试

行 132-136：

- 调用 `httpClient.processPaymentResult(...)`。
- 该方法会解析 `PAYMENT-RESPONSE` 或付费后再次返回的 `PAYMENT-REQUIRED`。
- 同时会触发 `x402Client.handlePaymentResponse`。

行 138-158：

- 如果 hooks 返回 `recovered`，说明本地状态已经修复，例如 approval 状态更新。
- 重新用原 challenge 创建 fresh payload。
- 创建新 request，写入 fresh payment headers。
- 再重试一次。
- 第二次恢复后只处理结果，不再允许进一步恢复，防止循环。

行 160：

- 默认返回付费请求响应。

## 3. x402Client 支付载荷创建路径

源码：`typescript/packages/core/src/client/x402Client.ts:385-482`

函数：`x402Client.createPaymentPayload(paymentRequired)`

### 3.1 协议版本和 requirement 选择

行 385-387：

- 方法接收服务端的 `PaymentRequired`。
- 返回完整 `PaymentPayload`。

行 388-391：

- 根据 `paymentRequired.x402Version` 查找已注册 client schemes。
- 如果该协议版本没有任何 client 注册，直接抛错。

行 393：

- 调用 `selectPaymentRequirements(...)`。
- 这是 client 选择支付方式的核心入口。

行 395-398：

- 构造 `PaymentCreationContext`。
- 后续 hooks 可以读到原始 challenge 和最终选中的 requirement。

### 3.2 before hooks

行 400-405：

- 通过 `getLabeledHooks` 获取 `beforePaymentCreation` hooks。
- hooks 来源可能是手动注册、scheme adapter 或 extension adapter。
- 传入协议版本、requirements、extensions 用于精确筛选。

行 406-409：

- 逐个执行 hook。
- 如果 hook 返回 `{ abort: true }`，抛出中止错误。

### 3.3 调用 mechanism client

行 412：

- 进入 try 块，后续错误可被 `onPaymentCreationFailure` hooks 恢复。

行 413-416：

- 根据 network 和 scheme 找到具体 `SchemeNetworkClient`。
- 找不到说明 client 注册和服务端 challenge 不匹配。

行 418-422：

- 调用 mechanism client 的 `createPaymentPayload`。
- 传入协议版本、选中的 requirements、server-declared extensions。
- EVM/TRON 的 exact scheme 会在这里签名。

### 3.4 包装完整 PaymentPayload

行 424-426：

- v1 payload 直接兼容透传。

行 427-441：

- v2 下先合并 server extensions 和 scheme 返回的 extensions。
- 然后构造完整 payload：
  - `x402Version`
  - `payload`
  - `extensions`
  - `resource`
  - `accepted`

行 445：

- 执行 client extensions enrichment。
- 这是非 scheme 扩展对 payload 做补充的入口。

行 447-459：

- 构造 `PaymentCreatedContext`。
- 执行 `afterPaymentCreation` hooks。

行 461：

- 返回完整 `PaymentPayload`。

### 3.5 创建失败恢复

行 462-466：

- 捕获签名、选择或 extension 过程中的异常。
- 构造 `PaymentCreationFailureContext`。

行 468-477：

- 执行 `onPaymentCreationFailure` hooks。
- 如果某个 hook 返回 `{ recovered: true, payload }`，直接返回替代 payload。

行 480：

- 没有 hook 恢复时，重新抛出原错误。

## 4. Client requirement 选择与 extension 合并

源码：`typescript/packages/core/src/client/x402Client.ts:494-630`

### 4.1 `mergeExtensions`

行 494-497：

- 接收 server-declared extensions 和 client/scheme extensions。

行 498-499：

- 如果一侧为空，直接返回另一侧。

行 501-503：

- 浅拷贝 server extensions。
- 遍历 client extensions。

行 504-514：

- 如果 server/client 任一值不是普通对象，client value 覆盖整个 key。
- 这处理 primitive、null、数组等情况。

行 516-519：

- 两边都是普通对象时，建立一个可变副本和 pending 栈。
- 目标是深层合并对象，但不覆盖 server 已有字段。

行 520-537：

- 遍历 client object。
- 如果 server 和 client 的同名字段都是普通对象，则递归合并。

行 540-542：

- 只有当 target 中不存在该字段时，才加入 client 字段。
- 这体现安全边界：client 可以补字段，但不能改写 server 已声明字段。

行 546-548：

- 写回合并后的 extension value 并返回 merged。

### 4.2 `enrichPaymentPayloadWithExtensions`

行 560-566：

- 如果 challenge 没有 extensions 或 client 没有注册 extensions，直接返回原 payload。

行 568-573：

- 遍历已注册 client extensions。
- 只有当 extension key 出现在 server challenge 中，且 extension 实现了 `enrichPaymentPayload`，才调用。

行 575-578：

- 返回 enrichment 后的 payload。
- 再次用 `mergeExtensions` 确保 server declaration 不被 client enrichment 覆盖。

### 4.3 `selectPaymentRequirements`

行 593-597：

- 根据 x402Version 取 client scheme 注册表。
- 没有注册表则抛错。

行 599-607：

- 过滤 `paymentRequirements`。
- 只保留 client 已注册 network 且包含对应 scheme 的 requirement。

行 609-617：

- 如果没有任何 supported requirement，抛出详细错误。
- 错误中包含已有版本、networks、schemes，方便定位注册问题。

行 620-627：

- 按顺序执行 `this.policies`。
- 任一策略把列表过滤为空，就抛错。

行 630：

- 调用最终 selector。
- 默认 selector 是 `accepts[0]`，业务可注入自定义策略。

## 5. Resource Server 初始化和 requirement 构造

源码：`typescript/packages/core/src/server/x402ResourceServer.ts:560-790`

### 5.1 `initialize`

行 560-564：

- 清空已有 facilitator 支持能力映射。
- 准备记录最后一个错误。

行 568-570：

- 逐个调用 facilitator client 的 `getSupported()`。
- 多 facilitator 场景下按数组顺序处理。

行 573-586：

- 遍历 supported kinds。
- 为 `x402Version` 创建 supported response map 和 facilitator client map。

行 588-598：

- 为每个 network 创建 map。

行 600-604：

- 如果该 network/scheme 尚未记录，则保存 supported response 和 facilitator client。
- 已存在时不覆盖，因此更早的 facilitator 优先。

行 606-610：

- 单个 facilitator 加载失败不会立即终止。
- 记录错误并继续尝试后续 facilitator。

行 613-624：

- 如果所有 facilitator 都失败或没有任何 supported kind，则抛错。
- 如果有 lastError，则作为 cause 附加。

### 5.2 `buildPaymentRequirements`

行 675-684：

- 根据 `resourceConfig.scheme` 和 `resourceConfig.network` 找到注册的 `SchemeNetworkServer`。

行 686-693：

- 找不到 scheme server 时记录 warning 并返回空列表。
- 这个 fallback 目前仍存在，但注释说明后续可能移除。

行 696-707：

- 查询 facilitator 是否支持当前 x402Version/network/scheme。
- 如果 facilitator 不支持，则抛错。

行 710-714：

- 获取 facilitator 支持的 extension keys。

行 717-720：

- 调用 scheme server 的 `parsePrice`。
- 这一步把业务价格转换为 asset 和 atomic amount。

行 723-734：

- 构造基础 `PaymentRequirements`。
- `extra` 合并 parsedPrice.extra 和 route/user extra。
- `maxTimeoutSeconds` 默认 300 秒。

行 737-741：

- 调用 scheme server 的 `enhancePaymentRequirements`。
- scheme 可在这里增加 token domain、transfer method、fee 等字段。

行 743-744：

- 将增强后的 requirement 放入数组返回。

### 5.3 `buildPaymentRequirementsFromOptions`

行 755-765：

- 输入是多个 route payment options。
- context 通常是 HTTP request context。

行 768-773：

- 对每个 option 解析动态 `payTo` 和 `price`。
- 如果字段是函数，就以当前 context 调用。

行 775-782：

- 将 option 转成 `ResourceConfig`。

行 785-786：

- 对每个 option 调用 `buildPaymentRequirements`。
- 汇总所有 requirements。

行 789：

- 返回完整 requirements 列表。

## 6. PaymentRequired 创建与安全约束

源码：`typescript/packages/core/src/server/x402ResourceServer.ts:803-897`

函数：`createPaymentRequiredResponse`

行 803-810：

- 入参包含 requirements、resourceInfo、错误原因、extensions、transportContext，以及可选 failed paymentPayload。

行 811-816：

- clone 每个 requirement，并 clone `extra`。
- 创建 `workingAccepts` 和 baseline snapshot。
- baseline 用于后续校验 hooks 是否非法改写核心字段。

行 819-824：

- 构造 v2 `PaymentRequired`。
- `resource` 在顶层。
- `accepts` 指向 `workingAccepts`。

行 827-829：

- 如果 route 声明了 extensions，则写入 response。

行 831-840：

- 遍历每个 accept。
- 找到匹配的 scheme server。
- 如果 scheme 没有 `enrichPaymentRequiredResponse`，跳过。

行 842-849：

- 构造 `SchemePaymentRequiredContext`。
- 该 context 包含 requirements、失败 payload、resource、error、当前 response、transportContext。

行 850-854：

- 调用 scheme enrichment。
- 如果返回新 accepts，就替换 `workingAccepts` 和 `response.accepts`。

行 855-861：

- 调用 `assertAcceptsAdditiveExtraAfterSchemeEnrich`。
- 约束 scheme 只能 additive 地修改 `extra`，不能改写 payment core terms。
- 更新 baseline。

行 865-868：

- 遍历声明的 extensions。
- 找到已注册 resource server extension。

行 869-886：

- 调用 extension 的 `enrichPaymentRequiredResponse`。
- 如果返回 extensionData，则写入 `response.extensions[key]`。
- 单个 extension 抛错会被捕获并 warning，不中断整个 challenge 创建。

行 890-891：

- 调用 `assertAcceptsAllowlistedAfterExtensionEnrich`。
- extension 对 accepts 的修改更严格，只允许白名单字段按规则变化。

行 896：

- 返回最终 `PaymentRequired`。

## 7. HTTP Resource Server 请求处理路径

源码：`typescript/packages/core/src/http/x402HTTPResourceServer.ts:485-680`

函数：`processHTTPRequest`

### 7.1 route 匹配与 request hooks

行 485-491：

- 规范化 method。
- 从 context 取 adapter 和 path。

行 494-497：

- 调用 `getRouteConfig(path, method)`。
- 如果 route 不受保护，返回 `no-payment-required`。

行 498-499：

- 取 route config 和匹配 pattern。
- 将 pattern 写入 enriched context。

行 502-517：

- 执行 protected request hooks。
- hook 返回 `grantAccess` 时直接放行。
- hook 返回 `abort` 时返回 403 JSON。

### 7.2 构造 challenge

行 520：

- 将 routeConfig.accepts 统一成数组。

行 523：

- 从 HTTP header 提取 payment payload。
- 没有 header 时得到 null。

行 526-533：

- 构造 resourceInfo。
- route config 可覆盖 URL、description、mimeType、serviceName、tags、iconUrl。

行 537-540：

- 调用 core resource server 根据 payment options 构造 requirements。

行 542-545：

- 如果 route 声明 extensions，先调用 `ResourceServer.enrichExtensions`。

行 548-555：

- 构造 HTTP transportContext。
- 调用 `createPaymentRequiredResponse`。
- 如果没有 paymentPayload，error 写为 `Payment required`。

行 558-573：

- 如果没有 payment payload，构造 unpaid body 并返回 `payment-error`。
- middleware 会把该结果写成 402 或 paywall HTML。

### 7.3 验证支付

行 578-581：

- 在 `paymentRequired.accepts` 中查找和 client payload 匹配的 requirement。

行 583-595：

- 找不到匹配 requirement 时，返回新的 402 challenge，error 为 `No matching payment requirements`。

行 597-614：

- 调用 `validateExtensions` 检查 client echo。
- 如果 extension echo 不匹配，返回带错误原因的新 402。

行 616-621：

- 调用 `ResourceServer.verifyPayment`。
- 这里会进入 core hooks 和 facilitator verify。

行 623-636：

- 如果 facilitator 返回 invalid，重新生成 402 challenge。
- error 使用 verifyResult.invalidReason。

行 639-647：

- 如果 verify hook 返回 `skipHandler`，直接进入 settlement 并返回结果。
- 这用于自包含操作，例如无需业务 handler 的 refund/ack。

行 649-654：

- 创建 cancellation dispatcher。
- 用于 handler 抛错或失败状态时取消 verified payment。

行 657-663：

- 返回 `payment-verified`。
- framework middleware 后续会执行业务 handler，再 settlement。

行 664-679：

- 捕获 verify 过程错误。
- facilitator boundary error 继续抛出，让上层转 502。
- 其他错误转成 402 challenge。

## 8. HTTP Settlement 处理路径

源码：`typescript/packages/core/src/http/x402HTTPResourceServer.ts:692-792`

函数：`processSettlement`

行 692-698：

- 输入 verified payment、requirements、declaredExtensions、transportContext 和 settlementOverrides。

行 699-707：

- 如果 transportContext request 缺少 method，则从 adapter 补齐。

行 710-723：

- settlement override 优先使用显式入参。
- 如果没有显式入参，则从 response headers 中读取 `Settlement-Overrides`。
- JSON parse 失败时忽略。

行 725-731：

- 调用 core resource server 的 `settlePayment`。

行 733-744：

- 如果 settleResponse.success 为 false：
  - 补齐 errorReason/errorMessage。
  - 创建 settlement headers。
  - 构造 settlement failure HTTP response。
  - 返回 failure 结果。

行 746-751：

- settle 成功时返回 success 结果。
- 附加 `PAYMENT-RESPONSE` header 和原 requirements。

行 752-755：

- facilitator boundary error 继续抛出。

行 756-774：

- 捕获 `SettleError`。
- 转成标准 `SettleResponse` failure。
- 再构造 402 settlement failure response。

行 775-790：

- 捕获其他错误。
- 用错误 message 或默认 `Settlement failed` 构造 failure response。

## 9. Resource Server Verify 与 Settle

源码：`typescript/packages/core/src/server/x402ResourceServer.ts:909-1248`

### 9.1 `verifyPayment`

行 909-914：

- 输入 paymentPayload、matched requirements、declaredExtensions、transportContext。

行 915-920：

- 归一化 declaredExtensions。
- 计算正在使用的 extension keys。
- 构造 matchedScheme，用于 hook 筛选。

行 922-927：

- 构造 verify context。

行 929-954：

- 执行 `beforeVerify` hooks。
- hook 返回 abort 时直接返回 invalid verify response。
- hook 返回 skip 时跳过 facilitator verify，但仍执行 afterVerify hooks。
- hook 自身抛错只 warning，不终止。

行 958-962：

- 根据 x402Version/network/scheme 查找 facilitator client。

行 966-986：

- 如果没有精确 facilitator client，则 fallback 尝试所有 facilitator clients。
- 所有 fallback 都失败时抛出最后一个错误或 no facilitator 错误。

行 987-990：

- 如果找到精确 facilitator client，直接调用 `verify`。

行 992：

- 对 verifyResult 执行 afterVerify hooks 并返回结果。

行 993-1015：

- 捕获 verify 异常。
- 执行 `onVerifyFailure` hooks。
- hook 可返回 recovered result。
- 无法恢复时重新抛错。

### 9.2 `createPaymentCancellationDispatcher`

行 1027-1034：

- 捕获当前 payment、requirements、extensions 和 transportContext。
- `cancelPromise` 用于确保 cancel 只执行一次。

行 1036-1048：

- 返回 `{ cancel }`。
- 第一次调用时执行 `dispatchVerifiedPaymentCanceled`。
- 后续调用复用同一个 promise。

### 9.3 `settlePayment`

行 1062-1068：

- 输入 verified payment、requirements、extensions、transportContext、可选 settlementOverrides。

行 1069-1070：

- 归一化 extension keys。

行 1073-1086：

- 如果有 settlement override amount：
  - 找到 scheme。
  - 读取 asset decimals。
  - 调用 `resolveSettlementOverrideAmount`。
  - 创建 `effectiveRequirements`。

行 1088-1097：

- 构造 settle context 和 matchedScheme。

行 1099-1147：

- 执行 `beforeSettle` hooks。
- abort 会抛 `SettleError`。
- skip 会直接执行 afterSettle hooks 和 response enrichment，然后返回 settleResult。
- hook 普通异常只 warning。

行 1150-1163：

- 找到 scheme server。
- 如果实现了 `enrichSettlementPayload`，则调用。
- 用 `assertAdditivePayloadEnrichment` 限制只能 additive 增加 payload 字段。

行 1166-1170：

- 查找精确 facilitator client。

行 1174-1194：

- 没有精确 facilitator client 时 fallback 尝试所有 facilitator clients。

行 1195-1198：

- 有精确 facilitator client 时直接调用 `settle`。

行 1200-1216：

- 构造 settle result context。
- 执行 afterSettle hooks。
- hook 抛错只 warning。

行 1218-1223：

- 执行 settlement response enrichment。

行 1225：

- 返回 settleResult。

行 1226-1248：

- 捕获 settlement 异常。
- 执行 `onSettleFailure` hooks。
- hook 可以 recovered。
- 否则重新抛出。

## 10. Matching 与 Extension Echo 校验

源码：`typescript/packages/core/src/server/x402ResourceServer.ts:1266-1333`

### 10.1 `validateExtensions`

行 1266-1269：

- 输入 server challenge 和 client payload。

行 1270-1272：

- 非 v2 直接通过。

行 1274-1277：

- server 没有 extensions 时通过。

行 1279-1282：

- client 没有 echo extensions 时通过。

行 1284-1287：

- 遍历 client extensions。
- 如果 key 不在 serverExtensions 中，跳过；未知 client extension 不参与校验。

行 1289-1291：

- 分别提取 server advertised info 和 client echoed info。
- 调用 `extensionInfoMatchesAdvertised`。

行 1292-1297：

- 如果不匹配，返回 invalid，并给出 `extension_echo_mismatch` 和 extensionKey。

行 1300：

- 全部通过后返回 valid。

### 10.2 `findMatchingRequirements`

行 1310-1313：

- 输入 server advertised requirements 和 client paymentPayload。

行 1314-1320：

- v2 使用 `paymentRequirementsMatchAccepted`。
- 要求 server-declared requirement 和 payload.accepted 匹配。
- client 可以在 `accepted.extra` 中带 additive scheme metadata。

行 1321-1327：

- v1 只按 scheme 和 network 匹配。

行 1328-1331：

- 未知 x402Version 抛错。

## 11. Express Middleware 响应缓冲与结算路径

源码：`typescript/packages/http/express/src/index.ts:80-378`

函数：`paymentMiddlewareFromHTTPServer`

### 11.1 初始化与扩展加载

行 80-85：

- 创建 Express middleware factory。
- 输入已配置好的 `x402HTTPResourceServer`。

行 86-89：

- 如果传入 paywall provider，则注册到 HTTP server。

行 93-94：

- 如果启用 `syncFacilitatorOnStart`，预先创建 initialize promise。
- `isInitialized` 标记初始化是否成功。

行 99-115：

- `initializeHttpServer` 确保初始化成功一次。
- 初始化失败会清空 `initPromise`，允许下次请求重试。

行 117-134：

- 如果 routes 使用 Bazaar extension，动态 import Bazaar。
- 必要时注册 `bazaarResourceServerExtension`。
- 然后校验 Bazaar route extension 配置。

### 11.2 每个请求入口

行 136-144：

- 返回真正的 Express middleware。
- 创建 `ExpressAdapter`。
- 构造 `HTTPRequestContext`，包含 path、method 和 payment header。

行 147-149：

- 先判断 route 是否需要支付。
- 不需要时直接 `next()`，避免不必要的 facilitator 初始化。

行 152-163：

- 受保护 route 才执行 initialize。
- facilitator boundary error 转 502。
- 其他错误交给 Express error handler。

行 166-169：

- 如果需要 Bazaar 动态加载，等待加载完成。

行 172-181：

- 调用 `httpServer.processHTTPRequest`。
- facilitator boundary error 仍转 502。

### 11.3 处理 processHTTPRequest 结果

行 184-187：

- `no-payment-required` 直接执行业务 handler。

行 189-201：

- `payment-error` 表示需要 402/403/paywall/settlement failure 响应。
- 写 status、headers。
- HTML 用 `send`，其他用 `json`。

行 203-206：

- `payment-verified` 表示 payment 已通过 verify。
- 取出 cancellationDispatcher、payload、requirements、extensions。

### 11.4 拦截响应方法

行 208-212：

- 保存 Express response 原始方法：
  - `writeHead`
  - `write`
  - `end`
  - `flushHeaders`

行 214-220：

- 定义 buffered call 类型。
- `bufferedCalls` 保存业务 handler 尝试写出的响应。
- `settled` 标记是否恢复原方法。

行 222-228：

- `restoreResponseMethods` 恢复原始响应方法，并把 `settled` 置 true。

行 230-234：

- 创建 `endPromise`。
- middleware 要等待业务 handler 调用 `res.end()` 后才能判断状态和结算。

行 236-268：

- 重写 `writeHead`、`write`、`end`、`flushHeaders`。
- 在 settlement 前，这些调用只进入 `bufferedCalls`，不会真正发给 client。
- `end` 会 resolve `endPromise`。

### 11.5 执行业务 handler 与取消逻辑

行 270-281：

- 调用 `next()` 执行业务 handler。
- 如果 handler 抛错，调用 `cancellationDispatcher.cancel({ reason: "handler_threw" })`。
- 清空 buffer，恢复 response 方法，把错误交给 Express。

行 283-284：

- 等待 handler 调用 `res.end()`。

行 287-305：

- 如果业务响应状态码 >= 400：
  - 取消 verified payment，reason 为 `handler_failed`。
  - 移除内部 settlement override header。
  - 恢复 response 方法。
  - 回放原业务错误响应。
  - 不进行 settlement。

### 11.6 成功响应后 settlement

行 307-313：

- 将 buffered write/end 的 body 拼成 `responseBody`。
- 该 buffer 会传给 settlement hooks。

行 315-320：

- 收集当前 response headers。

行 322-327：

- 调用 `httpServer.processSettlement`。
- transportContext 带 request、responseBody、responseHeaders。

行 330-341：

- 如果 settlement 失败：
  - 丢弃 buffered success response。
  - 写 settlement failure response headers。
  - 按 HTML/JSON 返回 402。

行 344-347：

- settlement 成功时，把 `PAYMENT-RESPONSE` 等 headers 写入原业务响应。

行 348-358：

- settlement 过程异常：
  - facilitator boundary error 转 502。
  - 其他错误返回空 402 JSON。
  - 不发送 buffered success response。

行 359-374：

- finally 中恢复 response 方法。
- 移除内部 `Settlement-Overrides`。
- 回放 buffered calls。
- 清空 buffer。

## 12. Facilitator 核心路径

源码：`typescript/packages/core/src/facilitator/x402Facilitator.ts:219-485`

### 12.1 `getSupported`

行 219-228：

- 返回支持的 payment kinds、extensions 和 signers。

行 229-235：

- 初始化 `kinds` 数组和 `signersByFamily`。

行 238-241：

- 遍历已注册 facilitator schemes。
- 每个元素含 facilitator 实例和 networks。

行 244-251：

- 对每个 network 调用 mechanism facilitator 的 `getExtra(network)`。
- 把 version、scheme、network、extra 推入 `kinds`。

行 254-258：

- 按 CAIP family 聚合 signer 地址。

行 264-267：

- 将 Set 转换为数组。

行 269-273：

- 返回 supported response。

### 12.2 `verify`

行 283-290：

- 构造 facilitator verify context。

行 293-301：

- 执行 beforeVerify hooks。
- abort 时直接返回 invalid response。

行 304-309：

- 根据 paymentPayload.x402Version 找注册表。
- 没有对应版本则抛错。

行 312-326：

- 遍历 schemeData。
- 先匹配 scheme。
- 再匹配具体 network 或 pattern。

行 328-332：

- 找不到匹配 facilitator 时抛错。

行 334-339：

- 构造 facilitatorContext。
- 调用 mechanism facilitator 的 `verify`。

行 341-365：

- 如果 verifyResult invalid：
  - 构造 failure context。
  - 执行 onVerifyFailure hooks。
  - hooks 可 recovered。
  - 无 recovered 时返回 invalid result。

行 367-377：

- verify 成功时执行 afterVerify hooks。
- 返回 verifyResult。

行 378-393：

- 捕获异常。
- 执行 onVerifyFailure hooks。
- 可 recovered，否则重新抛错。

### 12.3 `settle`

行 403-410：

- 构造 facilitator settle context。

行 413-418：

- 执行 beforeSettle hooks。
- abort 时抛错。

行 421-426：

- 根据 paymentPayload.x402Version 找注册表。

行 429-443：

- 按 scheme 和 network/pattern 找 mechanism facilitator。

行 445-449：

- 找不到则抛错。

行 451-456：

- 构造 facilitatorContext。
- 调用 mechanism facilitator 的 `settle`。

行 458-466：

- 执行 afterSettle hooks。

行 468：

- 返回 settleResult。

行 469-483：

- 异常时执行 onSettleFailure hooks。
- hooks 可 recovered，否则重新抛错。

## 13. EVM exact 三角色路径

### 13.1 Client: 创建 EIP-3009 或 Permit2 payload

源码：`typescript/packages/mechanisms/evm/src/exact/client/scheme.ts:59-102`

行 59-63：

- 实现 `SchemeNetworkClient.createPaymentPayload`。
- 输入 x402Version、paymentRequirements 和 extension context。

行 64-65：

- 从 `paymentRequirements.extra.assetTransferMethod` 读取转账方式。
- 默认 `eip3009`。

行 67-68：

- 如果是 `permit2`，调用 `createPermit2Payload`。

行 70-76：

- 尝试通过 EIP-2612 gas sponsoring extension 签 permit。

行 78-83：

- 如果拿到 EIP-2612 extension 数据，把它附到 result.extensions 返回。

行 85-90：

- 如果 EIP-2612 不可用，再尝试 ERC-20 approval sponsoring extension。

行 91-96：

- 如果拿到 ERC-20 approval extension 数据，附到 result.extensions 返回。

行 98：

- Permit2 无 extension enrichment 时返回原 result。

行 101：

- 非 Permit2 时创建 EIP-3009 payload。

### 13.2 Server: 价格解析和 requirement 增强

源码：`typescript/packages/mechanisms/evm/src/exact/server/scheme.ts:70-171`

行 70-81：

- `parsePrice` 如果输入已经是 `{ amount, asset }`，校验 asset 后直接返回。

行 83-84：

- 将 money string/number 解析为 decimal number。

行 87-92：

- 依次尝试自定义 money parsers。
- 第一个非 null 结果生效。

行 95：

- 自定义 parser 不处理时，走默认 stablecoin 转换。

行 110-124：

- `enhancePaymentRequirements` 当前不修改 EVM exact requirements。
- 保留 supportedKind 和 extensionKeys 参数以满足接口。

行 133-139：

- money 为 number 时直接返回。
- string 时使用 `parseMoneyString`。

行 148-150：

- 读取 network 默认 asset。
- 根据 decimals 转成 atomic amount。

行 156：

- 判断是否需要 EIP-712 domain fields。

行 158-170：

- 返回 `{ amount, asset, extra }`。
- `extra` 可能包含 token name/version 和 assetTransferMethod。

### 13.3 Facilitator: 路由到 EIP-3009 或 Permit2

源码：`typescript/packages/mechanisms/evm/src/exact/facilitator/scheme.ts:89-130`

行 89-94：

- 实现 `verify`。

行 95-96：

- 将 `payload.payload` 视为 EVM exact payload。
- 通过 `isPermit2Payload` 判断 payload 类型。

行 98-100：

- Permit2 payload 走 `verifyPermit2`。

行 102-103：

- 否则按 EIP-3009 payload 走 `verifyEIP3009`。

行 114-118：

- 实现 `settle`。

行 119-120：

- 再次判断 payload 类型。

行 122-125：

- Permit2 payload 走 `settlePermit2`。
- 传入 `simulateInSettle` 配置。

行 128-129：

- EIP-3009 payload 走 `settleEIP3009`。

## 14. TRON exact 三角色路径

### 14.1 Client: TIP-712/EIP-3009 风格或 Permit2 payload

源码：`typescript/packages/mechanisms/tron/src/exact/client/scheme.ts:39-75`

行 39-43：

- 实现 `SchemeNetworkClient.createPaymentPayload`。

行 44-45：

- 当前不使用 extension context，显式 `void context`。

行 47-48：

- 从 requirement extra 读取 assetTransferMethod，默认 `eip3009`。

行 50-52：

- Permit2 方式调用 `createPermit2Payload`。

行 54：

- 其他方式调用 `createEIP3009Payload`。

行 65-74：

- `checkBalance` 读取 TRC-20 `balanceOf`。
- 供余额感知选择策略使用。

### 14.2 Server: TRON 价格解析、transfer method 和 fee 注入

源码：`typescript/packages/mechanisms/tron/src/exact/server/scheme.ts:56-170`

行 56-67：

- 如果 price 已经是 `{ amount, asset }`，校验 asset 后直接返回。

行 69-73：

- 支持 `"0.5 USDD"` 这类显式 token symbol 格式。
- 命中时委托 token registry 的 `parseTokenPrice`。

行 75-87：

- 普通 money 转 decimal。
- 依次尝试自定义 money parsers。
- 都不处理时走默认转换。

行 102-112：

- `enhancePaymentRequirements` 接收基础 requirements、facilitator supportedKind 和 extensionKeys。
- 当前不使用 extensionKeys。

行 114-124：

- 从 facilitator advertised extra 中读取 supported transfer methods。
- 如果 requirement 已有 method，则优先使用 existingMethod。
- 否则优先选 `eip3009`，再回退第一个 supported method。

行 126-128：

- 如果没有 method，直接返回原 requirements。

行 130-132：

- 解析 permit2 facilitator address，优先 route extra，再用 facilitator advertised extra。

行 136-147：

- 从 facilitator advertised feeConfig 构造 fee。
- 如果 requirements.extra 已有 fee，则不覆盖。

行 149-157：

- 返回增强后的 requirements。
- `extra` 中写入 assetTransferMethod、permit2FacilitatorAddress、fee。

行 169-170：

- `getAssetDecimals` 从 TRON token registry 查询 decimals。

### 14.3 Facilitator: advertised extra、verify、settle

源码：`typescript/packages/mechanisms/tron/src/exact/facilitator/scheme.ts:44-134`

行 44-49：

- `getExtra(network)` 默认支持 `eip3009`。
- 如果该 network 有 Permit2 proxy 地址，则追加 `permit2`。

行 50-73：

- 返回 facilitator extra：
  - `supportedAssetTransferMethods`
  - 可选 `permit2FacilitatorAddress`
  - 可选 feeConfig

行 82-83：

- `getSigners` 返回 facilitator signer addresses。

行 94-100：

- 实现 verify。
- 当前不使用 facilitator context。

行 102-108：

- 读取 raw payload。
- Permit2 走 `verifyPermit2`。
- 否则走 `verifyEIP3009`。

行 119-125：

- 实现 settle。
- 当前不使用 facilitator context。

行 127-133：

- Permit2 走 `settlePermit2`。
- 否则走 `settleEIP3009`。

## 15. MCP Server Tool 支付路径

源码：`typescript/packages/mcp/src/server/paymentWrapper.ts:200-545`

函数：`createPaymentWrapper(...)(handler)`

行 200-207：

- 构造 MCP tool context 和 transportContext。
- transportContext 会传入 core hooks。

行 210-214：

- 从 MCP `_meta` 中提取 payment payload。

行 217-225：

- 如果没有 payment payload，返回 payment-required result。

行 227-235：

- 构造 tool resourceInfo。
- 调用 `createPaymentRequiredResponse` 得到 enrichment 后的 accepts，用于匹配。

行 236-239：

- 根据 client payload 查找匹配 requirement。

行 241-249：

- 找不到匹配时返回 payment-required result。

行 251-264：

- 校验 extension echo。
- 不合法时返回 payment-required result。

行 266-272：

- 调用 `resourceServer.verifyPayment`。

行 274-283：

- verify invalid 时返回 payment-required result。

行 286-297：

- 构造 hooks context。
- 创建 cancellation dispatcher。

行 299-310：

- 如果 verifyResult 请求 skipHandler，则直接 settlement 并返回 skip handler result。

行 313-325：

- 执行 `onBeforeExecution`。
- 如果 hook 返回 false，则返回 payment-required result，不执行 tool。

行 327-337：

- 执行真实 tool handler。
- handler 抛错时 cancel verified payment，然后继续抛错。

行 338-349：

- 将 result 放入 transportContext。
- 执行 `onAfterExecution`。

行 351-355：

- 如果 tool result 标记 `isError`，cancel verified payment 并返回错误结果。

行 357-367：

- tool 成功时进入 `settlePaymentResult`。

### 15.1 MCP settlement helper

源码：`typescript/packages/mcp/src/server/paymentWrapper.ts:409-451`

行 420-426：

- 调用 `resourceServer.settlePayment`。

行 428-434：

- 执行 `onAfterSettlement` hook。

行 436-442：

- 返回原 tool result，并把 settlement response 写入 `_meta[MCP_PAYMENT_RESPONSE_META_KEY]`。

行 443-450：

- settlement 异常时返回 settlement failed result。

### 15.2 MCP payment required result

源码：`typescript/packages/mcp/src/server/paymentWrapper.ts:490-519`

行 498：

- 构造 tool resourceInfo。

行 500-507：

- 调用 `createPaymentRequiredResponse`。

行 509-518：

- 返回 MCP-compatible error result：
  - `structuredContent` 是 paymentRequired。
  - `content[0].text` 是 JSON 字符串。
  - `isError: true`。

## 16. MCP Client Tool 自动支付路径

源码：`typescript/packages/mcp/src/client/x402MCPClient.ts:464-655`

### 16.1 `callTool`

行 464-468：

- 增强版 tool call。
- 支持 name、args、MCP request options。

行 470-472：

- 准备原始 result 和 paymentRequired。

行 473-485：

- 第一次不带 payment 调用 MCP tool。
- 校验返回结构。
- 尝试从 result 中提取 paymentRequired。

行 486-496：

- 如果 MCP SDK 以 error 形式抛出 payment required，也尝试提取。
- 能提取则继续支付流程，否则重新抛错。

行 498-505：

- 如果不是 payment required，原样返回内容，并标记 `paymentMade: false`。

行 507-526：

- 执行 `onPaymentRequired` hooks。
- hook 可以 abort，也可以提供现成 payment payload。

行 529-538：

- 如果关闭 autoPayment，则抛出包含 paymentRequired 的错误。

行 540-550：

- 构造 approval context。
- 调用 `onPaymentRequested`，用户或策略拒绝时抛错。

行 553-556：

- 执行 beforePayment hooks。

行 559：

- 调用 core `x402Client.createPaymentPayload`。

行 562：

- 调用 `callToolWithPayment` 进行付费重试。

### 16.2 `callToolWithPayment`

行 580-585：

- 接收显式 payment payload。

行 588-594：

- 构造 MCP call params。
- payment payload 写入 `_meta[MCP_PAYMENT_META_KEY]`。

行 597：

- 调用底层 MCP client。

行 600-602：

- 校验返回结构。

行 605-612：

- 保留 result `_meta`，并提取 settlement response。

行 615-622：

- 执行 afterPayment hooks。

行 624-632：

- 如果付费后又收到 paymentRequired，调用 core client 的 `handlePaymentResponse`。
- scheme hook 可修复本地状态。

行 636-645：

- 如果 recovered 且拿到了新的 paymentRequired：
  - 创建 fresh payload。
  - 重新构造带 payment 的 MCP call。
  - 再 retry 一次。

## 17. 运行路径之间的关键边界

### 17.1 Client 与 Resource Server 的边界

- Client 只信任 `PaymentRequired` 中的 `accepts` 和 `extensions`。
- Client 会把选中的 requirement 放入 `PaymentPayload.accepted`。
- Resource server 用 `findMatchingRequirements` 校验 `accepted` 是否仍匹配 server advertised requirements。

### 17.2 Resource Server 与 Facilitator 的边界

- Resource server 不做链上细节。
- 它只选择 facilitator client，并发送 `verify` / `settle` 请求。
- Facilitator 根据 scheme/network/payload 类型进入具体 mechanism。

### 17.3 Handler 与 Settlement 的边界

- Verify 成功不等于立即扣款。
- HTTP middleware 会先缓冲 handler 响应。
- handler 成功才 settlement。
- handler 抛错或返回 >= 400 时 cancel。

### 17.4 Extensions 的边界

- Client extensions 可以 enrich payload，但 server declaration 优先。
- Resource server extensions 可以 enrich challenge，但受 allowlist/policy 限制。
- Extension echo mismatch 会导致重新返回 402。

## 18. 调试建议

按问题类型定位：

- Client 没有自动付款：看 `wrapFetchWithPayment` 的 402 解析路径和 `x402Client.selectPaymentRequirements`。
- 报 no matching requirement：看 `processHTTPRequest` 的 `findMatchingRequirements` 和 payload.accepted。
- 报 extension mismatch：看 `validateExtensions` 和 client/server extension echo。
- Verify 失败：看 `x402ResourceServer.verifyPayment` 到 `x402Facilitator.verify`，再看具体 mechanism facilitator。
- Handler 成功但没返回业务响应：看 framework middleware 的 response buffering 和 `processSettlement`。
- Settlement failed：看 `x402ResourceServer.settlePayment`、facilitator `settle`、mechanism settle。

## 19. 本文覆盖的源码清单

- `typescript/packages/http/fetch/src/index.ts`
- `typescript/packages/core/src/client/x402Client.ts`
- `typescript/packages/core/src/server/x402ResourceServer.ts`
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts`
- `typescript/packages/http/express/src/index.ts`
- `typescript/packages/core/src/facilitator/x402Facilitator.ts`
- `typescript/packages/mechanisms/evm/src/exact/client/scheme.ts`
- `typescript/packages/mechanisms/evm/src/exact/server/scheme.ts`
- `typescript/packages/mechanisms/evm/src/exact/facilitator/scheme.ts`
- `typescript/packages/mechanisms/tron/src/exact/client/scheme.ts`
- `typescript/packages/mechanisms/tron/src/exact/server/scheme.ts`
- `typescript/packages/mechanisms/tron/src/exact/facilitator/scheme.ts`
- `typescript/packages/mcp/src/server/paymentWrapper.ts`
- `typescript/packages/mcp/src/client/x402MCPClient.ts`
