# TypeScript 审计发现汇总

审计日期：2026-07-02

汇总范围：本文件汇总 `docs/` 下已生成的 TypeScript 审计文档，重点依据 `docs/typescript-vs-typescript-new-audit-scope.md` 的审计范围，并合并安全、代码审查、异常边界、资产处理、架构结构、核心功能正确性等报告中的发现。

来源文档：

- `docs/typescript-vs-typescript-new-code-audit.md`
- `docs/typescript-security-audit.md`
- `docs/typescript-implementation-code-review.md`
- `docs/typescript-exception-boundary-audit.md`
- `docs/typescript-asset-handling-security-correctness-audit.md`
- `docs/typescript-core-functionality-correctness-audit.md`
- `docs/typescript-architecture-structure-audit.md`
- `docs/typescript-vs-typescript-new-audit-scope.md`

说明：下表为去重后的统一发现。同一问题在多份报告中出现时，只保留一条，来源列列出相关文档或原始编号。严重级别采用汇总后的最高影响评级。

## 总体结论

当前 TypeScript 版主路径已经具备较完整的 x402 支付生命周期：challenge、client payment payload、server verify、handler 成功后 settle、handler 失败 cancel、EVM/TRON 签名与结算校验都有实现和测试覆盖。

需要优先处理的问题集中在四类：

1. 支付语义完整性：Next `paymentProxy` 提前结算、MCP hook 已验证后未取消、HTTP adapter 结算准备失败取消不一致。
2. 默认安全策略：MCP client 默认自动付款、SIWX 默认 nonce 防重放不足、hook 异常默认 fail-open。
3. 资产处理正确性：TRON 小额金额转换、GasFree 超额 value、直接 AssetAmount 校验、settlement override 金额和 decimals。
4. 发布与兼容性：已删除 SVM/paywall 等包仍被文档引用，paywall 可选依赖未闭环，legacy 包仍存在 XSS/session-token 等历史风险。

发布建议：在处理 P0 项前，不建议作为稳定版本发布。

## P0 发现

| ID | 严重级别 | 发现 | 影响 | 主要建议 | 来源 |
| --- | --- | --- | --- | --- | --- |
| SUM-P0-01 | High | MCP client 默认 `autoPayment: true` 且默认 approval 返回 true | 恶意 MCP server 可诱导客户端自动签名付款 | 默认关闭自动付款；强制用户 approval hook；增加 spend/payTo/network/tool allowlist | `typescript-security-audit.md` H-01；`typescript-core-functionality-correctness-audit.md` F-07 |
| SUM-P0-02 | High | Next.js `paymentProxy` 在真实 handler 成功前结算 | 下游 route 失败或抛错时用户仍可能被扣款 | 生产 API 推荐 `withX402`；proxy 明确标为前置门禁；若承诺 pay-after-success，需重设计 | `typescript-security-audit.md` H-02；`typescript-implementation-code-review.md` Important 1；`typescript-architecture-structure-audit.md` A-05 |
| SUM-P0-03 | High | legacy paywall HTML 存在 `</script>` 注入风险 | 可在商户/paywall origin 执行脚本，篡改支付 UX 或诱导钱包操作 | JSON 不直接嵌入 script；HTML escape `<`；补 `</script>` 回归测试；冻结 legacy | `typescript-security-audit.md` H-03 |
| SUM-P0-04 | High | offer-receipt JWS `did:web` 自动解析存在 SSRF 面 | verifier 服务端可能访问内网、metadata 或受限网络 | 默认禁用自动 `did:web` resolver；添加 allowlist、私网拦截、timeout、响应大小限制 | `typescript-security-audit.md` H-04 |
| SUM-P0-05 | High | MCP `onBeforeExecution` 返回 false 时，已验证支付未取消 | batch/reservation 类支付可能留下 pending 授权或额度 | 返回前调用 cancellation dispatcher；增加 `execution_blocked` 取消原因 | `typescript-exception-boundary-audit.md` 发现 1 |
| SUM-P0-06 | High | MCP `onAfterExecution` 抛错时跳过取消和结算失败处理 | 业务已执行成功，但支付既未结算也未取消 | 包裹 hook 异常；抛错时取消或进入统一 settlement failure 结构 | `typescript-exception-boundary-audit.md` 发现 2 |
| SUM-P0-07 | High | TRON exact/upto 默认 money 转换会在小额输入上生成非法 amount | `PaymentRequirements.amount` 可能变成非整数，verify/settle 后续异常 | 复用 core `numberToDecimalString` + `convertToTokenAmount`；补 too-small 测试 | `typescript-asset-handling-security-correctness-audit.md` 发现 1 |
| SUM-P0-08 | High | TRON GasFree 允许签名 `value > requirements.amount` | exact 语义下可能接受并结算高于报价的金额 | GasFree amount 校验改为 equality；如需“至少支付”语义应另设 scheme | `typescript-asset-handling-security-correctness-audit.md` 发现 2 |

