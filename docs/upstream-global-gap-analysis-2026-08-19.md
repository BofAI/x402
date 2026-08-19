# 当前工程与社区上游全局差异分析

> 日期：2026-08-19
> 分析对象：BankofAI 当前分支与 `x402-foundation/x402` 最新已获取的 `origin/main`
> 文档定位：从 2026-08-19 起，本文件是上游同步的唯一持续台账。

## 0. 跟踪规则

后续同步直接更新本文件，不再新建其他同步分析文档。每轮必须记录：上游起止提交、目标分支和提交、已同步项、待办项、有意分歧、验证结果，以及下一轮比较起点。2026-07-30 及以前的详细记录由 Git 历史保留。

## 1. 结论摘要

本轮代码同步、安全修复和关键回归测试已经提交并推送；当前分支尚未合并到主干。

- 当前分支：`sync/upstream-typescript-2026-07-30`
- 同步提交：`9046c846d397c7bca3d35faa16c50a9c470b6c01`
- BankofAI 主干：`main` / `76368cf1`
- 远端分支：`origin/sync/upstream-typescript-2026-07-30`，已与本地同步。
- 分支相对主干：领先 2 个提交、落后 0 个提交；尚未合并。
- 社区上游最新已获取提交：`75b519d0a3a7fd609a00b6d5bf684a6a9131fe25`，时间为 2026-08-19。

全局比较确认：2026-08-19 这一轮主要共享运行时代码已经覆盖；发现的 SIWx 安全遗漏和 HTTP/Fetch 回归测试缺口也已经补齐。共享规范按当前决策暂不处理。

| 优先级 | 发现 | 判断 |
| --- | --- | --- |
| 已完成 | SIWx Solana 小阶 Ed25519 公钥校验 | 已同步修复和回归测试 |
| 暂缓 | 8 份共享规范仍停留在旧版本 | 按当前决策暂不处理 `specs/` |
| P1 | 上游仓库工作区落后 `origin/main` 67 个提交 | 同步流程风险，容易重复漏拷文件 |
| 已完成 | HTTP/Fetch 若干上游回归测试 | 已同步并通过全量包测试 |
| 已完成 | exact example 自定义资产被默认 spend controls 过滤 | Fetch/MCP 已配置资产白名单及单笔 atomic 上限，并完成端到端验证 |
| P2 | EVM 智能账户集成矩阵未引入 | 测试覆盖缺口，不是生产源码缺口 |
| 观察项 | EIP-1271 magic value 使用严格相等 | 本地安全加固，建议保留，不应视为遗漏 |

综合判断：代码同步提交可以进入评审；exact example 已适配新 spend controls，合并前仍需决定是否适配 EVM 智能账户集成矩阵。`specs/` 保持暂缓。

## 2. 比较基线与方法

### 2.1 基线

社区仓库位于：

```text
/Users/roger/Project/develop/foundation-x402/x402
```

该仓库当前工作区仍停在：

```text
183b2706953e5d730f268360ca20bddd58ba19a1
```

但其已获取的远端引用为：

```text
origin/main = 75b519d0a3a7fd609a00b6d5bf684a6a9131fe25
```

两者相差 67 个提交。因此本次没有把社区仓库工作区当成基线，而是使用 `git archive origin/main` 导出固定快照后比较。这一点非常重要：直接 `cp`、`rsync` 或对工作区运行 `diff`，都会错误地与 2026-07-30 的旧代码比较。

### 2.2 归一化处理

两个仓库不是同一 Git 历史，且包名不同。本次比较先在临时快照中把社区包名：

```text
@x402/*
```

归一化为：

```text
@bankofai/x402-*
```

随后分五层检查：

1. 包、目录和文件集合；
2. 公共源码的逐文件内容差异；
3. `package.json` 依赖、导出和脚本；
4. 公共规范与回归测试；
5. `183b2706..75b519d0` 的社区提交覆盖情况。

版本号、changelog、包名、上游网站、Go/Python、示例工程，以及本工程未支持的链机制没有被当成运行时代码遗漏。

## 3. 范围盘点

### 3.1 双方共有且纳入比较的包

- `core`
- `extensions`
- `mcp`
- HTTP：`axios`、`express`、`fastify`、`fetch`、`hono`、`next`
- 机制：`evm`
- 公共 `specs`

