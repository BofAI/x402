# TRON 链上可信分账合约设计

> 状态：Draft
>
> 目标版本：V1
>
> 适用方案：`exact_fee`、`upto_fee`、`batch-settlement-fee`
>
> 不适用方案：`exact_gasfree`（其 GasFree provider 已独立收费）

## 1. 背景

现有 TRON `exact`、`upto` 和 `batch-settlement` 实现只表达业务支付金额：

- `exact` 与 `upto` 的 Permit2 proxy 每次只向一个 `payTo` 转账；
- `batch-settlement` 的 Channel 只有一个 `receiver`，Voucher 和链上状态也只有一个累计金额；
- 如果仅在链下记录服务费，或者把服务费混入业务金额，链上无法证明业务款与服务费分别属于谁，也无法保证两笔转账同时成功或同时失败。

本设计引入新的、非升级式合约，通过付款人签名明确绑定业务收款人、服务费收款人和各自金额，并在同一链上交易内完成可信分账。

## 2. 设计目标

### 2.1 必须满足

1. **链上可信分账**：业务款只能发送给 `payTo`，服务费只能发送给 `feeRecipient`。
2. **付款人明确授权**：付款人签名同时绑定业务金额、服务费金额、资产、有效期和结算合约。
3. **原子性**：同一次结算中的业务款和服务费必须同时成功或同时回滚。
4. **单笔收费**：服务费按一次成功的 x402 资源支付收取，不按链上交易数重复收取。
5. **金额可解释**：`PaymentRequirements.amount` 始终表示业务金额，不包含服务费。
6. **兼容旧方案**：不修改已部署合约；旧客户端不会误把带服务费的支付当作普通支付处理。
7. **无管理员分账权**：合约没有可在付款人签名之后修改收款人或金额的管理员入口。
8. **TRON 兼容**：地址签名时遵循现有 TRON Base58 到 20-byte EVM hex 的规范；本设计合约主动发起的 TRC-20 转账使用 `sun-contract-std` 的 `SafeTransferLib`，Permit2 直接转账路径使用目标网络已验证的 canonical Permit2 实现。

### 2.2 V1 不包含

- `exact_gasfree`；
- 按比例、阶梯或动态费率计算；V1 只支持每笔固定服务费；
- 服务费与业务款使用不同 Token；
- fee-on-transfer、rebasing 或具有回调副作用的非标准 Token；
- 对旧合约或旧 Channel 的原地升级；
- EIP-3009 的即时分账路径；`exact_fee` 和 `upto_fee` V1 仅使用 Permit2；
- 协议层退款已结算服务费；已 claim/settle 的金额不可逆。

## 3. 统一金额语义

### 3.1 服务费定义

V1 的服务费是资源服务端在 `PaymentRequired` 中声明、付款人签名确认的固定金额：

```json
{
  "amount": "1000000",
  "extra": {
    "assetTransferMethod": "permit2",
    "serviceFee": {
      "amount": "10000",
      "recipient": "TFeeRecipientAddress"
    }
  }
}
```

字段语义：

| 字段 | 含义 |
| --- | --- |
| `amount` | 业务收款人应收的业务金额或业务金额上限 |
| `extra.serviceFee.amount` | 当前资源支付的固定服务费 |
| `extra.serviceFee.recipient` | 服务费收款地址 |
| `totalDebit` | 客户端派生值，等于业务金额加服务费，不作为可独立修改的 wire 字段 |

服务费和业务款必须使用 `PaymentRequirements.asset` 指定的同一种 Token。

### 3.2 收费触发规则

| Scheme | 服务费触发条件 |
| --- | --- |
| `exact_fee` | exact 支付成功时收取一次固定服务费 |
| `upto_fee` | `actualPaymentAmount > 0` 时收取一次固定服务费；实际业务金额为 0 时不发链上交易、不收服务费、不消耗 Permit2 nonce |
| `batch-settlement-fee` | 每个最终 `actualPaymentAmount > 0` 的成功资源请求累计一次固定服务费；deposit、top-up、claim、settle、refund 不重复收费 |

如果未来需要“业务金额为 0 仍收访问费”，应新增独立语义，不能改变 V1 的零金额行为。

## 4. 总体架构

新增三个 scheme 和三组部署：

| Scheme | 合约 | 主要职责 |
| --- | --- | --- |
| `exact_fee` | `x402ExactFeePermit2Proxy` | 固定业务金额与固定服务费即时原子分账 |
| `upto_fee` | `x402UptoFeePermit2Proxy` | 实际业务金额不超过上限，并收取固定服务费 |
| `batch-settlement-fee` | `x402BatchSettlementFee` | 托管资金、累计双账本、延迟原子分账 |

