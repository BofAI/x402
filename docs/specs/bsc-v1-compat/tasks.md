# Tasks: BSC V1-Compatible Refactor

## T0. 现状盘点

- [ ] 盘点所有读取 `PaymentPayloadV1` 的 EVM 入口
- [ ] 盘点所有假设 v1 EVM payload 等于 EIP-3009 的代码
- [ ] 盘点 server 当前生成 BSC requirement 的字段

## T1. 协议定义

- [ ] 定义 `ExactEvmBscPayloadV1`
- [ ] 定义 BSC `PaymentRequirementsV1.extra` 最小字段集
- [ ] 定义 facilitator 分流规则：`network + payload.kind`
- [ ] 输出 `contracts.md`
- [ ] 输出 `decisions.md`
- [ ] 输出 `acceptance-matrix.md`

## T2. Client 侧实现

- [ ] 新增 `v1-bsc/client/scheme.ts`
- [ ] 将 `PaymentRequirementsV1` 转为 permit2 所需 canonical 输入
- [ ] 生成 v1-compatible BSC payload
- [ ] 增加 client unit tests

## T3. Facilitator verify 实现

- [ ] 新增 `v1-bsc/facilitator/scheme.ts`
- [ ] 新增 BSC payload 识别逻辑
- [ ] 复用 permit2 verify 内核
- [ ] 输出 v1-compatible `VerifyResponse`
- [ ] 增加 verify unit tests

## T4. Facilitator settle 实现

- [ ] 复用 permit2 settle 内核
- [ ] 增加 error mapping 到 v1-compatible response
- [ ] 增加 settle unit tests

## T5. Server 支持

- [ ] 更新 BSC requirement builder
- [ ] 保证 `extra.assetTransferMethod = "permit2"`
- [ ] 补齐 permit2 所需上下文字段
- [ ] 增加 server integration tests

## T6. 集成验证

- [ ] 跑通 old-style v1 compatibility flow
- [ ] 跑通 BSC testnet E2E
- [ ] 验证非 BSC v1 流程无回归

## T7. 可观测性

- [ ] 增加 `v1-compatible-bsc` 路径日志
- [ ] 增加失败原因日志
- [ ] 增加 transfer method / network 维度日志