本工程还拥有社区上游没有的 TRON 机制、observability、wallets 和 agent-wallet 适配层。这些是 fork 自有能力，不属于漂移或遗漏。

### 3.2 社区存在但当前工程明确未支持的范围

社区 TypeScript 还包含 Stellar、Concordium、Aptos、SVM、AVM、Keeta、Hedera、NEAR、XRPL、TVM，以及 HTTP paywall/site 等包。当前工程只保留 EVM 与 TRON 机制，因此这些包的缺失应记录为产品范围，而不是同步遗漏。

### 3.3 文件集合结果

忽略构建产物后，在上述共有范围中发现：

- 社区独有文件：46 个；
- fork 独有文件：17 个。

社区独有的 46 个文件主要由以下内容构成：

- 39 个规范、模板或不支持链的规范文件；
- 7 个 EVM 智能账户集成测试、辅助脚本和测试 helper。

fork 独有的文件主要是：

- 3 份 TRON 规范；
- core observability 与 wallets；
- EVM agent-wallet 适配器；
- fork 自有的 EVM 集成和安全回归测试。

在共有包中，没有发现社区独有的生产 `src/` 文件被整体漏掉。本轮审计发现的 SIWx 源码遗漏发生在双方共有的 `solana.ts` 文件内部，因此只比较文件名是不够的。

## 4. 详细发现

### 已完成：SIWx Solana 小阶 Ed25519 公钥校验

社区提交：

```text
32464a267593bbf3d646ff3f5858f044aaf9fce9
Fix: SVM SIWx small-order Ed25519 verification (#2933)
```

受影响文件：

```text
typescript/packages/extensions/src/sign-in-with-x/solana.ts
typescript/packages/extensions/test/sign-in-with-x.test.ts
```

已在调用 `tweetnacl` 验签前使用 `@noble/curves/ed25519` 解析公钥并拒绝 small-order 点，同时同步 torsion subgroup 和端到端伪造签名回归测试。

这项变更此前被随“SVM 机制不支持”一起排除，但该判断不准确：文件属于共享的 `extensions/sign-in-with-x` 包，当前工程仍公开并编译 Solana SIWx 验签逻辑。即使没有引入 SVM 支付机制，调用该扩展的消费者仍可能触发这条路径。

依赖层面不存在阻塞：当前 `extensions/package.json` 已经包含 `@noble/curves`。

验证结果：修复前伪造签名被接受；修复后伪造签名被拒绝，正常 Ed25519 签名仍被接受。该修复已包含在 `9046c846`。

### 暂缓：共享规范快照仍是旧版本

当前 `specs/` 中已有 8 份与社区同名的共享规范，但内容仍对应旧检查点，而不是 `75b519d0`：

```text
specs/extensions/bazaar.md
specs/extensions/builder_code.md
specs/extensions/sign-in-with-x.md
specs/schemes/batch-settlement/scheme_batch_settlement_evm.md
specs/schemes/exact/scheme_exact.md
specs/schemes/exact/scheme_exact_evm.md
specs/schemes/upto/scheme_upto_evm.md
specs/x402-specification-v2.md
```

主要遗漏内容包括：

- Bazaar 禁止外部 `$ref`/`$id` 解析的 SSRF 安全约束；
- Builder Code 的 client/server/facilitator 分层预算、合并和截断语义；
- SIWx 客户端对最终资源 URL origin 的绑定要求；
- `settlement_pending` 的非终态语义及 transaction hash 要求；
- `assetTransferMethod` 与 payment flow 模型；
- exact/upto/batch-settlement 的新流程说明。

这些运行时变化在本轮工作区中大多已经同步，但规范没有同步，会造成“实现已更新、仓库规范仍描述旧协议”的不一致。

从时间戳和仓库状态看，这与从落后 67 个提交的社区工作区复制文件相吻合。以后应始终从固定 commit 的 Git 对象导出，不能从未 checkout 到最新提交的工作区复制。

另外，社区还有通用 scheme、transport、auth-capture 和 extension 规范未镜像。建议把规范分成两类管理：

- 必须跟随的共享协议规范；
- 因未支持对应链而明确排除的链专属规范。

### 已完成：同步检查点已落成提交

2026-08-19 的同步内容已提交为 `9046c846d397c7bca3d35faa16c50a9c470b6c01`，并推送到 `origin/sync/upstream-typescript-2026-07-30`。

