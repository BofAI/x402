---
"@bankofai/x402-express": patch
"@bankofai/x402-fastify": patch
"@bankofai/x402-hono": patch
"@bankofai/x402-next": patch
---

Depend directly on official `@x402/extensions@2.28.0` for Bazaar discovery instead of the retired local generic extension package. Remove legacy v1 workspaces; applications that need those APIs must install upstream packages directly.
