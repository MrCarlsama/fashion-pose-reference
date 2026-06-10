#!/usr/bin/env python3
from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path


DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "datasets" / "fashion_action_reference"


def image_key(url: str) -> str:
    return re.sub(
        r"-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp)(?:$|\?))",
        "",
        url,
        flags=re.I,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-count", type=int, default=10_000)
    parser.add_argument("--min-short-edge", type=int, default=500)
    parser.add_argument("--min-long-edge", type=int, default=900)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.output.resolve()
    manifest = root / "manifest.jsonl"
    rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]

    manifest_paths = {Path(row["local_path"]).resolve() for row in rows}
    files = [path.resolve() for path in (root / "images").rglob("*") if path.is_file()]
    keys = [image_key(row["image_url"]) for row in rows]

    missing_files = [row["local_path"] for row in rows if not Path(row["local_path"]).exists()]
    orphan_files = [str(path) for path in files if path not in manifest_paths]
    duplicate_rows = len(rows) - len(set(keys))
    too_small = [
        row["local_path"]
        for row in rows
        if min(row.get("width") or 0, row.get("height") or 0) < args.min_short_edge
        or max(row.get("width") or 0, row.get("height") or 0) < args.min_long_edge
    ]

    report = {
        "article_count": len({row["article_url"] for row in rows}),
        "duplicate_action_rows": duplicate_rows,
        "file_count": len(files),
        "manifest_rows": len(rows),
        "missing_files": len(missing_files),
        "orphan_files": len(orphan_files),
        "sources": dict(collections.Counter(row["source_id"] for row in rows)),
        "too_small": len(too_small),
        "unique_action_keys": len(set(keys)),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))

    ok = (
        report["manifest_rows"] >= args.min_count
        and report["unique_action_keys"] >= args.min_count
        and report["duplicate_action_rows"] == 0
        and report["missing_files"] == 0
        and report["orphan_files"] == 0
        and report["too_small"] == 0
    )
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
