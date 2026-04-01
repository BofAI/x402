# Acceptance Matrix: BSC V1-Compatible

## 目的

本矩阵用于定义文档阶段的验收范围，后续可以直接转成测试计划。

## 1. 基线回归

| Case | 描述 | 预期 |
|---|---|---|
| A1 | 非 BSC v1 EIP-3009 client create payload | 行为不变 |
| A2 | 非 BSC v1 facilitator verify | 行为不变 |
| A3 | 非 BSC v1 facilitator settle | 行为不变 |

## 2. BSC v1-compatible client

| Case | 描述 | 预期 |
|---|---|---|
| B1 | BSC requirement 带齐 required extra | 成功生成 payload |
| B2 | 缺少 `assetTransferMethod` | 失败，返回明确错误 |
| B3 | `assetTransferMethod != permit2` | 失败，拒绝走 BSC path |
| B4 | 缺少 `spender` | 失败，返回明确错误 |
| B5 | payload `kind !== permit2` | 不生成或生成失败 |

## 3. BSC v1-compatible facilitator verify

| Case | 描述 | 预期 |
|---|---|---|
| C1 | 合法 BSC payload + 合法 requirement | verify 通过 |
| C2 | network 不一致 | verify 失败 |
| C3 | payload shape 不完整 | verify 失败 |
| C4 | signature 非法 | verify 失败 |
| C5 | allowance 不足 | verify 失败，错误语义正确 |

## 4. BSC v1-compatible facilitator settle

| Case | 描述 | 预期 |
|---|---|---|
| D1 | verify 通过后 settle | 成功返回 transaction |
| D2 | 链上执行失败 | 返回 v1-compatible settle error |
| D3 | payload 非法但被误送到 settle | 快速失败 |

## 5. 路由正确性

| Case | 描述 | 预期 |
|---|---|---|
| E1 | BSC + `kind=permit2` | 命中 BSC v1-compatible path |
| E2 | 非 BSC + 老 EIP-3009 payload | 命中 legacy v1 path |
| E3 | BSC + 老 payload shape | 不应误入 legacy EIP-3009 路径 |

## 6. 端到端

| Case | 描述 | 预期 |
|---|---|---|
| F1 | BSC testnet 完整支付链路 | 跑通 |
| F2 | old-style v1 flow 回归 | 跑通 |
| F3 | BSC compatible flow + 旧调用方式 | 跑通 |

## 7. 可观测性

| Case | 描述 | 预期 |
|---|---|---|
| G1 | 命中 BSC compatible path | 有日志 |
| G2 | verify 失败 | 有结构化错误信息 |
| G3 | settle 失败 | 有结构化错误信息 |

