# TypeScript 资产处理安全性与正确性审计报告

审计日期：2026-07-02

审计范围：依据 `docs/typescript-vs-typescript-new-audit-scope.md`，对比 `commit:9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new` 与当前分支 `HEAD:typescript`。本报告只聚焦资产处理相关的安全性和正确性：金额精度、asset/token 识别、decimals、payTo/receiver、fee、allowance、settlement override、EVM/TRON 机制及 HTTP/MCP 透传边界。

## 总体结论

当前版本相对 `typescript_new` 的资产处理风险主要集中在 TRON 新增/扩展实现：TRON token registry、GasFree、upto、batch settlement、Permit2 路径显著扩大了资产处理面。正向变化是新增了多 token registry、TRON fee 层、GasFree provider 校验、upto facilitator witness 绑定、batch channel token/receiver 校验。主要问题是部分路径没有复用 core/EVM 已有的严格金额转换和地址校验，导致小额金额、非默认资产、malformed fee、overpayment 等边界行为不一致。

最高优先级问题：

1. TRON exact/upto 默认 money 转换使用 `parseFloat`，对科学计数法和小于最小单位的金额会生成非法 amount 字符串或静默错误。
2. TRON GasFree verify 允许 payload `value > requirements.amount`，与 exact 语义不一致，可能造成用户签名金额高于报价时仍被结算。
3. 直接传入 `AssetAmount` 时，TRON 新实现只检查 asset 存在，不验证 amount 是正整数字符串，也不验证 asset/payTo 是合法 TRON 地址；这是相对旧 `typescript_new` TRON exact server 的校验回退。

## 发现 1：TRON exact/upto 默认金额转换会在小额输入上生成非法 amount

严重级别：High

迁移状态：当前 TRON 新实现引入/放大。旧 `typescript_new` TRON exact server 使用 core `convertToTokenAmount(numberToDecimalString(...))`，当前 exact/upto 改成了本地 `parseFloat` 转换。

代码位置：

- `typescript/packages/mechanisms/tron/src/exact/server/scheme.ts:197` 默认 money 转换。
- `typescript/packages/mechanisms/tron/src/exact/server/scheme.ts:229` 本地 `convertToTokenAmount`。
- `typescript/packages/mechanisms/tron/src/upto/server/scheme.ts:164` 默认 money 转换。
- `typescript/packages/mechanisms/tron/src/upto/server/scheme.ts:184` 本地 `convertToTokenAmount`。
- 对照：`typescript/packages/core/src/utils/index.ts:12`、`typescript/packages/core/src/utils/index.ts:64` 已提供 `numberToDecimalString` 和严格 `convertToTokenAmount`。
- 对照：EVM exact server 仍使用 core 转换：`typescript/packages/mechanisms/evm/src/exact/server/scheme.ts:148`。

运行路径：

1. 服务端配置 TRON exact/upto route，价格使用 money 格式，例如 `"$0.0000001"`。
2. `parseMoneyString` 返回 JavaScript number `1e-7`。
3. 当前 TRON exact/upto 调用 `amount.toString()`，得到 `"1e-7"`。
4. 本地 `convertToTokenAmount` 对 `"1e-7"` 执行 `parseFloat`，再 `String(amount).split(".")`。
5. 对 6 decimals token，结果会拼出类似 `"1e-7000000"` 的非十进制 amount 字符串，而不是抛出“too small”。
6. 后续 `BigInt(requirements.amount)`、签名、verify 或 settle 才会失败，失败点远离价格解析。

影响：

这会破坏 `PaymentRequirements.amount` 的核心不变量：amount 应该是最小单位的非负整数字符串。轻则 402 响应给出不可支付报价，重则在中间件 verify/settle 阶段抛出非预期异常。对于超小金额，EVM 已有测试要求抛出 too small；TRON exact/upto 缺少同等保护。

现有覆盖：

- TRON token registry 的显式 token 价格 `"0.000001 USDT"` 有测试：`typescript/packages/mechanisms/tron/test/unit/tokens.test.ts:95`。
- EVM 小额边界有测试：`typescript/packages/mechanisms/evm/test/unit/server.moneyParser.test.ts:146`。
- 未看到 TRON exact/upto 默认 money 路径对 `"$0.0000001"`、`0.0000001`、科学计数法输出的测试。

建议修复：

TRON exact/upto 默认 money 转换应删除本地实现，复用 core：

