#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "datasets" / "fashion_action_reference"

MONTHS = {
    "january": "01",
    "february": "02",
    "march": "03",
    "april": "04",
    "may": "05",
    "june": "06",
    "july": "07",
    "august": "08",
    "september": "09",
    "october": "10",
    "november": "11",
    "december": "12",
}

SEASONS = {
    "spring/summer": "03",
    "spring-summer": "03",
    "spring summer": "03",
    "spring": "03",
    "summer/pre-fall": "06",
    "summer-pre-fall": "06",
    "summer pre-fall": "06",
    "summer": "06",
    "fall/winter": "09",
    "fall-winter": "09",
    "fall winter": "09",
    "autumn/winter": "09",
    "autumn-winter": "09",
    "autumn winter": "09",
    "fall": "09",
    "autumn": "09",
    "winter": "12",
    "holiday": "11",
    "lunar new year": "01",
}

KNOWN_CAMPAIGN_BRANDS = [
    "Alexander McQueen",
    "Balenciaga",
    "Bottega Veneta",
    "Burberry",
    "Chanel",
    "Coach",
    "Dior",
    "Gucci",
    "Louis Vuitton",
    "Miu Miu",
    "Prada",
    "Saint Laurent",
    "Valentino",
    "Versace",
]

KNOWN_MAGAZINES = [
    ("Harper’s Bazaar Australia", ["bazaar australia", "harper's bazaar australia", "harper’s bazaar australia"]),
    ("Harper’s Bazaar Brazil", ["harper's bazaar brazil", "harper’s bazaar brazil"]),
    ("Harper’s Bazaar Germany", ["harper's bazaar germany", "harper’s bazaar germany"]),
    ("Harper’s Bazaar Kazakhstan", ["harper's bazaar kazakhstan", "harper’s bazaar kazakhstan"]),
    ("Harper’s Bazaar Poland", ["harper's bazaar poland", "harper’s bazaar poland"]),
    ("Harper’s Bazaar Singapore", ["harper's bazaar singapore", "harper’s bazaar singapore"]),
    ("Harper’s Bazaar Spain", ["bazaar spain", "harper's bazaar spain", "harper’s bazaar spain"]),
    ("Harper’s Bazaar UK", ["harper's bazaar uk", "harper’s bazaar uk"]),
    ("Harper’s Bazaar US", ["harper's bazaar us", "harper’s bazaar us"]),
    ("Harper’s Bazaar", ["harper's bazaar", "harper’s bazaar", "harpers bazaar"]),
    ("American Vogue", ["american vogue"]),
    ("British Vogue", ["british vogue"]),
    ("Vogue Australia", ["vogue australia"]),
    ("Vogue China", ["vogue china"]),
    ("Vogue France", ["vogue france", "vogue paris"]),
    ("Vogue Global", ["vogue global"]),
    ("Vogue Italia", ["vogue italia"]),
    ("Vogue Japan", ["vogue japan"]),
    ("Vogue Netherlands", ["vogue netherlands"]),
    ("Vogue Portugal", ["vogue portugal"]),
    ("Vogue Spain", ["vogue spain"]),
    ("Vogue US", ["vogue us"]),
    ("Vogue", ["vogue"]),
    ("Elle Brasil", ["elle brasil"]),
    ("Elle Canada", ["elle canada"]),
    ("Elle France", ["elle france"]),
    ("Elle Indonesia", ["elle indonesia"]),
    ("Elle Italia", ["elle italia"]),
    ("Elle Mexico", ["elle mexico"]),
    ("Elle Poland", ["elle poland"]),
    ("Elle Russia", ["elle russia"]),
    ("Elle Serbia", ["elle serbia"]),
    ("Elle Spain", ["elle spain"]),
    ("Elle UK", ["elle uk"]),
    ("Elle US", ["elle us"]),
    ("Elle", ["elle"]),
    ("Dazed China", ["dazed china"]),
    ("Dazed Japan", ["dazed japan"]),
    ("Dazed", ["dazed"]),
    ("i-D Magazine", ["i-d magazine", "i-D magazine", " i-d "]),
    ("Interview Germany", ["interview germany"]),
    ("Interview Russia", ["interview russia"]),
    ("Interview", ["interview"]),
    ("V Magazine", ["v magazine"]),
    ("W Magazine", ["w magazine"]),
    ("GQ Style Australia", ["gq style australia"]),
    ("GQ Style China", ["gq style china"]),
    ("GQ Style Germany", ["gq style germany"]),
    ("GQ Style Russia", ["gq style russia"]),
    ("GQ Style UK", ["gq style uk"]),
    ("GQ Style US", ["gq style us"]),
    ("GQ Russia", ["gq russia"]),
    ("GQ", ["gq"]),
    ("10 Magazine", ["10 magazine"]),
    ("25 Magazine", ["25 magazine"]),
    ("Allure", ["allure"]),
    ("Amica", ["amica"]),
    ("Antidote", ["antidote"]),
    ("Arena Homme", ["arena homme"]),
    ("BlackBook", ["blackbook"]),
    ("Bon", ["bon magazine", " bon "]),
    ("Carbon Copy", ["carbon copy"]),
    ("Client Magazine", ["client magazine"]),
    ("Dansk", ["dansk"]),
    ("Flaunt", ["flaunt"]),
    ("Hercules", ["hercules"]),
    ("Hero", ["hero magazine", " hero "]),
    ("Jalouse", ["jalouse"]),
    ("LE MILE Magazine", ["le mile magazine", "le mile"]),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--apply", action="store_true", help="Rename files and rewrite manifest.")
    parser.add_argument(
        "--flat",
        action="store_true",
        help="Move all images into the top-level images directory instead of source-id subfolders.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Preview only the first N manifest rows.")
    return parser.parse_args()


def parse_issue_month(title: str, image_url: str) -> tuple[str, str]:
    month_names = "|".join(MONTHS)
    month_match = re.search(
        rf"\b(?P<month>{month_names})(?:/(?P<month2>{month_names}))?"
        rf"(?:\s+\d{{1,2}}(?:st|nd|rd|th)?,?)?\s+(?P<year>\d{{4}})",
        title,
        flags=re.I,
    )
    if month_match:
        month = MONTHS[month_match.group("month").casefold()]
        return f"{month_match.group('year')}-{month}", "title_month"

    season_names = sorted(SEASONS, key=len, reverse=True)
    season_match = re.search(
        rf"\b(?P<season>{'|'.join(re.escape(item) for item in season_names)})\s+(?P<year>\d{{4}})",
        title,
        flags=re.I,
    )
    if season_match:
        month = SEASONS[season_match.group("season").casefold()]
        return f"{season_match.group('year')}-{month}", "title_season"

    year_match = re.search(r"\b(20\d{2}|19\d{2})\b", title)
    upload_match = re.search(r"/uploads/(\d{4})/(\d{2})/", urlparse(image_url).path)
    if upload_match:
        return f"{upload_match.group(1)}-{upload_match.group(2)}", "upload_path"
    if year_match:
        return f"{year_match.group(1)}-00", "title_year_only"
    return "unknown-date", "unknown"


def parse_magazine_name(title: str, source_id: str) -> tuple[str, str]:
    if "campaign" in source_id:
        lowered = title.casefold()
        for brand in KNOWN_CAMPAIGN_BRANDS:
            if brand.casefold() in lowered:
                return f"{brand} Campaign", "campaign_brand"
        return "Campaign", "campaign"

    lowered = f" {title.casefold()} "
    for magazine, patterns in KNOWN_MAGAZINES:
        for pattern in patterns:
            if pattern.casefold() in lowered:
                return magazine, "known_magazine"

    for keyword in (" for ", " on "):
        pos = title.casefold().find(keyword)
        if pos != -1:
            segment = title[pos + len(keyword) :]
            return clean_magazine_segment(segment), keyword.strip()

    return clean_magazine_segment(title), "fallback_title"


def clean_magazine_segment(segment: str) -> str:
    segment = re.split(r"\s+by\s+", segment, maxsplit=1, flags=re.I)[0].strip()
    marker_words = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
        "Spring/Summer",
        "Summer/Pre-Fall",
        "Fall/Winter",
        "Autumn/Winter",
        "Spring",
        "Summer",
        "Fall",
        "Autumn",
        "Winter",
        "Holiday",
        "Volume",
        "Issue",
    ]
    marker_pattern = r"\b(" + "|".join(re.escape(word) for word in marker_words) + r")\b"
    marker = re.search(marker_pattern, segment, flags=re.I)
    if marker:
        segment = segment[: marker.start()].strip()
    segment = re.split(r"\s+[\"'“”]", segment, maxsplit=1)[0].strip()
    segment = re.sub(r"[’']s$", "", segment).strip()
    segment = segment.strip(" -–—:,.")
    return segment or "Unknown Magazine"


