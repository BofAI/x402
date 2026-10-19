---
"@bankofai/x402-tron": minor
---

Migrate all four TRON mechanisms to the official `@x402/core@2.28.0` peer dependency.
Keep wallet factories and payment payloads, move wallet contracts and logger exports
into TRON, separate transaction utilities, and allow signature-only client signers
on paths that do not require RPC. Consumers must use matching official Core and
integration packages and import logging from TRON. Add a public `/exact/extensions`
contract entrypoint for the next resource-extension migration stage.
