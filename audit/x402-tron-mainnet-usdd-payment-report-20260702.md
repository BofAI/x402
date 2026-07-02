# x402 TRON Mainnet USDD Payment Test Report

## 1. PRD 理解与范围确认

一句话总结：验证 BANK OF AI x402 recharge 接口在 TRON 主网使用 USDD 支付时，客户端可正确完成 402 challenge、链上授权/支付、服务端验签结算与充值入账。

### 1.1 测试范围

| 类型 | 范围 |
|---|---|
| 包含 | `https://tn-recharge.bankofai.io/x402/recharge` TRON mainnet USDD 支付 |
| 包含 | x402 `exact` scheme challenge 获取、客户端签名、permit2 授权、服务端 verification/settlement |
| 包含 | TRON 主网链上交易状态、付款/收款地址、token、金额校验 |
| 包含 | BANK OF AI recharge 接口返回状态与余额字段校验 |
| 不包含 | 前端页面充值流程、订单页面 UI 展示、账户余额业务账务深度核对 |
| 不包含 | 并发支付、性能压测、异常金额批量测试 |
| 不包含 | 私钥导出、助记词导出或任何钱包密钥暴露操作 |

## 2. 测试概要

| 项目 | 内容 |
|---|---|
| 测试时间 | 2026-07-02 18:08:14 CST |
| 测试对象 | BANK OF AI x402 recharge service |
| 接口 | `POST https://tn-recharge.bankofai.io/x402/recharge` |
| SDK 版本 | `@bankofai/x402-* 1.0.0-beta.6` |
| 本地仓库 | `/Users/admin/Documents/x402_new/x402-release-v1.0.0` |
| 本地分支 | `release-v1.0.0` |
| 本地 Commit | `4c18b93` |
| 执行脚本 | `typescript/scripts/pay-recharge-tron-usdd-release.ts` |
| 支付网络 | TRON Mainnet `tron:mainnet` |
| 支付代币 | USDD |
| USDD 合约 | `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` |
| 支付金额 | `1 USDD` |
| 付款地址 | `TD3t2GwHu4LjRq34diUfBx7tXnhMCo5215` |
| 收款地址 | `TNMxHxRTFrPHuVqe4BHE59fGfDMfpLxXrb` |
| 测试结论 | 通过。接口返回 `200 OK`，`recharge_status=success`，链上交易 `confirmed=true`、`contractRet=SUCCESS`。 |

## 3. 功能点拆分

| 功能点 | 前置条件 | 触发方式 | 可验证标准 |
|---|---|---|---|
| 获取 USDD 支付 challenge | recharge 服务可访问 | `POST /x402/recharge`，body 为 `{"amount":"1","token":"USDD"}` | 返回 HTTP `402`，accepts 中包含 `scheme=exact`、`network=tron:mainnet`、USDD 合约 |
| 本地钱包加载 | agent-wallet 已配置 TRON 钱包 | 运行支付脚本 | 能解析付款地址，且不输出私钥/助记词 |
| TRON exact client 注册 | SDK 已安装 beta.6 | `x402Client.register("tron:mainnet", new ExactTronScheme(...))` | 客户端能选择 `exact tron:mainnet` 支付要求 |
| USDD 授权 | 付款地址 USDD/TRX 余额充足 | 客户端根据 challenge 发起 `approve` | approve 交易广播并确认成功 |
| x402 支付结算 | 授权成功且 payload 生成成功 | paid fetch 重放原请求 | recharge 接口返回 `200 OK` |
| 服务端验签与入账 | 服务端 facilitator/settlement 可用 | 服务端处理 `X-PAYMENT` | 返回 `verified=true`、`settlement.success=true`、`recharge_status=success` |
| 链上状态核验 | TronScan API 可用 | 查询 tx 和 TRC20 transfer | 转账金额、付款方、收款方、合约和状态一致 |

## 4. 异常与边界分析

| 类别 | 风险点 | 本次覆盖情况 | 结果/说明 |
|---|---|---|---|
| 用户异常行为 | token 参数非 USDD/USDT | 未执行 | 本次只验证 USDD 正常路径 |
| 用户异常行为 | 金额为空、0、负数、小数精度超限 | 未执行 | 建议补充接口参数校验用例 |
| 环境异常 | 未配置钱包口令 | 间接覆盖 | 初始 shell 未加载 `AGENT_WALLET_PASSWORD`；执行时通过本地 zsh 配置加载，未泄露密钥 |
| 环境异常 | TronGrid key 缺失 | 已覆盖 | SDK 自动使用 `https://hptg.bankofai.io` fallback RPC，支付成功 |
| 环境异常 | 链上确认延迟 | 已覆盖 | 首次查询 `confirmed=false`，复查后为 `confirmed=true` |
| 数据边界 | 付款余额接近支付金额 | 已覆盖 | 支付前约 `1.9367 USDD`，支付后约 `0.9367 USDD` |
| 兼容性 | TRON mainnet + USDD permit2 | 已覆盖 | `permit2Authorization` payload 生成并结算成功 |

