# Scheme: `exact_gasfree`

## Summary

`exact_gasfree` is a TRON-only exact-payment scheme in which the payer signs a GasFreeController
permit and a GasFree service provider relays the transaction. Payment value and the provider's fee
are deducted from the payer's GasFree smart-account token balance, so the payer does not need TRX.

This is distinct from `exact` with Permit2:

- funds reside in the payer's GasFree address;
- no Permit2 allowance is required;
- the signed permit includes the service provider and `maxFee`;
- settlement depends on an external GasFree relayer API.

## Invariants

- Both scheme fields MUST equal `exact_gasfree` and networks MUST match.
- The signed token and receiver MUST match the payment requirements.
- The signed value MUST be at least the required amount.
- The service provider MUST be returned by the configured relayer.
- The permit MUST be unexpired, signed by `user`, and use the network's GasFreeController domain.
- The GasFree address SHOULD have at least `value + maxFee` of the token before submission.

## Network Binding

- [TRON](scheme_exact_gasfree_tron.md)

## Trust Model

The payer trusts the selected provider and GasFree contracts to enforce `maxFee`. The facilitator
trusts the configured relayer API to report providers, accept permits, and return a final transaction
identifier. Implementations MUST fail closed if the provider list cannot be validated.
