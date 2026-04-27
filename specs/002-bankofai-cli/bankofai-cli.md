# Feature Specification: BankofAI x402 CLI

**Feature Branch**: `002-bankofai-cli`  
**Created**: 2026-04-27  
**Status**: Draft  
**Input**: User description: "设计 x402 cli 命令行工具，能直接发起支付；或者拉起一个 server 设置网络、token 和金额，通过 BankofAI x402 SDK 的 GasFree 功能实现 gas-free 转账"

## 目标

提供一个 `x402` 命令行工具，让开发者和 Agent 可以直接完成支付与转账：

- 访问 x402 保护资源并自动完成 `402 Payment Required` 支付。
- 不依赖业务资源 server，直接按 `network + token + amount + recipient` 发起一次转账。
- 启动一个极简收款 server，配置网络、token、金额和收款地址，让付款方通过标准 x402 HTTP flow 完成转账。
- 复用 BankofAI SDK 已有能力，包括 `exact_permit`、`exact`、TRON `exact_gasfree` 和 GasFree 余额/费用/签名逻辑。

CLI 不重新定义协议，不绕过 BankofAI facilitator 的 verify/settle 职责；它只是把 BankofAI SDK 能力组织成可执行工具。

## 包形态

建议新增 TypeScript package：

```text
typescript/packages/cli/
  package.json              # name: @bankofai/x402-cli, bin: x402
  src/index.ts              # command router
  src/config.ts             # profile/env/config loading
  src/wallet.ts             # signer creation
  src/client.ts             # X402Client factory
  src/commands/pay.ts
  src/commands/transfer.ts
  src/commands/serve.ts
  src/commands/balance.ts
  src/commands/inspect.ts
  src/commands/config.ts
  src/commands/request.ts
  src/commands/receipt.ts
  src/commands/doctor.ts
  src/output.ts              # human/json output helpers
  src/amount.ts              # token amount parsing/formatting
  src/receipts.ts            # local receipt store
```

发布后使用方式：

```bash
npm install -g @bankofai/x402-cli
x402 --help
```

开发期也可以从 workspace 运行：

```bash
pnpm --filter @bankofai/x402-cli dev -- --help
```

## BankofAI 默认栈

CLI 第一版默认使用 BankofAI 的实现和托管服务：

- SDK package: `@bankofai/x402`
- CLI package: `@bankofai/x402-cli`
- Wallet provider: `@bankofai/agent-wallet`
- TRON GasFree/facilitator proxy: `https://facilitator.bankofai.io/<network>`
- Token registry: BankofAI SDK 内置 token registry
- 默认转账路径: `tron:nile` + `USDT` + `exact_gasfree`

第三方 facilitator、RPC、token registry 可以作为高级配置保留，但不作为默认体验。

## 核心概念

### profile

CLI 使用 profile 保存默认网络、facilitator、GasFree API、RPC 和钱包 provider。默认位置：

```text
~/.x402/config.json
```

示例：

```json
{
  "defaultProfile": "nile",
  "profiles": {
    "nile": {
      "network": "tron:nile",
      "scheme": "exact_gasfree",
      "facilitatorUrl": "https://facilitator.bankofai.io/nile",
      "gasfreeApiUrl": "https://facilitator.bankofai.io/nile",
      "wallet": {
        "provider": "agent-wallet",
        "network": "tron"
      }
    },
    "mainnet": {
      "network": "tron:mainnet",
      "scheme": "exact_gasfree",
      "facilitatorUrl": "https://facilitator.bankofai.io/mainnet",
      "gasfreeApiUrl": "https://facilitator.bankofai.io/mainnet",
      "wallet": {
        "provider": "agent-wallet",
        "network": "tron"
      }
    }
  }
}
```

优先级：CLI flag > environment variable > profile > BankofAI SDK default config。

### wallet

MVP 只接入 BankofAI SDK 现有 signer factory：

- TRON: `TronClientSigner.create()`
- EVM: `EvmClientSigner.create()`

