"""
Transaction Verification Utilities

Provides generic functionality to verify blockchain transaction results,
ensuring contract transfers and deliveries match expected parameters.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Protocol

from bankofai.x402.types import PaymentPayload, PaymentRequirements


@dataclass
class TransferEvent:
    """Represents a token transfer event from a transaction"""

    token: str  # Token contract address
    from_addr: str  # Sender address
    to_addr: str  # Recipient address
    amount: int  # Transfer amount


@dataclass
class TransactionVerificationResult:
    """Result of transaction verification"""

    success: bool
    tx_hash: str
    block_number: str | None = None
    error_reason: str | None = None
    transfers: list[TransferEvent] | None = None

    # Detailed verification flags
    status_verified: bool = False  # Transaction executed successfully
    payment_verified: bool = False  # Payment amount/recipient verified
    fee_verified: bool = False  # Fee payment verified

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary"""
        return {
            "success": self.success,
            "txHash": self.tx_hash,
            "blockNumber": self.block_number,
            "errorReason": self.error_reason,
            "statusVerified": self.status_verified,
            "paymentVerified": self.payment_verified,
            "feeVerified": self.fee_verified,
        }


class TransactionVerifier(Protocol):
    """Protocol for transaction verification implementations"""

    async def verify_transaction(
        self,
        tx_hash: str,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> TransactionVerificationResult:
        """Verify a transaction matches expected payment parameters"""
        ...

    async def get_transaction_transfers(
        self,
        tx_hash: str,
        token_address: str,
    ) -> list[TransferEvent]:
        """Get token transfer events from a transaction"""
        ...


class BaseTransactionVerifier(ABC):
    """Base class for transaction verification implementations"""

    def __init__(self) -> None:
        self._logger = logging.getLogger(self.__class__.__name__)

    @abstractmethod
    async def get_transaction_info(self, tx_hash: str) -> dict[str, Any]:
        """Get transaction information from blockchain"""
        pass

    @abstractmethod
    async def get_transaction_transfers(
        self,
        tx_hash: str,
        token_address: str,
    ) -> list[TransferEvent]:
        """Get token transfer events from a transaction"""
        pass

    @abstractmethod
    def normalize_address(self, address: str) -> str:
        """Normalize address to standard format for comparison"""
        pass

    async def verify_transaction(
        self,
        tx_hash: str,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> TransactionVerificationResult:
        """
        Verify a transaction matches expected payment parameters.

        This method checks:
        1. Transaction status (success/failed)
        2. Payment transfer (correct amount to payTo address)
        3. Fee transfer (correct fee amount to feeTo address)

        Args:
            tx_hash: Transaction hash to verify
            payload: Original payment payload
            requirements: Payment requirements

        Returns:
            TransactionVerificationResult with detailed verification status
        """
        permit = payload.payload.payment_permit
        authorization = payload.payload.authorization

        self._logger.info("=" * 60)
        self._logger.info(f"Verifying transaction: {tx_hash}")

        # Log expected transfers from payload and requirements
        if permit is not None:
            expected_from = self.normalize_address(permit.buyer)
        elif authorization is not None:
            expected_from = self.normalize_address(authorization.from_address)
        else:
            expected_from = "unknown"
        expected_pay_to = self.normalize_address(requirements.pay_to)
        expected_amount = int(requirements.amount)
        token_address = requirements.asset
        fee_amount = 0
        expected_fee_to = None

        if requirements.extra and requirements.extra.fee:
            fee_amount = int(requirements.extra.fee.fee_amount)
            expected_fee_to = self.normalize_address(requirements.extra.fee.fee_to)

        self._logger.info(
            "[EXPECTED] Payment: %s → %s | %s %s",
            expected_from,
            expected_pay_to,
            expected_amount,
            token_address,
        )
        if fee_amount > 0 and expected_fee_to:
            self._logger.info(
                "[EXPECTED] Fee: %s → %s | %s %s",
                expected_from,
                expected_fee_to,
                fee_amount,
                token_address,
            )
        else:
            self._logger.info("[EXPECTED] Fee: None")

        try:
            # Only verify transaction status
            tx_info = await self.get_transaction_info(tx_hash)

            status = tx_info.get("status", "").lower()
            if status == "failed" or status == "0" or status == 0:
                self._logger.error(f"[FAILED] Transaction failed on-chain: {tx_hash}")
                self._logger.info("=" * 60)
                return TransactionVerificationResult(
                    success=False,
                    tx_hash=tx_hash,
                    block_number=tx_info.get("blockNumber"),
                    error_reason="transaction_failed_on_chain",
                    status_verified=False,
                )

            self._logger.info(f"[OK] Transaction status: {status}")
            self._logger.info(f"[SUCCESS] Transaction verification passed: {tx_hash}")
            self._logger.info("=" * 60)
            return TransactionVerificationResult(
                success=True,
                tx_hash=tx_hash,
                block_number=tx_info.get("blockNumber"),
                status_verified=True,
            )

        except Exception as e:
            self._logger.error(f"Transaction verification error: {e}", exc_info=True)
            return TransactionVerificationResult(
                success=False,
                tx_hash=tx_hash,
                error_reason=f"verification_error: {str(e)}",
            )


def get_verifier_for_network(network: str, rpc_url: str | None = None) -> BaseTransactionVerifier:
    """
    Factory function to get appropriate transaction verifier for a network.

    Currently supports TRON networks only.

    Args:
        network: Network identifier (e.g., "tron:nile")
        rpc_url: Reserved for future use

    Returns:
        Transaction verifier instance

    Examples:
        >>> verifier = get_verifier_for_network("tron:nile")
        >>> verifier = get_verifier_for_network("tron:mainnet")
    """
    if network.startswith("tron:"):
        from bankofai.x402.utils.tron_verification import TronTransactionVerifier

        tron_network = network.split(":")[1] if ":" in network else "nile"
        return TronTransactionVerifier(network=tron_network)

    raise ValueError(f"No transaction verifier available for network: {network}")
