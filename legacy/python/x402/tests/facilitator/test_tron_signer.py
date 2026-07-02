from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.signers.facilitator.tron_signer import TronFacilitatorSigner


@pytest.mark.anyio
async def test_tron_facilitator_write_contract_uses_agent_wallet_with_active_permission(
    monkeypatch,
):
    wallet = MagicMock()
    wallet.sign_transaction = AsyncMock(return_value='{"signature":["' + ("ab" * 65) + '"]}')

    signer = TronFacilitatorSigner(wallet)
    signer.set_address("TFacilitatorAddress")

    txn = MagicMock()
    txn.to_json.return_value = {"txID": "txid", "raw_data": {"fee_limit": 1_000_000_000}}
    txn.raw_data_hex = "deadbeef"
    txn.broadcast = AsyncMock(return_value={"txid": "txhash"})

    txn_builder = MagicMock()
    txn_builder.with_owner.return_value = txn_builder
    txn_builder.permission_id.return_value = txn_builder
    txn_builder.fee_limit.return_value = txn_builder
    txn_builder.build = AsyncMock(return_value=txn)

    function = AsyncMock(return_value=txn_builder)
    function.function_signature = "permitTransferFrom(...)"
    function.function_signature_hash = "c13f2d68"

    functions = MagicMock()
    setattr(functions, "permitTransferFrom", function)

    contract = MagicMock()
    contract.functions = functions

    client = MagicMock()
    client.get_account = AsyncMock(return_value={"balance": 1_000_000})
    client.get_account_resource = AsyncMock(return_value={})
    client.get_contract = AsyncMock(return_value=contract)
    signer._ensure_async_tron_client = MagicMock(return_value=client)

    txid = await signer.write_contract(
        contract_address="TPermitContract",
        abi="[]",
        method="permitTransferFrom",
        args=["permit", "buyer", b"sig"],
        network="tron:nile",
    )

    assert txid == "txhash"
    txn_builder.with_owner.assert_called_once_with("TFacilitatorAddress")
    txn_builder.permission_id.assert_called_once_with(2)
    wallet.sign_transaction.assert_awaited_once_with(
        {
            "txID": "txid",
            "raw_data_hex": "deadbeef",
            "raw_data": {"fee_limit": 1_000_000_000},
        }
    )
    assert txn._signature == ["ab" * 65]


@pytest.mark.anyio
async def test_tron_facilitator_permission_id_env_override(monkeypatch):
    monkeypatch.setenv("TRON_PERMISSION_ID", "3")

    wallet = MagicMock()
    signer = TronFacilitatorSigner(wallet)

    assert signer._permission_id == 3