避免在命令行 flag 中传私钥。后续如需本地私钥，可只支持环境变量或系统 keychain，不支持 shell history 中可见的 `--private-key`。

### amount

用户输入使用人类可读金额，CLI 根据 token registry 转换为 smallest unit。

```bash
--amount 1.25 --token USDT
```

如果 token registry 不包含该 token，可显式传地址和 decimals：

```bash
--asset TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t --decimals 6 --token USDT
```

金额解析规则：

- `--amount` 永远表示人类可读金额，例如 `1.25`。
- `PaymentRequirements.amount` 永远使用 smallest unit 字符串，例如 `1250000`。
- `--max-amount` 使用 smallest unit，方便和 protocol 字段直接比较。
- `--json` 输出同时包含 `amount` 和 `amountDisplay`。

### receipt

CLI 需要本地 receipt store，默认位置：

```text
~/.x402/receipts.jsonl
```

每次 `pay`、`transfer`、`serve transfer` 成功 settle 后追加一行 JSON，便于审计和 Agent 后续引用。

## 命令设计

### 1. `x402 pay`

访问一个 x402 保护 URL，遇到 402 后自动选择支付要求、签名、重试并输出响应。

```bash
x402 pay https://api.example.com/premium \
  --profile nile \
  --scheme exact_gasfree \
  --max-amount 1000000 \
  --json
```

常用参数：

```text
x402 pay <url>
  --method <GET|POST|PUT|DELETE>     default: GET
  --body <json|string|@file>
  --header <k:v>                     repeatable
  --profile <name>
  --network <network>
  --scheme <scheme>
  --token <symbol>
  --max-amount <smallest-unit>
  --facilitator-url <url>
  --gasfree-api-url <url>
  --dry-run                          parse challenge and build plan, do not sign
  --yes                              skip interactive confirmation
  --json                             machine-readable output
```

交互确认示例：

```text
Payment required
  resource: https://api.example.com/premium
  scheme: exact_gasfree
  network: tron:nile
  token: USDT
  amount: 0.1 USDT
  max fee: 0.003 USDT
  pay to: T...
Proceed? [y/N]
```

成功输出：

```json
{
  "ok": true,
  "status": 200,
  "scheme": "exact_gasfree",
  "network": "tron:nile",
  "token": "USDT",
  "amount": "100000",
  "paymentResponse": {
    "success": true,
    "transaction": "..."
  }
}
```

### 2. `x402 transfer`

直接转账，不要求对方先启动业务 server。CLI 本地构造 `PaymentRequirements`，向 facilitator 获取 fee quote，使用 SDK 生成 `PaymentPayload`，然后调用 facilitator `/verify` 和 `/settle`。

```bash
x402 transfer \
  --to TYm... \
  --amount 1.25 \
  --token USDT \
  --network tron:nile \
  --scheme exact_gasfree
```

常用参数：

```text
x402 transfer
  --to <address>                     recipient / payTo
  --amount <decimal>                 human amount, e.g. 1.25
  --token <symbol>                   e.g. USDT
  --asset <address>                  optional explicit token address
  --decimals <n>                     required when --asset is not in registry
  --network <network>
  --scheme <exact_gasfree|exact_permit|exact>
  --facilitator-url <url>
  --gasfree-api-url <url>
  --payment-id <id>                  optional reconciliation id
  --valid-for <seconds>              default by scheme/network
  --dry-run
  --yes
  --json
```

内部流程：

```text
1. resolve profile, network, scheme, token, signer
2. normalize amount to smallest unit
3. build PaymentRequirements { scheme, network, amount, asset, payTo }
4. call facilitator /fee_quote when scheme requires fees
5. attach extra.fee to requirements
6. create PaymentPermitContext with paymentId, nonce, validAfter, validBefore
7. create PaymentPayload through X402Client mechanism
8. call facilitator /verify
9. call facilitator /settle
10. print tx hash / GasFree trace / structured result
```

