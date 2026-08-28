# Scheme: `exact` on `EVM`

## Summary

The `exact` scheme on EVM executes a transfer where the Facilitator (server) pays the gas, but the Client (user) controls the exact flow of funds via cryptographic signatures.

This repository selects one of two asset transfer methods, depending on the token's capabilities:

| AssetTransferMethod | Use Case                                                     | Recommendation                                 | Usage Semantics                     |
| :------------------ | :----------------------------------------------------------- | :--------------------------------------------- | :---------------------------------- |
| **1. EIP-3009**     | Tokens with native `transferWithAuthorization` (e.g., USDC). | **Recommended** (Simplest, truly gasless).     | One-time use                        |
| **2. Permit2**      | Tokens without EIP-3009. Uses a Proxy + Permit2.             | **Universal Fallback** (Works for any ERC-20). | One-time use                        |

If no `assetTransferMethod` is specified in `PaymentRequired.extra`, clients should default to `"eip3009"`. Payment payloads that use a non-default transfer method should echo the selected `assetTransferMethod` in `accepted.extra`.

In all cases, the Facilitator cannot modify the amount or destination. They serve only as the transaction broadcaster.

---

## 1. AssetTransferMethod: `EIP-3009`

The `eip3009` asset transfer method uses the `transferWithAuthorization` function directly on token contracts that support it.

### Phase 1: `PAYMENT-SIGNATURE` Header Payload

The `payload` field must contain:

- `signature`: The 65-byte signature of the `transferWithAuthorization` operation.
- `authorization`: The parameters required to reconstruct the signed message.

**Example PaymentPayload:**

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "maxTimeoutSeconds": 60,
    "extra": {
      "assetTransferMethod": "eip3009",
      "name": "USDC",
      "version": "2"
    }
  },
  "payload": {
    "signature": "0x2d6a7588d6acca505cbf0d9a4a227e0c52c6c34008c8e8986a1283259764173608a2ce6496642e377d6da8dbbf5836e9bd15092f9ecab05ded3d6293af148b571c",
    "authorization": {
      "from": "0x857b06519E91e3A54538791bDbb0E22373e36b66",
      "to": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      "value": "10000",
      "validAfter": "1740672089",
      "validBefore": "1740672154",
      "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480"
    }
  }
}
```

**`extra` field definitions specific to `eip3009`:**

- `extra.assetTransferMethod` (optional in `PaymentRequired`, default `"eip3009"`): if present, MUST be `"eip3009"`.
- `extra.name` (required): The EIP-712 domain name of the token contract. Used for `transferWithAuthorization` signature construction.
- `extra.version` (required): The EIP-712 domain version of the token contract. Used for `transferWithAuthorization` signature construction.

### Phase 2: Verification Logic

1.  **Verify** the signature is valid and recovers to the `authorization.from` address.
2.  **Verify** the `client` has sufficient balance of the `asset`.
3.  **Verify** the authorization parameters (Amount, Validity Window) meet the `PaymentRequirements`.
4.  **Verify** the Token and Network match the requirement.
5.  **Simulate** `token.transferWithAuthorization(...)` to ensure success.

### Phase 3: Settlement Logic

Settlement is performed via the facilitator calling the `transferWithAuthorization` function on the `EIP-3009` compliant contract with the `payload.signature` and `payload.authorization` parameters from the `PAYMENT-SIGNATURE` header.

---

## 2. AssetTransferMethod: `Permit2`

This asset transfer method uses the `permitWitnessTransferFrom` from the [canonical **Permit2** contract](#canonical-permit2) combined with a [`x402ExactPermit2Proxy`](#reference-implementation-x402exactpermit2proxy) to enforce receiver address security via the "Witness" pattern.

### Phase 1: One-Time Gas Approval

Permit2 requires the user to approve the [**Permit2 Contract** (Canonical Address)](#canonical-permit2) to spend their tokens. This is a one-time setup. The specification supports three ways to handle this:

#### Option A: Direct User Approval (Standard)

The user submits a standard on-chain `approve(Permit2)` transaction paying their own gas.

- _Prerequisite:_ User must have Native Gas currency.

#### Option B: Sponsored ERC20 Approval (Extension: [`erc20ApprovalGasSponsoring`](../../extensions/erc20_gas_sponsoring.md))

The client provides a signed approval transaction and the extension signer submits it before
settlement.

- _Prerequisite:_ Server supports this extension.
- _Flow:_ The extension signer receives the ordered operations `ERC20.approve(Permit2)` -> `settle`.
  The signer decides whether to execute sequentially, as an account batch, or through an atomic
  bundle, and is responsible for any gas-funding strategy it requires.

#### Option C: EIP2612 Permit (Extension: [`eip2612GasSponsoring`](../../extensions/eip2612_gas_sponsoring.md))

If the token supports EIP-2612, the user signs a permit authorizing Permit2.

- _Prerequisite:_ Token supports EIP-2612.
- _Flow:_ Facilitator calls `x402ExactPermit2Proxy.settleWithPermit()`

### Phase 2: `PAYMENT-SIGNATURE` Header Payload

The `payload` field must contain:

- `signature`: The signature for `permitWitnessTransferFrom`.
- `permit2Authorization`: Parameters to reconstruct the message.

**Important Logic:** The `spender` in the signature is the [**x402ExactPermit2Proxy**](#reference-implementation-x402exactpermit2proxy), not the Facilitator. This Proxy enforces that funds are only sent to the `witness.to` address.

> **Requirement**: This contract will be deployed to the same address across all supported EVM chains using `CREATE2` to ensure consistent behavior and simpler integration.

**Example PaymentPayload:**

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "maxTimeoutSeconds": 60,
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "extra": {
      "assetTransferMethod": "permit2",
      "name": "USDC",
      "version": "2"
    }
  },
  "payload": {
    "signature": "0x2d6a7588d6acca505cbf0d9a4a227e0c52c6c34008c8e8986a1283259764173608a2ce6496642e377d6da8dbbf5836e9bd15092f9ecab05ded3d6293af148b571c",
    "permit2Authorization": {
      "permitted": {
        "token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "amount": "10000"
      },
      "from": "0x857b06519E91e3A54538791bDbb0E22373e36b66",
      "spender": "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
      "nonce": "33247007178036348590600198031289925668252061821958005840077069883511451257277",
      "deadline": "1740672154",
      "witness": {
        "to": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
        "validAfter": "1740672089"
      }
    }
  }
}
```

