"""
TRON Transaction Verification

Provides TRON-specific transaction verification functionality.
"""

from typing import Any

from bankofai.x402.utils.tx_verification import BaseTransactionVerifier, TransferEvent


class TronTransactionVerifier(BaseTransactionVerifier):
    """TRON-specific transaction verification implementation"""

    def __init__(self, network: str = "nile") -> None:
        super().__init__()
        self._network = network
        self._async_client: Any = None

    def _ensure_async_client(self) -> Any:
        """Lazy initialize async tronpy client"""
        if self._async_client is None:
            from bankofai.x402.utils.tron_client import create_async_tron_client

            self._async_client = create_async_tron_client(self._network)
        return self._async_client

    def normalize_address(self, address: str) -> str:
        """Normalize address to TRON Base58 format"""
        try:
            from tronpy.keys import to_base58check_address

            if address.startswith("0x") and len(address) == 42:
                hex_addr = "41" + address[2:].lower()
                return to_base58check_address(hex_addr)

            if address.startswith("T"):
                return address

            return address
        except Exception:
            return address

    async def get_transaction_info(self, tx_hash: str) -> dict[str, Any]:
        """Get TRON transaction information"""
        client = self._ensure_async_client()

        try:
            info = await client.get_transaction_info(tx_hash)
            if info:
                receipt = info.get("receipt", {})
                status = "confirmed" if receipt.get("result") == "SUCCESS" else "failed"
                return {
                    "hash": tx_hash,
                    "blockNumber": str(info.get("blockNumber", "")),
                    "status": status,
                    "receipt": receipt,
                    "log": info.get("log", []),
                }
            return {"hash": tx_hash, "status": "pending"}
        except Exception as e:
            self._logger.error(f"Failed to get transaction info: {e}")
            raise

    async def get_transaction_transfers(
        self,
        tx_hash: str,
        token_address: str,
    ) -> list[TransferEvent]:
        """
        Get TRC20 token transfer events from a TRON transaction.

        Parses the transaction logs for Transfer(address,address,uint256) events.
        """
        client = self._ensure_async_client()
        transfers: list[TransferEvent] = []

        try:
            info = await client.get_transaction_info(tx_hash)
            if not info:
                return transfers

            logs = info.get("log", [])

            # TRC20 Transfer event topic
            # keccak256("Transfer(address,address,uint256)")
            transfer_topic = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

            normalized_token = self._normalize_to_hex(token_address)

            for log in logs:
                log_address = log.get("address", "")
                topics = log.get("topics", [])
                data = log.get("data", "")

                # Check if this is a Transfer event from the expected token
                if not topics or topics[0] != transfer_topic:
                    continue

                # Normalize log address for comparison
                normalized_log_address = self._normalize_to_hex(log_address)
                if normalized_log_address.lower() != normalized_token.lower():
                    continue

                if len(topics) < 3:
                    continue

                # Parse Transfer event
                # topics[1] = from address (padded to 32 bytes)
                # topics[2] = to address (padded to 32 bytes)
                # data = amount (uint256)
                from_addr = self._parse_address_from_topic(topics[1])
                to_addr = self._parse_address_from_topic(topics[2])
                amount = int(data, 16) if data else 0

                transfers.append(
                    TransferEvent(
                        token=self.normalize_address(log_address),
                        from_addr=from_addr,
                        to_addr=to_addr,
                        amount=amount,
                    )
                )

                self._logger.debug(f"Found transfer: {amount} from {from_addr} to {to_addr}")

            return transfers

        except Exception as e:
            self._logger.error(f"Failed to parse transfer events: {e}", exc_info=True)
            return transfers

    def _normalize_to_hex(self, address: str) -> str:
        """Normalize address to hex format (without 0x prefix)"""
        try:
            from tronpy.keys import to_hex_address

            if address.startswith("T"):
                # Convert TRON base58 to hex
                hex_addr = to_hex_address(address)
                return hex_addr[2:] if hex_addr.startswith("41") else hex_addr

            if address.startswith("0x"):
                return address[2:].lower()

            return address.lower()
        except Exception:
            return address

    def _parse_address_from_topic(self, topic: str) -> str:
        """Parse address from 32-byte padded topic"""
        try:
            from tronpy.keys import to_base58check_address

            # Topic is 32 bytes hex, address is last 20 bytes
            # For TRON, we need to add 41 prefix
            if len(topic) >= 40:
                addr_hex = "41" + topic[-40:]
                return to_base58check_address(addr_hex)
            return topic
        except Exception:
            return topic
