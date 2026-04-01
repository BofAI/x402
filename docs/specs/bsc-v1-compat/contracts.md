# Contracts: BSC V1-Compatible

## 目的

本文档定义 BSC v1-compatible 改造中的关键契约：

- client 输出的 payload 结构
- server 输出的 `PaymentRequirementsV1.extra` 最小字段集
- facilitator 的分流规则
- 错误映射的基本约束

这里的内容不是最终协议标准，而是本次改造的实现契约草案。

## 1. Payload Contract

## 1.1 外层 envelope

外层继续保持 v1 格式：

```ts
type PaymentPayloadV1Envelope = {
  x402Version: 1;
  scheme: "exact";
  network: "bsc" | "bsc-testnet";
  payload: ExactEvmBscPayloadV1;
};
```

约束：

- `x402Version` 固定为 `1`
- `scheme` 固定为 `exact`
- `network` 必须是 BSC v1-compatible 支持的网络名
- 内层 payload 不能使用现有 EIP-3009 authorization shape 冒充

## 1.2 BSC payload

建议 payload 草案：

```ts
type ExactEvmBscPayloadV1 = {
  kind: "permit2";
  permit: {
    owner: `0x${string}`;
    token: `0x${string}`;
    amount: string;
    nonce: string;
    deadline: string;
    spender: `0x${string}`;
    chainId: number;
  };
  transfer: {
    to: `0x${string}`;
    requestedAmount: string;
  };
  signature: `0x${string}`;
  meta?: {
    assetSymbol?: string;
    assetTransferMethod?: "permit2";
  };
};
```

说明：

- `kind` 用来与老的 EIP-3009 payload 显式区分
- `permit` 保存 permit2 校验所需的核心字段
- `transfer` 保存最终转账目标与金额
- `signature` 为签名结果
- `meta` 仅用于调试和辅助，不应作为安全关键字段

## 1.3 必需字段

下列字段缺失时，client 必须拒绝生成 payload：

- `kind`
- `permit.owner`
- `permit.token`
- `permit.amount`
- `permit.nonce`
- `permit.deadline`
- `permit.spender`
- `permit.chainId`
- `transfer.to`
- `transfer.requestedAmount`
- `signature`

## 2. Requirement Extra Contract

## 2.1 目标

server 在输出 BSC 的 `PaymentRequirementsV1` 时，必须通过 `extra` 提供 permit2 执行的最小上下文。

## 2.2 Extra 草案

建议最小字段集：

```ts
type BscPaymentRequirementsV1Extra = {
  assetTransferMethod: "permit2";
  spender: `0x${string}`;
  tokenDecimals: number;
  tokenSymbol?: string;
  permit2Address?: `0x${string}`;
  chainId?: number;
  domainName?: string;
  domainVersion?: string;
  settlementMode?: "permit2";
};
```

## 2.3 最小必需字段

以下字段建议视为必需：

- `assetTransferMethod`
- `spender`
- `tokenDecimals`

以下字段建议为强校验字段：

- `chainId`
- `settlementMode`

如果这些字段缺失，compat client 或 facilitator 至少应给出可诊断错误，而不是走默认兜底。

## 2.4 字段语义

- `assetTransferMethod`
  - 必须为 `permit2`
  - 用来阻断误入 EIP-3009 路径
- `spender`
  - permit2 授权目标
- `tokenDecimals`
  - 用于 amount 解释和调试
- `chainId`
  - 用于签名域校验和网络一致性
- `settlementMode`
  - 明确此 requirement 应由 permit2 路径执行

## 3. Facilitator Routing Contract

## 3.1 路由原则

facilitator 不应仅按 `scheme === "exact"` 分流。

建议分流顺序：

1. 读取 `x402Version`
2. 读取 `network`
3. 读取 payload 是否存在 `kind`
4. 如果 `network in {bsc,bsc-testnet}` 且 `payload.kind === "permit2"`，进入 BSC v1-compatible 路径
5. 否则继续走原有 EIP-3009 v1 路径

## 3.2 分流伪代码

```ts
if (payload.x402Version === 1 && isBscV1CompatibleNetwork(payload.network)) {
  if (isBscPermit2Payload(payload.payload)) {
    return handleBscV1Compatible(payload, requirements);
  }
}

return handleLegacyExactEvmV1(payload, requirements);
```

## 3.3 不允许的行为

- 不允许先把 payload 当作 EIP-3009 解析，失败后再 fallback 到 BSC
- 不允许仅根据 network 判断，而忽略 payload shape
- 不允许对 shape 不完整的 BSC payload 继续尝试 settle

## 4. Error Mapping Contract

## 4.1 原则

facilitator 内部虽然走 permit2 / canonical 逻辑，但对外仍应返回 v1-compatible 结果。

## 4.2 建议错误分类

建议最少区分：

- `invalid_network`
- `unsupported_scheme`
- `invalid_payload_shape`
- `missing_required_extra`
- `insufficient_funds`
- `insufficient_allowance`
- `invalid_signature`
- `settlement_failed`

## 4.3 错误映射要求

- 内部 permit2 错误不能原样裸透出给 old caller
- 对外至少要映射为旧调用方能处理的 `invalidReason` / `errorReason`
- 同时保留内部详细日志用于排查

## 5. Contract Validation Checklist

- [ ] payload shape 与 EIP-3009 shape 明确可区分
- [ ] `extra.assetTransferMethod = "permit2"` 是强约束
- [ ] facilitator 分流前不误解析老 payload
- [ ] 缺少必需 extra 时能快速失败
- [ ] 错误映射对 old caller 可理解