`exact_gasfree` 场景下，这个命令就是 gas-free transfer：用户签 TIP-712，GasFree service provider 代付 TRON gas，费用从 GasFree custodial wallet 中扣除。

### 3. `x402 serve transfer`

启动一个临时收款 server，把收款条件暴露成标准 x402 protected endpoint。付款方只需要执行 `x402 pay <server-url>/pay`。

```bash
x402 serve transfer \
  --host 0.0.0.0 \
  --port 4020 \
  --pay-to TYm... \
  --amount 1.25 \
  --token USDT \
  --network tron:nile \
  --scheme exact_gasfree \
  --facilitator-url https://facilitator.bankofai.io/nile
```

Endpoints：

```text
GET  /health
GET  /.well-known/x402-transfer       returns configured payment terms
POST /pay                             protected endpoint, settles payment and returns receipt
GET  /qr                              optional: terminal/browser QR for payer URL
```

`/.well-known/x402-transfer` 示例：

```json
{
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "token": "USDT",
  "asset": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  "amount": "1250000",
  "payTo": "TYm...",
  "payUrl": "http://127.0.0.1:4020/pay"
}
```

付款方：

```bash
x402 pay http://127.0.0.1:4020/pay --profile nile
```

这个模式适合临时收款、Agent-to-Agent 支付、二维码收款和本地测试。它完全走标准 HTTP 402 challenge-response flow。

### 4. `x402 balance`

查看主钱包和 GasFree wallet 余额。

```bash
x402 balance --network tron:nile --token USDT --gasfree
```

输出：

```text
Address:        TTX...
GasFreeAddress: TErc...
USDT main:      0.000000
USDT gasfree:   12.500000
active:         true
allowSubmit:    true
nonce:          7
transferFee:    0.003000 USDT
activateFee:    0.000000 USDT
```

### 5. `x402 inspect`

调试用命令，只读取信息，不签名、不付款。

```bash
x402 inspect https://api.example.com/premium --profile nile
x402 inspect transfer --to TYm... --amount 1 --token USDT --network tron:nile
```

用途：

- 查看 server 返回的 `accepts[]`。
- 查看 CLI 会选择哪个 scheme/network/token。
- 查看 estimated amount + fee + deadline。
- 检查 GasFree account 是否 active、余额是否足够。

### 6. `x402 config`

管理 BankofAI CLI profile。`config` 不触发签名，也不访问链上。

```bash
x402 config init
x402 config use nile
x402 config get
x402 config set nile.facilitatorUrl https://facilitator.bankofai.io/nile
```

常用参数：

```text
x402 config init
  --profile <name>                   default: nile
  --network <network>                default: tron:nile
  --scheme <scheme>                  default: exact_gasfree
  --force                            overwrite existing config

x402 config use <profile>
x402 config get [key]
x402 config set <key> <value>
x402 config list
```

`config init` 生成 BankofAI 默认配置：

```json
{
  "defaultProfile": "nile",
  "profiles": {
    "nile": {
      "network": "tron:nile",
      "scheme": "exact_gasfree",
      "facilitatorUrl": "https://facilitator.bankofai.io/nile",
      "gasfreeApiUrl": "https://facilitator.bankofai.io/nile",
      "wallet": {
        "provider": "agent-wallet",
        "network": "tron"
      }
    }
  }
}
```

### 7. `x402 request`

生成收款请求，不启动 server，不 settle。它适合二维码、聊天消息、Agent-to-Agent 任务描述。

```bash
x402 request \
  --to TYm... \
  --amount 1.25 \
  --token USDT \
  --network tron:nile \
  --scheme exact_gasfree
```

默认输出 URI：

```text
x402://transfer?network=tron%3Anile&scheme=exact_gasfree&token=USDT&amount=1250000&to=TYm...
```

常用参数：