即时方案共享一个内部 Module：

```text
x402BasePermit2Proxy
        |
x402FeePermit2ProxyBase
        |-- x402ExactFeePermit2Proxy
        `-- x402UptoFeePermit2Proxy
```

`x402FeePermit2ProxyBase` 的外部 Interface 保持为空，只封装以下实现复杂度：

- 校验付款人签名中的 Token、业务金额或上限、服务费、收款人和有效期；
- 按 V1 最终选择的资金路径构造 Permit2 transfer details，调用单笔或 batch `permitWitnessTransferFrom`；
- 保证调用方不能独立传入或替换实际收款地址和服务费金额；
- 统一参数校验、错误和事件字段。

### 4.1 即时分账的两个候选方案

#### 方案 A：单笔拉入代理后拆分

资金路径为：

```text
payer -- Permit2(totalDebit) --> fee proxy
                                  |-- paymentAmount --> payTo
                                  `-- feeAmount ----> feeRecipient
```

代理是无状态执行代理：一次调用结束时，本次拉入金额必须全部转出。即使第一笔转账已经执行，只要第二笔转账失败，整个交易及 Token 状态都会回滚。

该方案只依赖单 Token `PermitTransferFrom`，兼容面最广，但一次结算包含三次 Token 转账，并需要拉入前后和拆分后的余额检查。

#### 方案 B：Permit2 batch 直接分账

资金路径为：

```text
payer -- Permit2 batch --> payTo        (paymentAmount)
      `-- Permit2 batch --> feeRecipient (feeAmount)
```

`sunswap-permit2` 的 `contracts/interfaces/ISignatureTransfer.sol` 已经声明 `PermitBatchTransferFrom` 以及 batch `permitWitnessTransferFrom` overload，`contracts/SignatureTransfer.sol` 已实现该路径。实现允许 `TokenPermissions[]` 出现重复 Token，并按相同索引的 `SignatureTransferDetails[]` 分别发送给不同接收人；`test/SignatureTransfer.t.sol` 也覆盖了同一 Token 向多个地址转账。

方案 B 仍然需要 fee proxy 作为 Permit2 spender。Permit2 验证 Witness 哈希，但不会解释 Witness 中的 `payTo`、`feeRecipient` 和金额，也不会自动约束调用时的 `transferDetails.to`。Proxy 必须从已签 Witness 内部构造 transfer details，不能接受调用方提供任意接收人数组。

建议的 batch 数组顺序固定为：

```text
permit.permitted[0] = TokenPermissions(token, paymentAmount 或 maxPaymentAmount)
permit.permitted[1] = TokenPermissions(token, feeAmount)

