# Extension: `erc20ApprovalGasSponsoring`

## Summary

`erc20ApprovalGasSponsoring` supports Permit2 payments for tokens that cannot use EIP-2612. The
client signs, but does not broadcast, an EIP-1559 transaction calling
`token.approve(Permit2, MaxUint256)`. The facilitator submits that transaction before settlement.

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
  "erc20ApprovalGasSponsoring": {
    "info": {
      "description": "The facilitator broadcasts a pre-signed ERC-20 approve() transaction to grant Permit2 allowance.",
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
        "signedTransaction": { "type": "string", "pattern": "^0x[a-fA-F0-9]+$" },
        "version": { "type": "string", "pattern": "^[0-9]+(\\.[0-9]+)*$" }
      },
      "required": ["from", "asset", "spender", "amount", "signedTransaction", "version"]
    }
  }
}
```

## Client payload

The client adds the extension only when the server advertised it, the selected transfer method is
Permit2, and the current token allowance is insufficient. Its signer must be able to read the token
allowance, obtain the account nonce and fee estimate, and sign an EIP-1559 transaction.

```json
{
  "extensions": {
    "erc20ApprovalGasSponsoring": {
      "info": {
        "from": "0x2222222222222222222222222222222222222222",
        "asset": "0x55d398326f99059fF775485246999027B3197955",
        "spender": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        "signedTransaction": "0x02...",
        "version": "1"
      }
    }
  }
}
```

The transaction target MUST be `asset`, its calldata MUST decode as
`approve(canonicalPermit2, amount)`, and it MUST be signed by `from`. The current client signs an
approval for `MaxUint256`.

## Facilitator verification

Before accepting the extension, the facilitator MUST:

1. validate the client `info` fields against the advertised schema;
2. match `from` to the payment payer and `asset` to the selected token;
3. require both the declared and calldata spender to equal canonical Permit2;
4. parse the serialized transaction and recover its signer;
5. require its target and selector to be the expected token and `approve` call; and
6. verify the Permit2 payment authorization and other scheme-specific invariants.

The signed transaction also needs a usable chain ID, nonce, gas limit, and fee settings. These values
are ultimately enforced by the network when the transaction is broadcast.

## Settlement and signer capability

The facilitator registers an extension signer with `sendTransactions`. Settlement passes two ordered
operations to it:

1. the client's serialized approval transaction; and
2. an unsigned call to the exact/upto proxy or batch-deposit contract.

The signer owns the execution strategy. It may submit sequential transactions, an account batch, or
an atomic bundle. Production deployments SHOULD use an atomic or otherwise protected strategy to
avoid approval/settlement races. If the signer implements `simulateTransactions`, verification can
simulate the combined sequence; otherwise the scheme falls back to prerequisite checks.

The `sendTransactions` result is ordered, and the final transaction hash is treated as the settlement
transaction. A missing extension signer makes this path unavailable.
