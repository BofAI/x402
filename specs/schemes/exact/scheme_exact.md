# Scheme: `exact`

## Summary

`exact` transfers the amount quoted in `PaymentRequirements.amount` to `PaymentRequirements.payTo`
for one protected request. The client signs the complete payment terms and the facilitator pays the
network fee required to submit settlement.

## Invariants

Every `exact` network binding MUST enforce:

- `paymentPayload.accepted.scheme` and `paymentRequirements.scheme` are `exact`.
- The accepted and verified network identifiers match.
- The signed asset matches `paymentRequirements.asset`.
- The signed recipient matches `paymentRequirements.payTo`.
- The signed value equals `paymentRequirements.amount`; overpayment and underpayment are invalid.
- The authorization is active, has not expired, and cannot be replayed after settlement.
- The signature is valid for the payer under the selected network binding.
- Settlement re-verifies the authorization before changing network state.

## Lifecycle

1. The resource server advertises one or more `exact` requirements.
2. The client selects a supported network and transfer method and signs an authorization.
3. The facilitator verifies the authorization without transferring value.
4. The resource server performs the protected work.
5. The facilitator re-verifies and settles the exact amount.
6. The resource server returns the result and a `SettleResponse` through the selected transport.

## Network Bindings

- [EVM](scheme_exact_evm.md): EIP-3009 or Permit2 with EIP-712 signatures.
- [TRON](scheme_exact_tron.md): TIP-712 TransferWithAuthorization or Permit2.

The TRON-only `exact_gasfree` flow is a separate scheme because it signs a GasFreeController permit,
charges a relayer fee from a GasFree wallet, and has a different trust boundary. See
[`exact_gasfree`](../exact-gasfree/scheme_exact_gasfree.md).

## Security Considerations

The facilitator MUST NOT take a token, amount, recipient, deadline, spender, or verification contract
from untrusted payload fields without matching it to the requirements and binding-specific constants.
Best-effort balance or allowance reads do not replace signature and settlement validation; on-chain
execution remains authoritative.
