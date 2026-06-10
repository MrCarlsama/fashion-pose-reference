import fs from "node:fs/promises";
import path from "node:path";
import {
  DATASET_ROOT,
  IMAGES_DIR,
  appendRow,
  canonicalUrl,
  dimensions,
  extFor,
  imageKey,
  loadRows,
  sha1,
  sha256,
  stripTags,
} from "./fashion_tools.mjs";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const target = Number(arg("target", "20000"));
const timeoutMs = Number(arg("timeout-ms", "10000"));
const concurrency = Number(arg("concurrency", "12"));
const sources = new Set(String(arg("sources", "designscene,lemile")).split(",").map((item) => item.trim()).filter(Boolean));

function log(message) {
  console.log(message);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return await response.text();
}

function parseSrcset(value) {
  return String(value || "").split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "is").exec(tag);
  return match ? match[2].replace(/&amp;/g, "&") : "";
}

function normalizeSquarespace(url) {
  const parsed = new URL(url);
  parsed.search = "format=2500w";
  return parsed.toString();
}

function imageUrlsFromHtml(html, baseUrl, sourceId) {
  const urls = new Set();
  for (const tag of html.match(/<img\b[^>]*>/gis) || []) {
    for (const name of ["data-srcset", "srcset"]) {
      for (const src of parseSrcset(attr(tag, name))) urls.add(new URL(src, baseUrl).toString());
    }
    for (const name of ["data-src", "data-lazy-src", "data-original", "src"]) {
      const src = attr(tag, name);
      if (src && !src.startsWith("data:")) urls.add(new URL(src, baseUrl).toString());
    }
  }
  if (sourceId === "le_mile_archive") {
    for (const match of html.match(/https:\/\/images\.squarespace-cdn\.com\/[^"'<>)\s\\]+/gi) || []) {
      urls.add(match.replace(/&amp;/g, "&"));
    }
  }
  return [...urls].map((url) => sourceId === "le_mile_archive" && new URL(url).hostname.includes("squarespace-cdn.com") ? normalizeSquarespace(url) : canonicalUrl(url));
}

function likelyImage(url) {
  const parsed = new URL(url);
  if (parsed.hostname.includes("squarespace-cdn.com")) return true;
  if (!parsed.pathname.includes("/wp-content/uploads/")) return false;
  if (/(logo|avatar|banner|favicon|icon|placeholder|profile|sprite)/i.test(parsed.pathname)) return false;
  if (!/\.(jpe?g|png|webp)$/i.test(parsed.pathname)) return false;
  if (/-330x220\.(?:jpe?g|png|webp)$/i.test(parsed.pathname)) return false;
  return true;
}

function imageUrlScore(url) {
  const parsed = new URL(url);
  if (parsed.hostname.includes("squarespace-cdn.com")) {
    const format = /format=(\d+)/i.exec(parsed.search);
    return format ? Number(format[1]) * Number(format[1]) : 2500 * 2500;
  }
  const sized = /-(\d{2,5})x(\d{2,5})(?=\.(?:jpe?g|png|webp)$)/i.exec(parsed.pathname);
  if (sized) return Number(sized[1]) * Number(sized[2]);
  return 10_000_000_000;
}

async function designsceneCandidates() {
  const sitemap = await fetchText("https://www.designscene.net/category-sitemap.xml");
  const slugs = [...sitemap.matchAll(/<loc>https:\/\/www\.designscene\.net\/magazines\/([^<]+)<\/loc>/g)].map((match) => match[1]);
  const articles = new Map();
  for (const slug of slugs) {
    let categories;
    try {
      categories = await (await fetch(`https://www.designscene.net/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&_fields=id,count,name,slug`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      })).json();
    } catch {
      continue;
    }
    if (!categories?.length) continue;
    const category = categories[0];
    const pages = Math.max(1, Math.ceil(Number(category.count || 0) / 100));
    let kept = 0;
    for (let page = 1; page <= pages; page++) {
      let posts;
      try {
        const response = await fetch(`https://www.designscene.net/wp-json/wp/v2/posts?categories=${category.id}&page=${page}&per_page=100&_fields=link,title,content,date`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) break;
        posts = await response.json();
      } catch {
        break;
      }
      for (const post of posts || []) {
        const articleUrl = canonicalUrl(post.link);
        if (articles.has(articleUrl)) continue;
        const title = stripTags(post.title?.rendered || "");
        const content = post.content?.rendered || "";
        articles.set(articleUrl, { articleUrl, title, content });
        kept++;
      }
    }
    log(`[discover-node] designscene ${slug} posts=${kept} total=${articles.size}`);
  }
  const candidates = [];
  for (const article of articles.values()) {
    for (const imageUrl of imageUrlsFromHtml(article.content, article.articleUrl, "designscene_magazines")) {
      if (likelyImage(imageUrl)) {
        candidates.push({ sourceId: "designscene_magazines", articleUrl: article.articleUrl, articleTitle: article.title, imageUrl });
      }
    }
  }
  return candidates;
}

async function fashionotographyCandidates() {
  const categories = await (await fetch("https://fashionotography.com/wp-json/wp/v2/categories?slug=editorial&_fields=id,count,name,slug", {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  })).json();
  if (!categories?.length) return [];
  const category = categories[0];
  const pages = Math.max(1, Math.ceil(Number(category.count || 0) / 100));
  const postsByUrl = new Map();
  for (let page = 1; page <= pages; page++) {
    let posts;
    try {
      const response = await fetch(`https://fashionotography.com/wp-json/wp/v2/posts?categories=${category.id}&page=${page}&per_page=100&_fields=link,title,content,date`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) break;
      posts = await response.json();
    } catch {
      break;
    }
    for (const post of posts || []) {
      const articleUrl = canonicalUrl(post.link);
      if (postsByUrl.has(articleUrl)) continue;
      postsByUrl.set(articleUrl, {
        articleUrl,
        title: stripTags(post.title?.rendered || ""),
        content: post.content?.rendered || "",
      });
    }
    log(`[discover-node] fashionotography page=${page}/${pages} posts=${postsByUrl.size}`);
  }
  const candidates = [];
  for (const article of postsByUrl.values()) {
    for (const imageUrl of imageUrlsFromHtml(article.content, article.articleUrl, "fashionotography_editorial")) {
      if (likelyImage(imageUrl)) {
        candidates.push({ sourceId: "fashionotography_editorial", articleUrl: article.articleUrl, articleTitle: article.title, imageUrl });
      }
    }
  }
  return candidates;
}

async function leMileCandidates() {
  const archiveUrl = "https://www.lemilemagazine.com/digital-fashion-editorials-archive";
  const html = await fetchText(archiveUrl);
  return imageUrlsFromHtml(html, archiveUrl, "le_mile_archive")
    .filter(likelyImage)
    .map((imageUrl) => ({
      sourceId: "le_mile_archive",
      articleUrl: archiveUrl,
      articleTitle: "LE MILE Magazine Digital Fashion Editorials Archive 2025",
      imageUrl,
    }));
}

async function downloadCandidate(candidate, state) {
  const key = imageKey(candidate.imageUrl);
  if (state.rows.length >= target || state.seenKeys.has(key)) return false;
  state.attempts++;
  if (state.attempts % 500 === 0) {
    log(`[attempt-node] attempts=${state.attempts} saved=${state.rows.length}/${target} failures=${JSON.stringify(state.failures)}`);
  }
  let response;
  try {
    response = await fetch(candidate.imageUrl, {
      headers: { "User-Agent": USER_AGENT, Referer: candidate.articleUrl },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      state.failures.http++;
      return false;
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      state.failures.contentType++;
      return false;
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > 25 * 1024 * 1024) {
      state.failures.tooLarge++;
      return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024) {
      state.failures.tooLarge++;
      return false;
    }
    const size = dimensions(buffer);
    if (!size) {
      state.failures.dimensions++;
      return false;
    }
    if (Math.min(size.width, size.height) < 500 || Math.max(size.width, size.height) < 900) {
      state.failures.tooSmall++;
      return false;
    }
    if (state.rows.length >= target || state.seenKeys.has(key)) return false;
    const ext = extFor(contentType, candidate.imageUrl);
    const dir = path.join(IMAGES_DIR, candidate.sourceId);
    await fs.mkdir(dir, { recursive: true });
    const localPath = path.join(dir, `${sha1(candidate.imageUrl).slice(0, 16)}${ext}`);
    await fs.writeFile(localPath, buffer, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const row = {
      article_title: candidate.articleTitle,
      article_url: candidate.articleUrl,
      downloaded_at: new Date().toISOString(),
      height: size.height,
      image_url: candidate.imageUrl,
      local_path: localPath,
      method: "direct_download_node",
      sha256: sha256(buffer),
      source_id: candidate.sourceId,
      width: size.width,
    };
    await appendRow(row);
    state.rows.push(row);
    state.seenKeys.add(key);
    if (state.rows.length % 100 === 0) log(`[download-node] saved=${state.rows.length}/${target}`);
    return true;
  } catch {
    state.failures.exception++;
    return false;
  }
}

async function runPool(candidates, state) {
  let index = 0;
  let added = 0;
  async function worker() {
    while (index < candidates.length && state.rows.length < target) {
      const candidate = candidates[index++];
      if (await downloadCandidate(candidate, state)) added++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return added;
}

const rows = await loadRows();
const state = {
  rows,
  seenKeys: new Set(rows.map((row) => imageKey(row.image_url))),
  attempts: 0,
  failures: { http: 0, contentType: 0, tooLarge: 0, dimensions: 0, tooSmall: 0, exception: 0 },
};
log(`[start-node] existing=${rows.length} target=${target}`);

const sourceOrder = [];
if (sources.has("fashionotography")) sourceOrder.push(["fashionotography", fashionotographyCandidates]);
if (sources.has("designscene")) sourceOrder.push(["designscene", designsceneCandidates]);
if (sources.has("lemile")) sourceOrder.push(["lemile", leMileCandidates]);

for (const [name, discover] of sourceOrder) {
  if (state.rows.length >= target) break;
  const candidates = await discover();
  const bestByKey = new Map();
  for (const candidate of candidates) {
    const key = imageKey(candidate.imageUrl);
    if (state.seenKeys.has(key)) continue;
    const current = bestByKey.get(key);
    if (!current || imageUrlScore(candidate.imageUrl) > imageUrlScore(current.imageUrl)) {
      bestByKey.set(key, candidate);
    }
  }
  const uniqueCandidates = [...bestByKey.values()];
  log(`[candidates-node] ${name} raw=${candidates.length} new_keys=${uniqueCandidates.length}`);
  const added = await runPool(uniqueCandidates, state);
  log(`[source-done-node] ${name} added=${added} saved=${state.rows.length}/${target}`);
}

process.exit(state.rows.length >= target ? 0 : 2);
