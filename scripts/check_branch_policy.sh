#!/bin/sh
set -eu

base_branch=${1:-${GITHUB_BASE_REF:-}}
head_branch=${2:-${GITHUB_HEAD_REF:-}}

if [ -z "$base_branch" ] || [ -z "$head_branch" ]; then
  printf 'usage: %s <base-branch> <head-branch>\n' "$0" >&2
  exit 2
fi

case "$base_branch" in
  develop)
    case "$head_branch" in
      feature/*|feat/*|fix/*|docs/*|chore/*|refactor/*|test/*|perf/*|ci/*|sync/*|release_*|hotfix/*) ;;
      *)
        printf 'PRs to develop must come from a development, release, or hotfix branch; got %s.\n' \
          "$head_branch" >&2
        exit 1
        ;;
    esac
    ;;
  main)
    case "$head_branch" in
      release_*|hotfix/*) ;;
      *)
        printf 'PRs to main must come from release_* or hotfix/*; got %s.\n' \
          "$head_branch" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    printf 'Unsupported target branch: %s.\n' "$base_branch" >&2
    exit 1
    ;;
esac

printf 'Allowed PR route: %s -> %s.\n' "$head_branch" "$base_branch"
