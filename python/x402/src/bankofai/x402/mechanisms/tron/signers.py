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
        # For ABIEncoderV2 contracts, we need to manually encode the function call
        # and use triggersmartcontract directly
        from tronpy.abi import trx_abi

        # Find the function ABI
        func_abi = None
        for item in abi:
            if item.get("name") == function_name and item.get("type") == "function":
                func_abi = item
                break

        if not func_abi:
            raise ValueError(f"Function {function_name} not found in ABI")

        def _get_type_string(param: dict[str, Any]) -> str:
            if param.get("type", "").startswith("tuple"):
                components = param.get("components", [])
                inner = ",".join(_get_type_string(c) for c in components)
                # handle tuple[] or tuple[2]
                suffix = param["type"][5:]
                return f"({inner}){suffix}"
            return str(param["type"])

        # Format function signature like: settle(((address,uint256),uint256,uint256),address,(address,address,uint256),bytes)
        type_strings = [_get_type_string(inp) for inp in func_abi.get("inputs", [])]
        signature = f"({','.join(type_strings)})"
        func_selector = f"{function_name}{signature}"

        # Encode the function call args
        parameter = trx_abi.encode_single(signature, tuple(args)).hex()

        # Build transaction using triggersmartcontract
        txn = (
            self._client.trx.trigger_smart_contract(
                owner_address=self._address,
                contract_address=address,
                function_selector=func_selector,
                parameter=parameter,
                fee_limit=fee_limit,
            )
        )

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
