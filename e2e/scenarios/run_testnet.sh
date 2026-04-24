#!/usr/bin/env bash
# Run every testnet e2e scenario under e2e/scenarios/testnet/.
#
# Each scenario is skipped (not failed) when its required env vars are blank
# — developers check in .env via .env.example, and scenarios whose env stays
# empty are left for someone with the credentials to run.
#
# Usage:
#   set -a; source .env; set +a    # or export vars in CI from secrets
#   ./e2e/scenarios/run_testnet.sh
#
# Mock scenarios are NOT run by this script; use ./run_all.sh for those.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# scenario → space-separated list of required env vars.
# A scenario runs only if EVERY variable is non-empty.
declare -a names=(
  "exact_testnet"
  "exact_permit_testnet"
  "exact_gasfree_testnet"
)
declare -a required=(
  "BSC_TESTNET_FACILITATOR_KEY BSC_TESTNET_CLIENT_KEY BSC_TESTNET_PAY_TO"
  "BSC_TESTNET_FACILITATOR_KEY BSC_TESTNET_CLIENT_KEY BSC_TESTNET_PAY_TO"
  "TRON_NILE_FACILITATOR_KEY TRON_NILE_CLIENT_KEY TRON_NILE_PAY_TO GASFREE_NILE_API_URL"
)

skipped=()
failed=()
passed=()

for i in "${!names[@]}"; do
  name="${names[$i]}"
  vars="${required[$i]}"
  cfg="e2e/scenarios/testnet/$name/config.json"

  echo
  echo "=== $name ==="

  missing=()
  for v in $vars; do
    if [[ -z "${!v:-}" ]]; then
      missing+=("$v")
    fi
  done

  if ((${#missing[@]})); then
    echo "  SKIP: missing env vars: ${missing[*]}"
    skipped+=("$name")
    continue
  fi

  if python3 -m integration.run --config "$cfg"; then
    passed+=("$name")
  else
    failed+=("$name")
  fi
done

echo
echo "---"
echo "passed:  ${#passed[@]}${passed:+ (${passed[*]})}"
echo "failed:  ${#failed[@]}${failed:+ (${failed[*]})}"
echo "skipped: ${#skipped[@]}${skipped:+ (${skipped[*]})}"

if ((${#failed[@]})); then
  exit 1
fi
if ((${#passed[@]} == 0)); then
  echo
  echo "no testnet scenarios ran — fill in .env (see .env.example) to enable them."
fi
