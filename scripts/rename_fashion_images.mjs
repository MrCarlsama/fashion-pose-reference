import fs from "node:fs/promises";
import path from "node:path";
import {
  IMAGES_DIR,
  MANIFEST_PATH,
  loadRows,
  parseIssueMonth,
  parseMagazineName,
  safeFilenamePart,
} from "./fashion_tools.mjs";

const apply = process.argv.includes("--apply");
const rows = await loadRows();
const counts = new Map();
const operations = rows.map((row, index) => {
  const { magazineName, source: magazineNameSource } = parseMagazineName(row.article_title, row.source_id);
  const { issueMonth, source: issueDateSource } = parseIssueMonth(row.article_title, row.image_url);
  const slug = safeFilenamePart(magazineName);
  const displayKey = `${slug}__${issueMonth}`;
  const countKey = displayKey.toLowerCase().normalize("NFC");
  const next = (counts.get(countKey) || 0) + 1;
  counts.set(countKey, next);
  const ext = path.extname(row.local_path) || path.extname(new URL(row.image_url).pathname) || ".jpg";
  const newPath = path.join(IMAGES_DIR, `${displayKey}__${String(next).padStart(4, "0")}${ext.toLowerCase()}`);
  return { index, row, oldPath: row.local_path, newPath, magazineName, magazineNameSource, issueMonth, issueDateSource };
});

const targets = new Set(operations.map((op) => path.resolve(op.newPath).toLowerCase().normalize("NFC")));
if (targets.size !== operations.length) throw new Error("target filename collision detected");

for (const op of operations.slice(0, 12)) {
  console.log(`${path.basename(op.oldPath)} -> ${path.basename(op.newPath)}`);
}
if (!apply) {
  console.log("dry run only; pass --apply");
  process.exit(0);
}

const token = `${process.pid}`;
const temps = [];
for (const op of operations) {
  const tmp = path.join(path.dirname(op.oldPath), `.renaming-${token}-${String(op.index).padStart(5, "0")}${path.extname(op.oldPath)}`);
  await fs.rename(op.oldPath, tmp);
  temps.push({ tmp, op });
}

await fs.mkdir(IMAGES_DIR, { recursive: true });
for (const { tmp, op } of temps) {
  await fs.rename(tmp, op.newPath);
  op.row.local_path = op.newPath;
  op.row.magazine_name = op.magazineName;
  op.row.issue_month = op.issueMonth;
  op.row.issue_date_source = op.issueDateSource;
  op.row.magazine_name_source = op.magazineNameSource;
  op.row.filename_schema = "magazine__YYYY-MM__sequence";
}

await fs.writeFile(MANIFEST_PATH, operations.map((op) => JSON.stringify(op.row)).join("\n") + "\n", "utf8");

for (const entry of await fs.readdir(IMAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  await fs.rmdir(path.join(IMAGES_DIR, entry.name)).catch(() => {});
}

console.log(`renamed=${operations.length}`);
