"""
TronFacilitatorSigner - TRON facilitator signer implementation
"""

import asyncio
import time
from typing import Any

from bankofai.x402.signers.facilitator.base import FacilitatorSigner


class TronFacilitatorSigner(FacilitatorSigner):
    """TRON facilitator signer implementation"""

    def __init__(self, private_key: str) -> None:
        clean_key = private_key[2:] if private_key.startswith("0x") else private_key
        self._private_key = clean_key
        self._address = self._derive_address(clean_key)
        self._async_tron_clients: dict[str, Any] = {}

    @classmethod
    def from_private_key(cls, private_key: str) -> "TronFacilitatorSigner":
        """Create signer from private key"""
        return cls(private_key)

    def _ensure_async_tron_client(self, network: str) -> Any:
        """Lazy initialize async tron_client for the given network.

        Args:
            network: Network identifier (e.g. 'tron:nile', 'tron:mainnet').
        """
        if network not in self._async_tron_clients:
            try:
                from bankofai.x402.utils.tron_client import create_async_tron_client

                self._async_tron_clients[network] = create_async_tron_client(network)
            except ImportError:
                return None
        return self._async_tron_clients[network]

    @staticmethod
    def _derive_address(private_key: str) -> str:
        """Derive TRON address from private key"""
        try:
            from tronpy.keys import PrivateKey

            pk = PrivateKey(bytes.fromhex(private_key))
            return pk.public_key.to_base58check_address()
        except ImportError:
            return f"T{private_key[:33]}"

    def get_address(self) -> str:
        return self._address

    async def verify_typed_data(
        self,
        address: str,
        domain: dict[str, Any],
        types: dict[str, Any],
        message: dict[str, Any],
        signature: str,
        primary_type: str,
    ) -> bool:
        """Verify EIP-712 signature (Domain Neutral)"""
        try:
            import logging

            logger = logging.getLogger(__name__)

            from eth_account import Account
            from eth_account.messages import encode_typed_data

            from bankofai.x402.utils.address import tron_address_to_evm

            typed_data = {
                "types": types,
                "primaryType": primary_type,
                "domain": domain,
                "message": message,
            }

            signable = encode_typed_data(full_message=typed_data)
            sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
            recovered = Account.recover_message(signable, signature=sig_bytes)

            expected_evm = tron_address_to_evm(address)
            logger.info(f"Signature verification: expected_tron={address}, recovered={recovered}")

            return recovered.lower() == expected_evm.lower()
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.error(f"Signature verification error: {e}", exc_info=True)
            return False

    def _evm_to_tron_address(self, evm_address: str) -> str:
        """Convert EVM address to TRON address"""
        try:
            from tronpy.keys import to_base58check_address

            hex_addr = "41" + evm_address[2:].lower()
            return to_base58check_address(hex_addr)
        except ImportError:
            return evm_address

    def _normalize_tron_address(self, address: str) -> str:
        """Normalize TRON address to valid Base58Check format"""
        try:
            from tronpy.keys import to_base58check_address

            # If it's a hex address (0x...), convert to TRON address
            if address.startswith("0x") and len(address) == 42:
                hex_addr = "41" + address[2:].lower()
                return to_base58check_address(hex_addr)

            # If it starts with T, assume it's already a valid TRON address
            if address.startswith("T"):
                return address

            # Otherwise return as-is
            return address
        except Exception:
            return address

    async def check_balance(
        self,
        token: str,
        network: str,
        address: str | None = None,
    ) -> int:
        """Check TRC20 token balance"""
        client = self._ensure_async_tron_client(network)
        if client is None:
            import logging

            logger = logging.getLogger(__name__)
            logger.warning("AsyncTron client not available, returning 0 balance")
            return 0

        from bankofai.x402.abi import ERC20_ABI

        target_address = address or self._address
        try:
            contract = await client.get_contract(token)
            contract.abi = ERC20_ABI
            balance = await contract.functions.balanceOf(target_address)
            return int(balance)
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.error(f"Failed to check balance for {target_address}: {e}")
            return 0

    async def write_contract(
        self,
        contract_address: str,
        abi: str,
        method: str,
        args: list[Any],
        network: str,
    ) -> str | None:
        """Execute contract transaction on TRON (async).

        Uses AsyncTron for non-blocking operations.
        """
        import json as json_module
        import logging

        from tronpy.keys import PrivateKey

        logger = logging.getLogger(__name__)

        client = self._ensure_async_tron_client(network)
        if client is None:
            raise RuntimeError("AsyncTron client required for contract calls")

        try:
            # Normalize contract address to ensure valid Base58Check format
            normalized_address = self._normalize_tron_address(contract_address)
            logger.info(f"Normalized contract address: {contract_address} -> {normalized_address}")

            # Log account resources before transaction
            try:
                account_info = await client.get_account(self._address)
                account_resource = await client.get_account_resource(self._address)
                logger.info(f"Account address: {self._address}")
                logger.info(
                    f"Account balance: {account_info.get('balance', 0) / 1_000_000:.6f} TRX"
                )
                logger.info("Account resources:")
                logger.info(f"  - freeNetLimit: {account_resource.get('freeNetLimit', 0)}")
                logger.info(f"  - freeNetUsed: {account_resource.get('freeNetUsed', 0)}")
                logger.info(f"  - NetLimit: {account_resource.get('NetLimit', 0)}")
                logger.info(f"  - NetUsed: {account_resource.get('NetUsed', 0)}")
                logger.info(f"  - EnergyLimit: {account_resource.get('EnergyLimit', 0)}")
                logger.info(f"  - EnergyUsed: {account_resource.get('EnergyUsed', 0)}")
                logger.info(f"  - TotalEnergyLimit: {account_resource.get('TotalEnergyLimit', 0)}")
                logger.info(
                    f"  - TotalEnergyWeight: {account_resource.get('TotalEnergyWeight', 0)}"
                )
            except Exception as resource_err:
                logger.warning(f"Failed to fetch account resources: {resource_err}")

            # Log contract call parameters in detail
            self._log_contract_parameters(method, args, logger)

            # Use AsyncTron standard approach - let tronpy calculate Method ID
            abi_list = json_module.loads(abi) if isinstance(abi, str) else abi
            contract = await client.get_contract(normalized_address)
            contract.abi = abi_list

            # Get function object
            func = getattr(contract.functions, method)

            # Log tronpy calculated Method ID
            logger.info(f"Function: {method}")
            logger.info(f"  Signature: {func.function_signature}")
            logger.info(f"  Method ID: {func.function_signature_hash}")

            # Build and sign transaction
            logger.info("Building transaction with fee_limit=1,000,000,000 SUN (1000 TRX)")
            # AsyncTron: func(*args) returns a coroutine, need to await it first
            txn_builder = await func(*args)
            txn_builder = txn_builder.with_owner(self._address).fee_limit(1_000_000_000)
            txn = await txn_builder.build()
            txn = txn.sign(PrivateKey(bytes.fromhex(self._private_key)))

            # Log transaction details before broadcast
            try:
                txn_dict = txn.to_json()
                logger.info("Transaction built successfully:")
                logger.info(f"  - txID: {txn_dict.get('txID', 'N/A')}")
                logger.info(f"  - raw_data_hex length: {len(txn_dict.get('raw_data_hex', ''))}")
                logger.info(
                    f"  - fee_limit: {txn_dict.get('raw_data', {}).get('fee_limit', 'N/A')}"
                )
            except Exception as log_err:
                logger.warning(f"Failed to log transaction details: {log_err}")

            logger.info("Broadcasting transaction...")
            result = await txn.broadcast()
            logger.info(f"Transaction broadcast successful: {result}")
            return result.get("txid")
        except Exception as e:
            error_type = type(e).__name__
            error_msg = str(e)
            logger.error(f"Contract call failed: [{error_type}] {error_msg}")

            # Provide specific guidance for common errors
            if "BANDWITH_ERROR" in error_msg or "bandwidth" in error_msg.lower():
                logger.error(
                    "BANDWIDTH ERROR: The account does not have enough bandwidth to "
                    "broadcast the transaction."
                )
                logger.error("Solutions:")
                logger.error("  1. Wait for bandwidth to regenerate (24 hours for free bandwidth)")
                logger.error("  2. Stake TRX to get more bandwidth")
                logger.error(
                    "  3. Burn TRX to pay for bandwidth (transaction will consume TRX balance)"
                )
                logger.error("  4. Use a different account with available bandwidth")
            elif "ENERGY" in error_msg:
                logger.error(
                    "ENERGY ERROR: The account does not have enough energy to execute the contract."
                )
                logger.error("Solutions:")
                logger.error("  1. Stake TRX to get energy")
                logger.error("  2. Burn TRX to pay for energy")
            elif "balance" in error_msg.lower():
                logger.error("BALANCE ERROR: The account does not have enough TRX balance.")
                logger.error("Solution: Add TRX to the account")

            # Log full exception details
            logger.error("Full exception details:", exc_info=True)
            return None

    def _log_contract_parameters(self, method: str, args: list[Any], logger: Any) -> None:
        """Log contract call parameters as a complete JSON"""
        try:
            import json

            # Convert arguments to JSON-serializable format
            def serialize_value(value: Any) -> Any:
                """Recursively convert values to JSON-serializable format"""
                if isinstance(value, bytes):
                    return f"0x{value.hex()}"
                elif isinstance(value, (tuple, list)):
                    return [serialize_value(item) for item in value]
                elif isinstance(value, dict):
                    return {k: serialize_value(v) for k, v in value.items()}
                elif isinstance(value, int):
                    return {"decimal": value, "hex": f"0x{value:x}"}
                elif isinstance(value, str):
                    return value
                else:
                    return str(value)

            # Build the complete parameter structure
            contract_call = {"method": method, "arguments": [serialize_value(arg) for arg in args]}

            # Output as formatted JSON
            json_output = json.dumps(contract_call, indent=2, ensure_ascii=False)
            logger.info(
                f"\n{'=' * 80}\nContract Call Parameters:\n{'=' * 80}\n{json_output}\n{'=' * 80}"
            )
        except Exception as e:
            logger.warning(f"Failed to log contract parameters: {e}")

    async def wait_for_transaction_receipt(
        self,
        tx_hash: str,
        timeout: int = 60,
        network: str = "",
    ) -> dict[str, Any]:
        """Wait for TRON transaction confirmation (async with 60s default timeout)"""
        client = self._ensure_async_tron_client(network)
        if client is None:
            raise RuntimeError("AsyncTron client required")

        start = time.time()
        while time.time() - start < timeout:
            try:
                # Use AsyncTron's get_transaction_info
                info = await client.get_transaction_info(tx_hash)
                if info and info.get("blockNumber"):
                    return {
                        "hash": tx_hash,
                        "blockNumber": str(info.get("blockNumber")),
                        "status": "confirmed"
                        if info.get("receipt", {}).get("result") == "SUCCESS"
                        else "failed",
                    }
            except Exception:
                pass
            await asyncio.sleep(3)

        raise TimeoutError(f"Transaction {tx_hash} not confirmed within {timeout}s")
