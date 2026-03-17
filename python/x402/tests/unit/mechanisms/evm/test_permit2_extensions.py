"""Tests for EVM Permit2 gas sponsoring extensions."""

from eth_abi import encode
from eth_account import Account
from eth_utils import keccak

from bankofai.x402.extensions.eip2612_gas_sponsoring import EIP2612_GAS_SPONSORING
from bankofai.x402.extensions.erc20_approval_gas_sponsoring import (
    ERC20_APPROVAL_GAS_SPONSORING,
    Erc20ApprovalGasSponsoringExtension,
)
from bankofai.x402.interfaces import FacilitatorContext
from bankofai.x402.mechanisms.evm import (
    get_evm_chain_id,
    get_permit2_address,
    get_x402_exact_permit2_proxy_address,
)
from bankofai.x402.mechanisms.evm.exact.permit2 import verify_permit2
from bankofai.x402.mechanisms.evm.types import ExactPermit2Payload
from bankofai.x402.schemas import PaymentPayload, PaymentRequirements


class DummySigner:
    def __init__(self, balance: int = 10**9):
        self._balance = balance

    def get_addresses(self):
        return ["0xF000000000000000000000000000000000000001"]

    def read_contract(self, address, abi, function_name, *args):
        if function_name == "allowance":
            return 0
        if function_name == "balanceOf":
            return self._balance
        return 0

    def verify_typed_data(self, *args, **kwargs):
        return True

    def write_contract(self, *args, **kwargs):
        return "0x" + "00" * 32

    def wait_for_transaction_receipt(self, tx_hash):
        from bankofai.x402.mechanisms.evm.types import TransactionReceipt

        return TransactionReceipt(status=1, block_number=1, tx_hash=tx_hash)


def _build_requirements():
    return PaymentRequirements(
        scheme="exact",
        network="eip155:8453",
        asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount="1000",
        pay_to="0x0987654321098765432109876543210987654321",
        max_timeout_seconds=3600,
        extra={"name": "USD Coin", "version": "2", "assetTransferMethod": "permit2"},
    )


def _build_permit2_payload(requirements: PaymentRequirements, payer: str) -> dict:
    return {
        "signature": "0x" + "11" * 65,
        "permit2Authorization": {
            "from": payer,
            "permitted": {"token": requirements.asset, "amount": requirements.amount},
            "spender": get_x402_exact_permit2_proxy_address(str(requirements.network)),
            "nonce": "1",
            "deadline": str(9999999999),
            "witness": {
                "to": requirements.pay_to,
                "facilitator": requirements.pay_to,
                "validAfter": "0",
            },
        },
    }


def _build_signed_erc20_approval_tx(private_key: str, token: str, spender: str, chain_id: int) -> str:
    account = Account.from_key(private_key)
    selector = keccak(text="approve(address,uint256)")[:4]
    calldata = selector + encode(["address", "uint256"], [spender, 2**256 - 1])
    signed = account.sign_transaction(
        {
            "to": token,
            "data": "0x" + calldata.hex(),
            "value": 0,
            "nonce": 1,
            "gas": 100000,
            "maxFeePerGas": 1_000_000_000,
            "maxPriorityFeePerGas": 100_000_000,
            "chainId": chain_id,
        }
    )
    raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
    return "0x" + bytes(raw).hex()


def test_verify_permit2_accepts_eip2612_extension():
    requirements = _build_requirements()
    payload_dict = _build_permit2_payload(
        requirements, payer="0x1234567890123456789012345678901234567890"
    )

    payload = PaymentPayload(
        x402_version=2,
        accepted=requirements,
        payload=payload_dict,
        extensions={
            EIP2612_GAS_SPONSORING.key: {
                "info": {
                    "from": "0x1234567890123456789012345678901234567890",
                    "asset": requirements.asset,
                    "spender": get_permit2_address(str(requirements.network)),
                    "amount": requirements.amount,
                    "nonce": "1",
                    "deadline": str(9999999999),
                    "signature": "0x" + "11" * 65,
                    "version": "1",
                },
                "schema": {},
            }
        },
    )

    result = verify_permit2(
        DummySigner(),
        payload,
        requirements,
        ExactPermit2Payload.from_dict(payload_dict),
    )
    assert result.is_valid is True


def test_verify_permit2_accepts_erc20_extension_with_context():
    requirements = _build_requirements()
    payer_key = "0x59c6995e998f97a5a0044976f7ad0dc2f1b362f8c6f7f3d9f9a6b8b63f7f3f4f"
    payer = Account.from_key(payer_key).address
    payload_dict = _build_permit2_payload(requirements, payer=payer)
    signed_tx = _build_signed_erc20_approval_tx(
        payer_key,
        requirements.asset,
        get_permit2_address(str(requirements.network)),
        get_evm_chain_id(str(requirements.network)),
    )

    payload = PaymentPayload(
        x402_version=2,
        accepted=requirements,
        payload=payload_dict,
        extensions={
            ERC20_APPROVAL_GAS_SPONSORING.key: {
                "info": {
                    "from": payer,
                    "asset": requirements.asset,
                    "spender": get_permit2_address(str(requirements.network)),
                    "amount": requirements.amount,
                    "signedTransaction": signed_tx,
                    "version": "1",
                },
                "schema": {},
            }
        },
    )

    context = FacilitatorContext(
        {ERC20_APPROVAL_GAS_SPONSORING.key: Erc20ApprovalGasSponsoringExtension(key=ERC20_APPROVAL_GAS_SPONSORING.key)}
    )

    result = verify_permit2(
        DummySigner(),
        payload,
        requirements,
        ExactPermit2Payload.from_dict(payload_dict),
        context,
    )
    assert result.is_valid is True