transferDetails[0] = SignatureTransferDetails(payTo, actualPaymentAmount)
transferDetails[1] = SignatureTransferDetails(feeRecipient, feeAmount)
```

#### 方案比较

| 对比项 | 方案 A：拉入代理后拆分 | 方案 B：Permit2 batch 直接分账 |
| --- | --- | --- |
| Permit2 签名类型 | `PermitTransferFrom` | `PermitBatchTransferFrom` |
| Permit2 EIP-712 主类型 | `PermitWitnessTransferFrom` | `PermitBatchWitnessTransferFrom` |
| Token 转账次数 | 3 次 | 2 次 |
| 代理临时持有本次资金 | 是，同一交易内清空 | 否 |
| 原子性 | 支持 | 支持 |
| 同 Token 双收款人 | 由代理二次转账 | 由两个相同 Token permission 直接转账 |
| 非标准 Token 检查 | 可检查代理余额增量与清空 | 依赖 Token allowlist、Permit2 行为和 fork 测试 |
| 部署兼容性 | 只要求单笔接口 | 每个目标网络的已部署 Permit2 都必须验证 batch overload |
| 预计 Gas | 较高 | 较低，最终以 Nile/Mainnet fork 实测为准 |
| Witness 到收款参数的约束 | Proxy 执行拆分 | Proxy 构造 batch transfer details |

### 4.2 V1 选择规则

方案 B 是条件性优选方案，方案 A 是兼容回退方案。在冻结 scheme wire format、EIP-712 type string 和 golden vectors 之前，必须对所有 V1 目标网络完成以下验证：

1. 已部署 Permit2 字节码或可信构建产物与 `sunswap-permit2` 的 batch 实现一致；
2. batch `permitWitnessTransferFrom` selector 可调用；
3. 两个相同 Token permission 可以在一次调用中分别转给两个地址；
4. 第二笔转账失败时，第一笔转账、nonce 消耗和全部状态都回滚；
5. 目标 TRC-20 Token 在 batch 路径上的行为通过 fork 测试；
6. Solidity 与 TypeScript 对 batch witness type string 和 digest 的计算一致。

所有目标网络都通过时，V1 采用方案 B；任一目标网络不通过时，V1 在所有网络统一采用方案 A。同一个 `exact_fee` 或 `upto_fee` scheme 不得因网络不同而切换 `PermitTransferFrom` 与 `PermitBatchTransferFrom`，也不能在部署后静默改变签名类型或字节码。

## 5. `x402FeePermit2ProxyBase`

### 5.1 共同校验

两种候选方案都必须：

1. 校验 `owner`、`payTo`、`feeRecipient` 均非零地址；
2. 校验 `payTo != feeRecipient`；
3. 校验实际 `paymentAmount > 0`、`feeAmount > 0`；
4. 校验 `block.timestamp >= validAfter`；Permit2 负责校验 `deadline`；
5. 保证调用 Permit2 时 `msg.sender` 是实际 fee proxy，使 Permit2 签名中的 spender 解析为该 proxy；
6. 从 Witness 构造实际收款参数，不接受调用方覆盖；
7. 由子合约发送包含完整分账信息的事件。

### 5.2 方案 B 内部 Interface

```solidity
function _batchTransferAndSplit(
    ISignatureTransfer.PermitBatchTransferFrom calldata permit,
    address owner,
    address payTo,
    address feeRecipient,
    uint256 permittedPaymentAmount,
    uint256 actualPaymentAmount,
    uint256 feeAmount,
    uint256 validAfter,
    bytes32 witnessHash,
    string memory witnessTypeString,
    bytes calldata signature
) internal;
```

方案 B 的执行顺序为：

1. 执行共同校验；
2. 要求 `permit.permitted.length == 2`；
3. 要求两项 `token` 相同；
4. 要求 `permit.permitted[0].amount == permittedPaymentAmount`；
5. 要求 `permit.permitted[1].amount == feeAmount`；
6. 要求 `0 < actualPaymentAmount <= permittedPaymentAmount`；
7. 在合约内部构造长度为 2 的 `SignatureTransferDetails[]`，顺序固定为业务款、服务费；
8. 调用 batch `permitWitnessTransferFrom`；
9. 由子合约发送事件。

`transferDetails` 不得作为外部 Interface 参数。这样调用方无法在签名有效的情况下把业务款或服务费重定向到其他地址。

### 5.3 方案 A 回退 Interface

若部署验证未通过，使用以下回退函数：

```solidity
function _pullAndSplit(
    ISignatureTransfer.PermitTransferFrom calldata permit,
    uint256 requestedTotal,
    address owner,
    address payTo,
    address feeRecipient,
    uint256 paymentAmount,
    uint256 feeAmount,
    uint256 validAfter,
    bytes32 witnessHash,
    string memory witnessTypeString,
    bytes calldata signature
) internal;
```

方案 A 的执行顺序为：

1. 执行共同校验；
2. 校验 `requestedTotal == paymentAmount + feeAmount`；
3. 记录代理当前 Token 余额 `balanceBefore`；
4. 调用 Permit2，指定 `to = address(this)`、`requestedAmount = requestedTotal`；
5. 要求 `balanceAfterPull == balanceBefore + requestedTotal`；
6. 转账 `paymentAmount` 给 `payTo`；
7. 转账 `feeAmount` 给 `feeRecipient`；
8. 要求 `balanceAfterSplit == balanceBefore`；
9. 由子合约发送事件。

Solidity 加法必须使用 checked arithmetic。对于不满足余额增量或转账后余额条件的 Token，交易应回滚。

### 5.4 共同错误

```solidity
error InvalidOwner();
error InvalidPayTo();
error InvalidFeeRecipient();
error IdenticalRecipients();
error InvalidPaymentAmount();
error InvalidFeeAmount();
error InvalidTotalAmount();
error InvalidPermitLength();
error TokenMismatch();
error PaymentPermissionMismatch();
error FeePermissionMismatch();
error PaymentTooEarly();
error TokenBalanceDeltaMismatch();
error TransferFailed();
```

合约继续使用 `ReentrancyGuardTransient`。不得增加 owner、pause 后重定向资金、修改 fee recipient 或提取用户结算资金的管理函数。

## 6. `x402ExactFeePermit2Proxy`

### 6.1 Witness

```solidity
struct Witness {
    address payTo;
    address feeRecipient;
    uint256 paymentAmount;
    uint256 feeAmount;
    uint256 validAfter;
}
```

EIP-712 类型：

```text
Witness(
  address payTo,
  address feeRecipient,
  uint256 paymentAmount,
  uint256 feeAmount,
  uint256 validAfter
)
```

完整 Permit2 witness type string 必须按 EIP-712 的嵌套类型排序规则生成，并由 Solidity、TypeScript 和测试向量共同固定。

方案 A 的完整 Permit2 主类型是 `PermitWitnessTransferFrom`；方案 B 是包含 `TokenPermissions[]` 的 `PermitBatchWitnessTransferFrom`。两者 digest 不兼容，必须在 V1 选择资金路径后只保留一种。

### 6.2 Permit 约束

方案 B：

```text
permit.permitted.length     == 2
permit.permitted[0].token   == PaymentRequirements.asset
permit.permitted[1].token   == PaymentRequirements.asset
permit.permitted[0].amount  == paymentAmount
permit.permitted[1].amount  == feeAmount
paymentAmount               == PaymentRequirements.amount
feeAmount                   == PaymentRequirements.extra.serviceFee.amount
feeRecipient                == PaymentRequirements.extra.serviceFee.recipient
spender                     == x402ExactFeePermit2Proxy
```

方案 A 回退：

```text
permit.permitted.token  == PaymentRequirements.asset
permit.permitted.amount == paymentAmount + feeAmount
paymentAmount           == PaymentRequirements.amount
feeAmount               == PaymentRequirements.extra.serviceFee.amount
feeRecipient            == PaymentRequirements.extra.serviceFee.recipient
spender                 == x402ExactFeePermit2Proxy
```

Permit2 的 `nonce` 提供单次消费和重放保护；`deadline` 提供结束时间；Witness 提供开始时间和拆分绑定。任何人都可以提交结算，因为提交人无法修改收款人或金额。

方案 B 调用 `_batchTransferAndSplit` 时，`permittedPaymentAmount` 与 `actualPaymentAmount` 都取 `witness.paymentAmount`。

### 6.3 外部 Interface

方案 B：

```solidity
function settle(
    ISignatureTransfer.PermitBatchTransferFrom calldata permit,
    address owner,
    Witness calldata witness,
    bytes calldata signature
) external nonReentrant;

