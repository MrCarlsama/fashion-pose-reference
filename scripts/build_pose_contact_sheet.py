#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent.parent
DATASET_ROOT = ROOT / "datasets" / "fashion_action_reference"
ANNOTATIONS_DIR = DATASET_ROOT / "pose_annotations"


def read_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_font(size: int):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def make_tile(task, slot: int, tile_w: int, tile_h: int, label_h: int):
    image_area_h = tile_h - label_h
    source = Image.open(task["image"]["local_path"])
    source = ImageOps.exif_transpose(source).convert("RGB")
    source.thumbnail((tile_w, image_area_h), Image.Resampling.LANCZOS)

    tile = Image.new("RGB", (tile_w, tile_h), "white")
    x = (tile_w - source.width) // 2
    y = label_h + (image_area_h - source.height) // 2
    tile.paste(source, (x, y))

    draw = ImageDraw.Draw(tile)
    draw.rectangle((0, 0, tile_w, label_h), fill=(20, 20, 20))
    label = f"{slot} | {task['task_id']} | idx {task['image']['manifest_index']}"
    font = load_font(20)
    draw.text((10, 10), label, fill="white", font=font)
    return tile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", default=str(ANNOTATIONS_DIR / "pending_tasks.jsonl"))
    parser.add_argument("--out-dir", default=str(ANNOTATIONS_DIR / "contact_sheets"))
    parser.add_argument("--batch", type=int, default=0)
    parser.add_argument("--count", type=int, default=6)
    parser.add_argument("--columns", type=int, default=3)
    parser.add_argument("--tile-width", type=int, default=430)
    parser.add_argument("--tile-height", type=int, default=620)
    args = parser.parse_args()

    tasks_path = Path(args.tasks)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    tasks = read_jsonl(tasks_path)
    start = args.batch * args.count
    selected = tasks[start : start + args.count]
    if not selected:
        raise SystemExit(f"No tasks selected for batch={args.batch}, count={args.count}")

    label_h = 44
    rows = (len(selected) + args.columns - 1) // args.columns
    sheet = Image.new("RGB", (args.columns * args.tile_width, rows * args.tile_height), "white")
    for index, task in enumerate(selected):
        tile = make_tile(task, index + 1, args.tile_width, args.tile_height, label_h)
        x = (index % args.columns) * args.tile_width
        y = (index // args.columns) * args.tile_height
        sheet.paste(tile, (x, y))

    first_index = selected[0]["image"]["manifest_index"]
    last_index = selected[-1]["image"]["manifest_index"]
    stem = f"batch_{args.batch:05d}_idx_{first_index:05d}_{last_index:05d}"
    sheet_path = out_dir / f"{stem}.png"
    manifest_path = out_dir / f"{stem}.json"
    sheet.save(sheet_path, "PNG")
    manifest = {
        "batch": args.batch,
        "start": start,
        "count": len(selected),
        "columns": args.columns,
        "rows": rows,
        "tile_width": args.tile_width,
        "tile_height": args.tile_height,
        "sheet_path": str(sheet_path.resolve()),
        "tasks": [{"sheet_slot": i + 1, **task} for i, task in enumerate(selected)],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sheet_path": str(sheet_path.resolve()), "manifest_path": str(manifest_path.resolve()), "count": len(selected)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
