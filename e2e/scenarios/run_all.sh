#!/usr/bin/env bash
# Run every e2e scenario in e2e/scenarios/ and exit non-zero on the first failure.
# Meant to be runnable from the repo root or from any subdir.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

scenarios=(
  exact_happy_path
  exact_permit_happy_path
  exact_gasfree_happy_path
  unhappy_verify_invalid_sig
  unhappy_verify_expired
  unhappy_verify_network_mismatch
  unhappy_settle_insufficient
  unhappy_settle_revert
)

failed=()
for s in "${scenarios[@]}"; do
  cfg="e2e/scenarios/$s/config.json"
  echo
  echo "=== $s ==="
  if ! python3 -m integration.run --config "$cfg"; then
    failed+=("$s")
  fi
done

echo
if ((${#failed[@]})); then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "ALL GREEN (${#scenarios[@]} scenarios)"
