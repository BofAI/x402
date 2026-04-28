# `x402` CLI — 功能与用法

`@bankofai/x402-cli` v0.1.0,二进制 `x402`,Node ≥ 20。

## 安装

```bash
pnpm --filter @bankofai/x402-cli build
node typescript/packages/cli/dist/index.js --help

# 发布后
npm install -g @bankofai/x402-cli
x402 --help
```

## 全局约定

- **钱包**:从环境变量读私钥(0x 前缀十六进制),CLI 不接受 `--private-key`。
  - `TRON_PRIVATE_KEY` —— `tron:*` 网络
  - `EVM_PRIVATE_KEY` —— `eip155:*` 网络
- **配置**:`~/.x402/config.json`(可用 `X402_CONFIG_FILE` 改)。
- **输出**:每条命令默认人类可读;加 `--json`(或 `X402_OUTPUT=json`)输出统一信封:
  ```json
  { "ok": true,  "command": "...", "network": "...", "scheme": "...", "result": { ... } }
  { "ok": false, "command": "...", "error": { "code": "...", "message": "...", "hint": "..." } }
  ```
- **优先级**:CLI flag > 环境变量 > profile > SDK 默认值。

## 命令一览

| 命令 | 作用 | 是否签名 | 是否上链 |
|---|---|---|---|
| `config init/use/get/set/list` | 管理本地 profile | – | – |
| `doctor` | 诊断环境与 facilitator | – | – |
| `balance` | 查链上余额 + GasFree 状态 | – | – |
| `transfer` | 直接转账 | ✓ | ✓ |
| `pay <url>` | 访问 402 资源,自动支付 | ✓ | ✓ |
| `serve transfer` | 启动临时收款服务器 | – (服务端);✓ (付款方) | ✓ |
| `receipt list/show/export` | 查本地凭证 | – | – |
| `request` | 离线生成转账请求 URI | – | – |

---

## `x402 config` —— 管理 profile

```bash
x402 config init [--profile <name>] [--network <id>] [--scheme <s>] [--force] [--json]
x402 config use <name>
x402 config get [name]
x402 config set <key> <value>           # 例: nile.network tron:nile,defaultProfile mainnet
x402 config list
```

第一次运行 `x402 config init` 会建出默认配置(`nile` profile = TRON Nile + USDT + `exact_permit`,加一个 `mainnet` 预设)。`--force` 覆盖已有配置。

`config set` 支持的字段:`defaultProfile`、`<profile>.network`、`<profile>.scheme`、`<profile>.token`、`<profile>.wallet.network`(`tron`|`evm`)。

```bash
$ x402 config init
✓ config init
  path: ~/.x402/config.json
  defaultProfile: nile
  profiles: ["nile","mainnet"]
  created: true

$ x402 config get
✓ config get
  profile: nile
  isDefault: true
  network: tron:nile
  scheme: exact_permit
  token: USDT
  wallet: {"network":"tron"}
```

---

## `x402 doctor` —— 诊断

```bash
x402 doctor [--profile <n>] [--network <id>] [--json]
```

跑 5 项独立检查,各自报 `ok` / `warn` / `fail` / `skipped`:

| 检查项 | 内容 |
|---|---|
| `node` | Node 版本 ≥ 20 |
| `wallet` | 私钥环境变量已设 + 能派生地址 |
| `facilitator` | BankofAI hosted facilitator 可达(先试 `/api/v1/config/provider/all`,再回落 `/supported`) |
| `gasfree` | 仅 `exact_gasfree` on TRON:`getAddressInfo` 返回 active + nonce |
| `token` | profile 默认 token 在 SDK 注册表中 |

`overall` 仅当无 `fail` 时为 `ok`。一项 `fail` 不阻塞其他检查。