function settleWithPermit(
    EIP2612Permit calldata permit2612,
    ISignatureTransfer.PermitBatchTransferFrom calldata permit,
    address owner,
    Witness calldata witness,
    bytes calldata signature
) external nonReentrant;
```

方案 A 回退时，`PermitBatchTransferFrom` 替换为单笔 `PermitTransferFrom`：

```solidity
function settle(
    ISignatureTransfer.PermitTransferFrom calldata permit,
    address owner,
    Witness calldata witness,
    bytes calldata signature
) external nonReentrant;

function settleWithPermit(
    EIP2612Permit calldata permit2612,
    ISignatureTransfer.PermitTransferFrom calldata permit,
    address owner,
    Witness calldata witness,
    bytes calldata signature
) external nonReentrant;
```

`settleWithPermit` 中，EIP-2612 的 `value` 必须等于总授权金额，而不是只等于业务金额。

### 6.4 事件

```solidity
event FeeSettled(
    address indexed owner,
    address indexed token,
    address indexed feeRecipient,
    address payTo,
    uint256 paymentAmount,
    uint256 feeAmount,
    uint256 permitNonce
);
```

`paymentAmount` 与 `feeAmount` 必须分别记录，不能只记录总额。

## 7. `x402UptoFeePermit2Proxy`

### 7.1 Witness

```solidity
struct Witness {
    address payTo;
    address feeRecipient;
    address facilitator;
    uint256 maxPaymentAmount;
    uint256 feeAmount;
    uint256 validAfter;
}
```

EIP-712 类型：

```text
Witness(
  address payTo,
  address feeRecipient,
  address facilitator,
  uint256 maxPaymentAmount,
  uint256 feeAmount,
  uint256 validAfter
)
```

### 7.2 授权与实际结算

方案 B 中付款人签署：

```text
permit.permitted.length     == 2
permit.permitted[0].token   == PaymentRequirements.asset
permit.permitted[1].token   == PaymentRequirements.asset
permit.permitted[0].amount  == maxPaymentAmount
permit.permitted[1].amount  == feeAmount
```

方案 A 回退中付款人签署：

```text
permit.permitted.amount == maxPaymentAmount + feeAmount
```

结算时资源服务端向 facilitator 提供 `actualPaymentAmount`。合约执行：

```text
0 < actualPaymentAmount <= maxPaymentAmount
actualFeeAmount = feeAmount
requestedTotal = actualPaymentAmount + actualFeeAmount
msg.sender == witness.facilitator
```

合约不能接受由 facilitator 单独传入的 `actualFeeAmount`；实际服务费必须直接取自付款人签名的 Witness，消除结算方临时加价的空间。

### 7.3 外部 Interface

方案 B 使用：

```solidity
function settle(
    ISignatureTransfer.PermitBatchTransferFrom calldata permit,
    uint256 actualPaymentAmount,
    address owner,
    Witness calldata witness,
    bytes calldata signature
) external nonReentrant;
```

方案 A 回退使用：

```solidity
function settle(
    ISignatureTransfer.PermitTransferFrom calldata permit,
    uint256 actualPaymentAmount,
    address owner,
    Witness calldata witness,
    bytes calldata signature
) external nonReentrant;
```

如保留 `settleWithPermit`，其 EIP-2612 `value` 同样必须等于 `maxPaymentAmount + feeAmount`。

当 `actualPaymentAmount == 0` 时，SDK/facilitator 必须沿用现有 `upto` 行为：直接返回零结算结果，不调用合约、不收服务费、不消耗 nonce。合约侧调用零金额 `settle` 应回滚，避免调用方对零结算产生不同解释。

### 7.4 事件

```solidity
event UptoFeeSettled(
    address indexed owner,
    address indexed token,
    address indexed feeRecipient,
    address payTo,
    address facilitator,
    uint256 actualPaymentAmount,
    uint256 feeAmount,
    uint256 maxPaymentAmount,
    uint256 permitNonce
);
```

## 8. `x402BatchSettlementFee`

### 8.1 核心语义

Batch 不在每次 HTTP 请求时发送 Token。其可信分账分为两个原子阶段：

1. `claim` 原子记录业务款权益和服务费权益；
2. `settle` 从 escrow 原子支付业务款和服务费。

两个阶段之间资金仍在合约中。付款人的已签 Voucher 只是链下承诺，只有成功上链的 claim 才会减少可退款余额，这一点与现有 Batch 模型一致。

### 8.2 ChannelConfig

```solidity
struct ChannelConfig {
    address payer;
    address payerAuthorizer;
    address receiver;
    address receiverAuthorizer;
    address feeRecipient;
    address token;
    uint40 withdrawDelay;
    bytes32 salt;
}
```

`feeRecipient` 是 Channel 的不可变配置并参与 `channelId` 计算。变更服务费收款人必须新建 Channel，不能通过管理员修改现有 Channel。

```text
CHANNEL_CONFIG_TYPEHASH = keccak256(
  "ChannelConfig(address payer,address payerAuthorizer,address receiver,address receiverAuthorizer,address feeRecipient,address token,uint40 withdrawDelay,bytes32 salt)"
)
```

### 8.3 ChannelState

```solidity
struct ChannelState {
    uint128 balance;
    uint128 totalPaymentClaimed;
    uint128 totalFeeClaimed;
}
```

Channel 的链上已占用金额为：

```text
grossClaimed = totalPaymentClaimed + totalFeeClaimed
availableForRefund = balance - grossClaimed
```

所有加法先提升为 `uint256` 校验，再安全转换，避免两个合法 `uint128` 相加时溢出。

### 8.4 Voucher 与 VoucherClaim

为保留 Batch 动态定价能力，付款人签署两类累计上限；receiver authorizer 在 claim 时签署两类实际累计金额：

```solidity
struct Voucher {
    ChannelConfig channel;
    uint128 maxPaymentAmount;
    uint128 maxFeeAmount;
}