## P1 发现

| ID | 严重级别 | 发现 | 影响 | 主要建议 | 来源 |
| --- | --- | --- | --- | --- | --- |
| SUM-P1-01 | Medium-High | HTTP adapter 响应体读取/转换失败时取消语义不一致 | 已验证支付在 settlement 准备失败后可能未取消 | Hono body read 纳入 try/catch；所有 adapter 结算准备失败时调用 cancel | `typescript-exception-boundary-audit.md` 发现 3 |
| SUM-P1-02 | Medium-High | TRON 直接 `AssetAmount` 路径缺少 amount 与地址格式校验 | 非法 amount/asset/payTo 延迟到签名或链上阶段失败 | 所有 TRON server scheme 复用 asset guard；校验 amount、asset、payTo、network | `typescript-asset-handling-security-correctness-audit.md` 发现 3 |
| SUM-P1-03 | Medium-High | SIWX URI 只做 origin 前缀匹配，auth-only 路由可跨路径复用签名 | 同域不同权限 path 之间可能认证绕过 | 比较 parsed URL 的 origin + pathname，或要求 resources 绑定完整 resource URL | `typescript-security-audit.md` M-01 |
| SUM-P1-04 | Medium-High | SIWX nonce 防重放是可选的，默认 storage 不记录 nonce | 签名 header 在有效期内可作为 bearer token 重放 | storage 强制 TTL nonce；hook 调用 nonce check；原子记录 nonce | `typescript-security-audit.md` M-02 |
| SUM-P1-05 | Medium | Fastify `reply.raw.end()` 防护路径可能不触发 `onSend` 结算 | raw response 可能挂起或绕过结算/取消生命周期 | 增加真实 Fastify 集成测试；修复 raw.end 触发生命周期，或明确不支持 raw | `typescript-security-audit.md` M-03；`typescript-implementation-code-review.md` Important 2 |
| SUM-P1-06 | Medium | offer/receipt verify 只验签，不验有效期、资源和签发者授权 | 调用方可能误用为完整准入验证，接受过期或错误资源凭证 | 提供高层 `validateOffer/validateReceipt`；现有函数命名为 signature-only | `typescript-security-audit.md` M-04 |
| SUM-P1-07 | Medium | legacy session-token 端点可被公开滥用 | 攻击者可消耗商户 CDP 配额或为任意地址生成 session token | 示例加入 auth、origin、CSRF、rate limit、asset allowlist、ownership proof | `typescript-security-audit.md` M-05 |
| SUM-P1-08 | Medium | builder-code attribution 可被客户端覆盖 | 统计污染；若用于分成/奖励可能造成经济攻击 | attribution 来自服务端声明；客户端不得覆盖 app code；settle 前校验一致 | `typescript-security-audit.md` M-06 |
| SUM-P1-09 | Medium | malformed `Settlement-Overrides` header 被静默忽略，可能退回全额结算 | partial settlement 意图丢失，可能按原始 amount 结算 | strict 模式下 malformed 直接 settlement failure；至少记录 warning | `typescript-exception-boundary-audit.md` 发现 4 |
| SUM-P1-10 | Medium | core settlement override 金额解析缺少上界和格式校验 | `1000%`、超大 dollar、raw 非整数依赖下游拦截 | resolved amount 必须是整数且 `<= requirements.amount`；percent 限制 0-100%；dollar 用 decimal 字符串算法 | `typescript-exception-boundary-audit.md` 发现 5；`typescript-asset-handling-security-correctness-audit.md` 发现 5 |
| SUM-P1-11 | Medium | EVM dollar-format settlement override 对非默认 asset 使用错误 decimals | 非默认 token partial settlement 可能少收或多收 | EVM 增加 asset registry 或读取 `extra.decimals`；文档禁止非默认 asset 使用 dollar override | `typescript-asset-handling-security-correctness-audit.md` 发现 4 |
| SUM-P1-12 | Medium | resource server lifecycle hook 异常默认 warn-and-continue | 风控/授权类 hook 失败可能 fail-open | hook 注册支持 `onError: abort/continue`；官方 extension 声明失败策略 | `typescript-exception-boundary-audit.md` 发现 8；`typescript-core-functionality-correctness-audit.md` F-04 |
| SUM-P1-13 | Medium | HTTP header 解码只做 base64/JSON parse，缺少 schema 边界校验 | 结构错误但 JSON 合法的 payload 进入后续流程，错误位置不稳定 | decode 边界复用 PaymentPayload/PaymentRequired/SettleResponse schema | `typescript-exception-boundary-audit.md` 发现 7 |
| SUM-P1-14 | Medium | paywall 本地包删除后，动态 require、peer/optional dependency 和文档不一致 | 消费者无法从 manifest 知道需要安装 paywall，运行时静默 fallback | 声明 optional peer；catch 区分 MODULE_NOT_FOUND 和运行时异常；修复文档链接 | `typescript-vs-typescript-new-code-audit.md` F-02；`typescript-exception-boundary-audit.md` 发现 6 |
| SUM-P1-15 | Medium | 文档仍指导用户导入已删除的 SVM/paywall 包 | 用户按 README 集成会安装或导入不存在包 | 支持矩阵改为 EVM/TRON，或明确外部包来源和版本；文档 import smoke test | `typescript-vs-typescript-new-code-audit.md` F-01 |
| SUM-P1-16 | Medium | 删除链包后 CONTRIBUTING 和主动文档仍展示旧结构 | 维护者按不存在目录开发，CI/支持矩阵认知错误 | 更新仓库结构、删除或标记已移除链包、补 TRON 开发说明 | `typescript-vs-typescript-new-code-audit.md` F-03 |
| SUM-P1-17 | Medium | 未注册 scheme 仍可能生成空 requirements fallback | 直接 core 使用或跳过初始化时可能产生空 accepts challenge | 未注册 scheme 显式 throw，或仅兼容模式允许；补 direct core 测试 | `typescript-core-functionality-correctness-audit.md` F-02 |
| SUM-P1-18 | Medium | facilitator supported wildcard network 缺少直接测试，`getSupportedKind` 存在精确筛选 | `eip155:*` 类 supported kind 可能无法匹配具体网络 | 若支持 wildcard，二次筛选用 pattern match；若不支持，文档要求 concrete network | `typescript-core-functionality-correctness-audit.md` F-03 |
| SUM-P1-19 | Medium | HTTP adapter lifecycle 缺少共享契约测试 | 各框架 settlement/cancel 行为容易漂移 | 建立 adapter conformance suite，所有 adapter 运行同一组 verify/execute/settle/cancel 用例 | `typescript-core-functionality-correctness-audit.md` F-05；`typescript-architecture-structure-audit.md` A-01 |
| SUM-P1-20 | Medium | streaming/raw/large response 支持边界未定义 | 依赖 response body 的 settlement extension 在不同框架行为不一致 | 明确支持矩阵；不可捕获响应要求 opt-in 策略或禁用相关 extension | `typescript-core-functionality-correctness-audit.md` F-06；`typescript-architecture-structure-audit.md` A-06 |

