"""Tests for TRON utilities."""

import pytest

from bankofai.x402.mechanisms.tron.constants import TRON_CHAIN_IDS, TRON_NETWORK_CONFIGS
from bankofai.x402.mechanisms.tron.utils import (
    create_nonce,
    get_asset_info,
    get_network_config,
    get_tron_chain_id,
    normalize_address_for_signing,
)


def test_get_tron_chain_id():
    assert get_tron_chain_id("tron:nile") == TRON_CHAIN_IDS["tron:nile"]


def test_get_tron_chain_id_invalid():
    with pytest.raises(ValueError):
        get_tron_chain_id("eip155:1")


def test_get_network_config():
    cfg = get_network_config("tron:mainnet")
    assert cfg["chain_id"] == TRON_NETWORK_CONFIGS["tron:mainnet"]["chain_id"]


def test_get_network_config_unknown():
    with pytest.raises(ValueError):
        get_network_config("tron:unknown")


def test_get_asset_info_default():
    default = TRON_NETWORK_CONFIGS["tron:nile"]["default_asset"]
    asset = get_asset_info("tron:nile", default["address"])
    assert asset["address"] == default["address"]


def test_get_asset_info_additional_asset():
    info = get_asset_info("tron:nile", "TZ78R2E6ejfFhxq8hxrmuqT6hGBxjHQbo4")
    assert info["name"] == "Usdd Stablecoin"
    assert info["decimals"] == 18


def test_get_asset_info_unknown_raises():
    with pytest.raises(ValueError, match="not a registered asset"):
        get_asset_info("tron:nile", "0x" + "ff" * 20)


def test_normalize_address_for_signing_accepts_hex():
    addr = "0x" + "AA" * 20
    assert normalize_address_for_signing(addr) == addr.lower()


def test_normalize_address_for_signing_accepts_41_prefix():
    addr = "41" + "11" * 20
    assert normalize_address_for_signing(addr) == "0x" + "11" * 20


def test_normalize_address_for_signing_invalid():
    with pytest.raises(ValueError):
        normalize_address_for_signing("not-an-address")


def test_create_nonce_format():
    nonce = create_nonce()
    assert nonce.startswith("0x")
    assert len(nonce) == 66