struct VoucherClaim {
    Voucher voucher;
    bytes payerSignature;
    uint128 totalPaymentClaimed;
    uint128 totalFeeClaimed;
}
```

EIP-712 类型：

```text
Voucher(bytes32 channelId,uint128 maxPaymentAmount,uint128 maxFeeAmount)

ClaimEntry(
  bytes32 channelId,
  uint128 maxPaymentAmount,
  uint128 maxFeeAmount,
  uint128 totalPaymentClaimed,
  uint128 totalFeeClaimed
)
```

新合约使用 EIP-712 domain：

```text
name: "x402 Batch Settlement"
version: "2"
chainId: 当前链 ID
verifyingContract: x402BatchSettlementFee
```

新 domain version、verifying contract 和 typehash 共同隔离 V1/V2 签名，防止交叉重放。

### 8.5 每笔请求的累计规则

设服务端当前已确认的累计实际金额为：

```text
chargedPaymentCumulative
chargedFeeCumulative
```

客户端为新请求签署：

```text
maxPaymentAmount = chargedPaymentCumulative + PaymentRequirements.amount
maxFeeAmount     = chargedFeeCumulative + serviceFee.amount
```

资源执行完成后：

```text
if actualPaymentAmount > 0:
    chargedPaymentCumulative += actualPaymentAmount
    chargedFeeCumulative     += serviceFee.amount
else:
    两个累计实际金额均不增加
