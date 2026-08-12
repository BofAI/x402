# Scheme: `<name>` on `<network-family>`

## Summary

Describe how the generic scheme is implemented on this network family.

## Network and Contracts

Document CAIP-2 identifiers, address representation, required contracts, and deployment discovery.

## Payment Requirements

Document scheme-specific fields in `PaymentRequirements.extra`.

## Payment Payload

Document the object carried in `PaymentPayload.payload`, including a complete v2 JSON example.

## Typed Data or Authorization

Document signature domain, primary type, field order, and address normalization.

## Verification

List all required validation steps in order.

## Settlement

Document the on-chain or relayer action and the resulting `SettleResponse`.

## Error Codes

List stable scheme-specific `invalidReason` and `errorReason` values.

## Security Considerations

Cover replay protection, amount and recipient binding, expiry, simulation, and external trust.
