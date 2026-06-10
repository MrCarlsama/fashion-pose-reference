#!/usr/bin/env python3
"""
Harvest publicly reachable fashion editorial/campaign images for action reference.

This is intentionally boring:
- discover article URLs from known category pages;
- fetch each article;
- keep only large image assets from the article page;
- write every saved image to a manifest for audit and resume.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import json
import os
import re
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = ROOT / "sources" / "fashion_sources.json"
DEFAULT_OUTPUT = ROOT / "datasets" / "fashion_action_reference"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_IMAGE_WORDS = {
    "avatar",
    "banner",
    "favicon",
    "icon",
    "logo",
    "placeholder",
    "profile",
    "sprite",
}


@dataclass(frozen=True)
class Article:
    source_id: str
    url: str
    title: str
    content: str | None = None


@dataclass(frozen=True)
class ImageCandidate:
    source_id: str
    article_url: str
    article_title: str
    image_url: str


class Manifest:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.seen_urls: set[str] = set()
        self.seen_image_keys: set[str] = set()
        self.count = 0
        if path.exists():
            valid_rows: list[dict] = []
            total_lines = 0
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    total_lines += 1
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    local_path = row.get("local_path")
                    if local_path and not Path(local_path).exists():
                        continue
                    if row.get("image_url"):
                        valid_rows.append(row)

            best_by_key: dict[str, dict] = {}
            order: list[str] = []
            for row in valid_rows:
                key = image_key(row["image_url"])
                if key not in best_by_key:
                    best_by_key[key] = row
                    order.append(key)
                    continue
                if row_quality(row) > row_quality(best_by_key[key]):
                    best_by_key[key] = row

            clean_rows = [best_by_key[key] for key in order]
            for row in clean_rows:
                self.seen_urls.add(row["image_url"])
                self.seen_image_keys.add(image_key(row["image_url"]))
                self.count += 1

            if len(clean_rows) != total_lines:
                with path.open("w", encoding="utf-8") as handle:
                    for row in clean_rows:
                        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    def has_url(self, image_url: str) -> bool:
        with self.lock:
            return image_url in self.seen_urls or image_key(image_url) in self.seen_image_keys

    def append(self, row: dict, *, target: int | None = None) -> tuple[bool, int]:
        with self.lock:
            image_url = row["image_url"]
            key = image_key(image_url)
            if image_url in self.seen_urls or key in self.seen_image_keys:
                return False, self.count
            if target is not None and self.count >= target:
                return False, self.count
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            self.seen_urls.add(image_url)
            self.seen_image_keys.add(key)
            self.count += 1
            return True, self.count


def log(message: str) -> None:
    print(message, flush=True)


def image_key(url: str) -> str:
    parsed = urlparse(canonical_url(url))
    if "squarespace-cdn.com" in parsed.netloc:
        return parsed._replace(query="", fragment="").geturl()
    return re.sub(
        r"-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp)(?:$|\?))",
        "",
        parsed.geturl(),
        flags=re.I,
    )


def row_quality(row: dict) -> tuple[int, int]:
    width = row.get("width") or 0
    height = row.get("height") or 0
    area = width * height
    try:
        size = Path(row.get("local_path") or "").stat().st_size
    except OSError:
        size = 0
    return area, size


def load_sources(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def fetch_text(session: requests.Session, url: str, *, timeout: int = 30) -> str:
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    return response.text


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        }
    )
    return session


def strip_tags(value: str) -> str:
    value = re.sub(r"<script\b.*?</script>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<style\b.*?</style>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def title_from_html(text: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.I | re.S)
    if not match:
        return ""
    title = strip_tags(match.group(1))
    return re.sub(r"\s*[-|]\s*fashionotography\s*$", "", title, flags=re.I)


def extract_attr(tag: str, attr: str) -> str | None:
    match = re.search(rf"\b{re.escape(attr)}\s*=\s*([\"'])(.*?)\1", tag, flags=re.I | re.S)
    if not match:
        return None
    return html.unescape(match.group(2)).strip()


def canonical_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(fragment="").geturl()


def discover_wordpress_category(
    source: dict,
    session: requests.Session,
    *,
    max_pages: int,
    title_keywords: list[str],
    campaign_keywords: list[str],
    strict_keywords: bool,
) -> list[Article]:
    articles: dict[str, Article] = {}
    for page in range(1, max_pages + 1):
        url = source["category_url"] if page == 1 else source["page_url_pattern"].format(page=page)
        try:
            text = fetch_text(session, url)
        except Exception as exc:
            log(f"[discover] stop {source['id']} page={page}: {exc}")
            break

        found = extract_article_links(text, source["base_url"])
        if not found:
            log(f"[discover] stop {source['id']} page={page}: no article links")
            break

        kept_on_page = 0
        for article_url, article_title in found:
            title = article_title or article_url.rsplit("/", 2)[-2].replace("-", " ")
            if strict_keywords and not title_matches(title, title_keywords, campaign_keywords):
                continue
            articles.setdefault(
                article_url,
                Article(source_id=source["id"], url=article_url, title=title),
            )
            kept_on_page += 1

        log(
            f"[discover] {source['id']} page={page} links={len(found)} kept={kept_on_page} total={len(articles)}"
        )

    return list(articles.values())


def discover_wordpress_rest_magazine_categories(
    source: dict,
    session: requests.Session,
    *,
    max_pages: int,
) -> list[Article]:
    category_sitemap_url = source["category_sitemap_url"]
    api_base = source["api_base"].rstrip("/")
    category_prefix = source.get("category_path_prefix", "/magazines/")
    text = fetch_text(session, category_sitemap_url)
    slugs = []
    for loc in re.findall(r"<loc>(.*?)</loc>", text):
        parsed = urlparse(loc)
        path = parsed.path
        if category_prefix not in path:
            continue
        slug = path.rsplit("/", 1)[-1]
        if slug:
            slugs.append(slug)

    include = set(source.get("include_slugs") or [])
    exclude = set(source.get("exclude_slugs") or [])
    if include:
        slugs = [slug for slug in slugs if slug in include]
    slugs = [slug for slug in slugs if slug not in exclude]

    articles: dict[str, Article] = {}
    for slug in slugs:
        try:
            categories = session.get(
                f"{api_base}/categories",
                params={"slug": slug, "_fields": "id,count,name,slug"},
                timeout=30,
            )
            categories.raise_for_status()
            category_rows = categories.json()
        except Exception as exc:
            log(f"[discover-rest] skip category={slug}: {exc}")
            continue
        if not category_rows:
            continue
        category = category_rows[0]
        category_id = category["id"]
        total_pages = min(max_pages, max(1, (int(category.get("count") or 0) + 99) // 100))
        kept = 0
        for page in range(1, total_pages + 1):
            try:
                response = session.get(
                    f"{api_base}/posts",
                    params={
                        "categories": category_id,
                        "page": page,
                        "per_page": 100,
                        "_fields": "link,title,content,date",
                    },
                    timeout=45,
                )
                response.raise_for_status()
                posts = response.json()
            except Exception as exc:
                log(f"[discover-rest] stop category={slug} page={page}: {exc}")
                break
            if not posts:
                break
            for post in posts:
                url = canonical_url(post.get("link") or "")
                if not url:
                    continue
                title = strip_tags((post.get("title") or {}).get("rendered") or "")
                content = (post.get("content") or {}).get("rendered") or ""
                articles.setdefault(
                    url,
                    Article(source_id=source["id"], url=url, title=title, content=content),
                )
                kept += 1
        log(
            f"[discover-rest] {source['id']} category={slug} posts={kept} total={len(articles)}"
        )
    return list(articles.values())


def discover_html_image_archive(source: dict, session: requests.Session) -> list[Article]:
    text = fetch_text(session, source["archive_url"], timeout=45)
    title = source.get("article_title") or title_from_html(text) or source["id"]
    return [
        Article(
            source_id=source["id"],
            url=source["archive_url"],
            title=title,
            content=text,
        )
    ]


def extract_article_links(text: str, base_url: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []

    heading_pattern = re.compile(
        r"<h[1-4][^>]*>.*?<a[^>]+href=(['\"])(.*?)\1[^>]*>(.*?)</a>.*?</h[1-4]>",
        flags=re.I | re.S,
    )
    for _, href, title_html in heading_pattern.findall(text):
        url = canonical_url(urljoin(base_url, html.unescape(href)))
        title = strip_tags(title_html)
        if is_article_url(url, base_url):
            links.append((url, title))

    if links:
        return unique_pairs(links)

    anchor_pattern = re.compile(r"<a[^>]+href=(['\"])(.*?)\1[^>]*>(.*?)</a>", flags=re.I | re.S)
    for _, href, title_html in anchor_pattern.findall(text):
        url = canonical_url(urljoin(base_url, html.unescape(href)))
        title = strip_tags(title_html)
        if title and is_article_url(url, base_url):
            links.append((url, title))

    return unique_pairs(links)


def unique_pairs(items: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    result: list[tuple[str, str]] = []
    for url, title in items:
        if url in seen:
            continue
        seen.add(url)
        result.append((url, title))
    return result


def is_article_url(url: str, base_url: str) -> bool:
    parsed = urlparse(url)
    base = urlparse(base_url)
    if parsed.netloc != base.netloc:
        return False
    path = parsed.path.strip("/")
    if not path or "/" in path:
        return False
    bad_prefixes = (
        "about",
        "advertising",
        "beauty",
        "campaign",
        "category",
        "contact",
        "fashion-news",
        "footwear",
        "magazines",
        "page",
        "privacy",
        "tag",
    )
    return not path.startswith(bad_prefixes)


def title_matches(title: str, title_keywords: list[str], campaign_keywords: list[str]) -> bool:
    lowered = title.casefold()
    for keyword in title_keywords + campaign_keywords:
        if keyword.casefold() in lowered:
            return True
    return False


def extract_sections(text: str) -> set[str]:
    sections = set(re.findall(r'property=["\']article:section["\']\s+content=["\']([^"\']+)', text, flags=re.I))
    sections.update(re.findall(r'rel=["\']category tag["\'][^>]*>(.*?)</a>', text, flags=re.I | re.S))
    return {strip_tags(section) for section in sections if strip_tags(section)}


def extract_image_candidates(article: Article, text: str, source: dict) -> list[ImageCandidate]:
    sections = extract_sections(text)
    allowed_sections = set(source.get("allowed_sections") or [])
    if allowed_sections and sections and not allowed_sections.intersection(sections):
        return []

    title = title_from_html(text) or article.title
    urls: set[str] = set()
    for tag_match in re.finditer(r"<img\b[^>]*>", text, flags=re.I | re.S):
        tag = tag_match.group(0)
        for attr in ("data-lazy-srcset", "data-srcset", "srcset"):
            value = extract_attr(tag, attr)
            if value:
                urls.update(parse_srcset(value, source["base_url"]))
        for attr in ("data-lazy-src", "data-src", "data-original", "src"):
            value = extract_attr(tag, attr)
            if value:
                urls.add(urljoin(source["base_url"], value))
    for pattern in source.get("image_url_regexes") or []:
        for match in re.findall(pattern, text, flags=re.I):
            if isinstance(match, tuple):
                match = next((part for part in match if part), "")
            if match:
                urls.add(html.unescape(match))

    candidates = []
    for image_url in sorted(urls):
        image_url = normalize_image_url(canonical_url(image_url), source)
        if is_probable_large_article_image(image_url):
            candidates.append(
                ImageCandidate(
                    source_id=article.source_id,
                    article_url=article.url,
                    article_title=title,
                    image_url=image_url,
                )
            )
    return candidates


def normalize_image_url(url: str, source: dict) -> str:
    if source.get("force_squarespace_format") and "images.squarespace-cdn.com" in urlparse(url).netloc:
        parsed = urlparse(url)
        return parsed._replace(query=f"format={source['force_squarespace_format']}").geturl()
    return url


def parse_srcset(value: str, base_url: str) -> set[str]:
    urls: set[str] = set()
    for part in value.split(","):
        url = part.strip().split(" ")[0]
        if url:
            urls.add(urljoin(base_url, url))
    return urls


def image_size_hint(url: str) -> tuple[int | None, int | None]:
    match = re.search(r"-(\d{2,5})x(\d{2,5})(?=\.(?:jpe?g|png|webp)(?:$|\?))", url, flags=re.I)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def is_probable_large_article_image(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path
    suffix = Path(path).suffix.casefold()
    is_squarespace = "images.squarespace-cdn.com" in parsed.netloc
    if suffix not in IMAGE_EXTENSIONS and not is_squarespace:
        return False
    if "/wp-content/uploads/" not in path and not is_squarespace:
        return False
    lowered = path.casefold()
    if any(word in lowered for word in SKIP_IMAGE_WORDS):
        return False
    width, height = image_size_hint(url)
    if width is not None and height is not None:
        short_edge = min(width, height)
        long_edge = max(width, height)
        if width == 330 and height == 220:
            return False
        return short_edge >= 500 and long_edge >= 900
    return True


def extension_for_url(url: str, content_type: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return suffix
    if "webp" in content_type:
        return ".webp"
    if "png" in content_type:
        return ".png"
    return ".jpg"


def save_candidate(
    candidate: ImageCandidate,
    *,
    output_dir: Path,
    manifest: Manifest,
    min_short_edge: int,
    min_long_edge: int,
    target: int,
    timeout: int,
) -> bool:
    if manifest.count >= target or manifest.has_url(candidate.image_url):
        return False

    session = make_session()
    headers = {
        "Referer": candidate.article_url,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    try:
        response = session.get(candidate.image_url, headers=headers, timeout=timeout, stream=True)
        response.raise_for_status()
    except Exception:
        return False

    content_type = response.headers.get("content-type", "")
    if not content_type.startswith("image/"):
        return False

    ext = extension_for_url(candidate.image_url, content_type)
    url_hash = hashlib.sha1(candidate.image_url.encode("utf-8")).hexdigest()[:16]
    source_dir = output_dir / "images" / candidate.source_id
    source_dir.mkdir(parents=True, exist_ok=True)
    final_path = source_dir / f"{url_hash}{ext}"

    if final_path.exists():
        row = build_manifest_row(candidate, final_path, None, None, None, "direct_download")
        added, _ = manifest.append(row, target=target)
        return added

    with tempfile.NamedTemporaryFile(delete=False, dir=source_dir, suffix=ext) as tmp:
        tmp_path = Path(tmp.name)
        digest = hashlib.sha256()
        total = 0
        try:
            for chunk in response.iter_content(chunk_size=1024 * 128):
                if not chunk:
                    continue
                total += len(chunk)
                if total > 25 * 1024 * 1024:
                    raise ValueError("image too large")
                digest.update(chunk)
                tmp.write(chunk)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            return False

    try:
        with Image.open(tmp_path) as image:
            width, height = image.size
            image.verify()
    except Exception:
        tmp_path.unlink(missing_ok=True)
        return False

    short_edge = min(width, height)
    long_edge = max(width, height)
    if short_edge < min_short_edge or long_edge < min_long_edge:
        tmp_path.unlink(missing_ok=True)
        return False

    if manifest.count >= target:
        tmp_path.unlink(missing_ok=True)
        return False

    os.replace(tmp_path, final_path)
    row = build_manifest_row(candidate, final_path, width, height, digest.hexdigest(), "direct_download")
    added, _ = manifest.append(row, target=target)
    if not added:
        final_path.unlink(missing_ok=True)
    return added


def build_manifest_row(
    candidate: ImageCandidate,
    local_path: Path,
    width: int | None,
    height: int | None,
    sha256: str | None,
    method: str,
) -> dict:
    return {
        "article_title": candidate.article_title,
        "article_url": candidate.article_url,
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "height": height,
        "image_url": candidate.image_url,
        "local_path": str(local_path),
        "method": method,
        "sha256": sha256,
        "source_id": candidate.source_id,
        "width": width,
    }


def write_summary(output_dir: Path, manifest: Manifest, stats: dict) -> None:
    reports_dir = output_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "manifest": str(manifest.path),
        "saved_images": manifest.count,
        "stats": stats,
    }
    with (reports_dir / "summary.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2, sort_keys=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--target", type=int, default=10_000)
    parser.add_argument("--max-category-pages", type=int, default=260)
    parser.add_argument("--article-workers", type=int, default=8)
    parser.add_argument("--image-workers", type=int, default=12)
    parser.add_argument("--max-pending-images", type=int, default=200)
    parser.add_argument("--min-short-edge", type=int, default=500)
    parser.add_argument("--min-long-edge", type=int, default=900)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument(
        "--source-id",
        action="append",
        default=[],
        help="Only harvest these source ids. Can be passed multiple times.",
    )
    parser.add_argument(
        "--loose",
        action="store_true",
        help="Do not require title/brand keywords during discovery. Useful if strict mode cannot reach the target.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_sources(args.sources)
    args.output.mkdir(parents=True, exist_ok=True)

    manifest = Manifest(args.output / "manifest.jsonl")
    log(f"[start] existing_saved={manifest.count} target={args.target}")
    if manifest.count >= args.target:
        write_summary(args.output, manifest, {"already_complete": True})
        return 0

    session = make_session()
    title_keywords = config.get("avant_garde_title_keywords", [])
    campaign_keywords = config.get("campaign_brand_keywords", [])
    strict_keywords = not args.loose

    articles: dict[str, Article] = {}
    allowed_source_ids = set(args.source_id)
    for source in config["sources"]:
        if allowed_source_ids and source["id"] not in allowed_source_ids:
            continue
        if source["type"] == "wordpress_category":
            discovered = discover_wordpress_category(
                source,
                session,
                max_pages=args.max_category_pages,
                title_keywords=title_keywords,
                campaign_keywords=campaign_keywords,
                strict_keywords=strict_keywords,
            )
        elif source["type"] == "wordpress_rest_magazine_categories":
            discovered = discover_wordpress_rest_magazine_categories(
                source,
                session,
                max_pages=args.max_category_pages,
            )
        elif source["type"] == "html_image_archive":
            discovered = discover_html_image_archive(source, session)
        else:
            continue
        for article in discovered:
            articles.setdefault(article.url, article)

    article_list = list(articles.values())
    log(f"[articles] total={len(article_list)} strict_keywords={strict_keywords}")

    stats = {
        "article_failures": 0,
        "articles_processed": 0,
        "candidates_found": 0,
        "download_attempts": 0,
        "downloaded_this_run": 0,
    }

    source_by_id = {source["id"]: source for source in config["sources"]}
    stop_event = threading.Event()

    def article_job(article: Article) -> list[ImageCandidate]:
        if stop_event.is_set():
            return []
        if article.content:
            text = article.content
        else:
            local_session = make_session()
            try:
                text = fetch_text(local_session, article.url, timeout=args.timeout)
            except Exception:
                with stats_lock:
                    stats["article_failures"] += 1
                return []
        candidates = extract_image_candidates(article, text, source_by_id[article.source_id])
        with stats_lock:
            stats["articles_processed"] += 1
            stats["candidates_found"] += len(candidates)
            processed = stats["articles_processed"]
        if processed % 50 == 0:
            log(
                f"[articles] processed={processed}/{len(article_list)} "
                f"candidates={stats['candidates_found']} saved={manifest.count}"
            )
        return candidates

    stats_lock = threading.Lock()

    image_futures: set[concurrent.futures.Future] = set()

    def drain_done(block: bool = False) -> None:
        if not image_futures:
            return
        if block:
            done, _ = concurrent.futures.wait(
                image_futures,
                return_when=concurrent.futures.FIRST_COMPLETED,
            )
        else:
            done = {item for item in image_futures if item.done()}
        for item in done:
            image_futures.remove(item)
            if item.result():
                with stats_lock:
                    stats["downloaded_this_run"] += 1
                if manifest.count % 100 == 0:
                    log(f"[download] saved={manifest.count}/{args.target}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.image_workers) as image_pool:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.article_workers) as article_pool:
            future_to_article = {article_pool.submit(article_job, article): article for article in article_list}
            for future in concurrent.futures.as_completed(future_to_article):
                if manifest.count >= args.target:
                    stop_event.set()
                    break
                candidates = future.result()
                for candidate in candidates:
                    if manifest.count >= args.target:
                        stop_event.set()
                        break
                    if manifest.has_url(candidate.image_url):
                        continue
                    while len(image_futures) >= args.max_pending_images:
                        drain_done(block=True)
                    with stats_lock:
                        stats["download_attempts"] += 1
                    image_futures.add(
                        image_pool.submit(
                            save_candidate,
                            candidate,
                            output_dir=args.output,
                            manifest=manifest,
                            min_short_edge=args.min_short_edge,
                            min_long_edge=args.min_long_edge,
                            target=args.target,
                            timeout=args.timeout,
                        )
                    )
                drain_done()

        for future in concurrent.futures.as_completed(image_futures):
            if future.result():
                with stats_lock:
                    stats["downloaded_this_run"] += 1
                if manifest.count % 100 == 0:
                    log(f"[download] saved={manifest.count}/{args.target}")
            if manifest.count >= args.target:
                stop_event.set()

    write_summary(args.output, manifest, stats)
    log(f"[done] saved={manifest.count} target={args.target} stats={stats}")
    return 0 if manifest.count >= args.target else 2


if __name__ == "__main__":
    raise SystemExit(main())