## P2 发现

| ID | 严重级别 | 发现 | 影响 | 主要建议 | 来源 |
| --- | --- | --- | --- | --- | --- |
| SUM-P2-01 | Medium | TRON token registry 运行时注册缺少 schema，unknown decimals fallback 到 6 | 错误 token 注册或 unknown asset 可能导致错误定价/选择/override 换算 | `registerToken` 校验 address/decimals/symbol/method；安全路径 unknown decimals 不 fallback | `typescript-asset-handling-security-correctness-audit.md` 发现 6 |
| SUM-P2-02 | Low-Medium | TRON token selection 使用 `Number` 归一化极大金额 | 极大 18 decimals amount 比较可能丢精度或选错 token | 使用 BigInt 有理数交叉相乘比较 | `typescript-asset-handling-security-correctness-audit.md` 发现 7 |
| SUM-P2-03 | Low-Medium | fee 配置和 `extra.fee` 直接 `BigInt` 解析，缺少 malformed 防护 | malformed fee 导致 payload 创建、选择或 verify 抛通用异常 | 引入 `parseAtomicAmount`，只接受十进制非负整数字符串 | `typescript-asset-handling-security-correctness-audit.md` 发现 8 |
| SUM-P2-04 | Medium-Low | paywall HTML custom provider 异常和 optional require 异常处理不对称 | custom provider 抛错可能 500；optional 包内部错误被静默 fallback | custom provider fallback 并 warn；optional require 只吞模块不存在错误 | `typescript-exception-boundary-audit.md` 发现 6 |
| SUM-P2-05 | Low-Medium | package `main/module/types/exports` 兼容性需发布 smoke test | 旧 bundler 或旧 TypeScript 可能解析到错误入口 | `npm pack --dry-run`；CJS/ESM/types import smoke tests | `typescript-vs-typescript-new-code-audit.md` F-05 |
| SUM-P2-06 | Low-Medium | `syncFacilitatorOnStart` 行为与注释容易误导 | 调用方可能误以为未命中 protected route 时不触发 facilitator 网络请求 | 修正文档注释，或改为严格懒初始化；补调用次数测试 | `typescript-implementation-code-review.md` Minor 1；`typescript-core-functionality-correctness-audit.md` F-01 |
| SUM-P2-07 | Medium | `x402ResourceServer` 与 `x402HTTPResourceServer` 过大 | 核心变更风险高，审计成本高 | 拆分 registry、pipeline、matcher、response factory | `typescript-architecture-structure-audit.md` A-02 |
| SUM-P2-08 | Medium-High | extension 生命周期能力强但分散，第三方实现难度高 | hook 顺序、可变字段、失败策略不清晰，扩展易错 | 输出正式 lifecycle 表和 extension harness | `typescript-architecture-structure-audit.md` A-03 |
| SUM-P2-09 | Medium-High | 自定义 route regex 需要模拟多框架语义 | route 保护边界可能与真实框架 dispatch 不一致 | 增加跨框架 route matcher 契约测试 | `typescript-architecture-structure-audit.md` A-04 |
| SUM-P2-10 | Medium | extensions 单包过重 | 依赖膨胀，发布耦合 | 拆分扩展包，或明确 optional dependency 策略 | `typescript-architecture-structure-audit.md` A-07 |
| SUM-P2-11 | Medium | legacy 与新版并存 | 修复遗漏、文档混乱、review 噪音 | 冻结 legacy，建立迁移策略和同步安全修复策略 | `typescript-architecture-structure-audit.md` A-08 |
| SUM-P2-12 | Low-Medium | fetch/Axios/MCP client transport wrapper 重复 payment retry state machine | 新 transport 容易复制遗漏，恢复/重试语义漂移 | 抽出 transport-neutral payment retry helper | `typescript-architecture-structure-audit.md` A-09；`typescript-core-functionality-correctness-audit.md` P2 |
| SUM-P2-13 | Low-Medium | package exports 很细但用户导航不足 | 用户选择安装和导入路径成本高 | 增加按角色安装、导入、runtime 支持矩阵 | `typescript-architecture-structure-audit.md` A-10 |

