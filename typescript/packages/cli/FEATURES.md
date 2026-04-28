# `x402-tools` CLI 设计与 `--help` 样例

`x402-tools` 是一个一次性的 x402 命令行工具，只做两件事：

- `server`: 拉起一个 x402 payment server，声明收款网络、token、金额和收款账户。
- `client`: 作为 x402 payer，请求一个 x402 URL，收到 402 后签名并完成支付。


## 核心设计

### 命令边界

| 命令 | 作用 |
|---|---|
| `x402-tools server` | 启动收款 server，暴露标准 x402 payment endpoint |
| `x402-tools client <url>` | 请求 x402 endpoint，自动完成 402 支付 flow |

### 默认值

| 字段 | 默认值 |
|---|---|
| token | `USDT` |
| network | 由 server/client 参数显式传入；可以给常用测试网默认值，但 help 中必须可见 |
| payment amount | 必须显式传入 `--decimal` 或 `--amount` |
| output | 默认 human；`--json` 输出机器可读 JSON |

### 金额字段

金额必须区分 `decimal` 和 `amount`：

| 字段 | 含义 | 示例 |
|---|---|---|
| `decimal` | 人类可读金额，由 token registry 解析 | `1.25` USDT |
| `amount` | token smallest unit，直接进入 x402 payment requirements | `1250000` for USDT |

CLI 参数设计：

```text
--decimal <decimal>     Human-readable token amount, e.g. 1.25
--amount <integer>  smallest-unit amount, e.g. 1250000 for 1.25 USDT
```

规则：

- `--decimal` 和 `--amount` 二选一。
- 同时传入时直接报错，避免歧义。
- `--decimal` 用于人类操作。
- `--amount` 用于 Agent、脚本、服务间精确传参。
- JSON 输出里同时展示两者：`decimal` 和 `amount`。

示例：

```json
{
  "token": "USDT",
  "decimal": "1.25",
  "amount": "1250000"
}
```

## `x402-tools --help`

```text
Usage: x402-tools <command> [options]

One-shot BankofAI x402 tools for serving and paying x402 endpoints.

Commands:
  server                Start a local x402 payment server
  client <url>          Pay an x402 endpoint as a client

Global options:
  --json                Print machine-readable JSON
  -h, --help            Show help
  -v, --version         Show version

Examples:
  # Start a payment server that charges 1.25 USDT on TRON Nile
  x402-tools server --pay-to TJWdoJk8... --decimal 1.25 --network tron:nile

  # Same amount, passed as raw smallest-unit USDT amount
  x402-tools server --pay-to TJWdoJk8... --amount 1250000 --network tron:nile

  # Pay the x402 endpoint
  x402-tools client http://127.0.0.1:4020/pay

  # Agent-friendly JSON output
  x402-tools client http://127.0.0.1:4020/pay --json
```

## `x402-tools server --help`

```text
Usage: x402-tools server [options]

Start a temporary x402 payment server.

Required options:
  --pay-to <address>        Recipient wallet address
  --decimal <decimal>      Human-readable amount, e.g. 1.25
    or
  --amount <integer>    Smallest-unit amount, e.g. 1250000 for 1.25 USDT

Payment options:
  --network <id>            Payment network, e.g. tron:nile, tron:mainnet, eip155:97
  --token <symbol>          Token symbol from the built-in registry (default: USDT)
  --scheme <name>           x402 scheme: exact_permit, exact, exact_gasfree

Server options:
  --host <host>             Bind host (default: 127.0.0.1)
  --port <port>             Bind port (default: 4020)
  --resource-url <url>      Resource URL advertised in x402 requirements
                            (default: derived from host/port as http://host:port/pay)

Wallet options:
  --wallet <source>         Wallet source: agent-wallet, env (default: agent-wallet)

Runtime options:
  --daemon                  Run server in background and print process id

Output options:
  --json                    Print server info as JSON
  -h, --help                Show help

Examples:
  x402-tools server --pay-to TJWdoJk8... --decimal 1.25 --network tron:nile

  x402-tools server \
    --pay-to TJWdoJk8... \
    --amount 1250000 \
    --token USDT \
    --network tron:nile \
    --scheme exact_gasfree \
    --port 4020

  x402-tools server \
    --pay-to 0x742d... \
    --decimal 0.5 \
    --network eip155:97 \
    --scheme exact_permit

  x402-tools server \
    --pay-to TJWdoJk8... \
    --decimal 1.25 \
    --network tron:nile \
    --daemon
```

### `server` 行为

`server` 启动一个本地 HTTP endpoint，用标准 x402 方式收款：

| Endpoint | 行为 |
|---|---|
| `GET /health` | 返回 server 状态 |
| `GET /.well-known/x402` | 返回当前收款配置 |
| `GET/POST /pay` | 未支付时返回 402；带 payment payload 时验证并结算 |

启动后 human 输出示例：

