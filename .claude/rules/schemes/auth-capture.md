# Scheme: `auth-capture`

Code: `mechanisms/evm/src/auth-capture/**`. Class `AuthCaptureEvmScheme`. **EVM-only** (no TRON). No register helper — use `new + register`.

`auth-capture` adds **refundable payments** to x402, built on Base's audited [Commerce Payments Protocol](https://github.com/base/commerce-payments). The client signs a single payload (ERC-3009 **or** Permit2) over a payer-agnostic `PaymentInfo` hash. A facilitator submits it to `AuthCaptureEscrow`, where funds are **held under a `captureAuthorizer` role** rather than transferred straight to the merchant — enabling **capture, void, and refund** before settlement is final.

## When to use

- Payment that must be authorized first and captured (or voided / refunded) later — pre-auth / hold semantics, not an immediate transfer.

## Key invariants

- **`extra.captureAuthorizer` is required.** It is committed on-chain as `PaymentInfo.operator`; `authorize` / `capture` / `void` / `refund` / `charge` on `AuthCaptureEscrow` are gated by `onlySender(operator)`, so it must be the `msg.sender` of the `Authorize` call.
- Transfer method (ERC-3009 vs Permit2) follows the same `extra.assetTransferMethod` selection as `exact`; default is the ERC-3009 `ReceiveWithAuthorization` collector.
- `minFeeBps` / `maxFeeBps` bound the `captureAuthorizer`'s fee (in bps; `0` minimum = no floor).
- `AuthCaptureEscrow` + token-collector deployments come from the in-tree canonical address constants — don't hardcode.

## Testing

`mechanisms/evm/test/unit/auth-capture/**`.

## Safety

Escrow authorize/capture/void/refund + signing — **security-reviewer territory**.