**`extra` field definitions specific to `permit2`:**

- `extra.assetTransferMethod` (required): MUST be `"permit2"`.
- `extra.name` (conditional): The EIP-712 domain name of the token contract. Required when the token supports EIP-2612 for gasless Permit2 approval.
- `extra.version` (conditional): The EIP-712 domain version of the token contract. Required when the token supports EIP-2612 for gasless Permit2 approval.

### Phase 3: Verification Logic

The verifier must execute these checks in order:

1.  **Verify** `payload.signature` is valid and recovers to the `permit2Authorization.from`.

2.  **Verify** that the `client` has enabled the Permit2 approval.

    - if ERC20.allowance(from, Permit2_Address) < amount:
      - Check for **Sponsored ERC20 Approval** (Extension): Refers to [`erc20ApprovalGasSponsoring`](../../extensions/erc20_gas_sponsoring.md).
      - Check for **EIP2612 Permit** (Extension): Refers to [`eip2612GasSponsoring`](../../extensions/eip2612_gas_sponsoring.md).
      - **If neither exists:** Return `permit2_allowance_required`. The HTTP resource server maps
        this challenge to `412 Precondition Failed`, signaling that a one-time direct approval is
        required before retrying.

3.  **Verify** the `client` has sufficient balance of the `asset`.

4.  **Verify** the `permit2Authorization.amount` covers the payment.

5.  **Verify** the `deadline` (not expired) and `witness.validAfter` (active).

6.  **Verify** the Token and Network match the requirement.

7.  **Simulation (Recommended):**

    Simulation is recommended but implementations may defer to re-verify-before-settle.

    - _Standard:_ Simulate `x402ExactPermit2Proxy.settle`.
    - _With "Sponsored ERC20 Approval" (Extension):_ Ask the extension signer to simulate the
      ordered `approve` -> `settle` operations when it provides `simulateTransactions`; otherwise
      fall back to prerequisite checks.
    - _With "EIP2612 Permit" (Extension):_ Simulate `x402ExactPermit2Proxy.settleWithPermit`.

### Phase 4: Settlement Logic