```text
x402 request
  --to <address>
  --amount <decimal>
  --token <symbol>
  --asset <address>
  --decimals <n>
  --network <network>
  --scheme <scheme>
  --memo <text>
  --expires-in <seconds>
  --format <uri|json|qr>             default: uri
```

`--format json` 输出：

```json
{
  "type": "x402-transfer-request",
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "token": "USDT",
  "asset": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  "amount": "1250000",
  "amountDisplay": "1.25 USDT",
  "to": "TYm...",
  "memo": "invoice 1001",
  "expiresAt": 1770000000
}
```

MVP 只生成请求，不直接保证收款。真正收款仍由 `x402 transfer` 或 `x402 serve transfer` 执行。

### 8. `x402 receipt`

查询本地支付凭证。

```bash
x402 receipt list
x402 receipt show <payment-id>
x402 receipt export --format json
```

常用参数：

```text
x402 receipt list
  --profile <name>
  --network <network>
  --scheme <scheme>
  --token <symbol>
  --from <unix|iso-date>
  --to <unix|iso-date>
  --limit <n>
  --json

x402 receipt show <payment-id|tx-hash|trace-id>
x402 receipt export --format <json|csv>
```

receipt 记录结构：

```json
{
  "paymentId": "x402-transfer-...",
  "command": "transfer",
  "createdAt": "2026-04-27T10:00:00.000Z",
  "profile": "nile",
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "payer": "TTX...",
  "payTo": "TYm...",
  "token": "USDT",
  "asset": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  "amount": "1250000",
  "amountDisplay": "1.25 USDT",
  "feeAmount": "3000",
  "settlement": {
    "success": true,
    "transaction": "...",
    "traceId": "..."
  }
}
```

### 9. `x402 doctor`

诊断本地环境、BankofAI endpoints 和 GasFree account 状态。这个命令只读，不签名、不付款。

```bash
x402 doctor --profile nile
```

检查项：

- Node.js 版本满足 CLI 要求。
- 能加载 `@bankofai/x402` 和 `@bankofai/agent-wallet`。
- 当前 wallet provider 能返回地址。
- `https://facilitator.bankofai.io/nile` 可访问。
- GasFree API 能返回 address info。
- token registry 能解析目标 token。
- main wallet 派生的 `gasFreeAddress` 可用。

输出示例：

```text
BankofAI x402 doctor
  profile: nile
  wallet:  TTX... ok
  network: tron:nile ok
  token:   USDT ok
  gasfree: TErc... active=true allowSubmit=true ok
  balance: 12.500000 USDT ok
```

## 关键实现点

### 模块职责

```text
src/config.ts
  loadConfig()
  saveConfig()
  resolveProfile(flags)
  resolveEndpoint(profile, network)

src/wallet.ts
  createSigner(network)
  getSignerAddress(signer)

src/client.ts
  createX402Client(profile, signer)
  registerBankofAITronGasFree(client, signer, profile)

src/amount.ts
  resolveToken(network, tokenOrAsset, decimals?)
  parseHumanAmount(amount, decimals)
  formatAmount(amountSmallest, decimals, symbol)

src/facilitator.ts
  feeQuote(requirements)
  verify(payload, requirements)
  settle(payload, requirements)

src/receipts.ts
  appendReceipt(receipt)
  listReceipts(filters)
  findReceipt(id)

src/output.ts
  printHuman(result)
  printJson(result)
  maskAddress(address)
```

### 命令路由

推荐使用轻量 CLI framework，例如 `commander` 或 `cac`。命令函数只负责参数解析和 orchestration，协议细节放到 service/helper 模块。

```text
index.ts
  x402 pay
  x402 transfer
  x402 serve transfer
  x402 balance
  x402 inspect
  x402 config
  x402 request
  x402 receipt
  x402 doctor
```

### X402Client factory

按 network 注册机制：

```text
tron:*       exact_permit, exact_gasfree
 eip155:*    exact_permit, exact
```

对 `exact_gasfree` 必须创建 network -> `GasFreeAPIClient` 映射：