```ts
convertToTokenAmount(numberToDecimalString(amount), assetInfo.decimals)
```

同时补充测试：

- `new ExactTronScheme().parsePrice("$0.0000001", "tron:nile")` 应抛出 too small。
- `new UptoTronScheme().parsePrice(0.0000001, "tron:nile")` 应抛出 too small。
- 对 18 decimals token 或显式 `"0.000000000000000001 USDD"` 保持正确转换。

## 发现 2：TRON GasFree 允许签名 value 大于 requirements.amount

严重级别：High

迁移状态：当前新增 GasFree 路径引入。

代码位置：

- `typescript/packages/mechanisms/tron/src/gasfree/facilitator/scheme.ts:222` `validateTerms`。
- `typescript/packages/mechanisms/tron/src/gasfree/facilitator/scheme.ts:235` 只判断 `BigInt(m.value) < BigInt(requirements.amount)`。
- 对照：TRON EIP3009 exact 要求 equality：`typescript/packages/mechanisms/tron/src/exact/facilitator/eip3009.ts:86`。
- 对照：TRON Permit2 exact 要求 equality：`typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts:79`。

运行路径：

1. 客户端或外部构造一个合法 GasFree payload，`gasfree.value` 大于 `requirements.amount`。
2. `verifySignature` 对该更大 value 的签名验证通过。
3. `validateTerms` 只拒绝小于报价的 value，大于报价会通过。
4. `settle` 将原始 GasFree message 提交给 relayer：`typescript/packages/mechanisms/tron/src/gasfree/facilitator/scheme.ts:166`。
5. relayer按签名 message 中的 `value` 扣款/转账，而不是 `requirements.amount`。

影响：

`exact_gasfree` 命名和其它 exact 路径的语义都暗示必须精确匹配报价金额。当前实现允许 overpayment：用户签名金额高于服务端报价时，facilitator 仍会接受并结算。虽然攻击者不能凭空提高用户已签名金额，但这是支付安全边界：SDK/钱包/中间层 bug 或恶意服务端重放更高报价 payload 时，facilitator 不会保护用户免于超额支付。

现有覆盖：

- `typescript/packages/mechanisms/tron/test/unit/flow-integration.test.ts:204` 覆盖 tampered amount 后签名失效。
- 未覆盖“用户真实签名了更大 value，requirements.amount 较小”的有效签名 overpayment 场景。

建议修复：

把 GasFree amount 校验改为 equality：

```ts
if (BigInt(m.value) !== BigInt(requirements.amount)) {
  return errors.AMOUNT_MISMATCH;
}
```

如果业务确实需要“至少支付”语义，应改 scheme 名称或新增 `upto_gasfree`/`min_gasfree`，不要让 exact 路径接受超额。

## 发现 3：TRON 直接 AssetAmount 路径缺少 amount 和地址格式校验

严重级别：Medium-High

迁移状态：当前 TRON 新实现相对旧实现回退。旧 `typescript_new` TRON exact server 对 `AssetAmount.asset` 调用 `isValidTronAddress`，当前 exact/upto/gasfree/batch 多数只检查 asset 存在。

代码位置：

- `typescript/packages/mechanisms/tron/src/exact/server/scheme.ts:56` 直接 AssetAmount 路径。
- `typescript/packages/mechanisms/tron/src/upto/server/scheme.ts:44` 直接 AssetAmount 路径。
- `typescript/packages/mechanisms/tron/src/gasfree/server/scheme.ts:34` 直接 AssetAmount 路径。
- `typescript/packages/mechanisms/tron/src/batch-settlement/server/scheme.ts:234` 直接 AssetAmount 路径。
- TRON 地址工具只做宽松判断：`typescript/packages/mechanisms/tron/src/utils.ts:89`、`typescript/packages/mechanisms/tron/src/utils.ts:99`。

运行路径：

1. 应用直接配置 `{ amount, asset, extra }` 作为 price。
2. 当前 server scheme 只检查 `asset` 非空，直接返回。
3. `amount` 可以是 `"abc"`、`"-1"`、`"1.2"`、`"1e6"`；`asset` 可以是长度错误的 `"T..."` 或短 `0x`。
4. 后续 client/facilitator 在 `BigInt(amount)`、`normalizeAddressForSigning(asset)`、contract read/write 时才失败。

影响：

