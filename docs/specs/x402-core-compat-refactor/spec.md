# Spec: x402 Core Compatibility Refactor

## 背景

当前 x402 同时面临三个问题：

1. 需要继续兼容现有 v1
2. 需要自然接入当前 v2
3. 未来需要更快承接 Coinbase 侧的新能力和协议升级

如果继续围绕 v1 或 v2 分别堆实现，后续会持续出现：

- 版本逻辑扩散
- 机制逻辑和版本逻辑耦合
- 新链和新能力接入成本不断上升

因此需要一次面向长期演进的结构性重构。

## 当前代码判断

基于最新 `origin/main` 和 `origin/dev/v2` 的代码现状，可以得出以下判断：

### 1. `dev/v2` 应作为实现基线

当前 `dev/v2` 相比 `main` 已经不是小版本分支，而是一套明显更完整的新结构，包含：

- 分拆后的 `core`
- 独立的 `mechanisms`
- 更完整的 EVM / TRON / SVM 实现
- 更完整的 client / server / facilitator 组合能力

因此本次改造不应再以 `main` 为思考中心，而应以 `dev/v2` 为实现基线。

### 2. v2 EVM 机制层已经可复用

当前 v2 EVM 路径已经具备：

- client 按 `assetTransferMethod` 在 `eip3009` 和 `permit2` 之间路由
- facilitator 按 payload type 在 `eip3009` 和 `permit2` 之间路由
- server 在 requirement `extra` 中提供 transfer method 和相关上下文

这说明：

- v2 已经具备可复用的执行内核
- 当前问题不需要通过重写机制层来解决
- 当前问题更适合通过 adapter 和边界兼容来解决

### 3. v1 仍然是旧 EIP-3009 语义

当前 v1 EVM 路径虽然已经支持 `bsc` / `bsc-testnet` network 名称和 chain id 映射，但其支付逻辑仍然是旧的 EIP-3009 模型。

因此：

- v1 已经具备 BSC network name 支持
- v1 不具备 BSC permit2 执行能力
- 问题的核心不是 network mapping，而是 mechanism mismatch

### 4. BSC 在现有体系中天然属于 permit2 路径

当前资产注册表已明确：

- BSC 资产使用 `assetTransferMethod = "permit2"`
- BSC 不应按 EIP-3009 路径理解

因此：

- BSC 不应继续做进现有 v1 EIP-3009 内核
- BSC 应通过兼容入口接入 v2 permit2 机制层

## 问题陈述

当前实现中，至少存在以下耦合：

- 协议版本与执行逻辑耦合
- HTTP / transport 形态与业务语义耦合
- EVM 机制与具体旧协议 envelope 耦合
- 单边升级兼容逻辑未形成统一框架

这会导致：

- v1 和 v2 很难一起优雅维护
- 新机制接入只能继续堆分支
- Coinbase 后续升级只能重复做一次适配

## 目标

- 建立一个更稳定的 x402 内核
- 将 v1 和 v2 都收敛为 adapter
- 将支付执行按 mechanism 而不是按版本拆分
- 让 CLI、server、facilitator 三端共享同一套兼容框架
- 为 Coinbase 后续升级预留稳定的接入点

## 非目标

- 不在第一阶段完全删除 v1 或 v2 现有实现
- 不在第一阶段一次性重写所有机制包
- 不要求所有调用方立即迁移

## 核心结论

本次改造采用唯一方案：

1. Protocol Adapter Layer
2. Canonical Core Layer
3. Mechanism Execution Layer
4. Transport / Runtime Integration Layer

其中：

- `v1` 和 `v2` 只作为协议适配层存在
- 真正的业务语义进入 canonical core
- 真正的支付执行进入 mechanism layer

进一步明确：

- 不继续扩展现有 v1 EVM 核心实现来承载 BSC
- 直接复用 `dev/v2` 的机制执行能力
- BSC 的第一阶段落地采用 `v1-compatible adapter + v2 permit2 core`

## 核心设计

## Layer 1: Protocol Adapter

职责：

- 识别协议版本
- 解析协议对象
- 标准化到 canonical model
- 将 canonical model materialize 回目标版本

