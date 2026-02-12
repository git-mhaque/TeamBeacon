"""Shared file IO helpers."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Iterable, Mapping


DATA_DIR = Path(os.getenv("TEAM_BEACON_DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)


def resolve_path(filename: str | os.PathLike) -> Path:
    path = Path(filename)
    if path.is_absolute():
        return path
    return DATA_DIR / path


def write_dataset_to_csv(dataset: list[Mapping], filename: str | os.PathLike) -> None:
    filepath = resolve_path(filename)
    if not dataset:
        filepath.write_text("")
        return

    fieldnames = list(dataset[0].keys())
    with filepath.open("w", newline="", encoding="utf-8") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in dataset:
            writer.writerow(row)


def write_dataset_to_json(data, filename: str | os.PathLike) -> bool:
    filepath = resolve_path(filename)
    try:
        with filepath.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=4, default=str, ensure_ascii=False)
        return True
    except Exception as exc:  # pragma: no cover - IO edge case
        print(f"Error saving JSON: {exc}")
        return False
