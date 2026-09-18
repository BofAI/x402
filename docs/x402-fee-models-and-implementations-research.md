# x402 收费模式与现有实现调研

> 状态：Research
>
> 查询日期：2026-08-28
>
> 协议基线：x402 v2
>
> 文档性质：业界现状调研，不包含本项目方案设计

## 1. 调研结论

截至查询日期，x402 生态中已经存在的收费和分账商业模型可以分为三类：

1. **链下 Facilitator 服务计费**：Facilitator 在 x402 资源付款之外，按链上交易、成功 settlement、预付额度或套餐配额向使用其服务的项目收费。CDP、PayAI、x402facilitator.dev 和 x402Facilitator.ai 属于此类。
2. **链上 Facilitator Fee**：买方签名授权的总额同时包含资源款和 Facilitator Fee，结算合约从总额中累计费用并将净额转给商户。Nuwa x402x 属于此类。
3. **链上资源收入分润**：买方支付的是资源价格，收款地址为 Split 合约，资源收入再按比例分给商户和 Affiliate/Builder。x402aff 属于此类；它不是 Facilitator 服务收费。

x402 v2 Core 没有标准化 `serviceFee`、`facilitatorFee` 或 `feeRecipient`。Core 只定义通用的 `PaymentRequirements.extra` 和协议扩展容器；如果收费改变链上资金去向，必须由具体 Scheme 或外部合约实现，不能仅靠增加一个元数据字段完成。[x402 v2 Specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)

在所检查的官方规范和公开实现中，商业 Facilitator 最常见的收费方式仍是**链下账户、Credit、预付余额或订阅配额**。链上 Facilitator Fee 和资源收入分润已经有公开代码与部署，但属于社区扩展，不是 x402 官方标准，也不能互相等同。

## 2. 调研范围与证据口径

本调研收录以下内容：

- x402 Foundation 或 Coinbase 官方文档明确说明的 Facilitator 收费和协议边界；
- 已经公开定价并提供服务入口的 Facilitator；
- 已经公开源代码、集成说明或合约部署信息的链上 Facilitator Fee 或资源收入分润实现。

以下内容不作为本调研的收费模式：

- `exact`、`upto` 和 `batch-settlement` 对资源价格的表达与结算；
- Gas、Energy、带宽、Paymaster 或 Relayer 的网络资源费用；
- 本项目正在讨论的 TRON Fee Proxy、Permit2 双收款或 Batch 双累计账本；
- 只有概念说明、没有公开实现证据的方案。

证据等级如下：

| 等级 | 含义 |
| --- | --- |
| A：官方 | x402 Foundation、Coinbase 或服务提供方的当前官方规范、文档和定价页 |
| B：公开实现 | 有源代码、合约、测试或集成说明的社区项目，但不是 x402 官方标准 |
| C：公开商业页面 | 有公开价格和服务入口，但未在本调研中独立验证其交易量、可用性或安全审计状态 |

## 3. 商业模型分类与现有实现总览

### 3.1 一级分类：费用性质与资金来源

| 一级商业模型 | 费用或收入来源 | 与买方 x402 支付的关系 | 对买方支付总额的含义 | 商业关系 | 代表案例 |
| --- | --- | --- | --- | --- | --- |
| 链下 Facilitator 服务计费 | 使用 Facilitator 产生的用量、Credit 或套餐额度 | 位于资源付款之外；标准 Scheme 仍将资源款全额发送给 `payTo` | x402 Payload 中不增加 Facilitator Fee；资源服务方另行承担基础设施费用 | 资源服务方购买 Facilitator 基础设施服务 | Coinbase CDP、PayAI、x402facilitator.dev、x402Facilitator.ai |
| 链上 Facilitator Fee | 买方授权总额中的独立 Fee 部分 | Router 从签名总额中累计 Fee、转出商户净额 | 商户净额固定时，买方总额为“资源净额 + Fee” | Facilitator 因执行 settlement 获得费用 | Nuwa x402x |
| 链上资源收入分润 | 买方支付的资源价格 | 资源款进入 Split 后按比例分配 | 不额外增加买方总额，而是在既定资源价格内分配收入 | 商户与 Affiliate/Builder 分享销售收入 | x402aff |

这三类不能只按“链上/链下”合并判断：前两类都是 Facilitator 的商业收费，但费用分别位于链下账户系统和链上结算路径；第三类虽然也在链上分配资金，却是资源收入分润，不是 Facilitator Fee。

### 3.2 二级分类：具体计价和扣费方式

