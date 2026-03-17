"""TRON signer implementations using tronpy + eth_account.

Faithfully mirrors the TypeScript FacilitatorTronSigner / ClientTronSigner
behaviour:
  - verifyTypedData uses the same encoded typed-data path as the signer and
    compares normalised EVM addresses.
  - signTypedData uses the same key bytes via eth_account's sign_typed_data.
  - writeContract avoids the broken Python *args-after-default-arg pattern.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

try:
    from tronpy import Tron  # type: ignore
    from tronpy.keys import PrivateKey  # type: ignore
    from tronpy.providers import HTTPProvider  # type: ignore
except ImportError as e:
    raise ImportError("TRON signers require tronpy. Install with: pip install tronpy") from e

from .utils import normalize_address_for_signing


@dataclass
class TronTransactionReceipt:
    """Simplified receipt from a TRON transaction."""

    status: str  # "success" | "reverted" | "pending"
    tx_hash: str


def _normalize_message_for_signing(message: dict[str, Any]) -> dict[str, Any]:
    """Normalize a TIP-712 message dict for eth_account.

    - TRON base58 addresses → 0x hex
    - bytes32 nonces kept as "0x…" hex strings (eth_account accepts them)
    """
    result: dict[str, Any] = {}
    for k, v in message.items():
        if isinstance(v, str) and v.startswith("T") and len(v) == 34:
            result[k] = normalize_address_for_signing(v)
        else:
            result[k] = v
    return result


def _build_eip712_domain_types(domain: dict[str, Any]) -> list[dict[str, str]]:
    """Construct an EIP712Domain type list from the provided domain fields."""
    field_types: dict[str, str] = {
        "name": "string",
        "version": "string",
        "chainId": "uint256",
        "verifyingContract": "address",
        "salt": "bytes32",
    }
    return [
        {"name": field_name, "type": field_types[field_name]}
        for field_name in field_types
        if field_name in domain
    ]


def _build_typed_data_payload(
    domain: dict[str, Any],
    types: dict[str, list[dict[str, str]]],
    primary_type: str,
    message: dict[str, Any],
) -> dict[str, Any]:
    """Build a canonical typed-data payload for eth_account helpers."""
    domain_norm = {
        **domain,
        "verifyingContract": normalize_address_for_signing(
            domain.get("verifyingContract", "0x" + "00" * 20)
        ),
    }
    return {
        "types": {"EIP712Domain": _build_eip712_domain_types(domain_norm), **types},
        "primaryType": primary_type,
        "domain": domain_norm,
        "message": _normalize_message_for_signing(message),
    }


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
        domain: dict[str, Any],
        types: dict[str, list[dict[str, str]]],
        primary_type: str,
        message: dict[str, Any],
        signature: str,
    ) -> bool:
        """Verify a TIP-712 signature.

        Mirrors the client signer path by rebuilding the exact typed-data
        payload and recovering the signer from the encoded message.
        """
        try:
            from eth_account import Account
            from eth_account.messages import encode_typed_data

            signable = encode_typed_data(
                full_message=_build_typed_data_payload(domain, types, primary_type, message)
            )
            recovered = str(Account.recover_message(signable, signature=signature))
            return bool(normalize_address_for_signing(address) == recovered.lower())
        except Exception:
            return False

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
    ) -> Any:
        """Call a read-only TRC-20 / smart contract function."""
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        return func(*(args or []))

    def write_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any],
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
        txn = func(*args).with_owner(self._address).fee_limit(fee_limit).build().sign(self._pk)
        result = txn.broadcast()
        return str(result.txid)

    def write_contract_with_abi(
        self,
        address: str,
        function_name: str,
        args: list[Any],
        abi: list[dict[str, Any]],
        fee_limit: int = 1_000_000_000,
    ) -> str:
        """Execute a contract write call with explicit ABI and return the txid.

        This method is needed for contracts using ABIEncoderV2 with complex types.

        Args:
            address: Contract address (Base58 or hex).
            function_name: Function name to call.
            args: List of function arguments.
            abi: Contract ABI (list of function definitions).
            fee_limit: Max fee in SUN (default 1000 TRX).

        Returns:
            Transaction hash string (txid).
        """
        contract = self._client.get_contract(address)
        contract.abi = abi
        func = getattr(contract.functions, function_name)
        txn = func(*args).with_owner(self._address).fee_limit(fee_limit).build()

        # Sign and broadcast
        signed_txn = txn.sign(self._pk)
        result = signed_txn.broadcast()
        return str(result.txid)

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

    def send_raw_transaction(self, signed_transaction: dict[str, Any]) -> str:
        """Broadcast a signed transaction."""
        from tronpy.tron import Transaction

        tx: Any = signed_transaction
        if isinstance(signed_transaction, dict):
            tx = Transaction.from_json(signed_transaction, client=self._client)
        result = tx.broadcast()
        return str(result.txid)

    def get_sign_weight(self, transaction: Any) -> Any:
        """Ask the node to validate the signed transaction signatures."""
        from tronpy.tron import Transaction

        if isinstance(transaction, dict):
            transaction = Transaction.from_json(transaction, client=self._client)
        return self._client.get_sign_weight(transaction)


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
        domain: dict[str, Any],
        types: dict[str, list[dict[str, str]]],
        primary_type: str,
        message: dict[str, Any],
    ) -> str:
        """Sign TIP-712 typed data with ECDSA (same key bytes as EVM).

        Returns:
            0x-prefixed hex signature (r‖s‖v, 65 bytes).
        """
        from eth_account import Account

        account = Account.from_key("0x" + self._pk.hex())
        signed = account.sign_typed_data(
            full_message=_build_typed_data_payload(domain, types, primary_type, message),
        )
        return str("0x" + signed.signature.hex())

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
    ) -> Any:
        """Read data from a contract."""
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        return func(*(args or []))

    def build_trigger_smart_contract_transaction(self, **kwargs: Any) -> Any:
        """Build a trigger smart contract transaction."""
        contract_address = kwargs.get("contract_address")
        function_selector = kwargs.get("function_selector")
        parameters = kwargs.get("parameters") or []
        owner_address = kwargs.get("owner_address") or self._address
        fee_limit = kwargs.get("fee_limit")
        call_value = kwargs.get("call_value", 0)

        if not contract_address or not function_selector:
            raise AttributeError("TRON client does not support trigger smart contract transactions")

        method_name = str(function_selector).split("(", 1)[0]
        contract = self._client.get_contract(contract_address)
        func = getattr(contract.functions, method_name, None)
        if func is None:
            raise AttributeError("TRON client does not support trigger smart contract transactions")

        args: list[Any] = []
        for param in parameters:
            value = param.get("value")
            if param.get("type") == "uint256" and isinstance(value, str):
                try:
                    value = int(value)
                except ValueError:
                    pass
            args.append(value)
        txn_builder = func(*args).with_owner(owner_address)
        if fee_limit is not None:
            txn_builder = txn_builder.fee_limit(int(fee_limit))
        if call_value:
            txn_builder = txn_builder.with_transfer(int(call_value))
        txn = txn_builder.build()
        return txn

    def sign_transaction(self, transaction: dict[str, Any]) -> dict[str, Any]:
        """Sign a raw transaction dict."""
        if hasattr(transaction, "sign"):
            signed = transaction.sign(self._pk)
            try:
                return signed.to_json()
            except Exception:
                return signed  # type: ignore[return-value]
        if isinstance(transaction, dict):
            from tronpy.tron import Transaction

            signed = Transaction.from_json(transaction, client=self._client).sign(self._pk)
            try:
                return signed.to_json()
            except Exception:
                return signed  # type: ignore[return-value]
        txn = self._client.trx.sign(transaction, self._pk)
        try:
            return txn.to_json()
        except Exception:
            return dict(txn)