```bash
$ TRON_PRIVATE_KEY=0x... x402 doctor
✓ doctor
  profile: nile
  network: tron:nile
  scheme: exact_permit
  wallet: TTX1Us...3J3i
  overall: ok
  checks: [
    { name: node,        status: ok, detail: 20.19.5 },
    { name: wallet,      status: ok, detail: TTX1Us...3J3i },
    { name: facilitator, status: ok, detail: https://facilitator.bankofai.io/nile/... },
    { name: gasfree,     status: skipped, detail: not applicable: scheme=exact_permit ... },
    { name: token,       status: ok, detail: USDT on tron:nile }
  ]
```

---

## `x402 balance` —— 查余额

```bash
x402 balance [--profile <n>] [--network <id>] [--token <sym>] [--verbose] [--json]
```

每个 asset 同时显示:

- `chainBalance` —— 直接查 TRC-20 `balanceOf`,**链上权威**。
- `apiBalance` —— GasFree API 返回值,可能延迟(标 `apiBalanceStale: true`)。
- `transferFee` / `activateFee` —— 来自 GasFree API。

地址默认遮蔽(`TTX1Us...3J3i`),`--verbose` 显示完整。`--token <sym>` 过滤指定币。

```bash
$ x402 balance --json
{
  "result": {
    "network": "tron:nile",
    "wallet": "TTX1Us...3J3i",
    "gasFreeAddress": "TErc7V...FYUt",
    "active": true, "allowSubmit": true, "nonce": 7,
    "assets": [{
      "symbol": "USDT",
      "chainBalance": "23294800", "chainBalanceDisplay": "23.2948",
      "apiBalance": "0", "apiBalanceDisplay": "0", "apiBalanceStale": true,
      "transferFee": "0.1", "activateFee": "1"
    }]
  }
}
```

链上 ≠ API 时 stderr 会打印 `[x402] GasFree API balance is stale ... Trust the chain figure.`

---

## `x402 transfer` —— 直接转账

```bash
x402 transfer --to <address> --amount <decimal>
              [--token <symbol>] [--asset <addr>] [--decimals <n>]
              [--network <id>] [--scheme <s>] [--profile <n>]
              [--valid-for <seconds>] [--payment-id <id>]
              [--dry-run] [--yes] [--json]
```

CLI 本地构造 `PaymentRequirements`,根据 scheme 走不同结算路径:

- **`exact` / `exact_permit`(EVM 或 TRON)** —— 调 BankofAI 根 facilitator `/fee/quote → /verify → /settle`。**facilitator 付链上 gas,用户 0 fee**(BSC 已实测 fee=0)。
- **`exact_gasfree`(仅 TRON)** —— 直接走 GasFree submit/wait,GasFree provider 收 ~0.1 USDT/笔。

`--scheme` 不传时按 `(network, token)` 自动选最便宜:

| Network | Token | 自动选 | 用户 fee |
|---|---|---|---|
| BSC testnet (eip155:97) | DHLU | `exact` | 0 |
| BSC testnet (eip155:97) | USDT/USDC | `exact_permit` | 0 |
| TRON Nile (tron:nile) | USDT | `exact_permit` | 0 |
| TRON Nile (tron:nile) | USDD | `exact_gasfree` | 0.1 USDT |
| TRON Mainnet (tron:mainnet) | USDT | `exact_permit` | 0 |

**`--dry-run`** 完整跑通 fee_quote 但不签名、不上链,输出会带 `feeAsPercentageOfAmount`;费用 ≥ 10% 时 stderr 出 WARNING。

成功后追加一条 receipt 到 `~/.x402/receipts.jsonl`。

```bash
$ x402 transfer --to TJWdoJk8Kyrf... --amount 0.001 --token USDT --json
{
  "result": {
    "paymentId": "0x...",
    "payer": "TTX1Us...",
    "payTo": "TJWdoJk8...",
    "token": "USDT", "amount": "1000", "amountDisplay": "0.001 USDT",
    "feeAmount": "0",
    "transaction": "0xe6458fcbf1da1da9a0c638cf68b357982781ae932b6742a02331d2371bfeaf30"
  }
}

# Dry-run + 自动 fee 警告
$ x402 transfer --to ... --amount 0.001 --token USDT --dry-run
[x402] WARNING: GasFree relayer fee is 0.1 USDT, which is 10000.0% of the
0.001 USDT payment ...
✓ transfer
  dryRun: true
  feeAsPercentageOfAmount: 10000
  ...
```

