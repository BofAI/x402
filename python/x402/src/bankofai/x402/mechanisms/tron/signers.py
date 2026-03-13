"""TRON signer implementations using tronpy + eth_account.

Faithfully mirrors the TypeScript FacilitatorTronSigner / ClientTronSigner
behaviour:
  - verifyTypedData uses the same hash path as tronUtils.typedData.verifyTypedData
    (EIP-712 struct hash, no EIP-191 prefix) and compares normalised EVM addresses.
  - signTypedData uses the same key bytes via eth_account's sign_typed_data.
  - writeContract avoids the broken Python *args-after-default-arg pattern.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

try:
    from tronpy import Tron
    from tronpy.keys import PrivateKey
    from tronpy.providers import HTTPProvider
except ImportError as e:
    raise ImportError(
        "TRON signers require tronpy. Install with: pip install tronpy"
    ) from e

from .utils import normalize_address_for_signing


@dataclass
class TronTransactionReceipt:
    """Simplified receipt from a TRON transaction."""
    status: str   # "success" | "reverted" | "pending"
    tx_hash: str


# ---------------------------------------------------------------------------
# TIP-712 / EIP-712 helpers
# ---------------------------------------------------------------------------

def _normalize_message_for_signing(message: dict) -> dict:
    """Normalize a TIP-712 message dict for eth_account.

    - TRON base58 addresses → 0x hex
    - bytes32 nonces kept as "0x…" hex strings (eth_account accepts them)
    """
    result = {}
    for k, v in message.items():
        if isinstance(v, str) and v.startswith("T") and len(v) == 34:
            result[k] = normalize_address_for_signing(v)
        else:
            result[k] = v
    return result


def _compute_tip712_digest(domain: dict, types: dict, primary_type: str, message: dict) -> bytes:
    """Compute the TIP-712 struct hash the same way TronWeb does.

    TronWeb's tronUtils.typedData.verifyTypedData internally uses the standard
    EIP-712 encoding (domainSeparator || structHash), so we replicate it with
    eth_account._utils.typed_data.hash_typed_data.
    """
    from eth_account._utils.typed_data import hash_typed_data  # type: ignore

    # eth_account needs "EIP712Domain" in types
    full_types = {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"},
        ],
        **{k: v for k, v in types.items()},
    }

    domain_norm = {
        **domain,
        "verifyingContract": normalize_address_for_signing(
            domain.get("verifyingContract", "0x" + "00" * 20)
        ),
    }

    msg_norm = _normalize_message_for_signing(message)

    full_typed_data = {
        "types": full_types,
        "primaryType": primary_type,
        "domain": domain_norm,
        "message": msg_norm,
    }
    return hash_typed_data(full_typed_data)


# ---------------------------------------------------------------------------
# Facilitator signer
# ---------------------------------------------------------------------------

class FacilitatorTronSigner:
    """Facilitator-side TRON signer (verify + settle).

    Example:
        ```python
        signer = FacilitatorTronSigner(
            private_key="your_hex_private_key",
            full_node="https://nile.trongrid.io",
        )
        ```
    """

    def __init__(self, private_key: str, full_node: str = "https://api.trongrid.io") -> None:
        pk = private_key.removeprefix("0x")
        self._pk = PrivateKey(bytes.fromhex(pk))
        self._client = Tron(HTTPProvider(full_node))
        self._address: str = self._pk.public_key.to_base58check_address()

    @property
    def address(self) -> str:
        return self._address

    def get_addresses(self) -> list[str]:
        return [self._address]

    def verify_typed_data(
        self,
        address: str,
        domain: dict,
        types: dict,
        primary_type: str,
        message: dict,
        signature: str,
    ) -> bool:
        """Verify a TIP-712 signature.

        Mirrors tronUtils.typedData.verifyTypedData:
          1. Compute standard EIP-712 digest (same bytes as TronWeb).
          2. ecrecover the signer.
          3. Compare normalised EVM addresses.
        """
        try:
            from eth_account import Account
            from eth_account.messages import SignableMessage

            digest = _compute_tip712_digest(domain, types, primary_type, message)
            sig_bytes = bytes.fromhex(signature.removeprefix("0x"))

            # eth_account.Account._recover_hash accepts the raw 32-byte hash
            recovered = Account._recover_hash(digest, signature=sig_bytes)  # type: ignore[attr-defined]
            return normalize_address_for_signing(address) == recovered.lower()
        except Exception:
            return False

    def read_contract(self, address: str, function_name: str, args: list | None = None) -> object:
        """Call a read-only TRC-20 / smart contract function."""
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        return func(*(args or []))

    def write_contract(
        self,
        address: str,
        function_name: str,
        args: list,
        fee_limit: int = 1_000_000_000,
    ) -> str:
        """Execute a contract write call and return the txid.

        Args:
            address: Contract address (Base58 or hex).
            function_name: Function name to call.
            args: List of function arguments.
            fee_limit: Max fee in SUN (default 1000 TRX).

        Returns:
            Transaction hash string (txid).
        """
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        txn = (
            func(*args)
            .with_owner(self._address)
            .fee_limit(fee_limit)
            .build()
            .sign(self._pk)
        )
        result = txn.broadcast()
        return result.txid

    def wait_for_transaction_receipt(
        self, tx_hash: str, max_attempts: int = 30
    ) -> TronTransactionReceipt:
        """Poll until the transaction is confirmed."""
        for _ in range(max_attempts):
            try:
                info = self._client.get_transaction_info(tx_hash)
                result = info.get("receipt", {}).get("result", "")
                if result == "SUCCESS":
                    return TronTransactionReceipt(status="success", tx_hash=tx_hash)
                if result and result != "SUCCESS":
                    return TronTransactionReceipt(status="reverted", tx_hash=tx_hash)
            except Exception:
                pass
            time.sleep(1)
        return TronTransactionReceipt(status="pending", tx_hash=tx_hash)


# ---------------------------------------------------------------------------
# Client signer
# ---------------------------------------------------------------------------

class ClientTronSigner:
    """Client-side TRON signer for TIP-712 signing.

    Example:
        ```python
        signer = ClientTronSigner(
            private_key="your_hex_private_key",
            full_node="https://nile.trongrid.io",
        )
        ```
    """

    def __init__(self, private_key: str, full_node: str = "https://api.trongrid.io") -> None:
        pk = private_key.removeprefix("0x")
        self._pk = PrivateKey(bytes.fromhex(pk))
        self._client = Tron(HTTPProvider(full_node))
        self._address: str = self._pk.public_key.to_base58check_address()

    @property
    def address(self) -> str:
        return self._address

    def sign_typed_data(
        self,
        domain: dict,
        types: dict,
        primary_type: str,
        message: dict,
    ) -> str:
        """Sign TIP-712 typed data with ECDSA (same key bytes as EVM).

        Returns:
            0x-prefixed hex signature (r‖s‖v, 65 bytes).
        """
        from eth_account import Account

        full_types = {
            **{k: v for k, v in types.items()},
        }

        domain_norm = {
            **domain,
            "verifyingContract": normalize_address_for_signing(
                domain.get("verifyingContract", "0x" + "00" * 20)
            ),
        }
        msg_norm = _normalize_message_for_signing(message)

        account = Account.from_key("0x" + self._pk.hex())
        signed = account.sign_typed_data(
            domain_data=domain_norm,
            message_types=full_types,
            message_data=msg_norm,
        )
        return "0x" + signed.signature.hex()

    def read_contract(self, address: str, function_name: str, args: list | None = None) -> object:
        """Read data from a contract."""
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        return func(*(args or []))
