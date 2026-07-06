---
"@bankofai/x402-tron": major
---

**Breaking:** TRON CAIP-2 network identifiers now use the hex chain ID as the
reference (e.g. `tron:0xcd8690dc` for Nile) instead of the human-readable name
(`tron:nile` / `tron:shasta` / `tron:mainnet`). Passing the old string IDs to the
signer factories (`createClientTronSigner`, `createFacilitatorTronSigner`,
`createAuthorizerTronSigner`) or to `getTronChainId` / RPC resolution now throws
`Unknown TRON network` / `No TRON RPC configured`.

To migrate:
- Replace `tron:nile` → `tron:0xcd8690dc`, `tron:shasta` → `tron:0x94a9059e`,
  `tron:mainnet` → `tron:0x2b6653dc`.
- Prefer importing the new canonical constants from the package entry:
  `import { TRON_MAINNET, TRON_NILE, TRON_SHASTA } from "@bankofai/x402-tron"` —
  these are now exported so consumers no longer need to copy opaque hex strings.
