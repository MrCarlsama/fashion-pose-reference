import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATASET_ROOT = path.join(ROOT, "datasets", "fashion_action_reference");
export const MANIFEST_PATH = path.join(DATASET_ROOT, "manifest.jsonl");
export const IMAGES_DIR = path.join(DATASET_ROOT, "images");

export const MONTHS = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export const SEASONS = {
  "spring/summer": "03",
  "spring-summer": "03",
  "spring summer": "03",
  spring: "03",
  "summer/pre-fall": "06",
  "summer-pre-fall": "06",
  "summer pre-fall": "06",
  summer: "06",
  "fall/winter": "09",
  "fall-winter": "09",
  "fall winter": "09",
  "autumn/winter": "09",
  "autumn-winter": "09",
  "autumn winter": "09",
  fall: "09",
  autumn: "09",
  winter: "12",
  holiday: "11",
  "lunar new year": "01",
};

export const KNOWN_MAGAZINES = [
  ["LE MILE Magazine", ["le mile magazine", "le mile"]],
  ["Harper's Bazaar Australia", ["bazaar australia", "harper's bazaar australia", "harper’s bazaar australia"]],
  ["Harper's Bazaar Brazil", ["harper's bazaar brazil", "harper’s bazaar brazil"]],
  ["Harper's Bazaar Germany", ["harper's bazaar germany", "harper’s bazaar germany"]],
  ["Harper's Bazaar Kazakhstan", ["harper's bazaar kazakhstan", "harper’s bazaar kazakhstan"]],
  ["Harper's Bazaar Poland", ["harper's bazaar poland", "harper’s bazaar poland"]],
  ["Harper's Bazaar Singapore", ["harper's bazaar singapore", "harper’s bazaar singapore"]],
  ["Harper's Bazaar Spain", ["bazaar spain", "harper's bazaar spain", "harper’s bazaar spain"]],
  ["Harper's Bazaar UK", ["harper's bazaar uk", "harper’s bazaar uk"]],
  ["Harper's Bazaar US", ["harper's bazaar us", "harper’s bazaar us"]],
  ["Harper's Bazaar", ["harper's bazaar", "harper’s bazaar", "harpers bazaar"]],
  ["American Vogue", ["american vogue"]],
  ["British Vogue", ["british vogue"]],
  ["Vogue Australia", ["vogue australia"]],
  ["Vogue China", ["vogue china"]],
  ["Vogue France", ["vogue france", "vogue paris"]],
  ["Vogue Global", ["vogue global"]],
  ["Vogue Italia", ["vogue italia"]],
  ["Vogue Japan", ["vogue japan"]],
  ["Vogue Netherlands", ["vogue netherlands"]],
  ["Vogue Portugal", ["vogue portugal"]],
  ["Vogue Spain", ["vogue spain"]],
  ["Vogue US", ["vogue us"]],
  ["Vogue", ["vogue"]],
  ["Elle Brasil", ["elle brasil"]],
  ["Elle Canada", ["elle canada"]],
  ["Elle France", ["elle france"]],
  ["Elle Indonesia", ["elle indonesia"]],
  ["Elle Italia", ["elle italia"]],
  ["Elle Mexico", ["elle mexico"]],
  ["Elle Poland", ["elle poland"]],
  ["Elle Russia", ["elle russia"]],
  ["Elle Serbia", ["elle serbia"]],
  ["Elle Spain", ["elle spain"]],
  ["Elle UK", ["elle uk"]],
  ["Elle US", ["elle us"]],
  ["Elle", ["elle"]],
  ["Dazed China", ["dazed china"]],
  ["Dazed Japan", ["dazed japan"]],
  ["Dazed", ["dazed"]],
  ["i-D Magazine", ["i-d magazine", " i-d "]],
  ["Interview Germany", ["interview germany"]],
  ["Interview Russia", ["interview russia"]],
  ["Interview", ["interview"]],
  ["V Magazine", ["v magazine"]],
  ["W Magazine", ["w magazine"]],
  ["GQ Style Australia", ["gq style australia"]],
  ["GQ Style China", ["gq style china"]],
  ["GQ Style Germany", ["gq style germany"]],
  ["GQ Style Russia", ["gq style russia"]],
  ["GQ Style UK", ["gq style uk"]],
  ["GQ Style US", ["gq style us"]],
  ["GQ Russia", ["gq russia"]],
  ["GQ", ["gq"]],
  ["10 Magazine", ["10 magazine"]],
  ["25 Magazine", ["25 magazine"]],
  ["Allure", ["allure"]],
  ["Amica", ["amica"]],
  ["Antidote", ["antidote"]],
  ["Arena Homme", ["arena homme"]],
  ["BlackBook", ["blackbook"]],
  ["Bon", ["bon magazine", " bon "]],
  ["Carbon Copy", ["carbon copy"]],
  ["Client Magazine", ["client magazine"]],
  ["Dansk", ["dansk"]],
  ["Flaunt", ["flaunt"]],
  ["Hercules", ["hercules"]],
  ["Hero", ["hero magazine", " hero "]],
  ["Jalouse", ["jalouse"]],
  ["Madame Figaro", ["madame figaro"]],
  ["Numéro", ["numéro", "numero"]],
  ["WSJ. Magazine", ["wsj. magazine", "wsj magazine"]],
];