---

## `x402 pay <url>` —— 访问 402 保护的 URL

```bash
x402 pay <url> [--method GET]
               [--header 'Key: value'] (可重复)
               [--body '{...}']
               [--max-amount <smallest-unit>]
               [--profile <n>] [--network <id>] [--scheme <s>]
               [--dry-run] [--json]
```

包装 SDK 的 `X402FetchClient`。CLI 自动注册当前网络可用的所有 client 机制:

- EVM: `ExactEvmClientMechanism` + `ExactPermitEvmClientMechanism`
- TRON: `ExactPermitTronClientMechanism` + `registerGasFree`

服务器返回 402 时 SDK 自动签名重试。CLI 解码响应 header 里的 `PAYMENT-RESPONSE`,成功则写 receipt。

`--dry-run` 只发一次请求,解码 `PAYMENT-REQUIRED` 头报告服务器接受的 `accepts[]`,**不签名不付钱**。

```bash
$ x402 pay https://api.example.com/premium --json
{
  "result": {
    "url": "https://api.example.com/premium",
    "status": 200,
    "paymentResponse": {
      "success": true,
      "transaction": "0x...",
      "network": "eip155:97"
    },
    "body": { ... }
  }
}
```

---

## `x402 serve transfer` —— 临时收款服务器

```bash
x402 serve transfer --pay-to <address> --amount <decimal>
                    [--token <symbol>] [--port 4020] [--host 127.0.0.1]
                    [--profile <n>] [--network <id>] [--scheme <s>]
                    [--json]
```

启动一个极简 HTTP server(Node 原生 `http`,无框架):

| Endpoint | 行为 |
|---|---|
| `GET /health` | `{ ok: true }` |
| `GET /.well-known/x402-transfer` | 返回收款条件 JSON |
| `GET \| POST /pay` | 未带签名:发 402 + PaymentRequirements;带签名:验证 → 结算 → 返回 200 + `PAYMENT-RESPONSE` |

challenge 缓存 5 分钟。SIGINT/SIGTERM 优雅关停,等飞行中的 settle 完成。

付款方只需 `x402 pay http://<host>:<port>/pay`。

当前实现仅支持 TRON `exact_gasfree`(EVM serve 是 post-MVP)。

```bash
$ x402 serve transfer --pay-to TJWdoJk8... --amount 0.001 --token USDT --port 4321
x402 serve transfer listening on http://127.0.0.1:4321/pay
  (network=tron:nile scheme=exact_gasfree token=USDT amount=0.001 payTo=TJWdoJk8...)

$ curl http://127.0.0.1:4321/.well-known/x402-transfer
{
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "token": "USDT",
  "amount": "1000",
  "amountDisplay": "0.001 USDT",
  "payTo": "TJWdoJk8...",
  "payUrl": "http://127.0.0.1:4321/pay"
}
```

---

## `x402 receipt` —— 本地凭证

```bash
x402 receipt list [--profile <n>] [--network <id>] [--scheme <s>] [--token <sym>]
                  [--from <ts>] [--to <ts>] [--limit <n>] [--json]
x402 receipt show <paymentId | txHash>
x402 receipt export --format json | csv
```

凭证存在 `~/.x402/receipts.jsonl`(可用 `X402_RECEIPT_FILE` 改)。每次成功 `transfer` / `pay` / `serve transfer` settle 追加一行 JSON。

