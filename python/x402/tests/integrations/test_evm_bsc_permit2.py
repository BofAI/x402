"""BSC permit2 integration tests for the Python x402 SDK.

These tests perform REAL blockchain transactions on BSC Testnet.

Required environment variables:
- BSC_CLIENT_PRIVATE_KEY
- BSC_FACILITATOR_PRIVATE_KEY
- BSC_TESTNET_RPC_URL

The payer wallet must already have:
- testnet BNB for gas
- testnet USDT
- an approval for the configured BSC Permit2 contract
"""

import os

import pytest
from eth_account import Account

from bankofai.x402 import x402ClientSync, x402FacilitatorSync, x402ResourceServerSync
from bankofai.x402.mechanisms.evm import SCHEME_EXACT
from bankofai.x402.mechanisms.evm.constants import NETWORK_CONFIGS
from bankofai.x402.mechanisms.evm.exact import (
    ExactEvmClientScheme,
    ExactEvmFacilitatorScheme,
    ExactEvmSchemeConfig,
    ExactEvmServerScheme,
)
from bankofai.x402.mechanisms.evm.signers import EthAccountSigner, FacilitatorWeb3Signer
from bankofai.x402.schemas import (
    PaymentPayload,
    PaymentRequirements,
    ResourceConfig,
    SupportedResponse,
)

BSC_CLIENT_PRIVATE_KEY = os.environ.get("BSC_CLIENT_PRIVATE_KEY")
BSC_FACILITATOR_PRIVATE_KEY = os.environ.get("BSC_FACILITATOR_PRIVATE_KEY")
BSC_RPC_URL = os.environ.get("BSC_TESTNET_RPC_URL")

BSC_TESTNET = "eip155:97"
BSC_USDT_ADDRESS = NETWORK_CONFIGS[BSC_TESTNET]["default_asset"]["address"]

pytestmark = pytest.mark.skipif(
    not BSC_CLIENT_PRIVATE_KEY or not BSC_FACILITATOR_PRIVATE_KEY or not BSC_RPC_URL,
    reason=(
        "BSC_CLIENT_PRIVATE_KEY, BSC_FACILITATOR_PRIVATE_KEY, and "
        "BSC_TESTNET_RPC_URL are required for BSC permit2 integration tests"
    ),
)


class EvmFacilitatorClientSync:
    """Facilitator client wrapper for x402ResourceServerSync."""

    scheme = SCHEME_EXACT
    network = BSC_TESTNET
    x402_version = 2

    def __init__(self, facilitator: x402FacilitatorSync):
        self._facilitator = facilitator

    def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ):
        return self._facilitator.verify(payload, requirements)

    def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ):
        return self._facilitator.settle(payload, requirements)

    def get_supported(self) -> SupportedResponse:
        return self._facilitator.get_supported()


class TestBscPermit2Integration:
    """Integration tests for the Python EVM permit2 flow on BSC Testnet."""

    def setup_method(self) -> None:
        client_account = Account.from_key(BSC_CLIENT_PRIVATE_KEY)
        self.client_signer = EthAccountSigner(client_account)
        self.facilitator_signer = FacilitatorWeb3Signer(
            private_key=BSC_FACILITATOR_PRIVATE_KEY,
            rpc_url=BSC_RPC_URL,
        )
        self.client_address = self.client_signer.address
        self.facilitator_address = self.facilitator_signer.address

        self.client = x402ClientSync().register(
            BSC_TESTNET,
            ExactEvmClientScheme(self.client_signer),
        )
        self.facilitator = x402FacilitatorSync().register(
            [BSC_TESTNET],
            ExactEvmFacilitatorScheme(
                self.facilitator_signer,
                ExactEvmSchemeConfig(deploy_erc4337_with_eip6492=True),
            ),
        )
        facilitator_client = EvmFacilitatorClientSync(self.facilitator)
        self.server = x402ResourceServerSync(facilitator_client)
        self.server.register(BSC_TESTNET, ExactEvmServerScheme())
        self.server.initialize()

    def test_server_should_successfully_verify_and_settle_bsc_permit2_payment(self) -> None:
        """Exercise the full BSC Testnet permit2 flow against real chain state."""
        config = ResourceConfig(
            scheme=SCHEME_EXACT,
            network=BSC_TESTNET,
            pay_to=self.facilitator_address,
            price="$0.0001",
        )
        accepts = self.server.build_payment_requirements(config)

        assert len(accepts) == 1
        assert accepts[0].network == BSC_TESTNET
        assert accepts[0].asset == BSC_USDT_ADDRESS
        assert accepts[0].extra["assetTransferMethod"] == "permit2"
        assert accepts[0].extra["permit2FacilitatorAddress"].lower() == (
            self.facilitator_address.lower()
        )

        payment_required = self.server.create_payment_required_response(accepts)
        payment_payload = self.client.create_payment_payload(payment_required)

        assert "permit2Authorization" in payment_payload.payload
        assert (
            payment_payload.payload["permit2Authorization"]["witness"]["facilitator"].lower()
            == self.facilitator_address.lower()
        )

        accepted = self.server.find_matching_requirements(accepts, payment_payload)
        assert accepted is not None

        verify_response = self.server.verify_payment(payment_payload, accepted)
        assert verify_response.is_valid is True
        assert verify_response.payer.lower() == self.client_address.lower()

        settle_response = self.server.settle_payment(payment_payload, accepted)
        assert settle_response.success is True
        assert settle_response.network == BSC_TESTNET
        assert settle_response.transaction.startswith("0x")
        assert settle_response.payer.lower() == self.client_address.lower()
