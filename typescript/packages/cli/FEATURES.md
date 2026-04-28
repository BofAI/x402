# `x402` CLI 设计与用法样例

`x402` 是 BankofAI x402 的命令行入口，面向开发者、脚本和 Agent。它把支付、转账、临时收款 server、收款请求和本地凭证统一成一组可组合命令。

## 设计目标

- **直接支付**：`x402 pay <url>` 访问 x402 protected endpoint，遇到 `402 Payment Required` 后自动完成支付并重试请求。
- **直接转账**：`x402 transfer` 不依赖业务 server，直接按 `network + token + amount + recipient` 发起转账。
- **临时收款**：`x402 server` 启动一个本地收款 endpoint，设置网络、token、金额和收款账户，付款方用 `x402 pay` 完成支付。
- **Agent 友好**：所有命令支持 `--json`，输出稳定结构，便于 Agent 解析和继续执行。
- **Gas-free 优先**：优先选择用户侧不需要链上 gas 的路径，例如 BSC `exact` / `exact_permit`、TRON `exact_permit`，必要时兼容 TRON `exact_gasfree`。

## 使用场景

### Agent 直接转账

Agent 先检查环境和余额，再发起一次可解析的 JSON 转账。

```bash
x402 doctor --json
x402 balance --token USDT --json
x402 transfer --to TJWdoJk8... --amount 0.1 --token USDT --network tron:nile --json
```

### 一方开 server，另一方付款

收款方启动临时收款 server：

```bash
x402 server --pay-to TJWdoJk8... --amount 1 --token USDT --network tron:nile --port 4020
```

付款方通过标准 x402 flow 支付：

```bash
x402 pay http://receiver.example.com:4020/pay --json
```

### 生成请求，交给另一个 Agent 支付

收款方先生成结构化请求：

```bash
x402 request --to TJWdoJk8... --amount 1 --token USDT --network tron:nile --format json
```

另一个 Agent 读取请求后执行转账：

```bash
x402 transfer --to TJWdoJk8... --amount 1 --token USDT --network tron:nile
```

## 全局设计

### 钱包

产品形态优先使用 BankofAI `agent-wallet` 的 active wallet：

| 网络 | 钱包来源 |
|---|---|
| `tron:*` | agent wallet 的 TRON active wallet |
| `eip155:*` | agent wallet 的 EVM active wallet |

开发和本地调试可以保留环境变量 fallback：

| 变量 | 用途 |
|---|---|
| `TRON_PRIVATE_KEY` | TRON fallback signer |
| `EVM_PRIVATE_KEY` | EVM fallback signer |

CLI 不提供 `--private-key` 参数，避免私钥进入 shell history。

### 配置

默认配置放在 `~/.x402/config.json`。命令参数优先级：

```text
CLI flag > environment variable > profile > BankofAI default
```

典型 profile：

```json
{
  "defaultProfile": "nile",
  "profiles": {
    "nile": {
      "network": "tron:nile",
      "scheme": "exact_permit",
      "token": "USDT",
      "wallet": { "network": "tron", "source": "agent-wallet" }
    }
  }
}
```

### 输出

默认输出给人看；`--json` 输出给 Agent 和脚本看。

```json
{
  "ok": true,
  "command": "transfer",
  "network": "tron:nile",
  "scheme": "exact_permit",
  "result": {}
}
```

失败输出保持同一 envelope：

```json
{
  "ok": false,
  "command": "transfer",
  "error": {
    "code": "VERIFY_FAILED",
    "message": "Payment verification failed",
    "hint": "Check token, amount, network, and wallet balance."
  }
}
```

## 命令设计

| 命令 | 设计用途 |
|---|---|
| `x402 config` | 管理 profile、默认网络、默认 token、默认 scheme |
| `x402 doctor` | 检查钱包、网络、facilitator、token 配置是否可用 |
| `x402 balance` | 查看钱包余额、GasFree address 和费用信息 |
| `x402 transfer` | 给一个账户直接转账 |
| `x402 pay <url>` | 支付一个 x402 protected resource |
| `x402 server` | 启动临时收款 server |
| `x402 request` | 离线生成转账请求 URI/JSON |
| `x402 receipt` | 查看本地支付/转账凭证 |

## 转账路径设计

### 默认选择

`x402 transfer` 在未指定 `--scheme` 时按 `(network, token)` 选择推荐路径。

