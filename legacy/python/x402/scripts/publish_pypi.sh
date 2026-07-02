#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BASH_VERSION:-}" ]]; then
  exec bash "$0" "$@"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found. Install uv first: https://docs.astral.sh/uv/" >&2
  exit 1
fi

repo="${PYPI_REPOSITORY:-pypi}"
dry_run="${DRY_RUN:-0}"
dist_dir="${project_dir}/dist"

case "${repo}" in
  pypi)
    repository_name="pypi"
    ;;
  testpypi)
    repository_name="testpypi"
    ;;
  *)
    echo "PYPI_REPOSITORY must be 'pypi' or 'testpypi' (got: ${repo})" >&2
    exit 1
    ;;
 esac

cd "${project_dir}"

rm -rf "${dist_dir}"

uv build --out-dir "${dist_dir}"

shopt -s nullglob
dist_files=("${dist_dir}"/*)
shopt -u nullglob

if [[ ${#dist_files[@]} -eq 0 ]]; then
  echo "No distributions found in ${dist_dir}." >&2
  exit 1
fi

uvx twine check "${dist_dir}"/*

if [[ "${dry_run}" == "1" ]]; then
  echo "DRY_RUN=1: built artifacts in dist/ (upload skipped)"
  exit 0
fi

uvx twine upload --repository "${repository_name}" "${dist_dir}"/*
