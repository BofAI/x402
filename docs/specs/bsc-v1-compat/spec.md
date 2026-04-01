# Spec: BSC V1-Compatible Support

## 背景

当前需要在不要求现有调用方立即切换到 v2 的前提下，支持 BSC 上的支付能力。

现状上：

- 现有 `ExactEvmSchemeV1` 的语义和实现都强绑定 EIP-3009
- BSC 资产注册表已经表明 BSC 资产走 `permit2`
- BSC 资产在当前设计中并不适合直接复用旧的 v1 EIP-3009 机制

因此本次改造不能简单理解为“给 v1 增加一个网络配置”，而是需要增加一条 **v1-compatible 的 BSC 支付路径**。

## 问题陈述

需要同时满足以下目标：

1. 现有 v1 接入方式继续可用
2. BSC 能够真实完成支付、verify 和 settle
3. 当前改造不能把 `ExactEvmSchemeV1` 继续做成越来越重的历史兼容桶
4. 后续还要能自然接入统一 compat adapter 和 v2

## 设计目标

- 对外继续保持 v1 envelope
- BSC 不强行走 EIP-3009，而是走 permit2 / v2-like internal execution
- 新能力不污染现有 EIP-3009 v1 scheme
- 未来可以纳入统一 canonical model + adapter 架构

## 非目标

- 不修改现有 `ExactEvmSchemeV1` 的主语义使其同时承载 EIP-3009 和 permit2
- 不要求现有 borrower 立即切换到 v2
- 不在业务 route 或上层调用代码里增加版本/链特判

## 核心决策

本次实现采用唯一方案：

- 新增一套 **BSC 专用 v1-compatible scheme**
- 现有 `ExactEvmSchemeV1` 不承担 BSC permit2 能力
- BSC 路径内部统一转到 permit2 / canonical execution

具体形式：

- 对外：仍是 v1
- 对内：转成 permit2 / canonical 语义执行

实现结构：

- `typescript/packages/mechanisms/evm/src/exact/v1-bsc/client/scheme.ts`
- `typescript/packages/mechanisms/evm/src/exact/v1-bsc/facilitator/scheme.ts`
- `typescript/packages/mechanisms/evm/src/exact/v1-bsc/index.ts`

## 能力范围

### 输入

- `PaymentRequirementsV1`
- `PaymentPayloadV1`
- BSC / BSC testnet network 标识

### 输出

- v1-compatible payment payload
- v1-compatible verify response
- v1-compatible settle response

### 内部执行

- 使用 permit2 / canonical execution path
- 不使用旧的 EIP-3009 路径

## 功能需求

### FR-1: 保持 v1 外部契约

系统必须继续支持现有 v1 外部调用方式，包括：

- 旧 challenge
- 旧 payload envelope
- 旧 verify / settle 接口

### FR-2: 新增 BSC v1-compatible payload

系统必须支持一个 BSC 专用的 v1 payload 形态，并且该形态不能伪装为 EIP-3009 authorization。

payload 必须至少包含：

- `kind`
- permit 数据
- transfer 数据
- signature

### FR-3: Facilitator 能识别并分流 BSC payload

facilitator 必须能够根据：

- `network`
- `payload.kind`

将 BSC v1-compatible 请求分流到 permit2 执行逻辑。

### FR-4: Server 必须补齐执行所需上下文

server 在生成 BSC 的 `PaymentRequirementsV1` 时，必须通过 `extra` 提供 permit2 执行所需的关键信息。

### FR-5: 不破坏原有 v1 EIP-3009 流程

对非 BSC 的原有 v1 exact EVM 流程，行为必须保持不变。

## 非功能需求

### NFR-1: 可扩展

设计必须支持未来继续引入：

- 更多 permit2 型 EVM 链
- 更多版本 adapter
- 统一 canonical payment model

### NFR-2: 可观测

需要能记录：

- 是否命中 `v1-compatible-bsc`
- 内部使用的 transfer method
- verify / settle 失败原因

### NFR-3: 可测试

必须具备：

- unit tests
- integration tests
- BSC testnet end-to-end

## 数据与协议约束

### 协议约束 1

v1 外层 envelope 保持：

```ts
{
  x402Version: 1,
  scheme: "exact",
  network: "...",
  payload: ...
}
```

### 协议约束 2

BSC payload 必须显式区分旧 EIP-3009 payload，避免 facilitator 在错误路径上解析。

### 协议约束 3

缺少 permit2 必需上下文时，client 应拒绝创建 payload，而不是生成不完整请求。

## 风险

### 风险 1: v1 语义被拉伸

虽然外层继续是 v1，但内部已经不是旧的 EIP-3009 机制。必须通过命名和模块边界降低误解。

### 风险 2: 旧逻辑对 payload shape 有强假设

如果旧路径里有代码默认 v1 payload 一定等于 EIP-3009 authorization，则需要重构入口分流。

### 风险 3: server 提供的信息不够

如果 `PaymentRequirementsV1.extra` 里缺少 permit2 必需字段，则该方案无法可靠成立。

### 风险 4: 业务语义不完全等价

permit2 与 EIP-3009 的 verify / settle 语义不同，需要额外做业务兼容校验。

## 验收标准

### AC-1

现有非 BSC v1 EIP-3009 流程不回归。

### AC-2

BSC v1-compatible client 能生成合法 payload。

### AC-3

BSC v1-compatible facilitator 能 verify 合法 payload。

### AC-4

BSC v1-compatible facilitator 能完成 settle。

### AC-5

至少一条 BSC testnet end-to-end 路径跑通。
