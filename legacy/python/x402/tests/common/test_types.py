from bankofai.x402.types import (
    Fee,
    Payment,
    PaymentPermit,
    PaymentRequirements,
    PermitMeta,
)


def test_payment_permit_creation():
    """测试 PaymentPermit 模型创建"""
    permit = PaymentPermit(
        meta=PermitMeta(
            kind="PAYMENT_ONLY",
            paymentId="test_id",
            nonce="12345",
            validAfter=1000,
            validBefore=2000,
        ),
        buyer="TTestBuyerAddress",
        caller="TTestCallerAddress",
        payment=Payment(
            payToken="TTestTokenAddress",
            payAmount="1000000",
            payTo="TTestPayToAddress",
        ),
        fee=Fee(feeTo="TTestFeeAddress", feeAmount="10000"),
    )

    assert permit.buyer == "TTestBuyerAddress"
    assert permit.payment.pay_amount == "1000000"
    assert permit.meta.kind == "PAYMENT_ONLY"


def test_payment_requirements_creation():
    """测试 PaymentRequirements 模型创建"""
    requirements = PaymentRequirements(
        scheme="exact_permit",
        network="tron:shasta",
        amount="1000000",
        asset="TTestUSDTAddress",
        payTo="TTestMerchantAddress",
        maxTimeoutSeconds=3600,
    )

    assert requirements.scheme == "exact_permit"
    assert requirements.network == "tron:shasta"
    assert requirements.amount == "1000000"


def test_payment_permit_serialization():
    """测试 PaymentPermit 序列化为字典"""
    permit = PaymentPermit(
        meta=PermitMeta(
            kind="PAYMENT_ONLY",
            paymentId="test_id",
            nonce="12345",
            validAfter=1000,
            validBefore=2000,
        ),
        buyer="TTestBuyerAddress",
        caller="TTestCallerAddress",
        payment=Payment(
            payToken="TTestTokenAddress",
            payAmount="1000000",
            payTo="TTestPayToAddress",
        ),
        fee=Fee(feeTo="TTestFeeAddress", feeAmount="10000"),
    )

    data = permit.model_dump(by_alias=True)
    assert "buyer" in data
    assert "payment" in data
    assert data["payment"]["payAmount"] == "1000000"