这不是直接盗资漏洞，但会造成报价阶段不稳定、错误延迟、adapter 错误响应不一致。更重要的是，它破坏了资产处理边界：PaymentRequirements 应在生成时保证 amount 是十进制整数、asset/payTo 是目标链合法地址，而不是把校验推迟到签名/结算层。

建议修复：

新增 TRON asset guard，并在所有 TRON server scheme 的 AssetAmount 分支复用：

- `amount` 必须匹配 `^[0-9]+$`，建议大于 0，除非明确允许 0。
- `asset` 必须是合法 Base58Check TRON 地址或合法 `41`/`0x` 地址，且长度正确。
- `payTo` 在 PaymentRequirements 组装后也应按同样规则校验。
- `extra.assetTransferMethod` 只能是 `"permit2"` 或 `"eip3009"`。

同时恢复旧实现中的网络支持校验语义：未知 TRON network 应在 parse/enhance 阶段失败，而不是等到 chain id 或 address 常量查找时失败。

## 发现 4：EVM settlement override 的 dollar 格式对非默认 asset 使用错误 decimals

严重级别：Medium

迁移状态：继承自 `typescript_new`，但仍属于当前审计范围，且与新增 `Settlement-Overrides` 使用面相关。

代码位置：

- core 解析 dollar override：`typescript/packages/core/src/server/x402ResourceServer.ts:222`。
- resource server 调用 scheme decimals provider：`typescript/packages/core/src/server/x402ResourceServer.ts:1074`。
- EVM exact `getAssetDecimals` 忽略 asset：`typescript/packages/mechanisms/evm/src/exact/server/scheme.ts:52`。
- TRON 对照实现按 asset 地址查 registry：`typescript/packages/mechanisms/tron/src/exact/server/scheme.ts:169`。

运行路径：

1. EVM route 使用 custom money parser 或直接 AssetAmount，asset 是非默认 token，decimals 与默认稳定币不同。
2. handler 设置 settlement override，例如 `{ amount: "$0.05" }`。
3. core 调用 EVM `getAssetDecimals(asset, network)`。
4. EVM 实现忽略传入 asset，只返回该 network 默认 stablecoin decimals。
5. override amount 被换算成错误最小单位。

影响：

对于 `upto` 或 partial settlement，非默认资产可能被按错误 decimals 结算。若默认 token 是 6 decimals，而实际 asset 是 18 decimals，`"$0.05"` 会变成 `50000` 而不是 `50000000000000000`，导致少收；反向也可能多收。当前 core 注释声明 “decimals are determined from registered scheme's getAssetDecimals”，但 EVM 实现不满足“按 asset”语义。

建议修复：

EVM 应引入与 TRON 类似的 asset registry，或允许 custom parser 返回 `extra.decimals` 并让 `getAssetDecimals(asset, network)` 优先读取 route/requirement asset metadata。至少应在 EVM 文档中说明：dollar-format settlement override 只适用于默认 asset；非默认 asset 必须使用 raw atomic amount 或 percent。

## 发现 5：core settlement override 金额解析缺少资产安全上界校验

严重级别：Medium

迁移状态：继承自 `typescript_new`，当前仍存在。

代码位置：

- `typescript/packages/core/src/server/x402ResourceServer.ts:208` `resolveSettlementOverrideAmount`。
- `typescript/packages/core/src/server/x402ResourceServer.ts:214` percent 无 100% 上界。
- `typescript/packages/core/src/server/x402ResourceServer.ts:223` dollar 使用 `parseFloat` 和 `10 ** decimals`。
- `typescript/packages/core/src/server/x402ResourceServer.ts:229` raw amount 原样返回。

资产处理问题：

1. `"1000%"` 会转换为 10 倍授权金额，依赖下游 scheme 拦截。
2. `"$999999999999999999999"` 使用 JS number，存在精度损失。
3. `"abc"`、`"1e6"`、`"-1"` 作为 raw amount 会原样进入后续流程。
4. malformed `Settlement-Overrides` header 当前被忽略并回退原始金额，已在异常审计中单独记录。

影响：

对 `upto` partial settlement，core 层应保证 “实际结算金额 <= 授权最大金额” 和 “实际金额是合法原子单位整数”。当前这些不变量分散在 scheme/facilitator 层，新增 scheme 容易漏校验。

建议修复：

在 core 解析后统一校验：

