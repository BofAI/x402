from bankofai.x402.config import NetworkConfig


def test_gasfree_controller_mainnet_address() -> None:
    assert (
        NetworkConfig.get_gasfree_controller_address("tron:mainnet")
        == "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U"
    )
