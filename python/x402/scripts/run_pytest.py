#!/usr/bin/env python3

from __future__ import annotations

import importlib.machinery
import os
import platform
import sys
import types

import pytest


def _install_readline_stub() -> None:
    """Avoid macOS uv/readline crashes when pytest imports readline during startup."""
    if platform.system() != "Darwin":
        return
    if "readline" in sys.modules:
        return

    stub = types.ModuleType("readline")
    stub.__spec__ = importlib.machinery.ModuleSpec("readline", loader=None)
    stub.get_current_history_length = lambda: 0
    stub.get_history_item = lambda _index: None
    stub.read_history_file = lambda *_args, **_kwargs: None
    stub.write_history_file = lambda *_args, **_kwargs: None
    stub.parse_and_bind = lambda *_args, **_kwargs: None
    sys.modules["readline"] = stub


def main() -> int:
    _install_readline_stub()
    return pytest.main(sys.argv[1:] or ["-q"])


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    raise SystemExit(main())
