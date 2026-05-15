# x402 Roadmap

## 关联组件简称

- **TS SDK** = `typescript/packages/x402/`
- **Py SDK** = `python/x402/`
- **specs** = `specs/`（本仓）+ 上游 `x402-foundation/x402/specs/`
- **cli** = `/Users/bobo/code/x402/x402-cli/`
- **facilitator** = `/Users/bobo/code/x402/x402-facilitator/`
- **demo** = `/Users/bobo/code/x402/x402-demo/`
- **skills** = `/Users/bobo/code/x402/skills/`（含 `agent-wallet` / `recharge-skill`）
- **tron-contrib** = `tron-contribution/`（合约 + 上游 PR）

## 工作量按 day 估（AI 辅助节奏）

数字 = 净开发天数（含测试，不含等审计 / 等部署）。范围表示不确定性。

## 主线版本

| 版本 | 功能 | 工作量 | 说明 | 连带改动组件 |
|---|---|---|---|---|
| **v0.6.0** | TS 补全 Py parity | **完成，可发布** | TS 端已补齐：facilitator 客户端 + facilitator 服务端 + Hono / Express 中间件 + Fetch wrapper + signer-injected facilitator verify/settle（`exact` / `exact_permit` / `exact_gasfree`）。x402-demo 已完成 TypeScript QA smoke 和 TRON Nile 上链验证 | TS SDK；demo |
| **v0.6.1** | Extension 框架（双端新建） | **5d** | 对齐上游 `ResourceServerExtension` 接口 + 7 个 hooks（onBeforeVerify / onAfterVerify / onVerifyFailure / onBeforeSettle / onAfterSettle / onSettleFailure / onVerifiedPaymentCanceled）+ declaration / extraction helpers。后续所有 extension 的地基 | TS SDK；Py SDK；specs；facilitator；cli；demo |
| **v0.6.2** | Permit2 集成（TRON） | **7-10d** | 复用 SUN.io 主网部署 Permit2，新增 `exact_permit2_tron` mechanism。客户端按标准 `PermitTransferFrom` typed-data 签名（钱包能识别）。upto 的前置。含合约部署 | TS SDK；Py SDK；specs；cli；facilitator；demo；skills；tron-contrib |
| **v0.6.3** | Permit2 集成（BSC） | **3d** | 端口 Coinbase EVM 实现（`eip155:*` 通配自动适配 BSC）。MetaMask / OKX / Trust Wallet 原生识别签名；与 Coinbase 上游 EVM 路径互通 | TS SDK；Py SDK；facilitator；demo |
| **v0.6.4** | upto 计量计费 scheme | **7d** | 客户端签 max-authorization，服务端按实际消耗 partial-settle。LLM token / 推理时长 / 带宽计量。EVM 端可端口上游 [`coinbase-x402/python/x402/mechanisms/evm/upto/`](../coinbase-x402/python/x402/mechanisms/evm/upto/)（1400+ LoC）；TRON 端基于 v0.6.2 Permit2 自研 | TS SDK；Py SDK；specs；cli；facilitator；demo；skills；tron-contrib |
| **v0.7.0** | 支付幂等键扩展（payment-identifier） | **3d** | 客户端在 `extensions["payment-identifier"]` 带唯一 id，服务端去重重试请求防止重复扣费。Coinbase v2 spec 标配，依赖 v0.6.1 Extension 框架 | TS SDK；Py SDK；specs；cli；facilitator；demo |

## 候选（待拍）

| 候选 | 功能 | 工作量 | 说明 | 连带改动组件 |
|---|---|---|---|---|
| **batch-settlement scheme** | 批量结算（agent 高频微支付场景） | **15-20d** | Coinbase 刚发的新 scheme（[spec](../coinbase-x402/specs/schemes/batch-settlement/scheme_batch_settlement.md) + TS SDK）。客户端先签 voucher 服务端立即放行，最后批量结算。AI agent LLM 每 token 收钱场景必备。facilitator 需要全新 commitment + async redemption 体系，工作量主要在这 | TS SDK；Py SDK；specs；facilitator；cli；demo；skills |
| **auth-hints extension** | 在 PaymentRequired 里提示哪些 accepts 需要 auth | **3d** | 上游新 extension。比 payment-identifier 更面向 agent 工具链。Server ↔ Client 扩展，不经 facilitator | TS SDK；Py SDK；specs；cli |
| **bazaar 服务发现 + MCP discovery** | agent 通过 MCP 自动发现并付费调用 x402 endpoint | **7-10d** | 之前砍掉了，但上游加了 MCP discovery 集成 —— 跟 `apollo-arena` / `ainft-merchant-agent` 强相关 | TS SDK；Py SDK；cli；facilitator；skills |

## 工作量小计

| 阶段 | 主线 | 天数 |
|---|---|---|
| 两端对齐基础 | v0.6.0 + v0.6.1 | 12-15d |
| Permit2 双链 | v0.6.2 + v0.6.3 | 10-13d |
| 协议新能力 | v0.6.4 + v0.7.0 | 10d |
| **主线总计** | 6 个版本 | **32-38d** |

候选全做再加 25-33d。当前最大的工作量黑洞转到 **batch-settlement**（facilitator 大改）；**v0.6.0** 已完成并可正式发布。

## Permit2 背景说明（v0.6.2 + v0.6.3）

**当前 `exact_permit` 用的是我们自有的 `PaymentPermit` 合约**（TRON mainnet `TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn`、BSC `0x1825bB32db3443dEc2cc7508b2D818fc13EaD878`），自定义 EIP-712 type。**不是** EIP-2612 token 原生 permit，**也不是** Uniswap Permit2。

**硬伤：** 用户每个新协议都要重新 `approve(我们的合约)` / 钱包不识别签名 / 跟 Coinbase 上游不互通 / `PaymentPermit` 合约没 partial-settle 接口（upto 没法做）。

**Uniswap Permit2** 是行业标准的通用 ERC-20 授权层：用户 `approve(Permit2, max)` 一次，所有接 Permit2 协议（Uniswap、1inch、Across、Coinbase x402 EVM、各类 agent SDK）共用。已部署在所有主流 EVM 链 + **TRON 主网（SUN.io 部署）+ BSC**。

**两套并存，不替换：**

```
token 支持 ERC-3009 → exact             （直接 transferWithAuthorization）
token 支持 EIP-2612 → exact_permit      （我们的 PaymentPermit，现状）
否则                → exact_permit2     （兜底，新加；upto 也走这条路）
```
