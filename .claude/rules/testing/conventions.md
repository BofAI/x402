# Testing conventions (x402)

The SDK is tested with **`vitest`**, co-located per package under `packages/*/test/`. See [typescript/CLAUDE.md](../../../typescript/CLAUDE.md) for the commands.

## Two tiers

| Tier | Location | Command | Runs in CI | Needs |
|---|---|---|---|---|
| **Unit** | `packages/*/test/unit/**` | `pnpm test` (`turbo run test`) | yes | nothing — offline, no secrets |
| **Integration** | `packages/*/test/integrations/*.nile.test.ts` | `pnpm test:integration` | no | real-chain `.env` creds |

- **Unit tests must pass offline with no secrets.** No real RPC, no network. Mock the chain client builder (`createEvmPublicClient` / `buildTronWeb`) rather than hitting a node.
- **Integration tests self-skip** via `describe.skipIf(...)` when their `.env` credentials are absent. **Never gate CI on them.**

## Layout

- One suite directory per scheme/area: `test/unit/exact`, `test/unit/upto`, `test/unit/batch-settlement`, `test/unit/auth-capture`, plus top-level `*.test.ts` for signer/server/utils.
- TRON GasFree suites are the `gasfree-*.test.ts` files in `mechanisms/tron/test/unit/`.
- Run one suite: `pnpm --filter @bankofai/x402-evm exec vitest run test/unit/upto`.

## Conventions

- **Mock at the boundary, not the chain.** Drive `scheme.<role>()` methods with a mocked facilitator / fetch / `readContract`, and assert on the shaped output — see `batch-refund-network.test.ts` (mocks a multi-network 402 + a `readContract` sentinel to prove the correct VM family is selected).
- **`BigInt` everywhere** in fixtures; never compare amounts through `Number`.
- **Deterministic offline equivalents** of on-chain digests are fair game (e.g. `permit2-digest.test.ts`, `gasfree-digest.test.ts`) — they pin the signing math without a node.
- Co-locate `*.test.ts` with the package; don't add a central test app. Don't shell out to other test runners from a vitest test.

## Examples as smoke tests

`examples/typescript/` is a runnable workspace (client + server + facilitator trios per scheme), not part of `pnpm test`. Use it for manual end-to-end smoke runs against a local or hosted facilitator; it builds against local SDK source via workspace links.
