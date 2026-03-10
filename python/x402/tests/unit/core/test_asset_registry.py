"""Tests for AssetRegistry and convert_money."""

import pytest

from bankofai.x402.registry import AssetInfo, AssetRegistry, convert_money


class TestAssetRegistry:
    """Tests for AssetRegistry class."""

    def test_builtin_eth_mainnet_usdc_and_usdt(self) -> None:
        registry = AssetRegistry()
        usdc = registry.resolve("eip155:1", "USDC")
        assert usdc.address == "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        assert usdc.decimals == 6
        assert usdc.asset_transfer_method is None

        usdt = registry.resolve("eip155:1", "USDT")
        assert usdt.asset_transfer_method == "permit2"

    def test_register_custom_asset(self) -> None:
        registry = AssetRegistry()
        info = AssetInfo(address="0xCustom", decimals=18)
        registry.register("eip155:1", "WETH", info)
        assert registry.resolve("eip155:1", "WETH") == info

    def test_register_on_new_network(self) -> None:
        registry = AssetRegistry()
        registry.register("eip155:999", "FOO", AssetInfo(address="0xFoo", decimals=8))
        assert registry.has("eip155:999", "FOO")

    def test_register_all(self) -> None:
        registry = AssetRegistry()
        registry.register_all(
            "eip155:999",
            {
                "AAA": AssetInfo(address="0xAAA", decimals=6),
                "BBB": AssetInfo(address="0xBBB", decimals=18),
            },
        )
        assert registry.has("eip155:999", "AAA")
        assert registry.has("eip155:999", "BBB")

    def test_set_default_and_get_default(self) -> None:
        registry = AssetRegistry()
        symbol, info = registry.get_default("eip155:1")
        assert symbol == "USDC"
        assert info.address == "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

    def test_set_default_unregistered_raises(self) -> None:
        registry = AssetRegistry()
        with pytest.raises(ValueError, match="not registered"):
            registry.set_default("eip155:1", "NONEXISTENT")

    def test_get_default_no_default_raises(self) -> None:
        registry = AssetRegistry()
        registry.register("eip155:999", "FOO", AssetInfo(address="0xFoo", decimals=6))
        with pytest.raises(KeyError, match="No default"):
            registry.get_default("eip155:999")

    def test_resolve_unregistered_symbol_raises(self) -> None:
        registry = AssetRegistry()
        with pytest.raises(KeyError, match="not registered"):
            registry.resolve("eip155:1", "NONEXISTENT")

    def test_resolve_unregistered_network_raises(self) -> None:
        registry = AssetRegistry()
        with pytest.raises(KeyError, match="not registered"):
            registry.resolve("eip155:999999", "USDC")

    def test_get_symbols(self) -> None:
        registry = AssetRegistry()
        symbols = registry.get_symbols("eip155:1")
        assert "USDC" in symbols
        assert "USDT" in symbols

    def test_get_symbols_unknown_network(self) -> None:
        registry = AssetRegistry()
        assert registry.get_symbols("eip155:999999") == []

    def test_has_true(self) -> None:
        registry = AssetRegistry()
        assert registry.has("eip155:1", "USDC") is True

    def test_has_false(self) -> None:
        registry = AssetRegistry()
        assert registry.has("eip155:1", "WETH") is False

    def test_builtin_bsc_mainnet_tokens(self) -> None:
        registry = AssetRegistry()
        usdc = registry.resolve("eip155:56", "USDC")
        assert usdc.address == "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
        assert usdc.decimals == 18
        assert usdc.asset_transfer_method == "permit2"
        assert usdc.supports_eip2612 is None

        usdt = registry.resolve("eip155:56", "USDT")
        assert usdt.address == "0x55d398326f99059fF775485246999027B3197955"
        assert usdt.asset_transfer_method == "permit2"

    def test_builtin_bsc_testnet_tokens(self) -> None:
        registry = AssetRegistry()
        assert registry.has("eip155:97", "USDT")
        assert registry.has("eip155:97", "USDC")

    def test_builtin_tron_mainnet_tokens(self) -> None:
        registry = AssetRegistry()
        usdt = registry.resolve("tron:mainnet", "USDT")
        assert usdt.address == "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
        assert usdt.decimals == 6
        assert usdt.asset_transfer_method == "permit2"

        usdd = registry.resolve("tron:mainnet", "USDD")
        assert usdd.decimals == 18
        assert usdd.supports_eip2612 is True
        assert usdd.asset_transfer_method is None

    def test_builtin_tron_testnet_tokens(self) -> None:
        registry = AssetRegistry()
        assert registry.has("tron:shasta", "USDT")
        assert registry.has("tron:nile", "USDT")
        assert registry.has("tron:nile", "USDD")

    def test_builtin_bsc_tron_defaults(self) -> None:
        registry = AssetRegistry()
        assert registry.get_default("eip155:56")[0] == "USDC"
        assert registry.get_default("eip155:97")[0] == "USDT"
        assert registry.get_default("tron:mainnet")[0] == "USDT"
        assert registry.get_default("tron:shasta")[0] == "USDT"
        assert registry.get_default("tron:nile")[0] == "USDT"


class TestConvertMoney:
    """Tests for convert_money function."""

    def test_dollar_string_6_decimals(self) -> None:
        assert convert_money("$1.50", 6) == "1500000"

    def test_number_6_decimals(self) -> None:
        assert convert_money(1.5, 6) == "1500000"

    def test_18_decimals(self) -> None:
        assert convert_money("$1.50", 18) == "1500000000000000000"

    def test_integer_price(self) -> None:
        assert convert_money("$1", 6) == "1000000"
        assert convert_money(1, 6) == "1000000"

    def test_small_amount(self) -> None:
        assert convert_money("$0.001", 6) == "1000"

    def test_zero(self) -> None:
        assert convert_money(0, 6) == "0"
        assert convert_money("$0", 6) == "0"

    def test_invalid_format_raises(self) -> None:
        with pytest.raises(ValueError, match="Invalid money format"):
            convert_money("abc", 6)