| 一级商业模型 | 二级模式 | 计价或分配单位 | 收费与结算实现 | 代表案例 | 证据等级 |
| --- | --- | --- | --- | --- | --- |
| 链下 Facilitator 服务计费 | 用量计费 | Facilitator 产生的一次链上交易 | CDP Project 内部记录可计费用量；具体收款流程未公开 | Coinbase CDP | A |
| 链下 Facilitator 服务计费 | 预付 Credit | 一次 settled transaction | 商户充值 Credit，结算成功后扣减 | PayAI | A |
| 链下 Facilitator 服务计费 | 预付 USDC 余额 | 一次 settle | 先充值服务余额，再按 settle 扣费 | x402facilitator.dev | C |
| 链下 Facilitator 服务计费 | 订阅套餐配额 | 月费包含一定成功交易额度 | 订阅套餐，不从每笔资源付款中拆费 | x402Facilitator.ai | C |
| 链上 Facilitator Fee | Router Fee | 一次即时支付 | Settlement Router 拉取总额、累计 Fee、Hook 转净额 | Nuwa x402x | B |
| 链上资源收入分润 | Split 分润 | 进入 Split 地址的资源付款 | 标准 x402 支付到 0xSplits，之后 permissionless distribute | x402aff | B |

### 3.3 实现公开程度

“已有收费模式”不等于“收费系统源代码已公开”。各案例能够验证到的实现层级如下：

| 案例 | 公开接入接口 | 公开收费账本实现 | 公开链上合约 | 可复现程度 |
| --- | --- | --- | --- | --- |
| Coinbase CDP | SDK、`/verify`、`/settle` | 否 | 使用标准 Scheme 合约或 Token 方法 | 可复现接入，不能复现 CDP 内部计费 |
| PayAI | SDK、REST、Ed25519 JWT 认证 | 否 | 使用标准 Scheme 合约或 Token 方法 | 可复现接入和认证，不能复现 Credit 扣减服务 |
| x402facilitator.dev | 公开产品 API 名称和专属 Facilitator URL | 否 | 未披露 | 只能验证外部产品流程 |
| x402Facilitator.ai | 账户、API Key、Receipt、套餐页面 | 否 | 页面声明本地 Base 结算，未公开代码 | 只能验证外部产品流程 |
| Nuwa x402x | TypeScript SDK、Facilitator、REST | 是，Solidity `pendingFees` | 是，`SettlementRouter`、`TransferHook` | 合约和结算路径可复现 |
| x402aff | Python/TypeScript SDK、集成脚本 | 分润由 0xSplits 合约记录 | 使用现有 0xSplits PushSplit | 路由、地址推导和 distribute 可复现 |

### 3.4 当前市场活跃度

市场活跃度与前述证据等级、实现公开度不是同一个指标：证据等级回答“收费模式是否有可靠资料”，实现公开度回答“能否复现”，市场活跃度则回答“当前是否存在持续、具有一定参与广度的实际使用”。本节优先观察近期链上结算数、独立买方和卖方、生产部署及近期产品活动；网站仍可访问、合约已经部署、套餐包含多少额度或 GitHub 提交数，均不能单独证明市场采用。

截至 2026-08-28，文档所收录案例的综合活跃度排序为：

| 排名 | 案例 | 活跃度判断 | 可验证的当前信号 | 判断限制 |
| ---: | --- | --- | --- | --- |
| 1 | Coinbase CDP | 高 | 第三方链上统计快照显示，最近 24 小时约有 134,098 笔 settlement、1,473 个买方和 417 个卖方；Coinbase 当前仍将 CDP 列为推荐的主网 Facilitator | 公开统计会随查询时间变化，且链上笔数不能直接等同于真实终端用户数 |
| 2 | PayAI | 中高 | 同一统计快照显示，最近 24 小时约有 1,639 笔 settlement、81 个买方和 51 个卖方；Facilitator、Merchant Portal、SDK 和多网络接入仍在维护 | 统计页将其中较高比例标记为疑似 wash activity，该分类来自第三方，本调研未独立验证 |
| 3 | Nuwa x402x | 中，交易集中 | Base `SettlementRouter` 在查询时仍有持续调用；Blockscout 记录约 372,866 笔累计合约交易。对最近 50 笔调用的快照抽样涉及 3 个 Router 调用者、6 个付款地址和 7 个最终 `payTo` | 大量调用集中在少数地址和重复的小额模式，不能把累计调用量解释为同等数量的商户、客户或自然交易 |
| 4 | x402aff | 低，早期 | Python/TypeScript 包、公开仓库和 MiroShark 线上分润页面仍在运行，已经存在至少一个公开的商户接入页面 | 没有公开累计付款数、独立商户数、Affiliate 数或分润金额，现阶段主要是单一项目落地和实现参考 |
| 5（并列） | x402Facilitator.ai | 未知 | 账户注册、套餐页面和 Base 实付测试入口仍在线 | 免费或付费套餐额度只是产品上限，不是实际成交量；没有公开客户数、settlement 数或收入 |
| 5（并列） | x402facilitator.dev | 未知 | 充值、余额查询和专属 Facilitator URL 产品入口仍在线 | 没有公开商户数、充值余额、settlement 数或收入，且底层交易通过 CDP 结算，公开链上统计难以单独归因 |

## 4. 链下 Facilitator 商业计费

