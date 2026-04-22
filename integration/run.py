"""Generic integration step runner for x402 e2e scenarios.

Reads a JSON config defining sequential workflow steps (shell commands or
@-prefixed built-ins), executes them fail-fast, and writes a Markdown report.

Usage:
    python3 integration/run.py --config e2e/scenarios/<name>/config.json
    python3 integration/run.py --config path/to/config.json --report /tmp/report.md
    python3 integration/run.py --list-builtins

Exit codes:
    0  all steps passed
    1  at least one step failed
    2  config or environment error

Pattern inspired by sun-protocol/apollo-arena/integration/. This is a clean
independent implementation adapted to x402 conventions.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from commands import dispatch as dispatch_builtin, list_builtins  # noqa: E402

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_ENV_ERROR = 2


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="x402 integration step runner")
    p.add_argument("--config", help="Path to JSON config file")
    p.add_argument("--report", help="Override Markdown report output path")
    p.add_argument(
        "--list-builtins", action="store_true", help="List available @-builtin commands"
    )
    return p.parse_args()


def load_config(path: str) -> dict:
    cfg_path = Path(path)
    if not cfg_path.exists():
        sys.exit(_err(f"config file not found: {path}"))

    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(_err(f"invalid JSON in config: {e}"))

    if not isinstance(cfg.get("steps"), list):
        sys.exit(_err("config must contain a 'steps' array"))

    for i, step in enumerate(cfg["steps"]):
        if "command" not in step:
            sys.exit(_err(f"step {i} missing 'command'"))
        step.setdefault("name", f"step {i + 1}")

    return cfg


def _err(msg: str) -> int:
    print(f"error: {msg}", file=sys.stderr)
    return EXIT_ENV_ERROR


def is_builtin(command: str) -> bool:
    return command.strip().startswith("@")


def run_shell(
    command: str, workdir: str, timeout: int
) -> tuple[int, str, str, float]:
    t0 = time.monotonic()
    try:
        r = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=workdir,
        )
        return (r.returncode, r.stdout, r.stderr, time.monotonic() - t0)
    except subprocess.TimeoutExpired:
        return (124, "", f"command timed out after {timeout}s", time.monotonic() - t0)
    except OSError as e:
        return (2, "", f"failed to execute: {e}", time.monotonic() - t0)


def run_builtin(
    command: str, workdir: str, timeout: int
) -> tuple[int, str, str, float]:
    t0 = time.monotonic()
    code, out, err = dispatch_builtin(command, workdir)
    return (code, out, err, time.monotonic() - t0)


def run_step(step: dict, repo_root: str) -> dict:
    cmd = step["command"]
    workdir = step.get("workdir", repo_root)
    timeout = step.get("timeout", 30)

    if not Path(workdir).is_absolute():
        workdir = str(Path(repo_root) / workdir)

    runner = run_builtin if is_builtin(cmd) else run_shell
    code, out, err, duration = runner(cmd, workdir, timeout)

    return {
        "name": step["name"],
        "command": cmd,
        "exit_code": code,
        "stdout": out,
        "stderr": err,
        "duration": duration,
        "passed": code == 0,
    }


def format_report(
    name: str,
    results: list[dict],
    total_steps: int,
    started_at: datetime,
    finished_at: datetime,
) -> str:
    executed = len(results)
    passed = sum(1 for r in results if r["passed"])
    skipped = total_steps - executed
    all_green = executed == total_steps and passed == total_steps

    if all_green:
        status = "PASSED"
    else:
        failed_idx = next((i for i, r in enumerate(results) if not r["passed"]), None)
        status = (
            f"FAILED (step {failed_idx + 1})" if failed_idx is not None else "FAILED"
        )

    out = [
        f"# Integration Report: {name}",
        "",
        f"- **Started:** {started_at.isoformat()}",
        f"- **Finished:** {finished_at.isoformat()}",
        f"- **Status:** {status}",
        f"- **Steps:** {executed}/{total_steps} executed, {skipped}/{total_steps} skipped",
        "",
        "---",
    ]

    for i, r in enumerate(results):
        mark = "\u2713" if r["passed"] else "\u2717"
        out += [
            "",
            f"## Step {i + 1}: {r['name']} {mark}",
            f"- **Command:** `{r['command']}`",
            f"- **Exit code:** {r['exit_code']}",
            f"- **Duration:** {r['duration']:.1f}s",
            "",
            "### stdout",
            "```",
            r["stdout"].rstrip(),
            "```",
            "",
            "### stderr",
            "```",
            r["stderr"].rstrip(),
            "```",
        ]
        if not r["passed"]:
            out += ["", "> **FAILED** — stopping (fail-fast)"]
        out += ["", "---"]

    return "\n".join(out) + "\n"


def main() -> None:
    args = parse_args()

    if args.list_builtins:
        for entry in list_builtins():
            print(f"  {entry['usage']}")
        sys.exit(EXIT_OK)

    if not args.config:
        sys.exit(_err("--config is required"))

    cfg = load_config(args.config)
    name = cfg.get("name", Path(args.config).stem)
    report_path = args.report or cfg.get("report")
    steps = cfg["steps"]
    repo_root = str(Path(__file__).resolve().parents[1])

    started = datetime.now(timezone.utc)
    results: list[dict] = []

    for step in steps:
        r = run_step(step, repo_root)
        results.append(r)
        mark = "\u2713" if r["passed"] else "\u2717"
        print(f"  {mark} {r['name']} ({r['duration']:.1f}s)")
        if not r["passed"]:
            break

    finished = datetime.now(timezone.utc)
    report = format_report(name, results, len(steps), started, finished)

    if report_path:
        p = Path(report_path)
        if not p.is_absolute():
            p = Path(repo_root) / p
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(report, encoding="utf-8")
        print(f"\nReport written to {p}")

    all_green = len(results) == len(steps) and all(r["passed"] for r in results)
    sys.exit(EXIT_OK if all_green else EXIT_FAIL)


if __name__ == "__main__":
    main()
