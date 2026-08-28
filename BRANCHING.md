# Branching and Release Policy

This repository uses a two-branch development model based on java-tron's release workflow.

## Long-lived branches

- `develop` is the default development and integration branch. Start normal work from `develop`
  and merge it back through a pull request.
- `main` contains stable, released code. Do not send feature, fix, documentation, or upstream-sync
  pull requests directly to `main`.

Both branches are protected. Direct pushes, force pushes, and branch deletion are prohibited.

## Development branches

Create day-to-day branches from `develop`. Supported prefixes are:

- `feature/*` or `feat/*` for features
- `fix/*` for non-release fixes
- `docs/*`, `chore/*`, `refactor/*`, `test/*`, `perf/*`, or `ci/*` for their corresponding work
- `sync/*` for upstream synchronization

Open these pull requests against `develop`.

## Release branches

When `develop` is ready for release:

1. Create `release_vX.Y.Z` from `develop`.
2. Apply version changes, consume Changesets, update release notes, and complete regression testing
   on the release branch.
3. If regression identifies a bug, merge its fix directly into the release branch and repeat the
   regression test.
4. Open `release_vX.Y.Z` into `main` and merge it with a merge commit.
5. Tag and publish from the resulting `main` commit.
6. Merge the release branch back into `develop` after the release passes regression.
7. Retain the release branch permanently as the release snapshot.

Release branches must use the `release_*` pattern. Never open `develop` directly into `main`.

## Hotfix branches

For an urgent production fix:

1. Create `hotfix/<description>` from `main`.
2. Open it into `main`, complete review and CI, and merge it with a merge commit.
3. Merge the same hotfix branch into `develop`.

Retain the hotfix branch until both merges are complete.

## Allowed pull request routes

| Source | Target | Purpose |
| --- | --- | --- |
| Development branch | `develop` | Normal development |
| `release_*` | `main` | Stable release |
| `release_*` | `develop` | Mandatory release back-merge |
| `hotfix/*` | `main` | Production hotfix |
| `hotfix/*` | `develop` | Hotfix back-merge |

The `source-and-target` workflow enforces these routes.