## 5. 测试用例表

| 测试用例ID | 子模块 | 测试场景 | 前置条件 | 操作步骤 | 测试数据 | 优先级 | 预期结果 | 实际结果 | 备注 | 用例类型 |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-TRON-USDD-001 | Challenge | 获取 TRON 主网 USDD 支付要求 | recharge 服务在线 | POST recharge，不带支付凭证 | `amount=1`, `token=USDD` | P0 | 返回 HTTP 402，accepts 包含 `tron:mainnet` USDD | 通过，返回 USDD 合约 `TXDk8...9Hz` | 402 challenge 正常 | 正常 |
| TC-TRON-USDD-002 | 钱包 | 加载本地 TRON 钱包 | agent-wallet 已配置 | 执行支付脚本 | network=`tron` | P0 | 能获取付款地址，不输出密钥 | 通过，付款地址 `TD3t...5215` | 未输出私钥/助记词 | 正常 |
| TC-TRON-USDD-003 | 余额 | 支付前余额检查 | TronScan API 可用 | 查询付款地址 USDD/TRX | USDD 合约 `TXDk...9Hz` | P0 | USDD >= 1，TRX 足够手续费 | 通过，USDD 约 `1.9367`，TRX `24.035452` | 余额足够 | 正常 |
| TC-TRON-USDD-004 | SDK | 注册 TRON exact client | SDK beta.6 可用 | 创建 signer 并注册 `tron:mainnet` | `ExactTronScheme` | P0 | 客户端选择 `exact tron:mainnet` | 通过 | 使用新 TRON exact client | 正常 |
| TC-TRON-USDD-005 | 授权 | 发起 USDD approve | 钱包余额和 TRX 足够 | paid fetch 后由 SDK 发起授权 | approve spender 来自 challenge | P0 | approve 交易广播并确认成功 | 通过，tx `dd6f16...e7` | `contractRet=SUCCESS` | 正常 |
| TC-TRON-USDD-006 | 支付 | 使用 USDD 完成 x402 支付 | approve 成功 | SDK 生成 payment payload 并重放请求 | `1 USDD` | P0 | 服务端返回 `200 OK` | 通过 | `paid request result status=200` | 正常 |
| TC-TRON-USDD-007 | 验签结算 | 服务端 verification/settlement | payment payload 有效 | 检查响应体 | `verified`, `settlement` | P0 | `verified=true`, `settlement.success=true` | 通过 | payer 返回 EVM 映射地址 | 正常 |
| TC-TRON-USDD-008 | 充值业务 | recharge 状态 | 支付结算成功 | 检查业务响应字段 | `recharge_status` | P0 | `recharge_status=success` | 通过 | `bankofai_balance=1980000` | 正常 |
| TC-TRON-USDD-009 | 链上转账 | TRC20 transfer 状态核验 | 交易哈希已返回 | 查询 TronScan transfer | tx `c4ee62...3f85` | P0 | from/to/amount/contract 正确，状态成功 | 通过 | `confirmed=true`, `contractRet=SUCCESS` | 正常 |
| TC-TRON-USDD-010 | 确认延迟 | 新交易确认状态变化 | 刚完成支付 | 立即查询并延迟复查 | 同一 tx | P1 | 交易最终确认成功 | 通过 | 初查曾为 `confirmed=false`，复查为 `true` | 边界 |

## 6. 执行过程与结果

### 6.1 Challenge 响应摘要

```text
HTTP/2 402
scheme: exact
network: tron:mainnet
amount: 1000000000000000000
asset: TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz
payTo: TNMxHxRTFrPHuVqe4BHE59fGfDMfpLxXrb
assetTransferMethod: permit2
```

### 6.2 客户端执行摘要

```text
[release-client] TRON wallet: TD3t2GwHu4LjRq34diUfBx7tXnhMCo5215
x402: received 402, attempting payment
x402 tron: build+broadcast start method=approve contract=TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz
x402 tron: broadcast ok txid=dd6f16d9205bcdb30aca9232801b6d23a14025460688f7db131d4b1d6d4428e7
x402 tron: tx confirmed status=success contractRet=SUCCESS
[release-client] selected: exact tron:mainnet
[release-client] asset: TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz
[release-client] amount: 1000000000000000000
x402: paid request result status=200
```