本轮稳定 checkpoint：

- upstream：`75b519d0a3a7fd609a00b6d5bf684a6a9131fe25`；
- target：`9046c846d397c7bca3d35faa16c50a9c470b6c01`；
- 状态：已推送，尚未合并到 `main`。

### 已完成：HTTP/Fetch 回归测试

以下上游回归场景已同步测试：

- Express、Fastify、Hono、Next：eager initialization 首次失败不产生 unhandled rejection，下一次请求可以重试；
- Fetch：第一次付费请求失败后进入 recovery 时，`Request` body 仍可再次发送。

Express、Fastify、Hono、Next 和 Fetch 全量包测试均已通过。

### 已完成：exact example 适配默认 spend controls

社区提交 `4f587236` 新增 client spend controls，并默认只允许机制注册的默认资产。fork 的 exact example 使用 BSC 自定义 DHLU/USDC/USDT；TRON USDD 虽在机制 token registry 中，但不是默认资产（默认资产为 USDT）。这些支付选项此前会在 selector 运行前被过滤。

2026-08-19 已在 Fetch 和 MCP exact client 中将上述非默认资产显式加入 `allowedAssets`，单笔 atomic 上限与对应 example server 报价一致；没有关闭全局 spend controls，SDK 默认资产仍受默认 `$1` 上限保护。

### P2：EVM 智能账户集成矩阵缺失

社区独有以下集成测试设施：

```text
typescript/packages/mechanisms/evm/scripts/setup-smart-accounts.ts
typescript/packages/mechanisms/evm/test/integrations/evm-wallet-matrix.test.ts
typescript/packages/mechanisms/evm/test/integrations/exact-4337-evm.test.ts
typescript/packages/mechanisms/evm/test/integrations/exact-7579-evm.test.ts
typescript/packages/mechanisms/evm/test/integrations/exact-eoa-evm.test.ts
typescript/packages/mechanisms/evm/test/integrations/helpers/matrixCommon.ts
typescript/packages/mechanisms/evm/test/integrations/helpers/smartAccounts.ts
```

当前工程已有 ERC-1271、ERC-6492、ERC-7702 相关单元覆盖和 fork 自有 agent-wallet 测试，因此这不是生产源码遗漏；但缺少社区的 EOA/4337/7579 端到端兼容矩阵。若智能账户兼容性是发布承诺，建议适配而不是原样复制，因为当前工程的 signer/wallet 接口已经分叉。

## 5. 已确认的有意分歧

下列差异不应被自动同步工具覆盖：

### TRON 与多机制共存

- TRON 的地址、签名、GasFree、Permit2、batch settlement 和小数精度规则由 fork 自己维护；
- EVM refund 客户端额外限制 `eip155:*`，避免与 TRON 的同名 scheme 混用；
- TRON client/server 声明 payment flow，但保留 fork 自有 facilitator 逻辑。

### 注册与协议兼容策略

- `registerExactEvmScheme` 不自动注册 v1；这是既有明确决策；
- EVM v1 的 `validAfter` 保持 `0`，而社区当前仍使用 `now - 600`；这是本地安全评审后的明确分歧，需通过策略记录维护；
- wildcard network 的 facilitator capability 校验使用 fork 的具体网络反向匹配实现，比社区当前实现更适合本工程。

### 安全与可靠性加固

- EIP-1271 magic value 使用严格相等，而社区使用 `startsWith`；本地提交 `2b132c6c` 将其作为 R-21 安全加固，建议保留；
- EIP-3009 verification 的异常被转换为稳定错误响应，社区当前没有同等保护；
- 本地 logger 替代 `console` 是 observability 设计差异，不是行为遗漏。

### fork 自有公共 API

- core 导出 `./wallets`；
- EVM 导出 `./adapters/agent-wallet`；
- core 还导出 observability 能力。

归一化比较后，其余共有包的 `package.json` 依赖和 exports 基本一致。HTTP manifest 中社区新增的可选 paywall peer dependency 对应当前未引入的 paywall 包，应作为范围决策处理，而不是单独添加一个悬空 peer dependency。

## 6. 2026-08-19 提交覆盖判断

社区范围：

```text
183b2706953e5d730f268360ca20bddd58ba19a1..75b519d0a3a7fd609a00b6d5bf684a6a9131fe25
```

