---
"@bankofai/x402-tron": patch
"@bankofai/x402-tron-extensions": patch
---

Upgrade TronWeb to 6.5.1 to pick up input snapshotting for signing and contract calls.

The Axios 1.21.0 and follow-redirects 1.16.2 overrides apply to the repository's pnpm workspaces. SDK consumers resolve TronWeb's HTTP dependencies in their own projects and need their own overrides or an upstream TronWeb release with the patched dependencies.