### 6.3 接口响应摘要

```json
{
  "status": "paid",
  "recharge_status": "success",
  "mode": "trc20_x402",
  "transaction_hash": "c4ee62cb500676d6d7a6dd3c932656ed403825ba53b3fa864dd7356e624c3f85",
  "transaction_url": "https://tronscan.org/#/transaction/c4ee62cb500676d6d7a6dd3c932656ed403825ba53b3fa864dd7356e624c3f85",
  "token": "USDD",
  "amount": "1",
  "pay_to": "TNMxHxRTFrPHuVqe4BHE59fGfDMfpLxXrb",
  "network": "tron:mainnet",
  "verified": true,
  "settlement": {
    "success": true,
    "payer": "0x21ca9d40b246144a30be39bad0f25b1288cd04de",
    "transaction": "c4ee62cb500676d6d7a6dd3c932656ed403825ba53b3fa864dd7356e624c3f85",
    "network": "tron:mainnet"
  },
  "bankofai_balance": {
    "balance": 1980000
  }
}
```

## 7. 链上核验

| 项目 | 结果 |
|---|---|
| Approve tx | `dd6f16d9205bcdb30aca9232801b6d23a14025460688f7db131d4b1d6d4428e7` |
| Payment tx | `c4ee62cb500676d6d7a6dd3c932656ed403825ba53b3fa864dd7356e624c3f85` |
| TronScan | `https://tronscan.org/#/transaction/c4ee62cb500676d6d7a6dd3c932656ed403825ba53b3fa864dd7356e624c3f85` |
| 链上状态 | `confirmed=true`, `contractRet=SUCCESS` |
| TRC20 from | `TD3t2GwHu4LjRq34diUfBx7tXnhMCo5215` |
| TRC20 to | `TNMxHxRTFrPHuVqe4BHE59fGfDMfpLxXrb` |
| TRC20 quant | `1000000000000000000` |
| USDD decimals | `18` |
| 实际金额 | `1 USDD` |

### 7.1 余额变化

| 阶段 | USDD | TRX |
|---|---:|---:|
| 支付前 | `1.936719489091850428` | `24.035452` |
| 支付后 | `0.936719489091850428` | `21.801352` |
| 差值 | `-1.000000000000000000 USDD` | `-2.234100 TRX` |

## 8. 模块测试结果汇总

| 模块 | 用例数 | 通过 | 失败 | 阻塞 | 结论 |
|---|---:|---:|---:|---:|---|
| Challenge 获取 | 1 | 1 | 0 | 0 | 通过 |
| 钱包与余额 | 2 | 2 | 0 | 0 | 通过 |
| SDK 支付客户端 | 2 | 2 | 0 | 0 | 通过 |
| 服务端验签结算 | 2 | 2 | 0 | 0 | 通过 |
| 链上核验 | 2 | 2 | 0 | 0 | 通过 |
| 合计 | 9 | 9 | 0 | 0 | 通过 |

## 9. 问题清单

| 缺陷ID | 严重级别 | 问题描述 | 状态 | 建议 |
|---|---|---|---|---|
| N/A | N/A | 本次 TRON mainnet USDD 支付未发现阻断或失败问题 | 已关闭 | 保留链上确认复查步骤 |

## 10. 风险与建议

| 风险点 | 等级 | 说明 | 建议 |
|---|---|---|---|
| 主网真实扣款 | 高 | 本次为真实 TRON mainnet USDD 支付，已产生链上转账和 TRX 手续费 | 后续回归优先使用小额支付，执行前确认余额 |
| RPC fallback | 中 | 未配置 TronGrid API key 时 SDK 使用 fallback RPC | 生产或稳定回归建议配置 TronGrid API key |
| 交易确认延迟 | 中 | 新交易立即查询可能短暂显示 `confirmed=false` | 报告中应以二次复查或最终确认结果为准 |
| approve 交易成本 | 中 | USDD permit2 流程会先发起 approve，增加 TRX 消耗 | 回归前评估 allowance，避免重复授权成本 |

## 11. 结论

TRON 主网 USDD x402 recharge 支付验证通过。客户端成功使用 release-v1.0.0 / beta.6 SDK 的 TRON exact client 完成 challenge 解析、USDD approve、payment payload 生成和 paid request；服务端返回 `200 OK`、`recharge_status=success`、`verified=true`、`settlement.success=true`。链上 TRC20 转账最终确认成功，付款方、收款方、金额、合约与接口响应一致。