## 范围与测试缺口

以下不是单一漏洞，但会影响发布判断：

| ID | 问题 | 建议 |
| --- | --- | --- |
| GAP-01 | 当前环境未发现 `pnpm`，多份报告均未能运行完整 build/test/integration | 在修复前后执行 `pnpm --dir typescript build`、`pnpm --dir typescript test`、`pnpm --dir typescript test:integration` |
| GAP-02 | `typescript-security-audit.md` 明确未完成 517 个候选源文件的 full-file exhaustive 审计 | 对 deferred 范围继续做分批 full-file 审计，尤其 legacy、extensions 非重点路径、mechanisms 工具函数 |
| GAP-03 | 文档和 README 示例缺少 import smoke test | 对所有保留发布包和主动 README 示例执行 CJS/ESM/types/import smoke |
| GAP-04 | HTTP adapter 行为不是共享契约驱动 | 建立统一 conformance suite 后再视为稳定 SDK 基线 |

## 推荐修复顺序

P0 第一批：

1. 禁用 MCP 默认自动付款，补 approval/allowlist。
2. 处理 Next `paymentProxy` 提前结算语义，至少文档/API 命名明确风险。
3. 修复 MCP server hook 已验证后未取消的两条路径。
4. 修复 TRON exact/upto 金额转换和 GasFree overpayment。

P0 第二批：

1. legacy paywall XSS。
2. offer-receipt `did:web` SSRF。
3. TRON AssetAmount 校验。
4. HTTP adapter 结算准备失败取消一致性。

P1：

1. settlement override 解析、上界、malformed header 策略。
2. SIWX URI/nonce 安全边界。
3. Fastify raw lifecycle。
4. builder-code、session-token、offer/receipt high-level validate API。
5. paywall optional dependency 和删除包文档闭环。

P2：

1. adapter conformance suite。
2. extension lifecycle/fail policy harness。
3. core/HTTP 大类拆分。
4. legacy 冻结与发布入口 smoke test。

## 结论

本轮汇总后的主要阻塞项不是基础协议主路径缺失，而是默认安全策略、支付生命周期边界、资产金额精度和发布兼容性没有完全收敛。优先修复 P0 后，再通过共享契约测试和完整 build/test/integration 验证，才能把这些静态审计发现转为可关闭状态。