export function stripTags(value) {
  return String(value || "")
    .replace(/<script\b.*?<\/script>/gis, " ")
    .replace(/<style\b.*?<\/style>/gis, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

export function imageKey(value) {
  const url = new URL(canonicalUrl(value));
  if (url.hostname.includes("squarespace-cdn.com")) {
    url.search = "";
    return url.toString();
  }
  url.pathname = url.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp)$)/i, "");
  return url.toString();
}

export async function loadRows() {
  try {
    const text = await fs.readFile(MANIFEST_PATH, "utf8");
    return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function appendRow(row) {
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.appendFile(MANIFEST_PATH, `${JSON.stringify(row)}\n`, "utf8");
}

export function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function extFor(contentType, url) {
  const cleanPath = new URL(url).pathname.toLowerCase();
  const ext = path.extname(cleanPath);
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("png")) return ".png";
  return ".jpg";
}

export function dimensions(buffer) {
  if (buffer.length > 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
      const width = 1 + (b1 | ((b2 & 0x3f) << 8));
      const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
      return { width, height };
    }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      const length = buffer.readUInt16BE(offset);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
        };
      }
      offset += length;
    }
  }
  return null;
}

export function parseIssueMonth(title, imageUrl) {
  const monthNames = Object.keys(MONTHS).join("|");
  const month = new RegExp(`\\b(?<month>${monthNames})(?:/(?<month2>${monthNames}))?(?:\\s+\\d{1,2}(?:st|nd|rd|th)?,?)?\\s+(?<year>\\d{4})`, "i").exec(title);
  if (month?.groups) return { issueMonth: `${month.groups.year}-${MONTHS[month.groups.month.toLowerCase()]}`, source: "title_month" };
  const seasonNames = Object.keys(SEASONS).sort((a, b) => b.length - a.length).map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const season = new RegExp(`\\b(?<season>${seasonNames})\\s+(?<year>\\d{4})`, "i").exec(title);
  if (season?.groups) return { issueMonth: `${season.groups.year}-${SEASONS[season.groups.season.toLowerCase()]}`, source: "title_season" };
  const upload = /\/(?:uploads|content\/v1)\/(?:[^/]+\/)?(\d{4})\/(\d{2})\//.exec(new URL(imageUrl).pathname);
  if (upload) return { issueMonth: `${upload[1]}-${upload[2]}`, source: "upload_path" };
  const year = /\b(20\d{2}|19\d{2})\b/.exec(title);
  if (year) return { issueMonth: `${year[1]}-00`, source: "title_year_only" };
  return { issueMonth: "unknown-date", source: "unknown" };
}

export function parseMagazineName(title, sourceId) {
  if (sourceId.includes("campaign")) return { magazineName: "Campaign", source: "campaign" };
  const originalTitle = String(title || "");
  const loweredTitle = ` ${originalTitle.toLowerCase()} `;
  for (const keyword of [" for ", " on "]) {
    const index = loweredTitle.indexOf(keyword);
    if (index !== -1) {
      return { magazineName: cleanMagazineSegment(originalTitle.slice(index - 1 + keyword.length)), source: keyword.trim() };
    }
  }
  const lowered = ` ${String(title || "").toLowerCase()} `;
  for (const [name, patterns] of KNOWN_MAGAZINES) {
    if (patterns.some((pattern) => lowered.includes(pattern.toLowerCase()))) {
      return { magazineName: name, source: "known_magazine" };
    }
  }
  return { magazineName: cleanMagazineSegment(title), source: "fallback_title" };
}

export function cleanMagazineSegment(segment) {
  let value = String(segment || "").replace(/\s+by\s+.*$/i, "").trim();
  value = value.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Spring\/Summer|Spring-Summer|Summer\/Pre-Fall|Fall\/Winter|Autumn\/Winter|Spring|Summer|Fall|Autumn|Winter|Holiday|Volume|Issue)\b.*$/i, "").trim();
  value = value.replace(/\s+["'“”].*$/, "").replace(/[\s\-–—:,.]+$/g, "").trim();
  return value || "Unknown Magazine";
}

export function safeFilenamePart(value) {
  return String(value || "Unknown Magazine")
    .normalize("NFC")
    .replace(/[/:]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}._'’&+!()-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^[_ .]+|[_ .]+$/g, "") || "Unknown_Magazine";
}

export async function listFilesRecursive(dir) {
  const result = [];
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) result.push(...await listFilesRecursive(full));
      else if (entry.isFile()) result.push(path.resolve(full));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return result;
}
