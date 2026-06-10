import fs from "node:fs/promises";
import path from "node:path";
import { DATASET_ROOT } from "./fashion_tools.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--")) continue;
  args.set(key.slice(2), value ?? "true");
}

const annotationsDir = path.join(DATASET_ROOT, "pose_annotations");
const builtinBatchDir = path.join(annotationsDir, "builtin_preannotation_batches");
const targetPath = path.resolve(args.get("target-file") || path.join(annotationsDir, "target_1000_diverse.jsonl"));
const targetCount = args.has("target") ? Number(args.get("target")) : 1000;
const failIfIncomplete = args.get("fail-if-incomplete") === "true";
const baseAnnotationFiles = [
  path.join(annotationsDir, "seed_annotations.jsonl"),
  path.join(annotationsDir, "builtin_preannotations.jsonl"),
  path.join(annotationsDir, "annotations.jsonl"),
];

async function listJsonlFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\n/).filter(Boolean).map((line, index) => ({ file, line: index + 1, value: JSON.parse(line) }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function topCounts(items, keyFn, limit = 10) {
  const counts = new Map();
  for (const item of items) increment(counts, keyFn(item));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

function adjacentRepeats(items, keyFn) {
  let repeats = 0;
  for (let i = 1; i < items.length; i++) {
    if (keyFn(items[i]) === keyFn(items[i - 1])) repeats++;
  }
  return repeats;
}

const targetRows = (await readJsonl(targetPath)).map((item) => item.value);
const annotationFiles = [...baseAnnotationFiles, ...await listJsonlFiles(builtinBatchDir)];
const annotationRows = (await Promise.all(annotationFiles.map(readJsonl))).flat();
const annotationsBySha = new Map();
for (const item of annotationRows) {
  const sha = item.value.image?.sha256;
  if (sha && !annotationsBySha.has(sha)) annotationsBySha.set(sha, item.value);
}

const targetShas = new Set();
const duplicateTargetShas = [];
const targetCompleted = [];
const targetUsable = [];
const targetNonModel = [];
for (const row of targetRows) {
  const sha = row.image?.sha256;
  if (!sha) continue;
  if (targetShas.has(sha)) duplicateTargetShas.push(sha);
  targetShas.add(sha);
  const annotation = annotationsBySha.get(sha);
  if (!annotation) continue;
  targetCompleted.push(row);
  if (annotation.annotation_status === "non_model_detail" || annotation.pose?.body_count === "none") targetNonModel.push(row);
  else targetUsable.push(row);
}

const pendingRows = targetRows.filter((row) => !annotationsBySha.has(row.image?.sha256));
const report = {
  target_file: targetPath,
  target_images_required: targetCount,
  target_rows: targetRows.length,
  unique_target_images: targetShas.size,
  completed_target_images: targetCompleted.length,
  usable_completed_target_images: targetUsable.length,
  non_model_completed_target_images: targetNonModel.length,
  pending_target_images: pendingRows.length,
  existing_annotation_pool_size: annotationsBySha.size,
  duplicate_target_shas: duplicateTargetShas.length,
  target_complete: targetRows.length >= targetCount && targetUsable.length >= targetCount && duplicateTargetShas.length === 0,
  diversity: {
    max_per_article: Math.max(...topCounts(targetRows, (row) => row.diversity?.article_key || row.image?.article_title || "", targetRows.length).map(([, count]) => count)),
    max_per_issue: Math.max(...topCounts(targetRows, (row) => row.diversity?.issue_key || `${row.image?.magazine_name}|${row.image?.issue_month}`, targetRows.length).map(([, count]) => count)),
    max_per_magazine: Math.max(...topCounts(targetRows, (row) => row.diversity?.magazine_key || row.image?.magazine_name || "", targetRows.length).map(([, count]) => count)),
    adjacent_repeats_in_pending_queue: {
      magazine: adjacentRepeats(pendingRows, (row) => row.diversity?.magazine_key || row.image?.magazine_name || ""),
      issue: adjacentRepeats(pendingRows, (row) => row.diversity?.issue_key || `${row.image?.magazine_name}|${row.image?.issue_month}`),
      article: adjacentRepeats(pendingRows, (row) => row.diversity?.article_key || row.image?.article_title || ""),
    },
    top_magazines: topCounts(targetRows, (row) => row.image?.magazine_name || "Unknown Magazine", 12),
    top_issues: topCounts(targetRows, (row) => `${row.image?.magazine_name || "Unknown Magazine"}|${row.image?.issue_month || "unknown-date"}`, 12),
    aspect_buckets: topCounts(targetRows, (row) => row.diversity?.aspect_bucket || "unknown", 10),
  },
};

console.log(JSON.stringify(report, null, 2));
if (duplicateTargetShas.length || targetRows.length < targetCount || (failIfIncomplete && !report.target_complete)) {
  process.exit(2);
}
