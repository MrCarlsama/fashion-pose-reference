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
const outPath = path.resolve(args.get("out") || path.join(annotationsDir, "pending_tasks_1000_diverse.jsonl"));
const summaryPath = path.resolve(args.get("summary") || path.join(annotationsDir, "pending_tasks_1000_diverse.summary.json"));
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
    return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const targetRows = await readJsonl(targetPath);
const annotationFiles = [...baseAnnotationFiles, ...await listJsonlFiles(builtinBatchDir)];
const annotationRows = (await Promise.all(annotationFiles.map(readJsonl))).flat();
const completedShas = new Set(annotationRows.map((row) => row.image?.sha256).filter(Boolean));
const pendingRows = targetRows.filter((row) => !completedShas.has(row.image?.sha256));

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${pendingRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

const summary = {
  target_file: targetPath,
  target_rows: targetRows.length,
  completed_target_rows: targetRows.length - pendingRows.length,
  pending_target_rows: pendingRows.length,
  out_path: outPath,
  summary_path: summaryPath,
};

await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
