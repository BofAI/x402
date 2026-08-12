# Extension: `eip2612GasSponsoring`

## Summary

`eip2612GasSponsoring` lets a client authorize the canonical Permit2 contract with an off-chain
EIP-2612 permit. The facilitator submits the token permit and the Permit2 payment together, so the
client does not need a prior on-chain approval transaction.

The current EVM implementation supports Permit2 payments for:

- [`exact`](../schemes/exact/scheme_exact_evm.md);
- [`upto`](../schemes/upto/scheme_upto_evm.md); and
- the Permit2 deposit path of
  [`batch-settlement`](../schemes/batch-settlement/scheme_batch_settlement_evm.md).

This extension is not used for EIP-3009 transfers or TRON schemes.

## Declaration

A resource server advertises the extension in `PaymentRequired.extensions`:

```json
{
  "eip2612GasSponsoring": {
    "info": {
      "description": "The facilitator accepts EIP-2612 gasless Permit to `Permit2` canonical contract.",
      "version": "1"
    },
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "from": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
        "asset": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
        "spender": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
        "amount": { "type": "string", "pattern": "^[0-9]+$" },
        "nonce": { "type": "string", "pattern": "^[0-9]+$" },
        "deadline": { "type": "string", "pattern": "^[0-9]+$" },
        "signature": { "type": "string", "pattern": "^0x[a-fA-F0-9]+$" },
        "version": { "type": "string", "pattern": "^[0-9]+(\\.[0-9]+)*$" }
      },
      "required": [
        "from",
        "asset",
        "spender",
        "amount",
        "nonce",
        "deadline",
        "signature",
        "version"
      ]
    }
  }
}
```

The extension schema validates the client-supplied `info` object, not the server's descriptive
`info` object.

## Client payload

The client adds the extension only when the server advertised it, the selected transfer method is
Permit2, and the current token allowance to Permit2 is insufficient. The signer must support token
contract reads and EIP-712 signing.

```json
{
  "extensions": {
    "eip2612GasSponsoring": {
      "info": {
        "from": "0x2222222222222222222222222222222222222222",
        "asset": "0x55d398326f99059fF775485246999027B3197955",
        "spender": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        "amount": "1000000",
        "nonce": "3",
        "deadline": "1786464300",
        "signature": "0x...",
        "version": "1"
      }
    }
  }
}
```

The signature uses the token's EIP-712 domain (`name`, `version`, EVM chain ID, and token address)
and the standard `Permit(owner,spender,value,nonce,deadline)` message. `spender` MUST be the
canonical Permit2 contract. The payment requirements therefore need accurate token `name` and
`version` metadata when automatic client signing is expected.

For exact and upto payments, `amount` is the Permit2 authorized amount. For a batch deposit it MUST
equal the deposit amount.

## Facilitator verification

Before accepting the extension, the facilitator MUST:

1. validate every field against the advertised schema;
2. match `from` to the payment payer and `asset` to the selected token;
3. require `spender` to equal canonical Permit2;
4. require the deadline to be at least six seconds in the future;
5. enforce the scheme-specific amount invariant; and
6. verify the complete settlement path, normally by simulating the proxy call.

The token contract validates the EIP-2612 signature and nonce when settlement executes. A malformed,
expired, replayed, or token-incompatible permit causes settlement to fail.

## Settlement

For exact and upto, the facilitator calls the scheme proxy's `settleWithPermit`, which invokes the
token permit before consuming the Permit2 authorization in the same transaction. For batch deposit,
the EIP-2612 permit data is included in the Permit2 deposit collector call.

If sufficient Permit2 allowance already exists, clients normally omit this extension and use the
standard Permit2 settlement path.