Settlement is performed by calling the `x402ExactPermit2Proxy`.

1.  **Standard Settlement:**
    If the user has a sufficient direct allowance, call `x402ExactPermit2Proxy.settle`.

2.  **With Sponsored ERC20 Approval (Extension):**
    If `erc20ApprovalGasSponsoring` is used, the facilitator passes the signed approval and unsigned
    settlement calls to the registered extension signer in that order. Atomicity depends on the
    signer's execution strategy.

3.  **With EIP-2612 Permit (Extension):**
    If `eip2612GasSponsoring` is used, call `x402ExactPermit2Proxy.settleWithPermit`.

---

## Implementer Notes

- **Permit2 Dependency:** Integrators inherit the security properties and deployment assumptions of
  both the canonical Permit2 contract and `x402ExactPermit2Proxy`.
- **Smart-account signatures:** EIP-1271, ERC-6492 counterfactual wallets, and ERC-7702 delegated
  EOAs are supported as signature-validation forms for EIP-3009 and Permit2 payloads.

---

## Annex

### Canonical Permit2

The canonical Permit2 address used by this implementation is
`0x000000000022D473030F116dDEE9F6B43aC78BA3`.

### Reference Implementation: `x402ExactPermit2Proxy`

This contract acts as the authorized Spender. It validates the Witness data to ensure the destination cannot be altered by the Facilitator.

> **Requirement**: This contract will be deployed to the same address across all supported EVM chains using `CREATE2` to ensure consistent behavior and simpler integration.

**Canonical Address:** `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";

// Interface for EIP-2612 Support
interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

contract x402ExactPermit2Proxy {
    ISignatureTransfer public immutable PERMIT2;

    event x402PermitTransfer(address from, address to, uint256 amount, address asset);

    // EIP-712 Type Definition (post-audit: extra removed from Witness)
    string public constant WITNESS_TYPE_STRING =
        "Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)";

    bytes32 public constant WITNESS_TYPEHASH =
        keccak256("Witness(address to,uint256 validAfter)");

    struct Witness {
        address to;
        uint256 validAfter;
    }

    struct EIP2612Permit {
        uint256 value;
        uint256 deadline;
        bytes32 r;
        bytes32 s;
        uint8 v;
    }

    constructor(address _permit2) {
        PERMIT2 = ISignatureTransfer(_permit2);
    }

    /**
     * @notice Settles a transfer using a standard Permit2 signature
     */
    function settle(
        ISignatureTransfer.PermitTransferFrom calldata permit,
        address owner,
        Witness calldata witness,
        bytes calldata signature
    ) external {
        _settleInternal(permit, owner, witness, signature);
    }

    /**
     * @notice Extension: Settles a transfer using an EIP-2612 Permit for the allowance
     */
    function settleWithPermit(
        EIP2612Permit calldata permit2612,
        ISignatureTransfer.PermitTransferFrom calldata permit,
        address owner,
        Witness calldata witness,
        bytes calldata signature
    ) external {
        // 1. Submit the EIP-2612 Permit to the Token
        IERC20Permit(permit.permitted.token).permit(
            owner,
            address(PERMIT2),
            permit2612.value,
            permit2612.deadline,
            permit2612.v, permit2612.r, permit2612.s
        );

        // 2. Execute Permit2 Settlement
        _settleInternal(permit, owner, witness, signature);
    }

    function _settleInternal(
        ISignatureTransfer.PermitTransferFrom calldata permit,
        address owner,
        Witness calldata witness,
        bytes calldata signature
    ) internal {
        require(block.timestamp >= witness.validAfter, "Too early");

        ISignatureTransfer.SignatureTransferDetails memory transferDetails =
            ISignatureTransfer.SignatureTransferDetails({
                to: witness.to,
                requestedAmount: permit.permitted.amount
            });

        bytes32 witnessHash = keccak256(abi.encode(
            WITNESS_TYPEHASH,
            witness.to,
            witness.validAfter
        ));

        PERMIT2.permitWitnessTransferFrom(
            permit,
            transferDetails,
            owner,
            witnessHash,
            WITNESS_TYPE_STRING,
            signature
        );

        emit x402PermitTransfer(owner, transferDetails.to, transferDetails.requestedAmount, permit.permitted.token);
    }
}
```
