# Releasing

The TypeScript workspace uses `changesets` for versioning and npm publishing.

## Active npm packages

The release flow publishes the actively maintained packages in `typescript/packages/**`.
Legacy compatibility packages under `typescript/packages/legacy/**` are ignored by `changesets`.

## Beta release flow

From [`typescript/package.json`](/Users/bobo/code/x402/x402/typescript/package.json):

```bash
pnpm changeset pre enter beta
pnpm changeset version
pnpm install
pnpm build
pnpm changeset publish
```

When the beta cycle is over:

```bash
pnpm changeset pre exit
```

## CI flow

GitHub Actions uses a single changesets workflow:

- On pull requests or branch work, add changesets for the packages that changed.
- On `main`, the workflow opens or updates a release PR with version bumps and changelog updates.
- When the release PR lands on `main`, the same workflow publishes the changed packages to npm.

Trusted publishing remains configured through GitHub Actions permissions and npm provenance.
