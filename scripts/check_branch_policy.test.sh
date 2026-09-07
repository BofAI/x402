#!/bin/sh
set -eu

policy_script=${0%/*}/check_branch_policy.sh

assert_allowed() {
  if ! sh "$policy_script" "$1" "$2" >/dev/null 2>&1; then
    printf 'expected route to be allowed: %s -> %s\n' "$2" "$1" >&2
    exit 1
  fi
}

assert_rejected() {
  if sh "$policy_script" "$1" "$2" >/dev/null 2>&1; then
    printf 'expected route to be rejected: %s -> %s\n' "$2" "$1" >&2
    exit 1
  fi
}

for prefix in feature feat fix docs chore refactor test perf ci sync; do
  assert_allowed develop "$prefix/example"
done

assert_allowed develop release_v1.2.0
assert_allowed develop hotfix/example
assert_allowed main release_v1.2.0
assert_allowed main hotfix/example

assert_rejected develop main
assert_rejected develop random/example
assert_rejected main develop
assert_rejected main chore/example
assert_rejected main release-v1.2.0
assert_rejected staging feature/example

printf 'branch policy tests passed\n'
