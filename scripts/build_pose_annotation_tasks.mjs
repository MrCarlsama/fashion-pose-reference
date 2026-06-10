import fs from "node:fs/promises";
import path from "node:path";
import { DATASET_ROOT, loadRows } from "./fashion_tools.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--")) continue;
  args.set(key.slice(2), value ?? "true");
}

const annotationsDir = path.join(DATASET_ROOT, "pose_annotations");
const outPath = path.resolve(args.get("out") || path.join(annotationsDir, "pending_tasks.jsonl"));
const summaryPath = path.resolve(args.get("summary") || path.join(annotationsDir, "pending_tasks.summary.json"));
const limit = args.has("limit") ? Number(args.get("limit")) : Infinity;
const includeCompleted = args.get("include-completed") === "true";
const order = args.get("order") || "diverse";
const builtinBatchDir = path.join(annotationsDir, "builtin_preannotation_batches");
const baseCompletedPaths = [
  path.join(annotationsDir, "annotations.jsonl"),
  path.join(annotationsDir, "seed_annotations.jsonl"),
  path.join(annotationsDir, "builtin_preannotations.jsonl"),
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

function taskId(index, sha256) {
  return `pose_${String(index).padStart(5, "0")}_${sha256.slice(0, 12)}`;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0).padStart(10, "0");
}

function issueKey(row) {
  return `${normalizeKey(row.magazine_name || "Unknown Magazine")}|${row.issue_month || "unknown-date"}`;
}

function articleKey(row) {
  if (row.article_url) return normalizeKey(row.article_url);
  return [
    normalizeKey(row.magazine_name || "Unknown Magazine"),
    row.issue_month || "unknown-date",
    normalizeKey(row.article_title || ""),
  ].join("|");
}

function interleaveBy(items, keyFn, innerOrderFn = (group) => group) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const buckets = [...groups.entries()].map(([key, group]) => ({
    key,
    items: innerOrderFn(group).slice(),
  }));
  const result = [];
  let lastKey = "";
  while (buckets.some((bucket) => bucket.items.length)) {
    buckets.sort((a, b) => {
      const aPenalty = a.key === lastKey ? 1 : 0;
      const bPenalty = b.key === lastKey ? 1 : 0;
      return (
        aPenalty - bPenalty ||
        b.items.length - a.items.length ||
        stableHash(a.key).localeCompare(stableHash(b.key))
      );
    });
    const bucket = buckets.find((candidate) => candidate.items.length && candidate.key !== lastKey) ||
      buckets.find((candidate) => candidate.items.length);
    result.push(bucket.items.shift());
    lastKey = bucket.key;
  }
  return result;
}

function diverseOrder(tasks) {
  return interleaveBy(
    tasks,
    (task) => task.diversity.magazine_key,
    (magazineGroup) => interleaveBy(
      magazineGroup,
      (task) => task.diversity.issue_key,
      (issueGroup) => interleaveBy(
        issueGroup,
        (task) => task.diversity.article_key,
        (articleGroup) => articleGroup.sort((a, b) => a.image.manifest_index - b.image.manifest_index)
      )
    )
  );
}

function adjacentRepeats(items, keyFn) {
  let count = 0;
  for (let index = 1; index < items.length; index++) {
    if (keyFn(items[index]) === keyFn(items[index - 1])) count++;
  }
  return count;
}

function topCounts(items, keyFn, limit = 12) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit);
}

async function loadCompletedShas(paths) {
  const shas = new Set();
  for (const file of paths) {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const line of text.split(/\n/).filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.image?.sha256) shas.add(row.image.sha256);
    }
  }
  return shas;
}

function buildTask(row, index) {
  return {
    task_id: taskId(index, row.sha256),
    annotation_version: "pose-v1",
    schema_path: path.join(annotationsDir, "pose_annotation_schema.json"),
    prompt_path: path.join(annotationsDir, "annotation_prompt.md"),
    image: {
      manifest_index: index,
      sha256: row.sha256,
      local_path: row.local_path,
      magazine_name: row.magazine_name || "Unknown Magazine",
      issue_month: row.issue_month || "unknown-date",
      article_title: row.article_title || "",
      width: row.width,
      height: row.height,
    },
    diversity: {
      ordering_policy: "full20k_interleaved_by_magazine_issue_article",
      magazine_key: normalizeKey(row.magazine_name || "Unknown Magazine"),
      issue_key: issueKey(row),
      article_key: articleKey(row),
    },
    requested_output: "Return one JSON object matching pose_annotation_schema.json. Do not return markdown.",
    required_observation: [
      "visible body support and orientation",
      "head, gaze, shoulder line, spine, pelvis, arm, hand, leg, and foot positions",
      "camera angle, crop, and distance",
      "pose-affecting props or environment",
      "lighting distribution across face, body, props, floor, and background, including direction, contrast, and shadow placement",
      "emotion expressed through body tension, gaze, and movement",
      "lighting tags for retrieval, such as side light, back light, soft light, hard shadow, high contrast, or low contrast",
      "final action reference and simple human mannequin drawing prompt",
    ],
  };
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
const rows = await loadRows();
const completedPaths = [...baseCompletedPaths, ...await listJsonlFiles(builtinBatchDir)];
const completedShas = includeCompleted ? new Set() : await loadCompletedShas(completedPaths);
const rawTasks = [];
let skippedCompleted = 0;
for (const [index, row] of rows.entries()) {
  if (!row.sha256) throw new Error(`manifest row ${index} is missing sha256`);
  if (completedShas.has(row.sha256)) {
    skippedCompleted++;
    continue;
  }
  rawTasks.push(buildTask(row, index));
}
const orderedTasks = order === "manifest" ? rawTasks : diverseOrder(rawTasks);
const tasks = orderedTasks.slice(0, limit);

await fs.writeFile(outPath, `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`, "utf8");
const summary = {
  manifest_rows: rows.length,
  completed_annotations_seen: completedShas.size,
  skipped_completed: skippedCompleted,
  pending_tasks_available_before_limit: rawTasks.length,
  pending_tasks_written: tasks.length,
  include_completed: includeCompleted,
  order,
  diversity: {
    adjacent_repeats_in_pending_queue: {
      magazine: adjacentRepeats(tasks, (task) => task.diversity.magazine_key),
      issue: adjacentRepeats(tasks, (task) => task.diversity.issue_key),
      article: adjacentRepeats(tasks, (task) => task.diversity.article_key),
    },
    top_magazines: topCounts(tasks, (task) => task.image.magazine_name, 12),
    top_issues: topCounts(tasks, (task) => `${task.image.magazine_name}|${task.image.issue_month}`, 12),
  },
  out_path: outPath,
};
await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