```text
tron:mainnet -> getGasFreeApiBaseUrl("tron:mainnet") or --gasfree-api-url
tron:nile    -> getGasFreeApiBaseUrl("tron:nile") or --gasfree-api-url
tron:shasta  -> getGasFreeApiBaseUrl("tron:shasta") or --gasfree-api-url
```

默认注册 `SufficientBalancePolicy`，但 `--skip-balance-check` 可作为专家参数保留。

BankofAI 默认 factory 伪代码：

```ts
async function createBankofAIClient(profile: Profile) {
  const signer = await TronClientSigner.create()
  const x402 = new X402Client()

  x402.register('tron:*', new ExactPermitTronClientMechanism(signer))
  x402.registerGasFree(signer, {
    [profile.network]: new GasFreeAPIClient(profile.gasfreeApiUrl),
  })
  x402.registerPolicy(SufficientBalancePolicy)

  return { x402, signer }
}
```

### transfer 的 PaymentRequirements

`x402 transfer` 的 requirements 由 CLI 生成，不来自 HTTP server：

```json
{
  "scheme": "exact_gasfree",
  "network": "tron:nile",
  "amount": "1250000",
  "asset": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  "payTo": "TYm...",
  "maxTimeoutSeconds": 120,
  "extra": {
    "name": "Tether USD",
    "version": "1",
    "fee": {
      "facilitatorId": "...",
      "feeTo": "...",
      "feeAmount": "3000"
    }
  }
}
```

`extra.fee` 应来自 facilitator `/fee_quote`。如果 facilitator 对某 token 没有 fee quote，CLI 必须失败，而不是自己猜 fee。

### transfer 的 facilitator 调用

`x402 transfer` 要显式调用 BankofAI facilitator：

```text
POST {facilitatorUrl}/fee_quote
POST {facilitatorUrl}/verify
POST {facilitatorUrl}/settle
```

如果 `fee_quote` 返回多个 quote，按 `(scheme, network, asset)` 精确匹配。匹配不到就失败：

```text
FEE_QUOTE_NOT_FOUND
```

`verify` 失败时不允许继续 settle：

```text
VERIFY_FAILED
```

`settle` 成功后立即写 receipt。

### serve transfer 的幂等性

每次 402 challenge 生成新的 `paymentId` 和 `nonce`。`POST /pay` 成功后返回 settlement receipt。MVP 可以只保存在内存；后续可加 `--receipt-db sqlite:///...`。

`serve transfer` 必须缓存已发出的 challenge，settle 时做 anti-tampering 校验：

```text
payload.accepted.scheme == issued.scheme
payload.accepted.network == issued.network
payload.accepted.asset == issued.asset
payload.accepted.amount == issued.amount
payload.accepted.payTo == issued.payTo
```

MVP 缓存策略：

- key: `paymentId`
- value: issued `PaymentRequirements` + expiry
- storage: memory
- cleanup: 每 60 秒删除过期 challenge

### 输出格式

默认面向人类，`--json` 面向 Agent 和脚本。所有命令的 JSON 输出遵循：

```json
{
  "ok": true,
  "command": "transfer",
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "result": {}
}
```

失败时：

```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_GASFREE_BALANCE",
    "message": "Insufficient balance in GasFree wallet TErc...",
    "hint": "Deposit USDT to the GasFree address derived from your main wallet."
  }
}
```

### 标准错误码

CLI 应该把常见异常归一化成稳定错误码，方便 Agent 判断下一步。

```text
CONFIG_NOT_FOUND
PROFILE_NOT_FOUND
UNSUPPORTED_NETWORK
UNSUPPORTED_SCHEME
TOKEN_NOT_FOUND
INVALID_AMOUNT
WALLET_NOT_AVAILABLE
GASFREE_ACCOUNT_NOT_ACTIVE
INSUFFICIENT_GASFREE_BALANCE
FEE_QUOTE_NOT_FOUND
VERIFY_FAILED
SETTLE_FAILED
FACILITATOR_UNAVAILABLE
PAYMENT_CANCELLED
RECEIPT_NOT_FOUND
```

