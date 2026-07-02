# 全库描述一致性检查

生成时间：2026-07-02  
检查范围：仓库根文档、`typescript/` 文档、TypeScript 包级 README、包元数据、源码注释/内置提示、示例文档。  
排除说明：`docs/` 下此前生成的审计文档属于审计产物，会引用历史问题或对比范围，本次不把这些引用计入“用户面描述不一致”。

## 总体结论

当前仓库的主叙事已经收敛到 `@bankofai/x402-*` TypeScript-only SDK，主支持链路为 TRON 与 BSC/EVM。根 `README.md` 和 `typescript/README.md` 基本代表当前实现：根文档明确写明当前支持 TRON/BSC、scheme 包括 `exact`、`upto`、`batch-settlement`、`auth-capture`、`exact_gasfree`；`typescript/README.md` 的包矩阵只列出当前存在的 core/extensions/mcp/http/evm/tron 包。

不一致主要集中在旧文档和包级 README：大量位置仍描述 `@bankofai/x402-svm`、`@bankofai/x402-avm`、`@bankofai/x402-stellar`、`@bankofai/x402-aptos`、`@bankofai/x402-paywall` 或 `packages/http/paywall`，但当前 `typescript/packages` 目录下只存在 `mechanisms/evm`、`mechanisms/tron`、`http/{axios,express,fastify,fetch,hono,next}`、`core`、`extensions`、`mcp` 和 `legacy`。

## 检查方法

- 扫描包元数据：`find typescript/packages -name package.json`，并读取 `name`、`description`、`repository`、依赖字段。
- 扫描旧包/旧链路引用：`@bankofai/x402-svm`、`@bankofai/x402-avm`、`@bankofai/x402-stellar`、`@bankofai/x402-aptos`、`@bankofai/x402-paywall`、`packages/http/paywall`、`solana:*`、`ExactSvmScheme`。
- 对照源码导出：`typescript/packages/mechanisms/evm/src/index.ts`、`typescript/packages/mechanisms/tron/src/index.ts`。
- 对照当前准绳文档：根 `README.md`、`typescript/README.md`、`examples/typescript/README.md`。

## 发现

### C-01 高：支持链路描述分裂

根 `README.md:5` 写明当前支持 TRON 和 BSC，`README.md:147-167` 进一步限定资产和 scheme；`typescript/README.md:22-27` 只列出 EVM 与 TRON 链实现。

但旧文档仍把 SVM/Solana、AVM/Algorand、Stellar、Aptos 描述为当前 TypeScript SDK 的一部分：

- `typescript/CONTRIBUTING.md:24` 仍列 `packages/mechanisms/svm`。
- `typescript/CONTRIBUTING.md:44-49` 仍把 `@bankofai/x402-svm` 放在机制依赖图中。
- `typescript/CONTRIBUTING.md:225-233` 仍要求 SVM、Stellar、Aptos 集成测试变量。
- `typescript/packages/core/README.md:131-159` 的示例仍使用 EVM + SVM 双支付选项。
- `typescript/packages/core/README.md:284-286` 仍列 `@bankofai/x402-svm` 与 `@bankofai/x402-avm`。
- `typescript/packages/mechanisms/evm/README.md:171-172` 仍把 SVM/Stellar 作为相关包。

影响：开发者会认为这些机制当前可安装、可构建、可运行，实际包不存在，按文档操作会失败。

建议：以根 `README.md` 和 `typescript/README.md` 为准，统一用户面文档为 EVM/TRON；如保留 Solana 内容，应明确标记为 legacy、未来计划或扩展认证能力，不应放在当前支付机制路径里。

### C-02 高：已删除/缺失包仍被文档要求安装或导入

当前目录树中没有 `typescript/packages/http/paywall`，但 HTTP 中间件文档仍要求安装独立 paywall 包：

