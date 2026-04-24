"""
Mock facilitator FastAPI app.

Behavior is controlled by the `MOCK_FACILITATOR_MODE` env var (or the `?mode=`
query parameter on `/verify` and `/settle`), which overrides the process-level
default for that single request.

Modes:
  success                      — verify: isValid=true; settle: success=true, deterministic tx hash.
  fail_verify_invalid_sig      — verify: isValid=false, invalidReason="invalid_signature".
  fail_verify_expired          — verify: isValid=false, invalidReason="deadline_expired".
  fail_verify_network_mismatch — verify: isValid=false, invalidReason="network_mismatch".
  fail_settle_insufficient     — verify ok, settle: success=false, errorReason="insufficient_balance".
  fail_settle_revert           — verify ok, settle: success=false, errorReason="settle_reverted".

Every request is appended as one JSON line to `MOCK_FACILITATOR_LOG` (default
`/tmp/x402-mock-facilitator.log`) so scenarios can assert on interactions.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse

DEFAULT_SUPPORTED_KINDS: list[dict[str, Any]] = [
    {"x402Version": 2, "scheme": "exact", "network": "eip155:97"},
    {"x402Version": 2, "scheme": "exact_permit", "network": "eip155:97"},
    {"x402Version": 2, "scheme": "exact", "network": "eip155:56"},
    {"x402Version": 2, "scheme": "exact_permit", "network": "eip155:56"},
    {"x402Version": 2, "scheme": "exact_gasfree", "network": "tron:nile"},
    {"x402Version": 2, "scheme": "exact_gasfree", "network": "tron:mainnet"},
]

DETERMINISTIC_TX_HASH = "0x" + "11" * 32

_VALID_MODES = {
    "success",
    "fail_verify_invalid_sig",
    "fail_verify_expired",
    "fail_verify_network_mismatch",
    "fail_settle_insufficient",
    "fail_settle_revert",
}


def _default_mode() -> str:
    mode = os.environ.get("MOCK_FACILITATOR_MODE", "success")
    if mode not in _VALID_MODES:
        raise ValueError(f"invalid MOCK_FACILITATOR_MODE: {mode}")
    return mode


def _log_path() -> Path:
    return Path(os.environ.get("MOCK_FACILITATOR_LOG", "/tmp/x402-mock-facilitator.log"))


def _log(entry: dict[str, Any]) -> None:
    entry["ts"] = datetime.now(timezone.utc).isoformat()
    try:
        with _log_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, sort_keys=True) + "\n")
    except OSError:
        pass


def _resolve_mode(mode_query: str | None) -> str:
    if mode_query:
        if mode_query not in _VALID_MODES:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=422,
                detail=f"invalid mode '{mode_query}'. valid: {sorted(_VALID_MODES)}",
            )
        return mode_query
    return _default_mode()


def _verify_reply(mode: str) -> dict[str, Any]:
    if mode == "fail_verify_invalid_sig":
        return {"isValid": False, "invalidReason": "invalid_signature"}
    if mode == "fail_verify_expired":
        return {"isValid": False, "invalidReason": "deadline_expired"}
    if mode == "fail_verify_network_mismatch":
        return {"isValid": False, "invalidReason": "network_mismatch"}
    return {"isValid": True, "invalidReason": None}


_SETTLE_ERROR_REASONS = {
    "fail_verify_invalid_sig": "invalid_signature",
    "fail_verify_expired": "deadline_expired",
    "fail_verify_network_mismatch": "network_mismatch",
    "fail_settle_insufficient": "insufficient_balance",
    "fail_settle_revert": "settle_reverted",
}


def _settle_reply(mode: str, network: str | None) -> dict[str, Any]:
    error_reason = _SETTLE_ERROR_REASONS.get(mode)
    if error_reason is not None:
        return {
            "success": False,
            "transaction": None,
            "network": network,
            "errorReason": error_reason,
        }
    return {
        "success": True,
        "transaction": DETERMINISTIC_TX_HASH,
        "network": network,
        "errorReason": None,
    }


# ---------------------------------------------------------------------------
# GasFree API mock (required for exact_gasfree scenarios)
# ---------------------------------------------------------------------------

# Static provider used for GasFree scenarios. Must be a valid TRON address so
# that `TronAddressConverter.normalize` accepts it; the specific identity does
# not matter because the mock facilitator never actually relays.
MOCK_GASFREE_PROVIDER = "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"

# Static "GasFree custodial address" returned for any user. Again, arbitrary
# but valid.
MOCK_GASFREE_ADDRESS = "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"


def create_app() -> FastAPI:
    app = FastAPI(title="x402 mock facilitator", version="0.1.0")

    @app.get("/supported")
    async def supported() -> dict[str, Any]:
        _log({"endpoint": "supported"})
        return {"kinds": DEFAULT_SUPPORTED_KINDS}

    @app.post("/fee/quote")
    async def fee_quote(request: Request) -> JSONResponse:
        body = await request.json()
        _log({"endpoint": "fee_quote", "body": body})
        accepts = body.get("accepts", [])
        quotes: list[dict[str, Any]] = []
        for item in accepts:
            quotes.append(
                {
                    "fee": {
                        "facilitatorId": "mock-facilitator",
                        "feeTo": item.get("payTo") or "0x0000000000000000000000000000000000000000",
                        "feeAmount": "0",
                    },
                    "pricing": item.get("amount", "0"),
                    "scheme": item.get("scheme", ""),
                    "network": item.get("network", ""),
                    "asset": item.get("asset", ""),
                    "expiresAt": None,
                }
            )
        return JSONResponse(quotes)

    @app.post("/verify")
    async def verify(
        request: Request,
        mode: str | None = Query(default=None),
    ) -> JSONResponse:
        body = await request.json()
        resolved = _resolve_mode(mode)
        _log({"endpoint": "verify", "mode": resolved, "body": body})
        return JSONResponse(_verify_reply(resolved))

    @app.post("/settle")
    async def settle(
        request: Request,
        mode: str | None = Query(default=None),
    ) -> JSONResponse:
        body = await request.json()
        resolved = _resolve_mode(mode)
        network = None
        requirements = body.get("paymentRequirements") or {}
        if isinstance(requirements, dict):
            network = requirements.get("network")
        _log({"endpoint": "settle", "mode": resolved, "body": body})
        return JSONResponse(_settle_reply(resolved, network))

    @app.get("/api/v1/address/{user}")
    async def gasfree_address(user: str) -> JSONResponse:
        _log({"endpoint": "gasfree_address", "user": user})
        return JSONResponse(
            {
                "code": 200,
                "message": "ok",
                "data": {
                    "accountAddress": user,
                    "gasFreeAddress": MOCK_GASFREE_ADDRESS,
                    "active": True,
                    "nonce": 0,
                    "assets": [
                        {
                            "tokenAddress": "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",
                            "balance": "1000000000000",
                            "transferFee": "0",
                            "activateFee": "0",
                        },
                        {
                            "tokenAddress": "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
                            "balance": "1000000000000",
                            "transferFee": "0",
                            "activateFee": "0",
                        },
                    ],
                },
            }
        )

    @app.get("/api/v1/config/provider/all")
    async def gasfree_providers() -> JSONResponse:
        _log({"endpoint": "gasfree_providers"})
        return JSONResponse(
            {
                "code": 200,
                "message": "ok",
                "data": {"providers": [{"address": MOCK_GASFREE_PROVIDER}]},
            }
        )

    @app.get("/control/log")
    async def control_log() -> JSONResponse:
        path = _log_path()
        if not path.exists():
            return JSONResponse({"entries": []})
        entries = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return JSONResponse({"entries": entries})

    @app.post("/control/reset")
    async def control_reset() -> JSONResponse:
        path = _log_path()
        if path.exists():
            path.unlink()
        return JSONResponse({"ok": True})

    return app


app = create_app()