| 网络 | Token | 推荐 scheme | 用户侧 gas |
|---|---|---|---|
| `tron:nile` | USDT | `exact_permit` | 不需要 TRX |
| `tron:mainnet` | USDT | `exact_permit` | 不需要 TRX |
| `eip155:97` | USDT / USDC | `exact_permit` | 不需要 BNB |
| `eip155:97` | DHLU | `exact` | 不需要 BNB |
| `tron:*` | 不支持 permit 的 token | `exact_gasfree` | 不需要 TRX，但会扣 GasFree fee |

### TRON 兼容策略

TRON USDT 默认走 `exact_permit`。如果需要首次 approve 且钱包没有 TRX/energy/bandwidth 导致 approve 不可完成，CLI 可以 fallback 到 `exact_gasfree`。

```text
TRON USDT -> exact_permit -> approve 不可用 -> exact_gasfree fallback
```

### 费用语义

- `exact`：用户签授权，settler 支付链上 gas。
- `exact_permit`：用户签 permit/typed data，settler 支付链上 gas。
- `exact_gasfree`：TRON GasFree provider 代付 TRX gas，费用从 GasFree 余额中扣除。

## 用法样例

### 1. 初始化配置

```bash
x402 config init --profile nile --network tron:nile --token USDT --scheme exact_permit
x402 config use nile
x402 config get
```

### 2. 检查环境

```bash
x402 doctor
x402 doctor --network tron:nile --json
```

### 3. 查看余额

```bash
x402 balance --token USDT
x402 balance --network tron:nile --token USDT --json
```

### 4. 直接转账给一个账户

TRON USDT，默认走 `exact_permit`：

```bash
x402 transfer --to TJWdoJk8... --amount 1.25 --token USDT --network tron:nile
```

显式指定 TRON GasFree：

```bash
x402 transfer --to TJWdoJk8... --amount 1.25 --token USDT --network tron:nile --scheme exact_gasfree
```

BSC testnet USDT，走 `exact_permit`：

```bash
x402 transfer --to 0x742d... --amount 0.5 --token USDT --network eip155:97 --scheme exact_permit
```

BSC testnet DHLU，走 `exact`：

```bash
x402 transfer --to 0x742d... --amount 10 --token DHLU --network eip155:97 --scheme exact
```

Dry-run 预览，不签名、不付款：

```bash
x402 transfer --to TJWdoJk8... --amount 0.1 --token USDT --dry-run --json
```

### 5. 支付一个 x402 URL

```bash
x402 pay https://api.example.com/premium
```

带请求体：

```bash
x402 pay https://api.example.com/generate \
  --method POST \
  --header 'Content-Type: application/json' \
  --body '{"prompt":"hello"}'
```

限制最大支付金额，单位是 token smallest unit：

```bash
x402 pay https://api.example.com/premium --max-amount 1000000 --json
```

Dry-run 只查看服务端接受哪些 payment requirements：

```bash
x402 pay https://api.example.com/premium --dry-run --json
```

### 6. 启动临时收款 server

收 TRON Nile USDT：

```bash
x402 server \
  --host 0.0.0.0 \
  --port 4020 \
  --pay-to TJWdoJk8... \
  --amount 1.25 \
  --token USDT \
  --network tron:nile \
  --scheme exact_gasfree
```

付款方支付：

```bash
x402 pay http://localhost:4020/pay
```

查看收款配置：

```bash
curl http://localhost:4020/.well-known/x402-transfer
```

返回示例：

```json
{
  "network": "tron:nile",
  "scheme": "exact_gasfree",
  "token": "USDT",
  "amount": "1250000",
  "amountDisplay": "1.25 USDT",
  "payTo": "TJWdoJk8...",
  "payUrl": "http://localhost:4020/pay"
}
```

### 7. 离线生成收款请求

生成 URI：

```bash
x402 request --to TJWdoJk8... --amount 1.25 --token USDT --network tron:nile --format uri
```

生成 JSON：

```bash
x402 request --to TJWdoJk8... --amount 1.25 --token USDT --network tron:nile --format json
```

输出示例：

```json
{
  "type": "x402-transfer-request",
  "network": "tron:nile",
  "scheme": "exact_permit",
  "token": "USDT",
  "amount": "1250000",
  "amountDisplay": "1.25 USDT",
  "to": "TJWdoJk8..."
}
```

### 8. 查看凭证

```bash
x402 receipt list --limit 10
x402 receipt show <paymentId-or-txHash>
x402 receipt export --format csv > receipts.csv
```