共 67 个提交，其中 24 个提交直接触及本次纳入比较的共享 TypeScript/EVM/specs 路径；同步记录按产品语义还统计了 25 个相关提交。已检查的主要运行时主题均能在当前工作区找到对应实现：

- payment flow、取消结算和 `settlement_pending`；
- client spend controls 与 MCP policy/re-approval；
- HTTP encoded separator、backslash、line terminator 与 cache-control 加固；
- Bazaar 外部引用拒绝；
- SIWx request origin 绑定；
- Builder Code 合并和预算；
- EVM settlement receipt、pending result、默认资产和缺失 `accepted` 兼容。

因此，最新 67 个提交中的主要共享运行时代码没有发现第二个明确缺口。P0 的 SIWx 小阶公钥修复属于更早的 `ea2cd817..183b2706` 范围，正说明只做“上次 checkpoint 之后的增量提交审阅”仍可能永久继承历史误分类；必须定期做本报告这种归一化全量比较。

## 7. 验证状态

本轮同步记录中的验证结果：

| 包 | 测试数 |
| --- | ---: |
| core | 647 |
| extensions | 526 |
| EVM | 828 |
| TRON | 139 |
| MCP | 113 |
| Fetch | 21 |
| Axios | 23 |
| Express | 73 |
| Fastify | 55 |
| Hono | 63 |
| Next | 67 |

上述 11 个包均构建成功，同步文件 lint 通过。全包 lint 仍有同步前已存在的问题，不能把“局部 lint 通过”描述成“仓库 lint 全绿”。

SIWx 修复后还验证了伪造签名被拒绝、正常签名继续通过；Extensions 完成全量测试和构建。HTTP 五个受影响包完成全量测试，相关文件 ESLint 和 `git diff --check` 通过。

## 8. 当前待办与合并前检查

1. 评估是否适配 EVM 智能账户集成矩阵；
2. `specs/` 按当前决策暂缓，后续恢复时从固定 upstream Git 对象同步；
3. 合并到 `main` 后用 `git merge-base --is-ancestor 9046c846 main` 做最终确认，并更新本文件状态。

## 9. 后续全局比较机制建议

建议把同步审计固定成“增量提交审阅 + 定期全量快照比较”双轨制。

### 每次同步

```text
fetch upstream
  -> 锁定 upstream commit
  -> git archive 导出快照
  -> 包名/路径归一化
  -> 文件集合比较
  -> 公共源码语义比较
  -> package exports/dependencies 比较
  -> specs 与测试比较
  -> allowlist 分类
  -> 构建/测试/lint
  -> 记录 upstream commit + target commit
```

### 应长期维护的 allowlist

- fork 自有：TRON、wallets、observability、agent-wallet；
- 明确不支持：非 EVM/TRON 机制、site、paywall；
- 行为分歧：不自动注册 v1、`validAfter = 0`、EIP-1271 strict equality；
- 仅改名：`@x402/*` 到 `@bankofai/x402-*`；
- 发布噪声：version、changelog、changeset、站点和 release commit。

allowlist 必须写出原因、责任人或决策来源，并设置复查日期。没有原因的差异不能自动归为“fork 自有”。

### 建议的门禁

- 上游工作区 HEAD 与比较 commit 不一致时禁止从工作区复制；
- 上游修复提交若修改测试，目标同步必须包含等价测试或书面豁免；
- 共有 `src/` 文件出现语义差异时必须逐项分类；
- 共享 specs 的 hash 漂移必须被 CI 报告；
- checkpoint 必须同时记录 upstream commit 和已经提交的 target commit，不能指向未提交工作区。

采用该机制后，增量审阅负责理解社区最近做了什么，全量比较负责发现过去被误分类、漏拷或在后续重构中丢失的内容，两者互相补足。

## 10. 下一轮比较起点

下一轮从本次 upstream checkpoint 之后开始：

```bash
git -C /Users/roger/Project/develop/foundation-x402/x402 log \
  75b519d0a3a7..origin/main \
  --date=short --pretty=format:'%H%x09%ad%x09%s'
```

比较前必须先 `fetch`，并继续使用 `origin/main` 的 Git 对象快照，不依赖上游仓库当前 checkout 的工作区文件。目标基线为 `9046c846d397c7bca3d35faa16c50a9c470b6c01`；合并后再替换为对应的 `main` 提交。
