"""Minimal resource servers used by e2e scenarios.

Wire up the real x402 server with the mock facilitator, expose a protected
endpoint per scheme, and let scenario configs control host/port/facilitator-url
via env vars so the same binary can host any combination.
"""
