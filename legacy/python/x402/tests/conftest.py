"""
Pytest 配置和测试夹具
"""

import pytest


@pytest.fixture
def mock_tron_private_key():
    """用于测试的模拟 TRON 私钥"""
    return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


@pytest.fixture
def mock_evm_private_key():
    """用于测试的模拟 EVM 私钥"""
    return "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


@pytest.fixture
def mock_tron_payment_requirements():
    """用于测试的模拟 TRON 支付要求"""
    from bankofai.x402.types import PaymentRequirements

    return PaymentRequirements(
        scheme="exact_permit",
        network="tron:shasta",
        amount="1000000",
        asset="TTestUSDTAddress",
        payTo="TTestMerchantAddress",
        maxTimeoutSeconds=3600,
    )


@pytest.fixture
def mock_evm_payment_requirements():
    """用于测试的模拟 EVM 支付要求"""
    from bankofai.x402.types import PaymentRequirements

    return PaymentRequirements(
        scheme="exact_permit",
        network="eip155:8453",
        amount="1000000",
        asset="0xTestUSDCAddress",
        payTo="0xTestMerchantAddress",
        maxTimeoutSeconds=3600,
    )