```

服务端必须先持久化新的两个累计实际金额，再返回成功响应。并发请求继续使用现有的单 Channel 串行化和 pending reservation 机制，但 reservation 必须同时覆盖业务金额上限与服务费上限。

### 8.6 Claim 校验与记账

处理每个 `VoucherClaim` 时必须：

1. 重算并校验 `channelId`；
2. 校验付款人对 `maxPaymentAmount` 和 `maxFeeAmount` 的 Voucher 签名；
3. 校验 receiver authorizer 对实际累计 claim 的批量签名；
4. 校验两个实际累计金额分别单调不减；
5. 校验实际业务累计不超过 `maxPaymentAmount`；
6. 校验实际服务费累计不超过 `maxFeeAmount`；
7. 校验两类实际累计金额之和不超过 Channel `balance`；
8. 要求本次业务增量与费用增量同时为零或同时大于零；
9. 原子更新 Channel 状态和待结算状态。

建议错误：

```solidity
error NonMonotonicPaymentClaim();
error NonMonotonicFeeClaim();
error PaymentClaimExceedsCeiling();
error FeeClaimExceedsCeiling();
error ClaimExceedsBalance();
error UnpairedClaimDelta();
```

重复提交完全相同或更旧且两个累计值都未增加的 Voucher 可以保持 no-op，延续现有幂等行为；一个维度增加而另一个维度倒退必须回滚。

### 8.7 原子结算账本

不能继续只按 `(receiver, token)` 聚合，否则同一 receiver 对应多个 fee recipient 时无法确定配对关系。V2 按三元组记账：

```solidity
struct SettlementState {
    uint128 totalPaymentClaimed;
    uint128 totalPaymentSettled;
    uint128 totalFeeClaimed;
    uint128 totalFeeSettled;
}

mapping(address receiver =>
    mapping(address feeRecipient =>
        mapping(address token => SettlementState))) public settlements;
```

外部 Interface：

```solidity
function settle(
    address receiver,
    address feeRecipient,
    address token
) external nonReentrant;
```

执行顺序：

1. 计算 `paymentPending = totalPaymentClaimed - totalPaymentSettled`；
2. 计算 `feePending = totalFeeClaimed - totalFeeSettled`；
3. 两个 pending 都为 0 时直接返回；
4. 先更新两个 settled 累计值；
5. 转账 `paymentPending` 给 receiver；
6. 转账 `feePending` 给 fee recipient；
7. 发送一个同时包含两类金额的事件。

```solidity
event BatchFeeSettled(
    address indexed receiver,
    address indexed feeRecipient,
    address indexed token,
    address sender,
    uint128 paymentAmount,
    uint128 feeAmount
);
```

`settle` 保持 permissionless。状态先更新并配合重入保护；任意一笔 Token 转账失败时，两个状态更新和两笔 Token 转账全部回滚。

### 8.8 Deposit collector

现有 `Permit2DepositCollector` 和 `ERC3009DepositCollector` 在构造函数中绑定旧 Batch 合约地址，不能供新合约复用。必须为 `x402BatchSettlementFee` 分别部署新的 collector：

- `Permit2FeeDepositCollector`；
- `ERC3009FeeDepositCollector`。

collector 仍只负责把总 deposit 拉入 escrow，不负责分账。Deposit 金额必须覆盖付款人准备授权的业务金额上限和服务费上限之和。

### 8.9 Withdraw 与 Refund

所有可退款金额计算统一改为：

```text
available = balance - totalPaymentClaimed - totalFeeClaimed
```

- 未 claim 的业务款和服务费均可退款；
- 已 claim 但未 settle 的两类金额都不可退款；
- `refund`、`refundWithSignature` 和 timed withdrawal 必须使用相同公式；
- refund nonce 规则继续沿用现有合约；
- 如需在同一交易中先 claim 再 refund，可继续使用 `Multicall`，但新 Claim 类型必须完整覆盖两个累计金额。

## 9. 链下角色约束

### 9.1 Resource server

- 从可信配置加载 `serviceFee.amount` 和 `serviceFee.recipient`，不能从客户端请求覆盖；
- 在 402 response 中同时展示业务金额和服务费；
- 对 `upto_fee` 只提交实际业务金额，不能提交服务费金额；
- 对 Batch 持久化业务与服务费两个累计值；
- Batch 并发 reservation 同时预留业务金额上限与服务费上限。

### 9.2 Client

- 明确展示 `paymentAmount`、`feeAmount` 和 `totalDebit`；
- 校验服务费 Token 与业务 Token 相同；
- 校验 Permit2 spender 是当前网络登记的新 fee proxy；
- 按 V1 冻结后的统一方案生成单笔或 batch Permit2 typed data，不得根据网络或运行时结果自动切换签名类型；
- 签名之前检查 Token balance 和 Permit2 allowance 是否覆盖总授权金额；
- TRON Base58 地址进入 typed data 前必须标准化为 20-byte hex。

### 9.3 Facilitator

- 只接受配置中登记的新 scheme、Permit2、proxy、Batch 和 collector 地址；
- 同时校验业务收款人、服务费收款人和两类金额；
- `upto_fee` 结算时用签名中的最大金额重建签名，只把实际业务金额传给合约；
- Batch claim 同时校验、提交两个累计实际金额；
- 返回值分别包含 `paymentAmount`、`feeAmount`、`totalAmount`，不能只返回总额。

## 10. 安全不变量

### 10.1 即时分账合约

对每次成功结算：

```text
payerDebit == paymentAmount + feeAmount
payToCredit == paymentAmount
feeRecipientCredit == feeAmount
proxyBalanceAfter == proxyBalanceBefore
```

方案 A 中代理余额先增加后恢复；方案 B 中本次结算资金从付款人直接到达两个接收人，代理余额始终不变。在标准 TRC-20 假设下，任何一项失败都会回滚全部状态。

### 10.2 Batch 合约

对每个 Channel：

```text
totalPaymentClaimed + totalFeeClaimed <= balance
```

对每个 SettlementState：

```text
totalPaymentSettled <= totalPaymentClaimed
totalFeeSettled     <= totalFeeClaimed
```

对每个 Token，全局偿付能力应满足：

```text
contractTokenBalance >=
    sum(channel.balance - channel.totalPaymentClaimed - channel.totalFeeClaimed)
  + sum(unsettledPayment + unsettledFee)