def safe_filename_part(value: str) -> str:
    value = unicodedata.normalize("NFC", value)
    value = value.replace("/", " ")
    value = value.replace(":", " ")
    value = re.sub(r"\s+", "_", value.strip())
    value = re.sub(r"[^\w.\-’'&+!()]+", "_", value, flags=re.UNICODE)
    value = re.sub(r"_+", "_", value).strip("_.")
    return value or "Unknown_Magazine"


def load_rows(manifest: Path) -> list[dict]:
    return [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    args = parse_args()
    root = args.output.resolve()
    manifest = root / "manifest.jsonl"
    rows = load_rows(manifest)
    preview_rows = rows[: args.limit] if args.limit else rows

    grouped_counts: dict[tuple[str, str], int] = defaultdict(int)
    operations = []
    for row in rows:
        magazine_name, magazine_source = parse_magazine_name(row["article_title"], row["source_id"])
        issue_month, date_source = parse_issue_month(row["article_title"], row["image_url"])
        magazine_slug = safe_filename_part(magazine_name)
        key = (magazine_slug, issue_month)
        grouped_counts[key] += 1
        ext = Path(row["local_path"]).suffix.lower() or Path(urlparse(row["image_url"]).path).suffix.lower() or ".jpg"
        filename = f"{magazine_slug}__{issue_month}__{grouped_counts[key]:04d}{ext}"
        if args.flat:
            new_path = root / "images" / filename
        else:
            new_path = Path(row["local_path"]).with_name(filename)
        operations.append(
            {
                "date_source": date_source,
                "magazine_name": magazine_name,
                "magazine_source": magazine_source,
                "new_path": new_path,
                "old_path": Path(row["local_path"]),
                "row": row,
            }
        )

    target_paths = [op["new_path"].resolve() for op in operations]
    if len(target_paths) != len(set(target_paths)):
        raise SystemExit("target filename collision detected")

    print("preview:")
    for op in operations[: len(preview_rows) if args.limit else 12]:
        print(f"{op['old_path'].name} -> {op['new_path'].name}")

    if not args.apply:
        print("\ndry run only; pass --apply to rename files and update manifest")
        return 0

    temp_paths = []
    token = str(os.getpid())
    for index, op in enumerate(operations, start=1):
        old_path = op["old_path"]
        if not old_path.exists():
            raise SystemExit(f"missing file: {old_path}")
        temp_path = old_path.with_name(f".renaming-{token}-{index:05d}{old_path.suffix.lower()}")
        old_path.rename(temp_path)
        temp_paths.append((temp_path, op))

    for temp_path, op in temp_paths:
        op["new_path"].parent.mkdir(parents=True, exist_ok=True)
        temp_path.rename(op["new_path"])
        row = op["row"]
        row["local_path"] = str(op["new_path"])
        row["magazine_name"] = op["magazine_name"]
        row["issue_month"] = op["new_path"].name.split("__")[1]
        row["issue_date_source"] = op["date_source"]
        row["magazine_name_source"] = op["magazine_source"]
        row["filename_schema"] = "magazine__YYYY-MM__sequence"

    with manifest.open("w", encoding="utf-8") as handle:
        for op in operations:
            handle.write(json.dumps(op["row"], ensure_ascii=False, sort_keys=True) + "\n")

    for directory in sorted((root / "images").glob("*"), reverse=True):
        if directory.is_dir():
            try:
                directory.rmdir()
            except OSError:
                pass

    print(f"renamed={len(operations)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
