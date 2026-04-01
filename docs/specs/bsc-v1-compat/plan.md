# Plan: BSC V1-Compatible Refactor

## 总体策略

本次改造不直接修改现有 `ExactEvmSchemeV1` 的核心语义，而是在其旁边增加一条 BSC 专用 v1-compatible 路径。

策略原则：

1. 先定义协议形态，再做执行逻辑
2. 先搭兼容边界，再接 permit2 内核
3. 先打通 testnet，再考虑 mainnet

## 分层方案

### Layer 1: V1-Compatible Envelope Layer

职责：

- 保持对外仍是 `x402Version=1`
- 保持 challenge / payload / verify / settle 的外部使用方式兼容

改造点：

- 新增 BSC 专用 v1 payload 定义
- 明确 old EIP-3009 与 BSC payload 的区分方式

### Layer 2: Compatibility Mapping Layer

职责：

- `PaymentRequirementsV1 -> canonical permit2 context`
- `PaymentPayloadV1(BSC) -> canonical verify/settle input`
- `canonical response -> v1-compatible response`

改造点：

- 增加 BSC-specific normalizer
- 增加 BSC-specific materializer

### Layer 3: Execution Layer

职责：

- 复用 permit2 或 v2-like 执行逻辑
- verify
- settle

改造点：

- 尽量复用现有 permit2 逻辑
- 避免重写一整套 on-chain 执行代码

## 改造阶段

### Phase 0: 盘点现有假设

目标：

- 找出当前哪些路径假设 v1 EVM payload 一定是 EIP-3009 shape
- 确认 server 目前为 BSC requirement 能提供哪些 extra

输出：

- 假设清单
- 缺失字段清单

### Phase 1: 定义 BSC v1-compatible 协议

目标：

- 明确 payload shape
- 明确 requirement extra contract
- 明确 facilitator 分流规则

输出：

- payload type
- requirement extra schema
- router rule
- documented contracts

### Phase 2: 实现 client path

目标：

- 从 `PaymentRequirementsV1` 正确生成 BSC payload

输出：

- `v1-bsc/client/scheme.ts`
- client unit tests

### Phase 3: 实现 facilitator verify path

目标：

- facilitator 能识别并 verify BSC v1-compatible payload

输出：

- `v1-bsc/facilitator/scheme.ts`
- verify unit tests

### Phase 4: 实现 facilitator settle path

目标：

- facilitator 能完成 settle
- 错误映射回 v1-compatible response

输出：

- settle path
- settle tests

### Phase 5: 补 server requirement 支持

目标：

- server 输出满足 BSC permit2 所需的 `PaymentRequirementsV1.extra`

输出：

- requirement builder update
- server integration tests

### Phase 6: 跑通 testnet E2E

目标：

- BSC testnet 完整流程通过

输出：

- E2E 用例
- 问题清单

## 关键技术决策

### 决策 1: 不修改 `ExactEvmSchemeV1` 主语义

原因：

- 降低回归风险
- 避免把 EIP-3009 和 permit2 混在一个类里

### 决策 2: 新建 `v1-bsc` 路径

原因：

- 命名清晰
- 更容易逐步演进到统一 compat adapter

### 决策 3: 先复用 permit2 execution core

原因：

- 避免双份实现
- 保持与 v2 演进方向一致

## 可能的阻塞点

1. 旧代码对 v1 payload shape 的硬编码假设
2. BSC requirement extra 不完整
3. permit2 执行所需上下文无法从现有 server 生成
4. verify / settle 错误语义与旧调用方预期不一致

## 成功标准

1. 非 BSC v1 流程零回归
2. BSC testnet 支付路径完整可跑
3. 代码结构可以自然纳入后续 compat framework

## 文档输出物

本计划对应的文档输出包括：

- `spec.md`
- `plan.md`
- `tasks.md`
- `contracts.md`
- `acceptance-matrix.md`
- `decisions.md`
