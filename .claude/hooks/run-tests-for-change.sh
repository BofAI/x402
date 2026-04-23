#!/usr/bin/env bash
# PostToolUse hook: run the relevant test suite after Claude edits code.
# Reads Claude Code hook JSON from stdin, dispatches to the right test command.
#
# Exit codes:
#   0 — nothing to do, or tests passed
#   2 — tests failed (blocking signal; picked up by asyncRewake to wake the model)
#
# Scopes:
#   python/x402/src/**        → uv run pytest (scoped)
#   python/x402/tests/**      → uv run pytest (scoped)
#   typescript/packages/*/src/**/*.{ts,tsx}  → pnpm -C typescript/packages/<pkg> test
#   e2e/**, integration/**    → ./e2e/scenarios/run_all.sh
#   everything else           → skipped
#
# Docs-only changes (.md, .json, .yml, .yaml) are skipped.

set -u

REPO_ROOT="/Users/bobo/code/x402/x402"
LOG_DIR="$REPO_ROOT/.claude/hooks/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run-tests.log"

# Read hook input
INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)"
TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >> "$LOG_FILE"; }
log "tool=$TOOL_NAME file=$FILE_PATH"

# No file path → nothing to test
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Normalize to repo-relative
REL="${FILE_PATH#$REPO_ROOT/}"

# Docs-only changes: skip
case "$REL" in
  *.md|*.json|*.yml|*.yaml|*.toml|*.lock|*.txt)
    log "skip (docs/config: $REL)"
    exit 0
    ;;
esac

# Dispatch by path prefix
TEST_CMD=""
TEST_CWD="$REPO_ROOT"
LABEL=""

case "$REL" in
  python/x402/src/*.py | python/x402/tests/*.py | python/x402/src/**/*.py | python/x402/tests/**/*.py)
    LABEL="pytest"
    TEST_CWD="$REPO_ROOT/python/x402"
    TEST_CMD="uv run pytest -x -q --tb=short"
    ;;
  typescript/packages/*/src/*.ts | typescript/packages/*/src/*.tsx | typescript/packages/*/src/**/*.ts | typescript/packages/*/src/**/*.tsx)
    # extract package dir: typescript/packages/<pkg>/src/... (pkg may contain one sub-level, e.g. mechanisms/evm)
    PKG_REL="${REL#typescript/packages/}"
    PKG_REL="${PKG_REL%%/src/*}"
    LABEL="vitest ($PKG_REL)"
    TEST_CWD="$REPO_ROOT/typescript/packages/$PKG_REL"
    TEST_CMD="pnpm test --run"
    ;;
  e2e/* | integration/*)
    LABEL="e2e mock suite"
    TEST_CWD="$REPO_ROOT"
    TEST_CMD="./e2e/scenarios/run_all.sh"
    ;;
  *)
    log "skip (no rule for $REL)"
    exit 0
    ;;
esac

log "run: $LABEL — cd $TEST_CWD && $TEST_CMD"

# Run the tests; capture combined output
OUTPUT="$(cd "$TEST_CWD" && eval "$TEST_CMD" 2>&1)"
RC=$?

if [[ $RC -eq 0 ]]; then
  log "pass: $LABEL"
  exit 0
fi

# Failure — surface a compact summary for the model. Tail to keep noise down.
log "FAIL ($RC): $LABEL"
{
  printf 'Tests failed after your edit: %s\n' "$LABEL"
  printf 'cwd: %s\n' "$TEST_CWD"
  printf 'cmd: %s\n' "$TEST_CMD"
  printf 'rc:  %s\n\n' "$RC"
  printf '%s\n' "$OUTPUT" | tail -n 80
} >&2
exit 2
