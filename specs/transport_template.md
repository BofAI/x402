# Transport: `<name>`

## Summary

Describe the request/response protocol that carries x402 v2 objects.

## Payment Required Signaling

Define how the server carries a `PaymentRequired` object and how clients detect it.

## Payment Payload Transmission

Define how a client carries a `PaymentPayload` object on the retried request.

## Settlement Response Delivery

Define how the server carries a `SettleResponse` after processing payment.

## Encoding and Limits

Define serialization, character encoding, size limits, and duplicate-field behavior.

## Error Handling

Map protocol failures to transport-specific status or error forms.

## Security Considerations

Cover integrity, confidentiality, intermediary behavior, replay, and logging of payment data.

## References

- [Core x402 v2 Specification](x402-specification-v2.md)
- Relevant transport protocol documentation