### 4.1 Coinbase CDP：按链上交易计费

CDP Facilitator 当前公开价格为：

- 每月前 1,000 笔 Facilitator 链上交易免费；
- 超出后每笔链上交易收费 `$0.001`；
- `/verify` 免费；
- `exact` 和 `upto` 的每次 accepted payment 通常对应一笔链上交易；
- `batch-settlement` 的 Voucher 在链下免费验证，多笔 Voucher 可以合并 claim；
- Deposit、Refund、Withdrawal 等 Channel 操作各自计为一笔链上交易。

CDP 明确按照 **onchain activity** 而不是 HTTP payment request 数量计费。[CDP Facilitator Pricing](https://docs.cdp.coinbase.com/x402/seller/facilitator)

该费用按 CDP Project/API Key 关联的 Facilitator 用量计量，没有从每笔 x402 Token 付款中链上拆出。CDP 在 2026 年 1 月正式启用计费，但 x402 专属文档没有公开账单生成、支付方式、扣款周期和欠费处理流程。[CDP Changelog](https://docs.cdp.coinbase.com/get-started/changelog)

#### 4.1.1 公开的接入实现

CDP SDK 将托管 Facilitator 封装成标准 x402 Facilitator Client。Coinbase 当前示例使用以下组件组合：

```ts
const facilitator = createCdpFacilitatorClient();
const resourceServer = new x402ResourceServer(facilitator);

resourceServer.register(
  "eip155:8453",
  new ExactEvmScheme(),
);
```

资源服务端仍执行标准 x402 流程：

```text
收到 PAYMENT-SIGNATURE
        |
        |-- POST /platform/v2/x402/verify
        |
业务执行成功
        |
        `-- POST /platform/v2/x402/settle
                    |
                    `-- CDP 广播并确认链上交易
```

`/verify` 和 `/settle` 使用相同的外层请求结构：

```json
{
  "x402Version": 2,
  "paymentPayload": { "...": "..." },
  "paymentRequirements": { "...": "..." }
}
```

直接调用 REST API 时，请求发送到 `https://api.cdp.coinbase.com/platform/v2/x402/verify` 或 `/settle`，并携带 CDP Bearer Token；使用 SDK 时，`createCdpFacilitatorClient()` 处理该接入。[CDP TypeScript x402 Examples](https://github.com/coinbase/cdp-sdk/blob/main/examples/typescript/x402/README.md)；[CDP Settle API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/settle-payment)

#### 4.1.2 收费计量如何落到实现

CDP 对外公开的是计量规则，不是收费账本代码：

| 操作 | 是否计入 Facilitator 用量 |
| --- | --- |
| `/verify` | 否 |
| `exact` / `upto` 成功链上 settlement | 是，每笔链上交易一次 |
| Batch Voucher 链下验证 | 否 |
| Batch claim | 是，按 claim 链上交易数，不按其中 Voucher 数 |
| Deposit、Refund、Withdrawal | 是，各自按链上交易计数 |

`PaymentRequirements` 和 Token 转账中没有 CDP Fee 字段，也不会额外转账给 CDP Fee 地址。链上交易成功后，CDP 在项目账户内部增加用量；超过免费额度后形成可计费的超额用量。官方没有公开该用量如何形成最终账单并完成收款，也没有公开具体的用量表、幂等键和账单生成代码，因此不能从公开资料复现 CDP 的内部收费服务。

### 4.2 PayAI：按成功 settlement 扣除 Credit

PayAI 当前定价文档公开的实现是：

- 免费额度内不要求 API Key；
- 超出免费额度后每次 settled transaction 收费 `$0.001`；
- 商户在 Dashboard 充值 Credits；
- `1 credit = 1 settled transaction`；
- Credits 不过期。

这同样是 Facilitator 的链下账户收费，不改变资源支付的链上收款地址和金额。[PayAI Facilitator Pricing](https://docs.payai.network/x402/facilitators/pricing)

PayAI 的当前页面对免费额度存在公开信息不一致：定价文档写 1,000 次，Facilitator Introduction 和落地页显示 10,000 次/月。因此本调研只确认其稳定的收费单位和单价，即“每次 settlement `$0.001`、通过 Credit 扣费”；免费额度应以使用时的实时 Merchant Portal 和定价页为准。[PayAI Facilitator](https://facilitator.payai.network/)

#### 4.2.1 SDK 接入

PayAI 发布了预配置的 `@payai/facilitator` 包，资源服务端将其传给官方 x402 HTTP Client：

```ts
import { facilitator } from "@payai/facilitator";
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitatorClient = new HTTPFacilitatorClient(facilitator);
```

免费额度内不需要 API Key。超过免费额度后，包会读取：

```text
PAYAI_API_KEY_ID
PAYAI_API_KEY_SECRET
```

并自动为 `/verify`、`/settle` 和 `/supported` 请求附加认证。[PayAI Facilitator Introduction](https://docs.payai.network/x402/facilitators/introduction)

#### 4.2.2 REST 认证实现

PayAI 同时公开了不依赖其 SDK 的认证协议：

1. `PAYAI_API_KEY_SECRET` 是 Base64 编码的 Ed25519 PKCS#8/DER 私钥，可带 `payai_sk_` 前缀；
2. JWT Header 使用 `alg=EdDSA`，`kid` 为 API Key ID；
3. Payload 使用 `sub=<key-id>`、`iss=payai-merchant`、`iat`、`exp` 和随机 `jti`；
4. 文档建议 `exp = iat + 120` 秒；
5. 对 `base64url(header) + "." + base64url(payload)` 做 Ed25519 签名；
6. 请求携带 `Authorization: Bearer <jwt>`。

认证后的 Facilitator 请求仍是标准 x402 v2 Envelope：

```text
POST /verify   -> 验证 paymentPayload
POST /settle   -> 提交链上 settlement
GET  /supported
```

[PayAI Facilitator Authentication](https://docs.payai.network/x402/facilitators/authentication)

#### 4.2.3 Credit 扣减边界

公开资料能够确认 `1 credit = 1 settled transaction`，但没有公开以下服务端实现：

- settlement 成功状态如何原子地与 Credit 扣减提交；
- 重试或 `settlement_pending` 如何做幂等去重；
- Credit 余额的数据表和事务结构；
- 充值到账、退款和账务对账代码。

因此 PayAI 是“接入与认证可复现、收费账本不可复现”的现有实现。其费用不出现在 x402 Payload 或链上 Token 分账中。

### 4.3 x402facilitator.dev：预付余额按 settle 扣费

x402facilitator.dev 的公开页面显示：

- 用户先使用 USDC 为账户充值；
- 服务生成专属 Facilitator URL；
- `/settle` 每次收费 `$0.01`；
- `/verify` 和 `/supported` 免费；
- 底层使用 Coinbase CDP 进行结算。

这是“预付余额 + 每次 settle 固定扣费”的公开商业实现。[x402facilitator.dev](https://x402facilitator.dev/)

其页面披露的外部流程为：

```text
POST /api/deposit
        |
        |-- 使用 x402 支付 USDC，为服务账户充值
        `-- 返回专属 Facilitator URL

资源服务端使用专属 URL
        |
        |-- /verify：免费
        `-- /settle：余额扣除 $0.01，转发给底层 CDP

GET  /api/balance  -> 查询余额
POST /api/cancel   -> 取消并处理余额
POST /api/signers  -> 管理授权地址
```

该模式把“支付 Facilitator 使用费”也做成了一次 x402 充值，然后在服务端余额中逐次扣减。公开页面没有给出 Deposit、Balance Ledger、CDP 转发和 settle 幂等处理的源代码或数据库结构。本调研只能确认其外部 API 和产品流程，未独立验证服务规模、运营主体或安全控制，因此证据等级为 C。

### 4.4 x402Facilitator.ai：月费套餐包含成功交易额度

x402Facilitator.ai 的公开定价页采用套餐配额：免费、Developer 和 Business 套餐分别包含不同的成功 x402 交易额度；付费套餐按月收费，套餐内成功交易不再收 processing fee。[x402Facilitator.ai Pricing](https://x402facilitator.ai/pricing/)

其公开页面显示的产品组件包括：

```text
Account
  `-- Merchant Workspace
        |-- Published Service
        |-- API Keys
        |-- Receipts / Recovery
        `-- Successful Transaction Counter
```

支付在 Base 本地结算，系统只将成功交易计入每日套餐配额；套餐内不再收 processing fee。Developer 和 Business 通过月费获得更高的每日成功交易额度、更多 Workspace、Webhooks、审计和恢复能力。

这是“订阅月费 + 成功交易配额”的公开收费模式，而不是按每笔 x402 资源付款链上扣费。网站没有公开 `/verify`、`/settle` 的完整 API Schema、计数器实现或源代码，因此无法进一步还原“成功”的数据库判定和重复请求去重。该服务的生产使用规模和结算实现未在本调研中独立验证，证据等级为 C。[x402Facilitator.ai](https://x402facilitator.ai/)

## 5. 链上资金分配商业模型

### 5.1 链上 Facilitator Fee：Nuwa x402x Settlement Router

x402x 是 Nuwa 发布的可编程 x402 结算框架，核心组件包括：

- `SettlementRouter`：消费 EIP-3009 授权并执行结算；
- `TransferHook`：将扣除 Facilitator Fee 后的净额转给实际收款人；
- `claimFees()`：Facilitator 后续领取 Router 中累计的费用。

#### 5.1.1 `PaymentRequirements` 接入字段

x402x 不使用官方统一 Fee 字段，而是让资源服务端把顶层 `payTo` 指向 Router，再通过 `extra` 传入 x402x 自己定义的参数：

```json
{
  "payTo": "<SettlementRouter>",
  "extra": {
    "settlementRouter": "<SettlementRouter>",
    "payTo": "<Merchant>",
    "facilitatorFee": "10000",
    "hook": "<TransferHook>",
    "hookData": "0x",
    "salt": "<bytes32>"
  }
}
```

这里有两个 `payTo`：

| 位置 | 实际用途 |
| --- | --- |
| 顶层 `PaymentRequirements.payTo` | EIP-3009 Authorization 的 `to`，必须是 `SettlementRouter` |
| `extra.payTo` | Router 扣费后交给 Hook 的最终商户地址 |

项目当前 TypeScript 包提供 `isSettlementMode()`、`parseSettlementExtra()` 和 `calculateCommitment()`；Facilitator SDK 提供 `createRouterSettlementFacilitator()`，并通过 `allowedRouters` 按 CAIP-2 网络限制可调用的 Router。[x402x TypeScript SDK](https://github.com/nuwa-protocol/x402-exec/tree/main/typescript)

其公开 Facilitator 示例采用以下接入方式：

```ts
const facilitator = createRouterSettlementFacilitator({
  allowedRouters: {
    "eip155:8453": ["<approved-router>"],
  },
  rpcUrls: {
    "eip155:8453": "<rpc-url>",
  },
});

if (isSettlementMode(paymentRequirements)) {
  parseSettlementExtra(paymentRequirements.extra);
  await facilitator.settle(paymentPayload, paymentRequirements);
}
```

因此 Router 地址不是任意接受的 `extra` 参数；Facilitator 先按网络 Allowlist 检查，再将解析出的参数提交给链上 Router。

#### 5.1.2 合约入口与链上状态

`SettlementRouter` 的实际结算入口为：

```solidity
settleAndExecute(
  token,
  from,
  value,
  validAfter,
  validBefore,
  nonce,
  signature,
  salt,
  payTo,
  facilitatorFee,
  hook,
  hookData
)
```

合约公开源码中的关键状态为：

| 状态 | Key | 作用 |
| --- | --- | --- |
| `settled` | `contextKey` | 防止同一支付重复结算 |
| `pendingFees` | `facilitator -> token` | 记录各 Facilitator 可领取的累计费用 |
| `feeOperators` | `facilitator -> operator` | 授权 Operator 代 Facilitator 领取费用 |

`contextKey` 由 `keccak256(from, token, nonce)` 计算。`nonce` 本身必须等于项目定义的 commitment：

```text
keccak256(
  "X402/settle/v1",
  chainId,
  router,
  token,
  from,
  value,
  validAfter,
  validBefore,
  salt,
  payTo,
  facilitatorFee,
  hook,
  keccak256(hookData)
)
```

因此 Token、总金额、时间窗口、Router、商户地址、费用、Hook 和 Hook Data 都被绑定进 EIP-3009 nonce。[x402x SettlementRouter Source](https://github.com/nuwa-protocol/x402-exec/blob/main/contracts/src/SettlementRouter.sol)

其公开示例的资金流为：

```text
客户端授权 1.01 USDC
        |
        v
SettlementRouter 拉取 1.01 USDC
        |-- 累计 0.01 USDC Facilitator Fee
        `-- TransferHook 向商户转出 1.00 USDC
```

#### 5.1.3 `settleAndExecute` 执行顺序

公开合约按以下顺序执行一次结算：

1. 使用全部结算参数计算 commitment，要求它与 EIP-3009 `nonce` 相等；
2. 计算 `contextKey`，检查 `settled[contextKey]`，随后先标记为已结算；
3. 记录 Router 的 Token 余额；
4. 调用 Token 的 `transferWithAuthorization(from, router, value, ...)`，把总额拉到 Router；
5. 用余额增量确认实际收到的 Token 不少于 `value`；
6. 将 `facilitatorFee` 增加到 `pendingFees[msg.sender][token]`，此处 `msg.sender` 就是 Facilitator；
7. 计算 `hookAmount = value - facilitatorFee`；
8. Router 授权 Hook 使用 `hookAmount`，调用 `hook.execute(contextKey, from, token, hookAmount, salt, payTo, facilitator, hookData)`；
9. `TransferHook` 将净额转给 `extra.payTo`；
10. Router 检查最终余额只比结算前多出本次累计 Fee，防止 Hook 把净额残留在 Router；
11. 发出 `FeeAccumulated`、`HookExecuted` 和 `Settled` 等事件。

所有步骤在一个交易内完成；commitment 不匹配、重复结算、Token 实收不足、Hook 回滚或余额不符合预期都会使整个交易回滚。

#### 5.1.4 Fee 领取实现

Facilitator Fee 不会在每次资源结算中立即转到 Facilitator 地址，而是保存在 Router 并记入：

```text
pendingFees[facilitator][token]
```

领取接口分为两种：

```text
claimFees(tokens)
  `-- 将调用者在各 Token 下的 pendingFees 清零并转给调用者

claimFeesFor(facilitator, tokens, recipient)
  `-- Facilitator 或已授权 feeOperator 代领到指定 recipient
```

两条路径都先把账本清零，再执行 Token 转账，并发出 `FeesClaimed`。这说明 x402x 的“资源支付拆分”是即时的，但“Facilitator 将累计费用提到自己的钱包”是延迟发生的。

对应 `PaymentRequirements` 将顶层 `payTo` 设置为 Settlement Router，并在 `extra` 中携带实际商户 `payTo`、`facilitatorFee`、`hook` 和 `salt`。项目通过 settlement commitment 将这些参数绑定到支付授权，避免结算调用方在结算时替换参数。[x402x Built-in Hooks](https://github.com/nuwa-protocol/x402-exec/blob/main/contracts/docs/builtin_hooks.md)

这是已公开的链上 Facilitator Fee 实现，但不是 x402 官方 Scheme。x402x 主 README 列出了 Base、X-Layer 和 BSC 主网合约，TransferHook 文档同时仍将部分主网 Hook 标记为 `Pending Audit`，两处状态存在差异。因此本调研将其归类为“社区公开实现”，不据此认定为已经审计或大规模生产采用。[x402x Repository](https://github.com/nuwa-protocol/x402-exec)

### 5.2 资源收入分润：x402aff 将 `payTo` 指向 0xSplits

x402aff 没有自建 Facilitator，也不让 Facilitator 调用任意业务合约。它在资源服务端生成 `402` 时，将标准 x402 的 `payTo` 设置为确定性的 0xSplits PushSplit 地址：

#### 5.2.1 公开组件

| 模块 | 实现职责 |
| --- | --- |
| `builder_code.py` | 声明服务端 Builder Code，并解析链上 attribution suffix |
| `resolver.py` | 通过一次 `eth_call` 将 Builder Code 解析为注册的收款地址 |
| `split.py` | 根据商户、Builder 和价格生成 90/10 Split Plan |
| `push_split.py` | 生成 PushSplit calldata，并用 CREATE2 预测 counterfactual 地址 |
| `payto.py` | 在请求阶段返回动态 `payTo`；解析失败时回退到商户钱包 |
| `buyer_client.py` | 在客户端请求中附加 Builder Code 信息 |
| `distribute.py` | 生成部署 Split 和执行 distribute 所需的 calldata |
| `monitor.py` | 查找已有余额、尚待 distribute 的 Split 地址 |

资源服务端接入的关键代码是按请求动态替换 `payTo`：

```python
code = payto.builder_code_from_headers(request.headers)
result = payto.payto_for_request(code, seller_payout=SELLER)
route_config.pay_to = result.address
```

已注册的 Builder Code 返回该 `(seller, builder)` 对应的确定性 PushSplit 地址；没有 Builder Code、未注册或查询失败时，返回商户自己的钱包，支付继续执行但不发生分账。

#### 5.2.2 完整支付和分账路径

```text
标准 EIP-3009 x402 付款
        |
        v
payTo = PushSplit 地址
        |
        v
资金留在 Split 合约
        |
permissionless distribute
        |-- 商户 90%
        `-- Builder/Affiliate 10%
```

调用序列为：

1. 客户端第一次请求携带 `X-Builder-Code`；
2. 资源服务端查询 Builder Registry，构造固定 90/10 Split Plan；
3. `push_split.py` 根据不可变配置预测 CREATE2 PushSplit 地址，不要求此时已经部署合约；
4. 服务端在 `402 PAYMENT-REQUIRED` 中将该地址写入 `PaymentRequirements.payTo`；
5. 客户端生成标准 EIP-3009 授权，其中 `to` 就是 PushSplit 地址；
6. CDP `/verify` 验证标准 x402 付款；
7. CDP `/settle` 调用 USDC `transferWithAuthorization`，将全部金额转到 PushSplit；
8. Split 地址可以在尚未部署时先接收 Token；
9. `distribute.py` 后续生成“必要时部署 + distribute”的交易 calldata；
10. 任意调用者提交 distribute 交易，0xSplits 按不可变分配向商户和 Builder 转账。

分润比例不在 x402 `extra` 中，也没有 `serviceFee.amount`。链上约束来自付款签名绑定的 Split 地址，以及该 Split 地址对应的不可变接收人和比例。

#### 5.2.3 Attribution 与资金分配的边界

Builder Code 扩展中的 `s` 是随 settlement 写入 calldata 的 attribution 元数据，不负责移动资金，也不是 EIP-3009 资金授权的一部分。真正决定资金流向的是服务端在第一次 `402` 中选择的 `payTo`。

x402aff 因此在客户端第一次请求使用 `X-Builder-Code`，让服务端能够在生成 `402` 之前确定 Split 地址。普通客户端如果只附加 `s`、没有发送该 Header，付款会走商户地址而不分账。项目还明确规定多个 `s` 时只使用首个有效 Code。

CDP Facilitator 仍然执行普通 USDC `transferWithAuthorization`，只是收款地址从商户钱包变成 Split 地址。Split 的接收人和 90/10 比例由地址对应的不可变配置确定；资金进入后，由任意调用者执行 `distribute`。[x402aff Integration Guide](https://github.com/MiroShark/x402aff/blob/main/docs/INTEGRATION.md)

x402aff 项目说明其路径已在 Base Mainnet 和 Mainnet Fork 上验证。该结论来自项目自身文档，本调研未独立复现。它属于社区分润实现，不是 x402 官方 Facilitator Fee 标准。底层分账能力来自 [0xSplits Split V2](https://splits.org/protocol/docs/core/split-v2/)。

## 6. 各模式实现差异

| 一级商业模型 | 案例 | 费用或收入来源 | 状态保存位置 | 对标准资源付款的影响 | 收取或分配方式 | 实现公开度 |
| --- | --- | --- | --- | --- | --- | --- |
| 链下 Facilitator 服务计费 | CDP Facilitator | Project 对应的 Facilitator 链上操作用量 | CDP 内部用量系统 | 不改变 `payTo` 和资源付款金额 | 超额用量可计费；具体账单和收款流程未公开 | SDK/API 公开，内部账本闭源 |
| 链下 Facilitator 服务计费 | PayAI Facilitator | 商户预付 Credit | Merchant Credit 账本 | 不改变 `payTo` 和资源付款金额 | 每次 settled transaction 扣 1 Credit | SDK/认证公开，Credit 服务闭源 |
| 链下 Facilitator 服务计费 | x402facilitator.dev | 商户预付 USDC 服务余额 | 服务端余额账本 | 不改变底层资源付款；页面称转发到底层 CDP | 每次 settle 从余额扣 `$0.01` | 只有外部 API 描述 |
| 链下 Facilitator 服务计费 | x402Facilitator.ai | 商户订阅月费 | 套餐成功交易计数器 | 不从单笔资源付款中拆费 | 成功交易占用套餐额度 | 只有产品页面描述 |
| 链上 Facilitator Fee | x402x Router Fee | 买方签名总额（商户净额 + 独立 Fee） | `pendingFees[facilitator][token]` | `payTo` 改为 Router，Router 转出商户净额 | `claimFees` / `claimFeesFor` | SDK、Facilitator、Solidity 公开 |
| 链上资源收入分润 | x402aff Split | 买方支付的既定资源价格，不额外加费 | PushSplit Token 余额和不可变分配配置 | `payTo` 改为 Split，仍使用标准 settlement | `distribute` 时按 90/10 转出 | SDK、脚本、Fork Test 公开 |

### 6.1 Batch 相关实现现状

在以上案例中，只有 CDP 公开说明了其 Facilitator 商业收费与官方 `batch-settlement` 的对应关系：Voucher 的链下验证免费，claim、deposit、refund、withdrawal 按实际链上交易计费。

其他案例的公开资料没有提供以下实现：

- PayAI Credit 与 Batch Voucher/claim 的独立计量规则；
- x402facilitator.dev 或 x402Facilitator.ai 的 Batch 计费代码；
- x402x `pendingFees` 在 Batch Channel 中按 Voucher 累计的合约；
- x402aff 与官方 Batch Channel 组合的集成。

因此，不能把这些案例延伸解释成已经存在的 Batch 服务费实现。

## 7. 官方协议边界

根据当前 x402 v2 Core 和所检查的 Scheme 规范：

- Core 没有统一的 Facilitator 商业收费字段；
- `PaymentRequirements.extra` 是 Scheme-specific 数据容器，不会自行执行资金拆分；
- `extensions` 可以传播扩展信息，但元数据本身不改变 Token 转账；
- 官方 `exact` 将报价金额发送给一个 `payTo`；
- 官方 EVM Batch Channel 绑定一个 `receiver`；
- 官方 SVM Batch 明确要求将 100% 已结算资金发送给 `payTo`；
- 官方文档当前没有按每个 Batch Voucher 累计独立服务费并分给第二接收人的实现。

官方 EVM Batch 合约现有状态和调用路径是：

```text
Voucher.maxClaimableAmount
        |
        v
claimWithSignature(...)
        `-- 更新 Channel.totalClaimed，不发生 Token 转账
                    |
                    v
                 settle(...)
                    `-- 将 claimed-but-unsettled 金额转给唯一 receiver
```

Channel Config 只有一个 `receiver`，链上累计值只有资源款相关的 `totalClaimed`。这解释了为什么官方 Batch 现有实现不能直接承载“业务款 + 独立服务费接收人”。[x402 EVM Batch Settlement](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement_evm.md)

因此，CDP 和 PayAI 的 Facilitator 商业收费不属于 x402 链上支付金额的一部分；x402x 使用社区 Router 从签名总额中收取链上 Facilitator Fee；x402aff 使用 Split 合约分配资源收入，后者不是 Facilitator Fee。

## 8. 版本与弃用状态

- x402 v2 是当前推荐版本；v1 仍然可以工作，但旧 npm 包已被列为 Legacy，新实现应使用 `@x402/*` 包和 CAIP-2 网络标识。[Coinbase x402 v1 → v2 Migration Guide](https://docs.cdp.coinbase.com/x402/migration-guide)
- CDP 当前文档继续提供 v2 Facilitator，未发现 x402 Facilitator 下线公告。
- PayAI 当前文档继续提供 Facilitator、API Key 和 Credit 计费，未发现下线公告；其免费额度页面存在前述不一致。
- x402x 当前版本已改为使用官方 x402 v2 包和 `@x402x/extensions`，不再需要早期 patched x402 包。[x402x Repository](https://github.com/nuwa-protocol/x402-exec)
- x402aff 当前集成文档使用 CDP、EIP-3009、Builder Code 和 0xSplits Split V2，未发现项目弃用说明。

## 9. 事实性结论

1. 当前公开案例分为三种一级商业模型：链下 Facilitator 服务计费、链上 Facilitator Fee、链上资源收入分润。
2. 当前有明确商业定价的托管 Facilitator 主要通过链下账户、Credit、预付余额或订阅套餐收费，不从每笔资源付款中直接拆费。
3. CDP 和 PayAI 的 SDK、REST 接入及认证可以复现，但内部用量账本、Credit 扣减和账单事务没有开源；CDP 的最终账单和收款流程也未公开。
4. x402x 的 Router、`pendingFees`、commitment、Hook 和 `claimFees` 已有公开代码，表达链上 Facilitator Fee，但属于社区扩展。
5. x402aff 已公开动态 `payTo`、CREATE2 PushSplit 和 permissionless distribute 的完整集成，表达商户与 Affiliate/Builder 的资源收入分润，不是 Facilitator 服务收费。
6. CDP 的 Batch Facilitator 费用按链上操作计量，不按 Batch 中每个 Voucher 单独收 Facilitator 费。
7. 官方 Batch Scheme 没有第二套服务费累计账本，也没有第二个服务费接收人。
8. 截至查询日期，没有发现 x402 Foundation 发布统一链上服务费字段或跨 Scheme 的统一收费规范。
9. 按当前可验证市场活跃度，CDP 明显领先，PayAI 次之；x402x 虽有持续且累计规模较大的链上调用，但参与地址集中；x402aff 仍处于早期落地阶段；x402Facilitator.ai 和 x402facilitator.dev 缺少可独立验证的使用量数据。

## 10. 主要来源

### 官方规范与官方文档

- [x402 v2 Specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 EVM Batch Settlement](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement_evm.md)
- [x402 SVM Batch Settlement](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement_svm.md)
- [CDP Facilitator Pricing](https://docs.cdp.coinbase.com/x402/seller/facilitator)
- [CDP TypeScript x402 Examples](https://github.com/coinbase/cdp-sdk/blob/main/examples/typescript/x402/README.md)
- [CDP Settle API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/settle-payment)
- [CDP x402 Migration Guide](https://docs.cdp.coinbase.com/x402/migration-guide)
- [PayAI Facilitator Pricing](https://docs.payai.network/x402/facilitators/pricing)
- [PayAI Facilitator Introduction](https://docs.payai.network/x402/facilitators/introduction)
- [PayAI Facilitator Authentication](https://docs.payai.network/x402/facilitators/authentication)

### 社区公开实现

- [Nuwa x402x](https://github.com/nuwa-protocol/x402-exec)
- [x402x Built-in Hooks](https://github.com/nuwa-protocol/x402-exec/blob/main/contracts/docs/builtin_hooks.md)
- [x402x SettlementRouter Source](https://github.com/nuwa-protocol/x402-exec/blob/main/contracts/src/SettlementRouter.sol)
- [x402x TypeScript SDK](https://github.com/nuwa-protocol/x402-exec/tree/main/typescript)
- [x402aff Integration Guide](https://github.com/MiroShark/x402aff/blob/main/docs/INTEGRATION.md)
- [0xSplits Split V2](https://splits.org/protocol/docs/core/split-v2/)

### 其他公开商业页面

- [x402facilitator.dev](https://x402facilitator.dev/)
- [x402Facilitator.ai](https://x402facilitator.ai/)
- [x402Facilitator.ai Pricing](https://x402facilitator.ai/pricing/)
- [MiroShark x402aff](https://www.miroshark.xyz/x402aff)

### 市场活跃度与链上数据

- [x402gle Facilitator Statistics](https://www.x402gle.com/?tab=facilitators)
- [x402x Base Router Counters](https://base.blockscout.com/api/v2/addresses/0x73fc659Cd5494E69852bE8D9D23FE05Aab14b29B/counters)
- [x402x Base Router Transactions](https://base.blockscout.com/api/v2/addresses/0x73fc659Cd5494E69852bE8D9D23FE05Aab14b29B/transactions)
