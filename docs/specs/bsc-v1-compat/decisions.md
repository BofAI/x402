# Decisions: BSC V1-Compatible

## D-001 不修改现有 `ExactEvmSchemeV1` 主语义

### 结论

不把 BSC permit2 能力直接塞进现有 `ExactEvmSchemeV1`。

### 原因

- 当前 `ExactEvmSchemeV1` 语义和实现都强绑定 EIP-3009
- 直接混入 BSC 会让类语义失真
- 回归风险高

## D-002 新建 `v1-bsc` 路径

### 结论

新增 BSC 专用 v1-compatible 路径，而不是继续在老类里加 `if (network === "bsc")`

### 原因

- 命名更清晰
- 分层更清晰
- 更容易后续接入统一 compat framework

## D-003 对外保持 v1 envelope，对内转 permit2 内核

### 结论

外层继续使用 v1 envelope，内部使用 permit2 / canonical 逻辑。

### 原因

- old caller 无需立刻切换
- BSC 当前实际能力模型与 permit2 更匹配

## D-004 payload 必须显式带 `kind`

### 结论

BSC v1-compatible payload 必须显式包含 `kind: "permit2"`。

### 原因

- 避免和旧 EIP-3009 payload 混淆
- facilitator 分流需要稳定锚点

## D-005 server 需要提供额外上下文

### 结论

server 必须通过 `PaymentRequirementsV1.extra` 补齐 permit2 所需上下文。

### 原因

- 旧 v1 requirement 通用字段不足以安全构造 BSC permit2 payload

## D-006 先跑通 testnet，再考虑 mainnet

### 结论

先以 BSC testnet 为目标完成端到端，再扩展到 mainnet。

### 原因

- 降低试错成本
- 先确认 payload、verify、settle 语义稳定

