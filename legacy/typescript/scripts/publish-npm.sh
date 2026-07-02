#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BASH_VERSION:-}" ]]; then
  exec bash "$0" "$@"
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Install pnpm >= 8." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js >= 18." >&2
  exit 1
fi

registry_url="${NPM_REGISTRY:-https://registry.npmjs.org}"
package_version="$(node -p "require('./packages/x402/package.json').version")"
default_tag="latest"
if [[ "${package_version}" == *-* ]]; then
  default_tag="beta"
fi
tag="${NPM_TAG:-${default_tag}}"

publish_args=(--tag "${tag}" --access public)
if [[ "${NO_GIT_CHECKS:-1}" == "1" ]]; then
  publish_args+=(--no-git-checks)
fi
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  publish_args+=(--dry-run)
fi

export npm_config_registry="${registry_url}"

cd "${root_dir}"

pnpm install
pnpm -r clean
pnpm -r build

if command -v npm >/dev/null 2>&1; then
  npm whoami >/dev/null 2>&1 || {
    echo "Error: npm is not authenticated. Ensure your token is in ~/.npmrc" >&2
    exit 1
  }
fi

pnpm -r publish --filter "./packages/x402" "${publish_args[@]}"
