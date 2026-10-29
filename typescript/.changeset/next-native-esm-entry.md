---
"@bankofai/x402-next": patch
---

Use Next's explicit `next/server.js` entry so the published ESM package loads
under Node without requiring a bundler-specific extension resolver.
