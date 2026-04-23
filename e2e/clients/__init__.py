"""Test clients used by e2e scenarios.

Sign a real PAYMENT-SIGNATURE payload with a well-known Anvil-style private
key, POST to the resource server, and dump the response (status + headers +
body) as JSON so scenarios can diff it.
"""