每个错误都应该包含 `message` 和可选 `hint`。例如 GasFree 余额不足时，hint 必须提示充值到 main wallet 派生的 `gasFreeAddress`。

## 安全边界

- 默认付款前确认，除非传 `--yes` 或在非 TTY + `--json` 场景显式传 `--yes`。
- 不支持 `--private-key`，避免泄露到 shell history。
- `--dry-run` 不签名、不调用 settle。
- 输出中默认隐藏地址中间段；`--verbose` 才显示完整 payload。
- `transfer` 必须在 settle 前调用 verify；verify 失败直接终止。
- 对 `exact_gasfree`，余额检查必须查 main wallet 派生的 `gasFreeAddress`，不能递归查询 GasFree address。

## MVP 范围

第一版建议只做 BankofAI TRON GasFree 闭环：

1. `x402 config init/use/get`：生成并读取 BankofAI `nile` profile。
2. `x402 doctor`：确认 wallet、BankofAI facilitator、GasFree account 可用。
3. `x402 balance --gasfree`：显示 main wallet、GasFree address、USDT 余额和 fee。
4. `x402 transfer`：支持 `tron:nile` + `exact_gasfree` + `USDT`，打通 gas-free 转账闭环。
5. `x402 pay <url>`：复用 `X402FetchClient`，支持 BankofAI TRON GasFree protected URL。
6. `x402 serve transfer`：本地临时收款 server，内存 challenge 和 receipt。
7. `x402 receipt list/show`：查询本地成功支付记录。

暂不做：

- 多签钱包交互式权限选择。
- 私钥导入和 keystore 管理。
- 长期订单数据库。
- fiat pricing 和实时汇率。
- 跨链路由或 swap。
- 自动充值 GasFree wallet。
- 非 BankofAI facilitator 默认接入。

### MVP 验收标准

`config`：

- 没有配置文件时，`x402 config init` 能创建 `~/.x402/config.json`。
- `x402 config get` 能显示当前 profile。
- flag 可以覆盖 profile 中的 network/scheme/facilitator/gasfree URL。

`doctor`：

- wallet 不可用时返回 `WALLET_NOT_AVAILABLE`。
- BankofAI GasFree endpoint 不可用时返回 `FACILITATOR_UNAVAILABLE`。
- GasFree address info 可显示 `active`、`allowSubmit`、`nonce`。

`balance`：

- 显示 main wallet 和 main-wallet-derived `gasFreeAddress`。
- 余额检查必须查 GasFree address，不允许递归查询 GasFree address 的 GasFree address。

`transfer`：

- `--dry-run` 不签名、不调用 settle。
- 正常路径调用 `fee_quote -> createPaymentPayload -> verify -> settle`。
- verify 失败不 settle。
- settle 成功写入 `~/.x402/receipts.jsonl`。
- `--json` 输出稳定 JSON，便于 Agent 使用。

`pay`：

- 能解析 402 response header/body。
- 能根据 profile 注册 `exact_gasfree`。
- 成功响应保存 receipt。

`serve transfer`：

- `GET /.well-known/x402-transfer` 返回收款配置。
- `POST /pay` 未付款返回 402。
- 付款后返回 settlement receipt。
- payload accepted fields 必须和 server issued requirements 一致。

## 后续扩展

- `x402 request --format qr`: 生成二维码。
- `x402 receipt export --format csv`: 导出支付记录。
- `x402 mcp`: 把 CLI 暴露为 MCP tool，给 Agent 直接调用。
- `x402 faucet/deposit-helper`: 测试网辅助充值到 GasFree address。
- `x402 serve transfer --public-url`: 配合 tunnel 生成可外部访问的收款链接。
- `x402 transfer --from-request <uri>`: 读取 `x402://transfer?...` 收款请求并付款。
