from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.projects import editor


def test_resolve_runtime_project_path_leaves_non_documents_path_unchanged() -> None:
    assert editor._resolve_runtime_project_path("/home/deadpool/Documents/recodee") == "/home/deadpool/Documents/recodee"


def test_resolve_runtime_project_path_uses_first_documents_root_as_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    first_documents = tmp_path / "docs-first"
    second_documents = tmp_path / "docs-second"
    monkeypatch.setattr(editor, "_candidate_documents_roots", lambda: (first_documents, second_documents))

    resolved = editor._resolve_runtime_project_path("/Documents/szaloniroda/marva")

    assert resolved == str(first_documents / "szaloniroda" / "marva")


def test_open_project_folder_in_editor_resolves_documents_shorthand_to_existing_root(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    first_documents = tmp_path / "docs-first"
    second_documents = tmp_path / "docs-second"
    target_folder = second_documents / "szaloniroda" / "marva"
    target_folder.mkdir(parents=True, exist_ok=True)

    launched: list[list[str]] = []
    monkeypatch.setattr(editor, "_candidate_documents_roots", lambda: (first_documents, second_documents))
    monkeypatch.setattr(editor, "_resolve_executable", lambda name: "/usr/bin/code" if name == "code" else None)
    monkeypatch.setattr(editor, "_spawn_detached", lambda argv: launched.append(argv))

    selected_editor = editor.open_project_folder_in_editor("/Documents/szaloniroda/marva")

    assert selected_editor == "code"
    assert launched == [["/usr/bin/code", "-n", str(target_folder)]]