```text
x402-tools server listening
  pay_url:      http://127.0.0.1:4020/pay
  resource_url: http://127.0.0.1:4020/pay
  network:      tron:nile
  scheme:       exact_gasfree
  token:        USDT
  decimal:      1.25
  amount:   1250000
  pay_to:       TJWdoJk8...
```

`--daemon` 输出示例：

```text
x402-tools server started
  pid:          42817
  pay_url:      http://127.0.0.1:4020/pay
  resource_url: http://127.0.0.1:4020/pay
```

`--json` 输出示例：

```json
{
  "ok": true,
  "command": "server",
  "result": {
    "pid": null,
    "pay_url": "http://127.0.0.1:4020/pay",
    "resource_url": "http://127.0.0.1:4020/pay",
    "network": "tron:nile",
    "scheme": "exact_gasfree",
    "token": "USDT",
    "decimal": "1.25",
    "amount": "1250000",
    "pay_to": "TJWdoJk8..."
  }
}
```

`--daemon --json` 输出示例：

```json
{
  "ok": true,
  "command": "server",
  "result": {
    "pid": 42817,
    "pay_url": "http://127.0.0.1:4020/pay",
    "resource_url": "http://127.0.0.1:4020/pay"
  }
}
```

## `x402-tools client --help`

```text
Usage: x402-tools client <url> [options]

Request an x402 endpoint and pay when the server returns 402 Payment Required.

Arguments:
  url                       x402 protected URL, e.g. http://127.0.0.1:4020/pay

Payment safety options:
  --max-decimal <decimal>   Maximum human-readable amount allowed
  --max-amount <int>    Maximum smallest-unit amount allowed
  --network <id>            Require a specific network
  --token <symbol>          Require a specific token (default: USDT)
  --scheme <name>           Require a specific x402 scheme

Request options:
  --method <method>         HTTP method (default: GET)
  --header <k:v>            HTTP header; can be repeated
  --body <value>            Request body string or JSON

Wallet options:
  --wallet <source>         Wallet source: agent-wallet, env (default: agent-wallet)

Mode options:
  --dry-run                 Read payment requirements but do not sign or pay
  --yes                     Skip interactive confirmation
  --json                    Print machine-readable JSON
  -h, --help                Show help

Examples:
  x402-tools client http://127.0.0.1:4020/pay

  x402-tools client http://127.0.0.1:4020/pay \
    --max-decimal 1.25 \
    --network tron:nile \
    --token USDT

  x402-tools client https://api.example.com/generate \
    --method POST \
    --header 'Content-Type: application/json' \
    --body '{"prompt":"hello"}' \
    --max-amount 1250000 \
    --json

  x402-tools client http://127.0.0.1:4020/pay --dry-run --json
```

### `client` 行为

`client` 的职责是完成标准 x402 client flow：

1. 请求目标 URL。
2. 如果不是 402，直接输出 response 摘要。
3. 如果返回 402，解析 payment requirements。
4. 检查 `--max-decimal` / `--max-amount` / `--network` / `--token` / `--scheme` 限制。
5. 用 agent wallet 或 env fallback 签名。
6. 携带 payment payload 重试请求。
7. 输出最终 response 和 payment result。

Dry-run 输出示例：

```json
{
  "ok": true,
  "command": "client",
  "dry_run": true,
  "result": {
    "url": "http://127.0.0.1:4020/pay",
    "accepts": [
      {
        "network": "tron:nile",
        "scheme": "exact_gasfree",
        "token": "USDT",
        "decimal": "1.25",
        "amount": "1250000",
        "pay_to": "TJWdoJk8..."
      }
    ]
  }
}
```

支付成功输出示例：

```json
{
  "ok": true,
  "command": "client",
  "result": {
    "url": "http://127.0.0.1:4020/pay",
    "status": 200,
    "network": "tron:nile",
    "scheme": "exact_gasfree",
    "token": "USDT",
    "decimal": "1.25",
    "amount": "1250000",
    "transaction": "0x...",
    "response_body": {}
  }
}
```

## 使用场景

### 本地收款测试

终端 A：

```bash
x402-tools server --pay-to TJWdoJk8... --decimal 1 --network tron:nile
```

终端 B：

```bash
x402-tools client http://127.0.0.1:4020/pay --max-decimal 1 --json
```

### Agent 支付 API

```bash
x402-tools client https://api.example.com/premium \
  --max-amount 1000000 \
  --token USDT \
  --json
```

### 服务端生成固定金额收款口

```bash
x402-tools server \
  --host 0.0.0.0 \
  --port 4020 \
  --pay-to TJWdoJk8... \
  --amount 5000000 \
  --token USDT \
  --network tron:nile \
  --scheme exact_gasfree
```

### BSC gas-free 用户体验

```bash
x402-tools server \
  --pay-to 0x742d... \
  --decimal 0.5 \
  --token USDT \
  --network eip155:97 \
  --scheme exact_permit

x402-tools client http://127.0.0.1:4020/pay --max-decimal 0.5 --network eip155:97
```
