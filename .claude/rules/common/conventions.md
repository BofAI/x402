# x402 Conventions

Repository-wide conventions that apply to every component, every language, every scheme. Break these silently and you will produce bugs that take days to diagnose.

## Addressing

- **Lowercase everything**: addresses, selectors, event topics.
- **TRON + EIP/TIP-712**: convert TRON Base58 addresses (`T...`) to **0x-prefixed EVM hex** before passing to any EIP-712 / TIP-712 signer. This applies to `verifyingContract`, `token`, `serviceProvider`, `user`, `receiver`, and any other `address`-typed field, **both in the domain and in the message**. See [docs/solutions.md entry #1](../../../docs/solutions.md).
- **Network identifiers**: CAIP-2 `eip155:<chainId>` for EVM, `tron:<name>` for TRON. Detection rule: `tron:` prefix → TRON, `eip155:` prefix → EVM. See [docs/specs/config.md](../../../docs/specs/config.md).

## Amounts & fees

- **Fees in millionths** (e.g. `3000` = 0.3%).
- **Token amounts in smallest unit** (wei / sun). Never use floating point. Use `BigInt` in TS, `int` in Python.

## Payment identifiers

- **`paymentId`**: 16 random bytes, serialized as `0x` + 32 hex chars. Used as `bytes16` in EIP-712 / TIP-712 signatures.

## HTTP wire format

- **Header encoding**: `Base64(UTF-8(JSON.stringify(object)))`.
- **Headers** (see [docs/specs/protocol.md](../../../docs/specs/protocol.md)):
  - `PAYMENT-REQUIRED` — server → client (402 response)
  - `PAYMENT-SIGNATURE` — client → server (retry request)
  - `PAYMENT-RESPONSE` — server → client (success response, with settlement info)
- **Fallback**: the 402 response body MAY contain `PaymentRequired` as raw JSON; clients try the header first, then the body.
- **Protocol version**: `x402Version: 2`.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `DeliveryKind` | `"PAYMENT_ONLY"` | Only supported delivery mode |
| `KIND_MAP["PAYMENT_ONLY"]` | `0` | uint8 mapping for EIP-712 signing |

## Mechanism registration

- **Exact match** (e.g. `"tron:nile"`) outranks **wildcard** (e.g. `"tron:*"`). Register more specific first, or accept that exact-match mechanisms win the lookup regardless of insertion order.
- Each mechanism is associated with a scheme (`exact`, `exact_permit`, `exact_gasfree`, ...). Do not conflate schemes across mechanisms; register each scheme-network pair explicitly.

## Policy pipeline

Client payment selection is a five-step pipeline (see [docs/specs/roles.md](../../../docs/specs/roles.md)):

```
[1] Filter by scheme  →  [2] Filter by network  →  [3] Filter by max amount
  →  [4] Filter by registered mechanisms  →  [5] Apply policies (user-registered)
```

Step [5] is the insertion point for budget caps, approval hooks, audit logging. Policies receive the list and return a filtered/reordered subset; they should be pure, idempotent, and fast.

## Commit messages

Format: `<type>(<scope>): <description>`.

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Scopes (choose the narrowest one that fits): `python`, `typescript`, `tron`, `evm`, `gasfree`, `facilitator`, `client`, `server`, `specs`, `docs`, `ci`, `design`.
