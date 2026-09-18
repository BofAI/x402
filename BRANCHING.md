# Branching and Release Policy

This repository uses a two-branch development model based on java-tron's release workflow.

## Long-lived branches

- `develop` is the default development and integration branch. Start normal work from `develop`
  and merge it back through a pull request.
- `main` contains stable, released code. Do not send feature, fix, documentation, or upstream-sync
  pull requests directly to `main`.

Protect both branches from direct pushes, force pushes, and deletion. Require pull requests,
successful checks, review approval, and resolved conversations before merging.

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

## Audit workflow

Automatic pull-request Audit is disabled by default while the self-hosted
runner is unavailable. Leave the repository variable `AUDIT_AUTO_ENABLED`
unset, or set it to a value other than `true`, to keep the Audit check as a
successful no-op on GitHub-hosted infrastructure.

Set `AUDIT_AUTO_ENABLED=true` only after the runner is healthy. Automatic Audit
then runs only for branches in this repository; fork pull requests remain on
the no-op path. Authorized users listed in `AUDIT_ALLOWED_USERS` can continue
to request the existing self-hosted workflow with `/audit-pr`.
