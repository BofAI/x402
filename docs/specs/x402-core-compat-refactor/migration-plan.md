# Migration Plan: x402 Core Compatibility Refactor

## Phase 1: 建立 canonical compatibility framework

目标：

- 把 v1 / v2 都视为 adapter
- 定义 canonical types
- 明确 CLI / server / facilitator 的 compat boundary

输出：

- canonical model spec
- adapter contract
- compatibility pipeline

## Phase 2: 用 BSC 验证新结构

目标：

- 将 BSC 作为第一个“旧外壳 + 新机制内核”的用例

输出：

- BSC v1-compatible spec
- BSC payload contract
- BSC requirement extra contract
- BSC verify / settle route

## Phase 3: 抽离 EVM mechanism handlers

目标：

- 从版本导向实现迁移到机制导向实现

输出：

- EIP-3009 handler
- Permit2 handler
- router contract

## Phase 4: 三端统一接入 compat framework

目标：

- CLI / server / facilitator 都通过统一 adapter pipeline 工作

输出：

- compat CLI boundary
- compat server boundary
- compat facilitator boundary

## Phase 5: 为 Coinbase future upgrade 预留接入方式

目标：

- future upgrade 只需要增加 adapter / capability，而不是推翻 core

输出：

- capability registry draft
- future adapter slot
- upgrade acceptance checklist

## 里程碑判断

### Milestone A

文档层面达成共识：

- 版本和机制解耦
- BSC 作为第一阶段 use case
- v1 / v2 都降为 adapter

### Milestone B

spec 与 contract 完整：

- canonical core spec
- BSC spec
- acceptance matrix

### Milestone C

开始实现时：

- 先从 BSC-compatible path 入手
- 不直接在旧 v1 核心里继续扩功能