```bash
$ x402 receipt list --token USDT --limit 3
✓ receipt list
  total: 12, matched: 12
  receipts: [
    { paymentId: "0x...", command: "transfer", token: "USDT",
      amountDisplay: "0.001 USDT", success: true, transaction: "0x..." },
    ...
  ]

$ x402 receipt show 0xe6458fcbf1da1da9a0c638cf68b357982781ae932b6742a02331d2371bfeaf30
✓ receipt show
  paymentId: 0x...
  command: transfer
  network: eip155:97
  scheme: exact_permit
  payer: 0x0f2A...
  payTo: 0x6d36...
  amount: 1000000000000000
  amountDisplay: 0.001 USDT
  feeAmount: 0
  settlement: { success: true, transaction: 0xe6458fcb... }

$ x402 receipt export --format csv
# 全部 receipts 输出为 CSV
```

---

## `x402 request` —— 离线生成转账请求

```bash
x402 request --to <address> --amount <decimal>
             [--token <symbol>] [--asset <addr>] [--decimals <n>]
             [--network <id>] [--scheme <s>] [--profile <n>]
             [--memo <text>] [--expires-in <seconds>]
             [--format uri | json]
```

**不签名、不读钱包、不调 facilitator**——纯本地生成 `x402://transfer?...` URI 或 JSON,供二维码、聊天消息、Agent 任务描述用。

```bash
$ x402 request --to TJWdoJk8... --amount 1.25 --token USDT --json
{
  "result": {
    "uri": "x402://transfer?network=tron%3Anile&scheme=exact_permit&token=USDT&asset=TXYZ...&amount=1250000&to=TJWdoJk8...",
    "request": {
      "type": "x402-transfer-request",
      "network": "tron:nile", "scheme": "exact_permit",
      "token": "USDT", "amount": "1250000",
      "amountDisplay": "1.25 USDT", "to": "TJWdoJk8..."
    }
  }
}
```

---

## 全局环境变量

| 变量 | 用途 |
|---|---|
| `TRON_PRIVATE_KEY` | TRON 钱包私钥 |
| `EVM_PRIVATE_KEY` | EVM 钱包私钥 |
| `TRON_GRID_API_KEY` | 可选,转给 SDK 走 TronGrid |
| `X402_PROFILE` | 当前 profile 名 |
| `X402_NETWORK` / `X402_SCHEME` / `X402_TOKEN` | 单字段覆盖 |
| `X402_OUTPUT` | `json` 或 `human`(默认) |
| `X402_CONFIG_FILE` | 配置 JSON 路径 |
| `X402_RECEIPT_FILE` | receipt JSONL 路径 |
| `X402_FACILITATOR_URL_OVERRIDE` | **e2e 专用**,改成 active 时 stderr 会出警告 |

## 标准错误码

`error.code` 字段会是以下之一(一共 15 种):

```
CONFIG_NOT_FOUND  PROFILE_NOT_FOUND  UNSUPPORTED_NETWORK  UNSUPPORTED_SCHEME
TOKEN_NOT_FOUND   INVALID_AMOUNT     WALLET_NOT_AVAILABLE GASFREE_ACCOUNT_NOT_ACTIVE
INSUFFICIENT_GASFREE_BALANCE  FEE_QUOTE_NOT_FOUND  VERIFY_FAILED  SETTLE_FAILED
FACILITATOR_UNAVAILABLE  PAYMENT_CANCELLED  RECEIPT_NOT_FOUND  INVALID_INPUT  IO_ERROR
```

## 典型工作流

```bash
# Day 1
x402 config init                       # 写默认 profile
export TRON_PRIVATE_KEY=0x...
x402 doctor                            # 5 项绿色

# 转账给某人
x402 transfer --to TJWdoJk8... --amount 0.1 --token USDT

# 在 BSC 上 0 fee 转账
export EVM_PRIVATE_KEY=0x...
x402 transfer --to 0x... --amount 0.001 --token USDT --network eip155:97

# 起一个临时收款 server,让别人来付
x402 serve transfer --pay-to TJWdoJk8... --amount 1 --token USDT --port 4020 &
# 别人:
x402 pay http://your-host:4020/pay

# 查记录
x402 receipt list --limit 10
x402 receipt show <txHash>
x402 receipt export --format csv > receipts.csv
```
