import os

from tronpy import Tron
from tronpy.keys import PrivateKey


def _load_private_key() -> PrivateKey:
    private_key = os.environ.get(
        "TRON_PRIVATE_KEY",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    if private_key.startswith("0x"):
        private_key = private_key[2:]
    return PrivateKey(bytes.fromhex(private_key))


def main() -> None:
    tron = Tron(network="nile")
    priv_key = _load_private_key()
    owner = priv_key.public_key.to_base58check_address()

    token_address = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"  # Nile USDT
    spender = "TXCxox5kcZiZNq4Ysv86m8icv4JfxXWkfe"

    contract = tron.get_contract(token_address)
    txn = (
        contract.functions.approve(spender, 1_000_000)
        .with_owner(owner)
        .fee_limit(10_000_000)
        .build()
    )
    signed = txn.sign(priv_key)
    signed_json = signed.to_json()

    print(f"tronpy_version={getattr(__import__('tronpy'), '__version__', 'unknown')}")
    print(f"owner={owner}")
    print(f"tx_id={signed.txid}")
    print(f"signed_has_signature={bool(signed_json.get('signature'))}")

    # Validate via tronpy with Transaction instance.
    weight_txn = tron.get_sign_weight(signed)
    print(f"sign_weight_transaction={weight_txn}")

    print(f"signed_json_keys={sorted(signed_json.keys())}")

    # Rebuild Transaction from JSON and validate.
    from tronpy.tron import Transaction

    rebuilt = Transaction.from_json(signed_json, client=tron)
    weight_rebuilt = tron.get_sign_weight(rebuilt)
    print(f"sign_weight_rebuilt={weight_rebuilt}")


if __name__ == "__main__":
    main()
