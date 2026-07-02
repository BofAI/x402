#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BASH_VERSION:-}" ]]; then
  exec bash "$0" "$@"
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# NPM_TAG="beta"
NO_GIT_CHECKS="1"
DRY_RUN="0"
PYPI_REPOSITORY="pypi"

run_clean_env() {
  env -i \
    PATH="${PATH}" \
    HOME="${HOME}" \
    USER="${USER:-}" \
    SHELL="${SHELL:-}" \
    NPM_TAG="${NPM_TAG:-latest}" \
    NO_GIT_CHECKS="${NO_GIT_CHECKS}" \
    DRY_RUN="${DRY_RUN}" \
    PYPI_REPOSITORY="${PYPI_REPOSITORY}" \
    bash "$@"
}

usage() {
  cat <<'EOF'
Usage:
  scripts/upload_pkgs.sh [npm|pypi|all]

Examples:
  scripts/upload_pkgs.sh all
  scripts/upload_pkgs.sh npm
  scripts/upload_pkgs.sh pypi
EOF
}

target="${1:-}"
if [[ -z "${target}" ]]; then
  target="all"
fi

case "${target}" in
  npm|pypi|all)
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown target: ${target}" >&2
    usage
    exit 2
    ;;
esac

if [[ "${target}" == "npm" || "${target}" == "all" ]]; then
  echo "==> Publishing TypeScript package(s) to npm"
  run_clean_env "${root_dir}/typescript/scripts/publish-npm.sh"
fi

if [[ "${target}" == "pypi" || "${target}" == "all" ]]; then
  echo "==> Publishing Python package(s) to PyPI"
  run_clean_env "${root_dir}/python/x402/scripts/publish_pypi.sh"
fi