- `typescript/packages/http/express/README.md:140-143` 建议 `pnpm add @bankofai/x402-paywall`。
- `typescript/packages/http/express/README.md:180` 链接 `../paywall/README.md`，该路径不存在。
- `typescript/packages/http/hono/README.md:139-159`、`typescript/packages/http/fastify/README.md:140-160` 有同类 `@bankofai/x402-paywall` 描述。
- `typescript/packages/http/next/README.md:201-207` 导入 `createPaywall`、`evmPaywall`、`svmPaywall`。

源码也存在动态加载提示：

- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:345-363` 的 fallback HTML 提示安装 `@bankofai/x402-paywall`。
- `typescript/packages/core/src/http/x402HTTPResourceServer.ts:1204-1221` 尝试 `require("@bankofai/x402-paywall")`，失败后 fallback。

影响：如果 `@bankofai/x402-paywall` 已从当前 monorepo 删除且没有外部发布策略，这会造成运行时能力描述与可交付包不一致。若它是外部可选包，也缺少 package metadata 或文档中的外部来源说明。

建议：产品上二选一：恢复并发布 `@bankofai/x402-paywall`，或删除/改写所有“安装 paywall 包”的描述，改为内置 fallback/custom provider 文档。若保留可选外部包，应在 README 中说明它不在本仓库，并给出真实 npm/GitHub 来源。

### C-03 高：EVM 包 README 的 API 名称与当前导出不一致

`typescript/packages/mechanisms/evm/src/index.ts` 当前导出：

- `ExactEvmScheme`
- `UptoEvmScheme`
- `BatchSettlementEvmScheme`
- `AuthCaptureEvmScheme`
- signer、类型、Permit2 helper、默认资产和扩展 helper

但 `typescript/packages/mechanisms/evm/README.md` 仍使用旧命名：

- `README.md:26`：`ExactEvmClient`
- `README.md:31`：`ExactEvmFacilitator`
- `README.md:36`：`ExactEvmServer`
- `README.md:43-45`：`ExactEvmClientV1`、`ExactEvmFacilitatorV1`、`NETWORKS`
- `README.md:82-88`、`README.md:102-108`、`README.md:119-124`：示例导入并实例化 `ExactEvmClient`

影响：包级 README 是 npm 用户最常访问的文档，错误导出名会直接导致复制粘贴失败。

建议：把 EVM README 改为 `ExactEvmScheme` / `ExactEvmSchemeV1` / `registerExactEvmScheme` 等当前导出名，并补上 `upto`、`batch-settlement`、`auth-capture` 的当前能力边界。

### C-04 中：EVM/TRON 能力描述粒度不一致

根 `README.md:159-167` 已描述当前 scheme：`exact`、`upto`、`batch-settlement`、`auth-capture`、`exact_gasfree`。但包级描述仍有偏差：

- `typescript/README.md:26` 说 EVM implementation using Exact payment scheme，弱化了当前 EVM 已包含 `upto`、`batch-settlement`、`auth-capture`。
- `typescript/packages/mechanisms/evm/README.md:3` 只描述 Exact + EIP-3009，未反映 Permit2、upto、batch-settlement、auth-capture。
- `typescript/packages/mechanisms/tron/package.json:30` 描述 TRON exact TransferWithAuthorization/Permit2，但源码导出和 README 已包含 `UptoTronScheme`、GasFree payload 类型、token/fee/selector 工具；包描述没有体现 `upto`/GasFree/batch-settlement 相关能力。

影响：不会直接导致编译失败，但会影响包选型、能力判断和 npm 搜索摘要准确性。

建议：为每个包维护一句统一风格描述。例如：

- core：transport-agnostic x402 client/server/facilitator primitives。
- evm：EVM x402 mechanisms for exact, upto, batch-settlement, and auth-capture with EIP-3009/Permit2 support。
- tron：TRON x402 mechanisms for exact, upto, batch-settlement, and exact_gasfree with TRC-20 Permit2/GasFree support。
- HTTP 包：明确是对应框架 adapter，而不是泛化的 `x402 Payment Protocol`。

### C-05 中：包元数据仓库/作者描述与 BankofAI 包名存在品牌不一致

当前发布包名均为 `@bankofai/x402-*`，但多个 package metadata 仍写：

- `author: "x402 Foundation"`
- `repository: "https://github.com/x402-foundation/x402"`

证据示例：

- `typescript/packages/mechanisms/tron/package.json:28-30`
- `typescript/packages/mechanisms/evm/package.json:28-30`
- `typescript/packages/core/package.json:22-24`
- `typescript/packages/http/express/package.json:21-23`
- `typescript/packages/extensions/package.json:26-28`
- `typescript/packages/mcp/package.json:22-24`

根 `README.md:15` 解释 core/EVM fork 自 upstream、TRON in-house，因此 upstream 引用可能有历史原因；但包元数据作为 npm 用户入口，会让人误以为包仍由 x402 Foundation 仓库维护。

建议：若当前维护入口是 BankofAI，应统一 `repository` 为真实仓库，保留 upstream 可放入 README 的 fork attribution；若确实要指向 upstream，应在包 README 明确 BankofAI fork 与 upstream 的关系。

### C-06 中：HTTP adapter README 仍使用 Solana/SVM 示例

当前 HTTP adapter 本身是链无关的，允许任意 `Network` 字符串；但用户面示例把不存在的 SVM 机制写成可用支付方案：

- `typescript/packages/http/fetch/README.md:59-60` 示例说明包含 `solana:mainnet`、`ExactSvmScheme`。
- `typescript/packages/http/fetch/README.md:124-160` 导入 `@bankofai/x402-svm` 并注册 `solana:*`。
- `typescript/packages/http/axios/README.md:124-160` 同类 SVM 示例。
- `typescript/packages/http/hono/README.md:219-229`、`typescript/packages/http/fastify/README.md:219-229` 使用 Solana payment requirement 与 `ExactSvmScheme`。
- `typescript/packages/http/next/README.md:165-171` 导入并注册 `registerExactSvmScheme`。

影响：HTTP 包的核心功能可能没问题，但 README 的多链示例会误导集成路径。

建议：把示例替换成 EVM + TRON，或保留抽象说明“可注册任何实现了 scheme interface 的机制”，但不要引用本仓库不存在的 `@bankofai/x402-svm`。

### C-07 中：TypeScript 贡献指南落后于当前目录结构

`typescript/CONTRIBUTING.md` 的目录结构和新增功能说明仍包含当前不存在的 `packages/mechanisms/svm`、`packages/http/paywall`，并把 `packages/site` 作为当前 TypeScript 结构的一部分。

影响：新贡献者按该文档创建机制包、测试变量或 paywall 改动时，会和实际 workspace 不匹配。

建议：用 `find typescript/packages -maxdepth 3 -type d` 的当前目录树重写结构图；测试变量部分改为 EVM/TRON/GasFree/batch-settlement 示例；删除 `Paywall Changes` 或改为 custom provider/fallback paywall。

### C-08 低：Solana 在扩展包中既有真实能力也有过时支付示例，需要分层说明

`typescript/packages/extensions/src/sign-in-with-x` 源码和 README 支持 Solana/Ed25519 认证，这是扩展认证能力，不等同于当前支付机制支持 SVM。该部分可以保留。

但 `typescript/packages/extensions/src/offer-receipt/README.md:104-123` 把 offer-receipt 客户端示例写成 `registerExactEvmScheme` + `registerExactSvmScheme`，其中 SVM 支付机制当前不存在。

影响：读者可能把“SIWX 支持 Solana 认证”理解为“当前 SDK 支持 Solana 支付”。

建议：在扩展文档中明确区分认证链支持和支付机制包支持；offer-receipt 示例改为 EVM + TRON 或 EVM-only。

### C-09 低：legacy 文档中的旧能力需要更明显的边界

`typescript/packages/legacy/*` 中出现 Solana/paywall 是历史包能力的一部分，不能按当前包缺失直接判错。问题在于全库搜索或用户从旧 README 进入时，未必能马上识别它是 deprecated/legacy。

建议：在 legacy 根 README 或每个 legacy 包 README 顶部加统一醒目声明：仅供历史参考，不代表当前 `@bankofai/x402-*` TypeScript SDK 的支持矩阵。

## 正向一致点

- 根 `README.md` 与 `examples/typescript/README.md` 对当前 EVM/TRON、BSC/TRON Nile、GasFree、upto、batch-settlement 的叙事基本一致。
- `typescript/README.md` 的包矩阵没有列出已缺失的 `svm/avm/stellar/aptos/paywall` 当前包。
- `typescript/packages/mechanisms/tron/README.md` 对 TRON Permit2、GasFree、地址规范化、receipt polling 等实现细节描述较贴近源码。
- examples 文档整体已经按 EVM + TRON 重写，是后续修正包级 README 的可复用来源。

## 修复优先级

### P0：先修会导致复制粘贴失败的文档

- 改 `typescript/packages/mechanisms/evm/README.md`：删除 `ExactEvmClient/Facilitator/Server` 旧命名，替换为当前 `ExactEvmScheme` 等导出。
- 改 HTTP adapter README：删除 `@bankofai/x402-svm` 示例，替换为 EVM + TRON 或抽象机制示例。
- 改 paywall 文档：决定 `@bankofai/x402-paywall` 是恢复、外部依赖还是移除描述。

### P1：统一支持矩阵

- 以根 `README.md` 的 TRON/BSC + scheme 表为准，回写到 `typescript/README.md`、core README、EVM/TRON README、CONTRIBUTING。
- 删除当前包文档中未实现的 `svm/avm/stellar/aptos` 机制引用，或全部改成 “future/legacy/external”。

### P2：统一包元数据

- 为所有 `package.json` 统一 `description` 风格。
- 确认 `author` 和 `repository` 是否应指向 BankofAI 当前仓库；如保留 upstream，增加 fork attribution 说明。

### P3：增加一致性守卫

- 在 CI 加文档 lint 脚本，禁止用户面文档出现未 allowlist 的 `@bankofai/x402-svm`、`@bankofai/x402-avm`、`@bankofai/x402-stellar`、`@bankofai/x402-aptos`、`@bankofai/x402-paywall`。
- 对包 README 示例做轻量 import smoke check，至少验证导入路径能被当前 package exports 解析。
- 为 legacy 文档建立 allowlist，避免把历史包说明误报为当前支持矩阵。

## 建议的单一事实来源

建议把当前支持矩阵集中维护在一个文档片段或脚本生成数据中，至少包括：

| 维度 | 当前事实 |
| --- | --- |
| 当前 SDK 形态 | TypeScript-only pnpm/turbo monorepo |
| 当前包命名 | granular `@bankofai/x402-*`，无 umbrella package |
| 当前支付机制包 | `@bankofai/x402-evm`、`@bankofai/x402-tron` |
| 当前网络叙事 | BSC/EVM 与 TRON |
| 当前核心 scheme | `exact`、`upto`、`batch-settlement` |
| EVM-only | `auth-capture` |
| TRON-only | `exact_gasfree` |
| 当前 HTTP adapters | axios、express、fastify、fetch、hono、next、mcp |
| 非当前机制 | SVM/Solana payment、AVM、Stellar、Aptos |
| paywall 状态 | 需产品决策：恢复包、外部包或仅保留 fallback/custom provider |

## 风险说明

本次为静态一致性检查，未运行完整构建和测试。结论基于当前文件树、package metadata、README 和源码导出对照。若 `@bankofai/x402-paywall` 或 SVM 等包计划通过外部仓库/私有 npm 发布，当前仓库文档仍需要显式说明外部来源，否则从本仓库视角仍属于描述不一致。
