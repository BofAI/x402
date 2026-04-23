# @bankofai/x402

Public TypeScript SDK entry point. Re-exports from sibling workspace packages (`mechanisms/*`, `extensions`, `core`).

## Build & test

```bash
pnpm build     # tsc
pnpm test      # vitest run
pnpm clean     # rm -rf dist
```

## Layout

```
src/
├── index.ts             — public surface; keep additions minimal, re-export only
├── config.ts            — network + contract registry (mirrors docs/specs/config.md)
├── config.test.ts       — wire-format snapshot; update when adding networks
├── abi.ts               — ERC-3009 + EIP-2612 + GasFreeController ABIs
├── address.ts           — address normalization helpers
├── tokens.ts            — token metadata registry
├── errors.ts            — X402Error hierarchy
├── types/               — protocol types (PaymentRequired, PaymentPayload, PaymentResponse)
├── http/                — header encode/decode, fetch middleware
├── client/              — client-side retry-with-payment loop
├── mechanisms/          — re-exports from ../mechanisms/*
├── signers/             — account abstractions (wraps agent-wallet)
└── utils/               — hex, base64, address conversion
```

## Rules for this package

- **Public surface is precious.** Additions to `index.ts` require a corresponding doc update in `docs/specs/` (if a new wire-format field) and ideally a unit test. Prefer re-export over re-implement.
- **No direct imports from `dist/`**, even in tests. Import from `./src/...` or from the package name.
- **`config.ts` is the single source of truth for network identifiers.** Do not hardcode chain IDs or contract addresses elsewhere in this package.
- **Snapshot tests in `config.test.ts`** will fail if the registry changes — this is intentional. Update the snapshot in the same commit that changes the registry.

## Dependencies

- `viem` for EVM typed-data signing
- `@gasfree/gasfree-sdk` for TRON GasFree API calls
- `@bankofai/agent-wallet` for signer abstraction (keeps wallet concerns out of this package)