- resolved amount 必须匹配 `^[0-9]+$`。
- `BigInt(resolved) <= BigInt(requirements.amount)`。
- percent 限制 `0%` 到 `100%`。
- dollar 转换改为十进制字符串算法，不使用 `parseFloat`。

## 发现 6：TRON token registry 的运行时注册与 decimals fallback 可能导致错误资产定价

严重级别：Medium

迁移状态：当前新增 token registry 能力引入。

代码位置：

- `typescript/packages/mechanisms/tron/src/shared/tokens.ts:148` `registerToken`。
- `typescript/packages/mechanisms/tron/src/shared/tokens.ts:162` unknown asset decimals fallback 到 6。
- `typescript/packages/mechanisms/tron/src/shared/tokenSelection.ts:29` selection 使用 `getDecimals`。

问题说明：

`registerToken` 是公开可调用的全局可变 registry，但没有校验：

- address 是否为合法 TRON 地址。
- decimals 是否是安全整数且在合理范围内。
- symbol 是否为空、是否覆盖内置 token。
- `assetTransferMethod` 是否与网络上的 Permit2/TransferWithAuthorization 能力一致。

同时，unknown asset 的 decimals fallback 为 6。这个 fallback 被用于 settlement override dollar 换算和 token selection。如果传入的是 18 decimals 的未知资产，系统会按 6 decimals 估值。

影响：

在单进程服务里，错误或恶意的 runtime registration 会影响同 network/symbol 的所有后续报价。对多租户服务，这属于全局状态污染。fallback 6 对 USDT/USDC 友好，但对多 token registry 会造成错误价格比较或 partial settlement 换算。

建议修复：

1. `registerToken` 做严格 schema 校验，并可选禁止覆盖内置 token。
2. unknown asset 的 `getDecimals` 在安全路径上应返回 `undefined` 或抛错；只有 UI display 可 fallback 6。
3. `CheapestTokenSelectionStrategy` 遇到 unknown asset 应降级到保守策略，而不是按 6 decimals 参与比较。

## 发现 7：TRON token selection 使用 Number 归一化，极大金额存在精度风险

严重级别：Low-Medium

迁移状态：当前新增 token selection 能力引入。

代码位置：

- `typescript/packages/mechanisms/tron/src/shared/tokenSelection.ts:29` `normalizedCost`。
- `typescript/packages/mechanisms/tron/src/shared/tokenSelection.ts:46` cheapest selection。

问题说明：

`normalizedCost` 将 `BigInt(req.amount)` 转为 `Number` 后除以 `10 ** decimals`。当 amount 超过 `Number.MAX_SAFE_INTEGER`，比较可能丢精度；极大金额还可能变为 `Infinity`。对于 18 decimals token，正常业务金额很容易超过 `MAX_SAFE_INTEGER` 的原子单位。

影响：

两个 token 价格非常接近或金额非常大时，cheapest selector 可能选错资产。由于 selector 面向用户付款选择，这属于正确性风险，通常不是直接安全漏洞。

建议修复：

使用 BigInt 有理数比较，避免浮点：

```ts
// 比较 a.amount / 10^aDecimals < b.amount / 10^bDecimals
BigInt(a.amount) * 10n ** BigInt(bDecimals) < BigInt(b.amount) * 10n ** BigInt(aDecimals)
```

并对 malformed amount 捕获错误，避免 selector 抛出影响整个支付流程。

## 发现 8：fee 配置和 fee extra 的 BigInt 解析缺少防护

严重级别：Low-Medium

迁移状态：当前 TRON fee 层新增。

代码位置：

- `typescript/packages/mechanisms/tron/src/shared/fee.ts:62` `resolveBaseFee`。
- `typescript/packages/mechanisms/tron/src/shared/fee.ts:135` `validateFee`。
- `typescript/packages/mechanisms/tron/src/shared/balance.ts:49` affordability 计算。
- `typescript/packages/mechanisms/tron/src/gasfree/client/scheme.ts:243` `computeMaxFee`。

问题说明：

fee 配置和 `extra.fee.feeAmount` 只要求是 string，但多个位置直接 `BigInt(...)`。如果配置为 `"1.5"`、`"abc"`、`"-1"`、`"1e6"`，会抛异常或产生负数语义。部分路径未 catch，会让支付选择、payload 创建或 facilitator verify 以通用异常失败。

影响：

