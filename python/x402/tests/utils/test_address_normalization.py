from web3 import Web3

from bankofai.x402.types import PaymentPermit, PaymentRequirements


def test_payment_requirements_preserves_addresses() -> None:
    req = PaymentRequirements(
        scheme="exact_permit",
        network="eip155:97",
        amount="1",
        asset="0x52908400098527886e0f7030069857d2e4169ee7",
        payTo="0x27b1fdb04752bbc536007a920d24acb045561c26",
        extra={
            "fee": {
                "feeTo": "0xde709f2102306220921060314715629080e2fb77",
                "feeAmount": "1",
                "caller": "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359",
            }
        },
    )

    assert req.asset == "0x52908400098527886e0f7030069857d2e4169ee7"
    assert req.pay_to == "0x27b1fdb04752bbc536007a920d24acb045561c26"
    assert req.extra is not None
    assert req.extra.fee is not None
    assert req.extra.fee.fee_to == "0xde709f2102306220921060314715629080e2fb77"
    assert req.extra.fee.caller == "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359"


def test_payment_permit_checksum_addresses() -> None:
    permit = PaymentPermit(
        meta={
            "kind": "PAYMENT_ONLY",
            "paymentId": "0x" + "11" * 16,
            "nonce": "1",
            "validAfter": 0,
            "validBefore": 1,
        },
        buyer="0x52908400098527886e0f7030069857d2e4169ee7",
        caller="0xde709f2102306220921060314715629080e2fb77",
        payment={
            "payToken": "0x27b1fdb04752bbc536007a920d24acb045561c26",
            "payAmount": "1",
            "payTo": "0x5aeda56215b167893e80b4fe645ba6d5bab767de",
        },
        fee={
            "feeTo": "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359",
            "feeAmount": "1",
        },
    )

    assert permit.buyer == Web3.to_checksum_address(permit.buyer)
    assert permit.caller == Web3.to_checksum_address(permit.caller)
    assert permit.payment.pay_token == Web3.to_checksum_address(permit.payment.pay_token)
    assert permit.payment.pay_to == Web3.to_checksum_address(permit.payment.pay_to)
    assert permit.fee.fee_to == Web3.to_checksum_address(permit.fee.fee_to)
