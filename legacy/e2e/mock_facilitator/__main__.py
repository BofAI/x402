"""CLI entry: `python -m e2e.mock_facilitator --port 4020 --mode success`.

Requires `uvicorn` (already a dep of x402 examples).
"""

from __future__ import annotations

import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="x402 mock facilitator")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4020)
    parser.add_argument(
        "--mode",
        default="success",
        choices=[
            "success",
            "fail_verify_invalid_sig",
            "fail_verify_expired",
            "fail_verify_network_mismatch",
            "fail_settle_insufficient",
            "fail_settle_revert",
        ],
    )
    parser.add_argument(
        "--log",
        default=None,
        help="Path to the request log (default $MOCK_FACILITATOR_LOG or /tmp/x402-mock-facilitator.log)",
    )
    args = parser.parse_args()

    os.environ["MOCK_FACILITATOR_MODE"] = args.mode
    if args.log:
        os.environ["MOCK_FACILITATOR_LOG"] = args.log

    try:
        import uvicorn
    except ImportError:
        print(
            "uvicorn is required to run the mock facilitator; install with `pip install uvicorn`",
            file=sys.stderr,
        )
        return 2

    uvicorn.run(
        "e2e.mock_facilitator.app:app",
        host=args.host,
        port=args.port,
        log_level=os.environ.get("MOCK_FACILITATOR_LOG_LEVEL", "warning"),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