第一阶段包含：

- `v1 adapter`
- `v2 adapter`

未来可扩展：

- `coinbase-next adapter`
- `extension-specific adapter`

## Layer 2: Canonical Core

职责：

- 提供稳定的内部支付语义模型
- 作为所有协议版本和执行机制的中间层

第一阶段统一以下对象：

- canonical payment requirement
- canonical payment payload
- canonical supported response
- canonical verify context
- canonical settle context

关键要求：

- core 不直接依赖 v1/v2 特定字段名
- core 不直接依赖 HTTP header 细节
- core 只表达支付语义，不表达协议历史包袱

## Layer 3: Mechanism Execution

职责：

- 按机制执行 verify / settle

执行层按机制拆分，不按版本拆分：

- `ExactEvmEip3009Handler`
- `ExactEvmPermit2Handler`
- `ExactTronHandler`
- `ExactSvmHandler`

未来新增能力时，优先考虑“新增 mechanism handler”，而不是“新增一个版本专属分支”。

当前实现方向上，第一阶段直接复用已有 v2 EVM 机制层：

- `ExactEvmEip3009Handler`
- `ExactEvmPermit2Handler`

不在第一阶段重新设计新的 EVM execution core。

## Layer 4: Transport / Runtime Integration

职责：

- CLI 边界适配
- server 边界适配
- facilitator 边界适配
- `/supported`、`/verify`、`/settle`
- headers / body / retry / observability

## 设计原则

1. 版本是 adapter concern，不是业务核心 concern
2. mechanism 是执行 concern，不是版本 concern
3. transport 是边界 concern，不进入 canonical core
4. 单边升级兼容必须作为框架能力存在
5. future upgrade 必须走同一套 adapter pipeline

## 为什么这样更好

### 对 v1

- 保持现有外部接入面
- 兼容逻辑集中，而不是散落在旧实现中

### 对 v2

- v2 成为 canonical 的自然来源，而不是唯一核心
- 新增 v2 能力时不必侵入旧流程

### 对 Coinbase 后续升级

- 只需新增 adapter 或 capability mapping
- 不需要再重写核心支付语义
- 新能力可以 capability-gated，而不是强制大版本切换

## 第一阶段 use case

第一阶段以 BSC 作为验证场景。

原因：

- BSC 能代表“旧外壳 + 新机制内核”的真实场景
- 能验证 v1-compatible envelope + permit2 execution 是否可行
- 能提前暴露“版本适配”和“机制执行”解耦是否真的成立

落地方式明确为：

- 对外保持 v1-compatible envelope
- 对内直接接入 v2 permit2 mechanism core
- 不修改现有 v1 EIP-3009 内核主语义

## 成功标准

1. 能兼容 v1
2. 能接入 v2
3. BSC 作为 first use case 跑通
4. 未来 Coinbase 升级通过新增 adapter / capability 的方式接入

## 实施方向

本次实施方向固定为：

1. 以 `dev/v2` 为实现基线
2. 保留 v1 作为兼容入口，而不是继续作为能力核心
3. 复用现有 v2 mechanism execution
4. 在 BSC 上先验证 `v1-compatible adapter -> v2 permit2 core`
5. 再逐步抽象成更完整的 canonical compatibility framework

这意味着第一阶段不做的事情包括：

- 不直接在 `ExactEvmSchemeV1` 里堆 permit2 分支
- 不同时重写所有机制包
- 不在第一阶段完成整个 canonical core 的彻底替换

## 时间预估

基于当前 `dev/v2` 已具备较完整机制层的前提，时间预估如下。

### 第一阶段：BSC first use case

范围：

- v1-compatible BSC adapter
- 复用 v2 permit2 core
- 补齐 server requirement contract
- 跑通 BSC testnet

预估：

- `1 ~ 2 周`

### 第二阶段：compat framework 骨架收敛

范围：

- adapter contract 明确化
- canonical model 初步收敛
- 三端边界统一

预估：

- `2 ~ 3 周`

该预估前提是：

- 不重写现有 v2 机制内核
- 以文档中定义的第一阶段范围为准
- 先证明路径成立，再扩大改造面
