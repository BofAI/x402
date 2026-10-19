# TRON SDK 3.0.0-beta.1 Release Record

Date: 2026-10-16 (Asia/Shanghai). Version alignment and beta publication were explicitly requested. Source branch: `feat/tron-official-sdk`. Source commit: `92b1b133d9f020f867b0a4a08de2fd0cf8f0c461`. Target: public npm registry, tag `beta`; only the two TRON packages below. As requested, this beta was published from the verified development commit. Stable releases continue to follow the release/main workflow in BRANCHING.md.

## Versions and artifacts

| Package                          | Version        | Verified artifact SHA-512 integrity                                                               |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `@bankofai/x402-tron`            | `3.0.0-beta.1` | `sha512-4m4lmgr+lCV54EawIG8pwSB8rbWEleMgcyJrSiUbXdA/SEZ9pYLqgmKhdasFZOD5782NsEhkxCPNGK4KRpWuAA==` |
| `@bankofai/x402-tron-extensions` | `3.0.0-beta.1` | `sha512-h3Bqmx1zxhMGikCNuwCWibd+6lS9Oo7g810usKmNdMyFWBq4/Hw9yf8EPMolkFUK9BdYKE+EyzrvELezEqmqxg==` |

Artifacts are in this worktree's `dist/releases/tron-3.0.0-beta.1/`, including two tarballs and `manifest.json`. The packed extension depends on `@bankofai/x402-tron: 3.0.0-beta.1`; both packages have an exact official Core 2.28.0 peer dependency. The Changesets fixed group keeps future TRON versions aligned; at this stage, both computed stable targets were 3.0.0. The existing legacy Core changeset remains for separate handling, outside this publish list. No whole-workspace Changesets publish ran.

## Pre-release validation

- pnpm 11.1.1: both packages passed types, build, lint, and format checks.
- Mechanism: 26 files, 224 unit tests; extension: 7 files, 101 unit tests, all passed.
- Final tarballs passed independent basic/full composition consumers: strict TypeScript 5.7.3 NodeNext, ESM/CJS, all 20/25 public entrypoints, real offline signed payments, and extension composition.
- All export targets existed, dependencies were rewritten, and no tests/node_modules were packed. No legacy Core, generic extension, or Agent Wallet production dependency was present.
- Both final tarballs passed npm publish dry-run, with integrity matching the release manifest.
- Node.js 25.6.0; official Core 2.28.0; TronWeb 6.3.0; test Agent Wallet 2.4.0.

## Publication and readback

npm accepted the mechanism, visible as `beta = 3.0.0-beta.1`, `latest = 2.0.0`, with matching integrity. Clean npm installation passed strict basic ESM/CJS consumer validation. The extension became visible with `beta = 3.0.0-beta.1`, matching dependencies and integrity. Clean npm installation of full composition passed strict ESM/CJS compilation, all public entrypoints, and offline signed payments. Final registry readback is in the artifact directory's `registry-verified.json`. Publication proceeded mechanism first, then extension, preserving the mechanism's existing latest tag at 2.0.0.

After the extension's first publication, readback also showed `latest = 3.0.0-beta.1`. Removing that tag returned npm 403, explicitly disallowing this operation for a granular token bypassing 2FA. The tag was not removed; npm-supported interactive authentication is required. The extension must not be described as having only a beta tag. Install an explicit version above or beta. The supplied npm token was stored in local user configuration with mode 0600; credentials were not written to the repository or this record.

## Installation

```sh
npm install @x402/core@2.28.0 @bankofai/x402-tron@3.0.0-beta.1
# Install only when enabling resource sponsorship
npm install @bankofai/x402-tron-extensions@3.0.0-beta.1
```

## Known scope

This run changed only versions, package metadata, and release notes, without payment runtime changes. M3 external service migration, live testnet, persistent coordinator/cross-service recovery still required acceptance. M4 legacy caller migration/retirement was unfinished. Upto still used legacy optimistic validation when allowance/balance RPC reads failed; explicit rejection was needed before stable publication. Whole-workspace release build acceptance was not completed. Missing local legacy/x402 dependencies were outside the two target packages' passing results. No live chain transactions, Git branch pushes, or merges occurred in this run.
