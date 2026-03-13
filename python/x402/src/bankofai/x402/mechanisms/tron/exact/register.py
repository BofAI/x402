"""Registration helpers for TRON exact payment schemes."""

from typing import TYPE_CHECKING, TypeVar

if TYPE_CHECKING:
    from bankofai.x402 import x402Facilitator, x402FacilitatorSync, x402ResourceServer, x402ResourceServerSync

FacilitatorT = TypeVar("FacilitatorT", "x402Facilitator", "x402FacilitatorSync")
ServerT = TypeVar("ServerT", "x402ResourceServer", "x402ResourceServerSync")


def register_exact_tron_facilitator(
    facilitator: FacilitatorT,
    signer,
    networks: str | list[str] = "tron:nile",
) -> FacilitatorT:
    """Register TRON exact payment scheme to an x402Facilitator.

    Args:
        facilitator: x402Facilitator or x402FacilitatorSync instance.
        signer: FacilitatorTronSigner instance.
        networks: TRON network(s) to register.

    Returns:
        Facilitator for chaining.
    """
    from .facilitator import ExactTronScheme

    scheme = ExactTronScheme(signer)
    if isinstance(networks, str):
        networks = [networks]
    facilitator.register(networks, scheme)  # type: ignore[arg-type]
    return facilitator


def register_exact_tron_server(
    server: ServerT,
    networks: str | list[str] = "tron:nile",
) -> ServerT:
    """Register TRON exact server scheme to an x402ResourceServer.

    Args:
        server: x402ResourceServer or x402ResourceServerSync instance.
        networks: TRON network(s) to register.

    Returns:
        Server for chaining.
    """
    from .server import ExactTronServerScheme

    scheme = ExactTronServerScheme()
    if isinstance(networks, str):
        networks = [networks]
    for network in networks:
        server.register(network, scheme)  # type: ignore[arg-type]
    return server
