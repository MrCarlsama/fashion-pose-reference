import fs from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR, imageKey, listFilesRecursive, loadRows } from "./fashion_tools.mjs";

const minCountIndex = process.argv.indexOf("--min-count");
const minCount = minCountIndex === -1 ? 10000 : Number(process.argv[minCountIndex + 1]);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const rows = await loadRows();
const allFiles = await listFilesRecursive(IMAGES_DIR);
const files = allFiles.filter((file) => imageExts.has(path.extname(file).toLowerCase()));
const nonImageFiles = allFiles.filter((file) => !imageExts.has(path.extname(file).toLowerCase()));
const manifestPaths = new Set(rows.map((row) => path.resolve(row.local_path).toLowerCase().normalize("NFC")));
const keys = rows.map((row) => imageKey(row.image_url));
const sourceCounts = {};
for (const row of rows) sourceCounts[row.source_id] = (sourceCounts[row.source_id] || 0) + 1;
let missingFiles = 0;
let tooSmall = 0;
for (const row of rows) {
  try {
    await fs.access(row.local_path);
  } catch {
    missingFiles++;
  }
  if (Math.min(row.width || 0, row.height || 0) < 500 || Math.max(row.width || 0, row.height || 0) < 900) tooSmall++;
}
const orphanFiles = files.filter((file) => !manifestPaths.has(path.resolve(file).toLowerCase().normalize("NFC"))).length;
const report = {
  article_count: new Set(rows.map((row) => row.article_url)).size,
  duplicate_action_rows: rows.length - new Set(keys).size,
  file_count: files.length,
  ignored_non_image_files: nonImageFiles.length,
  manifest_rows: rows.length,
  missing_files: missingFiles,
  orphan_files: orphanFiles,
  sources: sourceCounts,
  too_small: tooSmall,
  unique_action_keys: new Set(keys).size,
};
console.log(JSON.stringify(report, null, 2));
const ok = report.manifest_rows >= minCount && report.unique_action_keys >= minCount && report.duplicate_action_rows === 0 && report.missing_files === 0 && report.orphan_files === 0 && report.too_small === 0;
process.exit(ok ? 0 : 2);
