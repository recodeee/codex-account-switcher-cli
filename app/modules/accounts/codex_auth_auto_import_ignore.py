from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable


def list_auto_import_ignored_account_ids() -> set[str]:
    path = _resolve_ignore_path()
    if not path.exists() or not path.is_file():
        return set()

    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError, TypeError):
        return set()

    if not isinstance(payload, list):
        return set()
    return {item for item in payload if isinstance(item, str) and item}


def add_auto_import_ignored_account_id(account_id: str) -> None:
    if not account_id:
        return
    _mutate_ignored_ids(lambda values: values.add(account_id))


def remove_auto_import_ignored_account_id(account_id: str) -> None:
    if not account_id:
        return
    _mutate_ignored_ids(lambda values: values.discard(account_id))


def _mutate_ignored_ids(mutator: Callable[[set[str]], None]) -> None:
    path = _resolve_ignore_path()
    values = list_auto_import_ignored_account_ids()
    mutator(values)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{json.dumps(sorted(values), indent=2)}\n", encoding="utf-8")
    except OSError:
        return


def _resolve_ignore_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_AUTO_IMPORT_IGNORE_PATH")
    if raw:
        path = Path(raw).expanduser()
        resolved = path if path.is_absolute() else (Path.cwd() / path)
        return resolved.resolve()

    accounts_dir_raw = os.environ.get("CODEX_AUTH_ACCOUNTS_DIR")
    if accounts_dir_raw:
        accounts_dir = Path(accounts_dir_raw).expanduser().resolve()
    else:
        accounts_dir = (Path.home() / ".codex" / "accounts").resolve()
    return accounts_dir / ".codex-lb-auto-import-ignore.json"
