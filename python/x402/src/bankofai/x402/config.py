"""
X402 Network Configuration
Centralized configuration for contract addresses and network settings
"""

from typing import Dict

from bankofai.x402.exceptions import UnsupportedNetworkError


class NetworkConfig:
    """Network configuration for contract addresses and chain IDs"""

    # Default networks
    TRON_MAINNET = "tron:mainnet"
    TRON_SHASTA = "tron:shasta"
    TRON_NILE = "tron:nile"

    # EVM Networks
    EVM_MAINNET = "eip155:1"
    EVM_SEPOLIA = "eip155:11155111"
    BSC_MAINNET = "eip155:56"
    BSC_TESTNET = "eip155:97"

    # TRON Chain IDs
    CHAIN_IDS: Dict[str, int] = {
        "tron:mainnet": 728126428,  # 0x2b6653dc
        "tron:shasta": 2494104990,  # 0x94a9059e
        "tron:nile": 3448148188,  # 0xcd8690dc
        "eip155:1": 1,
        "eip155:11155111": 11155111,
        "eip155:56": 56,
        "eip155:97": 97,
    }

    # PaymentPermit contract addresses
    PAYMENT_PERMIT_ADDRESSES: Dict[str, str] = {
        "tron:mainnet": "TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn",
        "tron:shasta": "TR2XninQ3jsvRRLGTifFyUHTBysffooUjt",
        "tron:nile": "TFxDcGvS7zfQrS1YzcCMp673ta2NHHzsiH",
        "eip155:97": "0x1825bB32db3443dEc2cc7508b2D818fc13EaD878",
        "eip155:56": "0x1825bB32db3443dEc2cc7508b2D818fc13EaD878",
    }

    # GasFreeController contract addresses
    GASFREE_CONTROLLER_ADDRESSES: Dict[str, str] = {
        "tron:mainnet": "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U",
        "tron:shasta": "TQghdCeVDA6CnuNVTUhfaAyPfTetqZWNpm",
        "tron:nile": "THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc",
    }

    # GasFree API Base URLs
    GASFREE_API_BASE_URLS: Dict[str, str] = {
        "tron:mainnet": "https://facilitator.bankofai.io/mainnet",
        "tron:shasta": "https://facilitator.bankofai.io/shasta",
        "tron:nile": "https://facilitator.bankofai.io/nile",
    }

    # RPC URLs for EVM networks
    RPC_URLS: Dict[str, str] = {
        "eip155:97": "https://data-seed-prebsc-1-s1.binance.org:8545/",
        "eip155:56": "https://bsc-dataseed.binance.org/",
        # "eip155:1": "https://eth.llamarpc.com",
    }

    @classmethod
    def get_rpc_url(cls, network: str) -> str | None:
        """Get RPC URL for an EVM network.

        Args:
            network: Network identifier (e.g., "eip155:97")

        Returns:
            RPC URL string, or None if not configured
        """
        return cls.RPC_URLS.get(network)

    @classmethod
    def get_chain_id(cls, network: str) -> int:
        """Get chain ID for network

        Args:
            network: Network identifier (e.g., "tron:nile", "eip155:8453")

        Returns:
            Chain ID as integer

        Raises:
            UnsupportedNetworkError: If network is not supported
        """
        # EVM networks encode chain ID directly in the identifier
        if network.startswith("eip155:"):
            try:
                return int(network.split(":", 1)[1])
            except (ValueError, IndexError):
                raise UnsupportedNetworkError(f"Invalid EVM network: {network}")

        chain_id = cls.CHAIN_IDS.get(network)
        if chain_id is None:
            raise UnsupportedNetworkError(f"Unsupported network: {network}")
        return chain_id

    @classmethod
    def get_payment_permit_address(cls, network: str) -> str:
        """Get PaymentPermit contract address for network

        Args:
            network: Network identifier (e.g., "tron:nile", "eip155:8453")

        Returns:
            Contract address (Base58 for TRON, 0x-hex for EVM)
        """
        addr = cls.PAYMENT_PERMIT_ADDRESSES.get(network)
        if addr is not None:
            return addr
        # EVM fallback: zero address
        if network.startswith("eip155:"):
            return "0x0000000000000000000000000000000000000000"
        return "T0000000000000000000000000000000"

    @classmethod
    def get_gasfree_controller_address(cls, network: str) -> str:
        """Get GasFreeController contract address for network"""
        return cls.GASFREE_CONTROLLER_ADDRESSES.get(network, "T0000000000000000000000000000000")

    @classmethod
    def get_gasfree_api_base_url(cls, network: str) -> str:
        """Get GasFree API Base URL for network"""
        url = cls.GASFREE_API_BASE_URLS.get(network)
        if not url:
            raise UnsupportedNetworkError(f"No GasFree API URL configured for network: {network}")
        return url