这是配置/输入健壮性问题。对 GasFree，fee 是实际扣款上限的重要字段；对 affordability selection，malformed fee 可能让客户端无法选择任何支付方式或崩溃。

建议修复：

新增 `parseAtomicAmount(label, value)`：

- 只接受 `^[0-9]+$`。
- 根据业务要求拒绝 0 或允许 0。
- 对 malformed fee 返回结构化错误，而不是裸 `BigInt` 异常。

## 已确认的正向资产处理

1. TRON token registry 显式 `"<amount> <symbol>"` 路径使用 BigInt-safe 字符串转换，并拒绝小数位超出 token decimals：`typescript/packages/mechanisms/tron/src/shared/tokens.ts:198`。
2. TRON exact EIP3009 校验 token、payTo、amount equality、deadline 和 signature：`typescript/packages/mechanisms/tron/src/exact/facilitator/eip3009.ts:71`、`typescript/packages/mechanisms/tron/src/exact/facilitator/eip3009.ts:86`。
3. TRON exact Permit2 校验 spender、token、recipient、amount equality 和 signature：`typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts:55`、`typescript/packages/mechanisms/tron/src/exact/facilitator/permit2.ts:78`。
4. TRON upto Permit2 witness 绑定 facilitator，settle 时拒绝超过授权上限：`typescript/packages/mechanisms/tron/src/upto/facilitator/permit2.ts:71`、`typescript/packages/mechanisms/tron/src/upto/facilitator/permit2.ts:223`。
5. TRON GasFree 校验 token、receiver、fee provider、deadline、signature，并在 settle 前做余额 preflight：`typescript/packages/mechanisms/tron/src/gasfree/facilitator/scheme.ts:229`、`typescript/packages/mechanisms/tron/src/gasfree/facilitator/scheme.ts:242`、`typescript/packages/mechanisms/tron/src/gasfree/facilitator/scheme.ts:251`。
6. TRON batch settlement 校验 channel receiver、receiverAuthorizer、token 与 payment requirements 一致：`typescript/packages/mechanisms/tron/src/batch-settlement/facilitator/utils.ts:180`。
7. EVM default asset money 转换已覆盖 sub-micro 18 decimals 与 too-small 6 decimals 测试：`typescript/packages/mechanisms/evm/test/unit/server.moneyParser.test.ts:146`。

## 建议优先级

P0：

1. TRON exact/upto 默认 money 转换复用 core `numberToDecimalString` + `convertToTokenAmount`。
2. TRON GasFree amount 校验从 `>=` 改为 `===`。
3. TRON 所有 server scheme 的 AssetAmount 分支增加 amount/address/network 校验。

P1：

1. core settlement override 增加 resolved amount 上界和格式校验。
2. EVM `getAssetDecimals(asset, network)` 支持非默认 asset，或禁止 dollar override 用于非默认 asset。
3. TRON fee amount 和 baseFee 增加 atomic amount parser。

P2：

1. TRON token registry `registerToken` 增加 schema 校验和覆盖策略。
2. TRON token selection 改用 BigInt 有理数比较。
3. unknown asset decimals fallback 从 settlement/selection 安全路径移除。

## 建议补充测试

1. TRON exact/upto：`"$0.0000001"`、`0.0000001` 对 6 decimals 默认 USDT 应抛出 too small，不能生成 `1e-*` amount。
2. TRON exact/upto：直接 AssetAmount 的 `amount: "abc"`、`amount: "-1"`、`asset: "TBad"` 应在 parse/enhance 阶段失败。
3. TRON GasFree：合法签名但 `gasfree.value > requirements.amount` 应被拒绝为 amount mismatch。
4. EVM settlement override：非默认 18 decimals asset 使用 `"$0.05"` 时应按 asset decimals 换算，或显式拒绝。
5. TRON token selection：超过 `Number.MAX_SAFE_INTEGER` 的 18 decimals amount 比较应仍选择正确资产。
6. TRON fee：`feeAmount: "abc"`、`baseFee: { USDT: "1.5" }` 应返回结构化错误。

## 验证说明

本次为静态代码审计，未运行完整测试套件。当前环境中未发现可用 `pnpm` 命令，因此没有执行 monorepo build/test。结论基于当前分支源码、既有测试和 `9c172bb29aca9aafc6da4b971183d9daee5f8698:typescript_new` 对应文件的静态对比。