```

对于标准 Token 且不存在第三方误转时，上式应为等式。

### 10.3 威胁与处理

| 威胁 | 处理 |
| --- | --- |
| facilitator 修改 fee | fee 固定在 payer 签名的 Witness/Voucher 中 |
| facilitator 修改实际业务金额 | exact 不允许；upto/batch 只能在付款人签名上限内，并受 facilitator/receiver-authorizer 签名约束 |
| 重放即时支付 | Permit2 nonce bitmap |
| 新旧 Batch 签名重放 | 新合约地址、domain version 2、新 typehash |
| 一笔分账成功、另一笔失败 | 同交易执行，失败整体回滚 |
| 重入 Token | `ReentrancyGuardTransient`，状态先更新再外部转账 |
| 非标准 Token 少到账 | Token registry 禁止 fee-on-transfer/rebasing Token；方案 A 额外检查代理余额增量，方案 B 必须通过目标 Token fork 测试 |
| batch 调用方重定向收款人 | Proxy 从 Witness 内部构造固定顺序的 transfer details，外部调用方不能提供接收人数组 |
| 即时 scheme 跨网络签名分叉 | V1 冻结前统一选择一种 Permit2 类型，所有目标网络使用相同 wire format 和 type string |
| fee recipient 被后续修改 | 即时方案由 Witness 绑定；Batch 由 ChannelConfig 和 channelId 绑定 |
| 恶意 collector | 只允许部署配置中登记的 collector；deposit 后校验合约余额精确增加 |
| Batch 未及时 claim 被 payer withdraw | 沿用 withdraw delay；运营方必须在窗口内提交 claim 并监控 pending withdrawal |

## 11. 兼容性与部署

### 11.1 不修改旧合约

以下已部署合约保持不变：

- `x402ExactPermit2Proxy`；
- `x402UptoPermit2Proxy`；
- `x402BatchSettlement`；
- 旧 Batch deposit collectors。

新功能使用新 scheme 名和新合约地址。客户端不得在不识别 `serviceFee` 时回退到普通 `exact`、`upto` 或 `batch-settlement`。

### 11.2 CREATE2

- 即时 fee proxy 的构造参数只包含 canonical Permit2 地址，并在各链保持一致；
- Batch fee 合约使用无参数构造函数；
- 新 collector 的构造参数绑定 Batch fee 合约和 Permit2，因此需要独立计算并记录 CREATE2 地址；
- 部署后更新 contracts repo 的 `deployments/`、README 地址表，以及 SDK 的 network contract registry。

### 11.3 旧 Channel 迁移

旧 Channel 不能直接迁移到 V2，因为 ChannelConfig、channelId、Voucher 类型、EIP-712 domain 和状态布局均已改变。迁移流程只能是：

1. 停止在旧 Channel 创建新 Voucher；
2. claim/settle 已接受的旧 Voucher；
3. refund 或 withdraw 剩余余额；
4. 在 V2 创建包含 `feeRecipient` 的新 Channel 并重新 deposit。

## 12. 测试计划

### 12.1 Permit2 资金路径决策测试

- 校验每个目标网络已部署 Permit2 的 batch `permitWitnessTransferFrom` selector 和可信字节码来源；
- batch witness 的 Solidity 与 TypeScript digest golden vectors；
- 两个相同 Token permission 分别发送给 `payTo` 与 `feeRecipient`；
- permission 数组与 transfer details 数组长度不一致时回滚；
- Token 重复但接收人、金额或数组顺序被篡改时回滚或签名验证失败；
- 第一笔转账成功、第二笔失败时验证两笔转账和 nonce 消耗全部回滚；
- 对 Nile 和 Mainnet 目标 TRC-20 执行 fork 测试；
- 对两种候选方案执行 Gas benchmark，并记录最终选择依据。

### 12.2 `exact_fee`

- 正常业务款与服务费分账；
- 方案 B 的 permission 长度、重复 Token、固定顺序与两项金额校验；或方案 A 的 permitted total 与两个金额之和校验；
- payTo、feeRecipient、asset、金额或 Witness 被篡改时签名失败；
- 第二次使用相同 nonce 失败；
- 第一笔转账成功、第二笔失败时验证余额全部回滚；
- 恶意 Token 重入失败；
- TRON USDT fork 测试验证无 bool 返回值兼容性。

### 12.3 `upto_fee`

- 实际金额小于、等于最大金额；
- 实际金额大于最大金额回滚；
- 非 witness facilitator 调用回滚；
- facilitator 无法修改 fee；
- 零金额不调用合约、不消耗 nonce、不收费；
- 总 allowance/balance 按 `maxPaymentAmount + feeAmount` 校验。

### 12.4 Batch V2

- 两个累计金额正常、重复和倒退场景；
- 分别超过业务上限、费用上限和总余额；
- 只有一个累计增量时回滚；
- 多 Channel、同 receiver、不同 fee recipient 的隔离；
- settle 两笔转账的成功、空操作和第二笔失败回滚；
- claim 后 withdraw/refund 只能取未 claim 的 gross amount；
- claim 与 refund 的 Multicall 原子性；
- domain version/typehash 的 Solidity 与 TypeScript golden vectors；
- 新 collector 只能被绑定的 Batch V2 调用；
- 属性测试覆盖所有安全不变量和 `uint128` 边界。

### 12.5 集成测试

- Client -> Server -> Facilitator -> TRON Nile 的三种新 scheme；
- corrective 402 同步业务累计与费用累计；
- 服务端崩溃恢复后不会重复累计费用；
- 不支持 fee scheme 的旧客户端明确拒绝，而不是忽略费用继续支付；
- PAYMENT-RESPONSE 分别返回业务金额、服务费和总额。

## 13. 实施顺序

1. 对所有目标网络执行 Permit2 batch 部署验证、同 Token 双接收人测试和两种方案 Gas benchmark；
2. 按第 4.2 节规则统一选择方案 B 或方案 A；
3. 固化 wire fields、scheme 名、Permit2 类型和 EIP-712 golden vectors；
4. 实现 `x402FeePermit2ProxyBase` 与 `x402ExactFeePermit2Proxy`；
5. 实现 `x402UptoFeePermit2Proxy`；
6. 实现 `x402BatchSettlementFee` 和两种新 deposit collector；
7. 完成 Solidity 单元、属性、fork 测试及安全审计；
8. 部署测试网并登记新地址；
9. 实现 SDK Client/Server/Facilitator adapter；
10. 完成 Nile 端到端测试后再评估主网部署。

## 14. V1 决策摘要

| 决策 | 结论 |
| --- | --- |
| 费用模式 | 每笔成功 x402 资源支付收取固定费用 |
| 金额展示 | 业务金额、服务费、总扣款分别展示 |
| 即时分账资金路径 | 方案 B（Permit2 batch 直接分账）为条件性优选；所有目标网络验证通过后采用，否则全网络统一回退方案 A（拉入无状态代理后拆分） |
| 即时分账签名一致性 | 同一 V1 scheme 在所有网络使用同一种 Permit2 类型和 witness type string，不允许运行时切换 |
| `upto_fee` 零业务金额 | 不上链、不收费、不消耗 nonce |
| Batch Voucher | 分别签署业务累计上限和费用累计上限 |
| Batch claim | receiver authorizer 分别签署两个实际累计金额 |
| Batch settle 聚合键 | `(receiver, feeRecipient, token)` |
| 服务费资产 | 与业务资产相同 |
| EIP-3009 即时分账 | V1 不支持 |
| GasFree | 不纳入本设计 |
| 升级策略 | 新 scheme、新合约、新部署；旧合约不变 |
