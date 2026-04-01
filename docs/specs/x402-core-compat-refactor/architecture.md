# Architecture: x402 Core Compatibility Refactor

## 架构目标

通过统一 canonical core，将：

- 历史协议版本
- 未来协议升级
- 不同支付机制

从同一个演进框架中处理。

## 逻辑分层

```text
CLI / Server / Facilitator
        |
Protocol Adapters
  - v1
  - v2
  - future adapters
        |
Canonical Core
        |
Mechanism Router
  - EIP-3009
  - Permit2
  - TRON Exact
  - SVM Exact
        |
Execution Handlers
```

## 数据流

### Ingress

1. transport 收到协议请求
2. adapter 识别版本
3. adapter 解析并 normalize 到 canonical model
4. canonical core 调 mechanism router
5. handler 执行 verify / settle

### Egress

1. handler 返回 canonical result
2. adapter 根据目标版本 materialize
3. transport 输出 old/new response

## 版本与机制解耦

### 版本层只关心

- header / body
- schema shape
- envelope
- backward / forward compatibility

### 机制层只关心

- 支付签名
- 余额与 allowance
- on-chain verify / settle
- 特定链执行逻辑

## 为什么 BSC 要挂在 mechanism 层

BSC 的核心问题不是“版本不同”，而是“支付机制不同”。

在当前仓库里：

- old v1 EVM route 偏 EIP-3009
- BSC 资产能力偏 permit2

所以 BSC 应该挂到：

- `ExactEvmPermit2Handler`

而不是继续堆到：

- `ExactEvmSchemeV1`

## 建议的初始模块

### core

- `compat/types.ts`
- `compat/detect.ts`
- `compat/normalize.ts`
- `compat/materialize.ts`
- `compat/router.ts`

### evm

- `handlers/eip3009.ts`
- `handlers/permit2.ts`
- `adapters/v1-bsc/`

### runtime

- `compatHttpClient`
- `compatResourceServer`
- `compatFacilitatorTransport`

## 能力扩展模式

以后新增能力优先通过下面两个入口扩展：

1. 新增 adapter
2. 新增 mechanism handler

避免：

- 在旧类里继续加 network if/else
- 在业务逻辑里继续判断 `x402Version`

