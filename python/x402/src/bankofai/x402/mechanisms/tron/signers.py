"""TRON signer implementations using tronpy."""

from __future__ import annotations

from dataclasses import dataclass

try:
    from tronpy import Tron
    from tronpy.keys import PrivateKey
    from tronpy.providers import HTTPProvider
except ImportError as e:
    raise ImportError(
        "TRON signers require tronpy. Install with: pip install x402[tron]"
    ) from e

from .utils import normalize_address_for_signing


@dataclass
class TronTransactionReceipt:
    """Simplified receipt from a TRON transaction."""
    status: str  # "success" | "reverted" | "pending"
    tx_hash: str


class FacilitatorTronSigner:
    """Facilitator-side TRON signer using tronpy.

    Implements signature verification (using tronpy typed-data helpers)
    and on-chain settlement (via tronpy contract calls).

    Example:
        ```python
        signer = FacilitatorTronSigner(
            private_key="your_hex_private_key",
            full_node="https://nile.trongrid.io",
        )
        ```
    """

    def __init__(self, private_key: str, full_node: str = "https://api.trongrid.io") -> None:
        """Initialize signer.

        Args:
            private_key: Hex private key (with or without 0x prefix).
            full_node: TRON node HTTP endpoint.
        """
        pk = private_key.lstrip("0x") if private_key.startswith("0x") else private_key
        self._pk = PrivateKey(bytes.fromhex(pk))
        self._client = Tron(HTTPProvider(full_node))
        # Derive TRON base58 address
        self._address: str = self._pk.public_key.to_base58check_address()

    @property
    def address(self) -> str:
        """TRON Base58Check address."""
        return self._address

    def get_addresses(self) -> list[str]:
        """Return facilitator wallet addresses."""
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
        """Verify a TIP-712 typed data signature.

        Uses tronpy's typed_data utilities to recover the signer address.

        Args:
            address: Expected signer address (any format).
            domain: TIP-712 domain parameters.
            types: Type definitions dict.
            primary_type: Primary type name.
            message: Message data.
            signature: 0x-prefixed hex signature.

        Returns:
            True if the signature matches the expected address.
        """
        try:
            from tronpy.keys import to_hex_address
            from tronpy.hashes import keccak256
            import json, struct

            # Use tronpy's built-in typed data recovery (available in tronpy >= 0.4.x)
            # We reconstruct the typed data dict and use eth_account for recovery
            # since TRON TIP-712 is byte-compatible with EIP-712
            from eth_account import Account
            from eth_account._utils.typed_data import hash_typed_data

            # Build full types with domain
            full_types = {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                **{k: v for k, v in types.items()},
            }

            # Normalize domain verifyingContract to EVM hex
            domain_normalized = {
                **domain,
                "verifyingContract": normalize_address_for_signing(
                    domain.get("verifyingContract", "0x0000000000000000000000000000000000000000")
                ),
            }

            typed_data = {
                "types": full_types,
                "primaryType": primary_type,
                "domain": domain_normalized,
                "message": {
                    k: (
                        normalize_address_for_signing(v)
                        if isinstance(v, str) and (v.startswith("T") and len(v) == 34)
                        else v
                    )
                    for k, v in message.items()
                },
            }

            sig_bytes = bytes.fromhex(signature.lstrip("0x"))
            struct_hash = hash_typed_data(typed_data)
            recovered = Account.recover_message(
                __import__("eth_account.messages", fromlist=["encode_typed_data"]).encode_typed_data(
                    full_message=typed_data
                ),
                signature=sig_bytes,
            )
            return normalize_address_for_signing(address) == recovered.lower()
        except Exception as e:
            return False

    def read_contract(self, address: str, function_name: str, *args) -> object:
        """Call a read-only contract function.

        Args:
            address: Contract (Base58 or hex).
            function_name: Function to call.
            *args: Function arguments.

        Returns:
            Return value from contract.
        """
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        return func(*args)

    def write_contract(self, address: str, function_name: str, fee_limit: int = 1_000_000_000, *args) -> str:
        """Execute a contract write call and returns the txid.

        Args:
            address: Contract (Base58 or hex).
            function_name: Function name.
            fee_limit: Max fee in SUN.
            *args: Function arguments.

        Returns:
            Transaction hash string.
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

    def wait_for_transaction_receipt(self, tx_hash: str, max_attempts: int = 30) -> TronTransactionReceipt:
        """Wait for a transaction to be confirmed.

        Args:
            tx_hash: Transaction hash to poll.
            max_attempts: Max poll iterations.

        Returns:
            TronTransactionReceipt with status.
        """
        import time
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


class ClientTronSigner:
    """Client-side TRON signer using tronpy for TIP-712 signing.

    Example:
        ```python
        signer = ClientTronSigner(
            private_key="your_hex_private_key",
            full_node="https://nile.trongrid.io",
        )
        ```
    """

    def __init__(self, private_key: str, full_node: str = "https://api.trongrid.io") -> None:
        """Initialize client signer.

        Args:
            private_key: Hex private key (with or without 0x prefix).
            full_node: TRON node HTTP endpoint.
        """
        pk = private_key.lstrip("0x") if private_key.startswith("0x") else private_key
        self._pk = PrivateKey(bytes.fromhex(pk))
        self._client = Tron(HTTPProvider(full_node))
        self._address: str = self._pk.public_key.to_base58check_address()

    @property
    def address(self) -> str:
        """TRON Base58Check address."""
        return self._address

    def sign_typed_data(
        self,
        domain: dict,
        types: dict,
        primary_type: str,
        message: dict,
    ) -> str:
        """Sign TIP-712 typed data.

        Args:
            domain: Domain parameters.
            types: Type definitions.
            primary_type: Primary type.
            message: Message to sign.

        Returns:
            0x-prefixed hex signature.
        """
        from eth_account import Account
        from eth_account.messages import encode_typed_data
        from .utils import normalize_address_for_signing

        full_types = {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            **{k: v for k, v in types.items()},
        }

        domain_normalized = {
            **domain,
            "verifyingContract": normalize_address_for_signing(
                domain.get("verifyingContract", "0x0000000000000000000000000000000000000000")
            ),
        }

        message_normalized = {
            k: (normalize_address_for_signing(v) if isinstance(v, str) and len(v) == 34 and v.startswith("T") else v)
            for k, v in message.items()
        }

        typed_data = {
            "types": full_types,
            "primaryType": primary_type,
            "domain": domain_normalized,
            "message": message_normalized,
        }

        # Use eth_account with the raw private key bytes (TRON and EVM use same ECDSA)
        account = Account.from_key("0x" + self._pk.hex())
        signed = account.sign_typed_data(
            domain_data=domain_normalized,
            message_types={k: v for k, v in full_types.items() if k != "EIP712Domain"},
            message_data=message_normalized,
        )
        return "0x" + signed.signature.hex()

    def read_contract(self, address: str, function_name: str, *args) -> object:
        """Read data from a contract."""
        contract = self._client.get_contract(address)
        func = getattr(contract.functions, function_name)
        return func(*args)
