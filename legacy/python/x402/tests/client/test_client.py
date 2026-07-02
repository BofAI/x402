import pytest

from bankofai.x402.clients import X402Client
from bankofai.x402.clients.x402_client import PaymentRequirementsFilter
from bankofai.x402.types import PaymentRequirements


class MockClientMechanism:
    """用于测试的模拟机制"""

    def scheme(self) -> str:
        return "exact_permit"

    def get_signer(self):
        return None

    async def create_payment_payload(self, requirements, resource, extensions=None):
        return {"mock": "payload"}


def test_client_creation():
    """测试 X402Client 创建"""
    client = X402Client()
    assert client is not None


def test_client_register_mechanism():
    """测试注册机制"""
    client = X402Client()
    mechanism = MockClientMechanism()

    result = client.register("tron:shasta", mechanism)
    assert result is client  # 应该返回 self 以支持链式调用


@pytest.mark.anyio
async def test_client_select_payment_requirements():
    """测试从多个网络中选择支付要求"""
    client = X402Client()
    mechanism = MockClientMechanism()
    client.register("tron:shasta", mechanism)

    accepts = [
        PaymentRequirements(
            scheme="exact_permit",
            network="tron:shasta",
            amount="1000000",
            asset="TTestUSDT",
            payTo="TTestMerchant",
        ),
        PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset="0xTestUSDC",
            payTo="0xTestMerchant",
        ),
    ]

    # 默认应该选择第一个
    selected = await client.select_payment_requirements(accepts)
    assert selected.network in ["tron:shasta", "eip155:8453"]


@pytest.mark.anyio
async def test_client_select_with_tron_filter():
    """测试使用过滤器选择 TRON 支付要求"""
    client = X402Client()
    mechanism = MockClientMechanism()
    client.register("tron:shasta", mechanism)

    accepts = [
        PaymentRequirements(
            scheme="exact_permit",
            network="tron:shasta",
            amount="1000000",
            asset="TTestUSDT",
            payTo="TTestMerchant",
        ),
        PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset="0xTestUSDC",
            payTo="0xTestMerchant",
        ),
    ]

    # 过滤 TRON 网络
    selected = await client.select_payment_requirements(
        accepts, filters=PaymentRequirementsFilter(network="tron:shasta")
    )
    assert selected.network == "tron:shasta"


@pytest.mark.anyio
async def test_client_select_with_evm_filter():
    """测试使用过滤器选择 EVM 支付要求"""
    client = X402Client()

    mechanism = MockClientMechanism()
    client.register("eip155:8453", mechanism)
    accepts = [
        PaymentRequirements(
            scheme="exact_permit",
            network="tron:shasta",
            amount="1000000",
            asset="TTestUSDT",
            payTo="TTestMerchant",
        ),
        PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset="0xTestUSDC",
            payTo="0xTestMerchant",
        ),
    ]

    # 过滤 EVM 网络
    selected = await client.select_payment_requirements(
        accepts, filters=PaymentRequirementsFilter(network="eip155:8453")
    )
    assert selected.network == "eip155:8453"


@pytest.mark.anyio
async def test_client_create_payment_payload():
    """测试创建支付载荷"""
    client = X402Client()
    mechanism = MockClientMechanism()
    client.register("tron:shasta", mechanism)

    requirements = PaymentRequirements(
        scheme="exact_permit",
        network="tron:shasta",
        amount="1000000",
        asset="TTestUSDT",
        payTo="TTestMerchant",
    )

    payload = await client.create_payment_payload(requirements, "https://example.com/resource")
    assert payload == {"mock": "payload"}
