"""
Seller receipt signing for x402 protocol.

Constructs and signs ECDSA receipt digests compatible with the PurchaseLog
contract's signature verification. The seller signs the digest using Ethereum
personal-sign (EIP-191) so the buyer can submit it on-chain as proof of purchase.

Digest format (must match PurchaseLog._recoverSigner):
    digest = keccak256(abi.encode(listingId, buyerAgentId, paymentHash, amount, chainId, contractAddress))
    prefixedHash = keccak256("\x19Ethereum Signed Message:\n32" || digest)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi import encode as abi_encode
from Crypto.Hash import keccak as pycryptodome_keccak

logger = logging.getLogger(__name__)


def _keccak256(data: bytes) -> bytes:
    """Compute keccak256 hash."""
    k = pycryptodome_keccak.new(digest_bits=256)
    k.update(data)
    return k.digest()


def _to_bytes32(value: str | bytes | int) -> bytes:
    """Convert a value to a 32-byte representation."""
    if isinstance(value, int):
        return value.to_bytes(32, byteorder="big")
    if isinstance(value, str):
        if value.startswith("0x"):
            value = value[2:]
        return bytes.fromhex(value).rjust(32, b"\x00")
    return value.rjust(32, b"\x00")


def _to_uint256(value: int | str) -> int:
    """Convert to uint256 integer."""
    return int(value)


def _to_address_hex(address: str) -> str:
    """Convert an address string to 0x-prefixed hex for eth_abi address encoding."""
    if address.startswith("0x") and len(address) == 42:
        return address
    # TRON address — convert to EVM hex first
    from bankofai.x402.utils.address import tron_address_to_evm

    return tron_address_to_evm(address)


@dataclass
class ReceiptSignature:
    """Seller's ECDSA signature over a receipt digest."""

    signature: str  # 0x-prefixed hex, 65 bytes (r+s+v)
    digest: str  # 0x-prefixed hex, 32 bytes
    listing_id: int
    buyer_agent_id: int
    payment_hash: str  # 0x-prefixed hex
    amount: int
    chain_id: int
    contract_address: str  # 0x-prefixed hex


def compute_receipt_digest(
    listing_id: int,
    buyer_agent_id: int,
    payment_hash: bytes,
    amount: int,
    chain_id: int,
    contract_address: str,
) -> bytes:
    """
    Compute the receipt digest exactly as PurchaseLog.sol does:
        keccak256(abi.encode(listingId, buyerAgentId, paymentHash, amount, block.chainid, address(this)))

    Args:
        listing_id: Listing ID in DataMarketplace.
        buyer_agent_id: 8004 agent ID of the buyer (0 for anonymous).
        payment_hash: 32-byte payment hash (SHA-256 of x402 X-Payment header).
        amount: Payment amount in token smallest unit.
        chain_id: EVM chain ID.
        contract_address: PurchaseLog contract address (0x-prefixed hex).

    Returns:
        32-byte keccak256 digest.
    """
    contract_addr_hex = _to_address_hex(contract_address)

    # abi.encode(uint256, uint256, bytes32, uint256, uint256, address)
    encoded = abi_encode(
        ["uint256", "uint256", "bytes32", "uint256", "uint256", "address"],
        [
            _to_uint256(listing_id),
            _to_uint256(buyer_agent_id),
            payment_hash,
            _to_uint256(amount),
            _to_uint256(chain_id),
            contract_addr_hex,
        ],
    )

    return _keccak256(encoded)


def sign_receipt(
    private_key: str,
    listing_id: int,
    buyer_agent_id: int,
    payment_hash: str | bytes,
    amount: int | str,
    chain_id: int,
    contract_address: str,
) -> ReceiptSignature:
    """
    Sign a receipt digest using Ethereum personal-sign (EIP-191).

    The resulting signature can be verified on-chain by PurchaseLog.logPurchase().

    Args:
        private_key: Seller's private key (0x-prefixed hex).
        listing_id: Listing ID in DataMarketplace.
        buyer_agent_id: 8004 agent ID of the buyer (0 for anonymous).
        payment_hash: 32-byte payment hash as hex string or bytes.
        amount: Payment amount in token smallest unit.
        chain_id: EVM chain ID.
        contract_address: PurchaseLog contract address.

    Returns:
        ReceiptSignature with the 65-byte ECDSA signature and metadata.
    """
    amount_int = int(amount)

    if isinstance(payment_hash, str):
        if payment_hash.startswith("0x"):
            payment_hash_bytes = bytes.fromhex(payment_hash[2:])
        else:
            payment_hash_bytes = bytes.fromhex(payment_hash)
    else:
        payment_hash_bytes = payment_hash

    # Pad to 32 bytes if needed
    payment_hash_bytes = payment_hash_bytes.rjust(32, b"\x00")

    digest = compute_receipt_digest(
        listing_id=listing_id,
        buyer_agent_id=buyer_agent_id,
        payment_hash=payment_hash_bytes,
        amount=amount_int,
        chain_id=chain_id,
        contract_address=contract_address,
    )

    # EIP-191 personal sign: the wallet signs the raw digest bytes, and
    # encode_defunct applies the "\x19Ethereum Signed Message:\n32" prefix.
    signable = encode_defunct(primitive=digest)
    signed = Account.sign_message(signable, private_key=private_key)

    sig_hex = "0x" + signed.signature.hex()

    logger.info(
        "Signed receipt: listing=%d buyer_agent=%d amount=%d chain=%d",
        listing_id,
        buyer_agent_id,
        amount_int,
        chain_id,
    )

    return ReceiptSignature(
        signature=sig_hex,
        digest="0x" + digest.hex(),
        listing_id=listing_id,
        buyer_agent_id=buyer_agent_id,
        payment_hash="0x" + payment_hash_bytes.hex(),
        amount=amount_int,
        chain_id=chain_id,
        contract_address=contract_address,
    )


@dataclass
class SellerSigningConfig:
    """Configuration for seller receipt signing.

    Attach this to a protected endpoint so the middleware knows how to
    construct and sign the receipt digest after settlement.

    Args:
        private_key: Seller's private key (0x-prefixed hex).
        listing_id: Listing ID in DataMarketplace.
        purchase_log_address: PurchaseLog contract address.
        buyer_agent_id_header: HTTP header name that carries the buyer's agent ID.
            If the header is absent, buyer_agent_id defaults to 0 (anonymous).
    """

    private_key: str
    listing_id: int
    purchase_log_address: str
    buyer_agent_id_header: str = "X-Buyer-Agent-Id"
