---
"@bankofai/x402-tron": major
"@bankofai/x402-tron-extensions": major
"@bankofai/x402-express": patch
"@bankofai/x402-fastify": patch
"@bankofai/x402-hono": patch
"@bankofai/x402-next": patch
"@bankofai/x402-mcp": patch
---

Adopt the official x402 2.29.0 security release using native Zod >=4.6.6.
Update official extensions in the HTTP integrations and align the MCP SDK with
the official transport's 1.32.0 minimum. Example dependencies and strict packed
consumer checks now use the same official versions.

TRON and TRON resource extensions now require official `@x402/core@2.29.0` as a
peer instead of 2.28.0. Upgrade that peer alongside these packages. The official
Core `/schemas` export uses Zod 4; applications composing those schemas must
also use native Zod 4. Oversized `accepts` arrays are limited to 1,024 entries by
the official release.
