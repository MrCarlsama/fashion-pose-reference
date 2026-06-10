import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DATASET_ROOT, loadRows } from "./fashion_tools.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--")) continue;
  args.set(key.slice(2), value ?? "true");
}

const annotationsDir = path.join(DATASET_ROOT, "pose_annotations");
const builtinBatchDir = path.join(annotationsDir, "builtin_preannotation_batches");
const targetCount = args.has("target") ? Number(args.get("target")) : 1000;
const maxPerArticle = args.has("max-per-article") ? Number(args.get("max-per-article")) : 1;
const maxPerIssue = args.has("max-per-issue") ? Number(args.get("max-per-issue")) : 2;
const maxPerMagazine = args.has("max-per-magazine") ? Number(args.get("max-per-magazine")) : 18;
const aspectQuotas = parseAspectQuotas(args.get("aspect-quotas") || "landscape:200,square:50,tall_portrait:150,portrait:600", targetCount);
const targetPath = path.resolve(args.get("out") || path.join(annotationsDir, "target_1000_diverse.jsonl"));
const pendingPath = path.resolve(args.get("pending-out") || path.join(annotationsDir, "pending_tasks_1000_diverse.jsonl"));
const summaryPath = path.resolve(args.get("summary") || path.join(annotationsDir, "target_1000_diverse.summary.json"));
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

function stableHash(value) {
  return createHash("sha1").update(String(value)).digest("hex");
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, "and")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function aspectBucket(row) {
  if (!row.width || !row.height) return "unknown";
  const ratio = row.width / row.height;
  if (ratio > 1.15) return "landscape";
  if (ratio >= 0.9) return "square";
  if (ratio < 0.7) return "tall_portrait";
  return "portrait";
}

function parseAspectQuotas(value, target) {
  const quotas = new Map();
  for (const part of String(value || "").split(",")) {
    const [key, rawCount] = part.split(":");
    if (!key || rawCount === undefined) continue;
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count < 0) throw new Error(`Invalid aspect quota: ${part}`);
    quotas.set(key.trim(), count);
  }
  const total = [...quotas.values()].reduce((sum, count) => sum + count, 0);
  if (total !== target) throw new Error(`Aspect quotas must sum to target ${target}; got ${total}`);
  return quotas;
}

function articleKey(row) {
  if (row.article_url) return normalizeKey(row.article_url);
  return [
    normalizeKey(row.magazine_name),
    row.issue_month || "unknown-date",
    normalizeKey(row.article_title),
  ].join("|");
}

function issueKey(row) {
  return `${normalizeKey(row.magazine_name)}|${row.issue_month || "unknown-date"}`;
}

function taskId(index, sha256) {
  return `pose_${String(index).padStart(5, "0")}_${sha256.slice(0, 12)}`;
}

function buildTask(row, index, diversity) {
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
    diversity,
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

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function topCounts(items, keyFn, limit = 10) {
  const counts = new Map();
  for (const item of items) increment(counts, keyFn(item));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

function interleaveByMagazine(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.diversity.magazine_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const group of groups.values()) {
    group.sort((a, b) =>
      String(a.image.issue_month).localeCompare(String(b.image.issue_month)) ||
      stableHash(a.diversity.article_key).localeCompare(stableHash(b.diversity.article_key))
    );
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const result = [];
  while (orderedGroups.some(([, group]) => group.length)) {
    for (const [, group] of orderedGroups) {
      const item = group.shift();
      if (item) result.push(item);
    }
  }
  return result;
}

function adjacentRepeats(items, keyFn) {
  let repeats = 0;
  for (let i = 1; i < items.length; i++) {
    if (keyFn(items[i]) === keyFn(items[i - 1])) repeats++;
  }
  return repeats;
}

const rows = await loadRows();
const completedPaths = [...baseCompletedPaths, ...await listJsonlFiles(builtinBatchDir)];
const completedShas = await loadCompletedShas(completedPaths);

const articleGroups = new Map();
for (const [index, row] of rows.entries()) {
  if (!row.sha256) throw new Error(`manifest row ${index} is missing sha256`);
  const magazine_key = normalizeKey(row.magazine_name || "Unknown Magazine");
  const issue_key = issueKey(row);
  const article_key = articleKey(row);
  const enriched = {
    row,
    index,
    completed: completedShas.has(row.sha256),
    magazine_key,
    issue_key,
    article_key,
    aspect_bucket: aspectBucket(row),
    area: (row.width || 0) * (row.height || 0),
  };
  if (!articleGroups.has(article_key)) articleGroups.set(article_key, []);
  articleGroups.get(article_key).push(enriched);
}

const candidatesByAspect = new Map();
for (const group of articleGroups.values()) {
  const byAspect = new Map();
  for (const item of group) {
    if (!byAspect.has(item.aspect_bucket)) byAspect.set(item.aspect_bucket, []);
    byAspect.get(item.aspect_bucket).push(item);
  }
  for (const [aspect, aspectGroup] of byAspect) {
    aspectGroup.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? -1 : 1;
      return b.area - a.area || a.index - b.index;
    });
    if (!candidatesByAspect.has(aspect)) candidatesByAspect.set(aspect, []);
    candidatesByAspect.get(aspect).push(aspectGroup[0]);
  }
}

for (const candidates of candidatesByAspect.values()) {
  candidates.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? -1 : 1;
    return stableHash(`${a.aspect_bucket}|${a.article_key}`).localeCompare(stableHash(`${b.aspect_bucket}|${b.article_key}`));
  });
}

const selected = [];
const magazineCounts = new Map();
const issueCounts = new Map();
const articleCounts = new Map();
const aspectCounts = new Map();

function canSelect(candidate) {
  const articleCount = articleCounts.get(candidate.article_key) || 0;
  const issueCount = issueCounts.get(candidate.issue_key) || 0;
  const magazineCount = magazineCounts.get(candidate.magazine_key) || 0;
  return articleCount < maxPerArticle && issueCount < maxPerIssue && magazineCount < maxPerMagazine;
}

function select(candidate) {
  selected.push(candidate);
  articleCounts.set(candidate.article_key, (articleCounts.get(candidate.article_key) || 0) + 1);
  issueCounts.set(candidate.issue_key, (issueCounts.get(candidate.issue_key) || 0) + 1);
  magazineCounts.set(candidate.magazine_key, (magazineCounts.get(candidate.magazine_key) || 0) + 1);
  aspectCounts.set(candidate.aspect_bucket, (aspectCounts.get(candidate.aspect_bucket) || 0) + 1);
}

for (const [aspect, quota] of aspectQuotas) {
  const candidates = candidatesByAspect.get(aspect) || [];
  for (const candidate of candidates) {
    if ((aspectCounts.get(aspect) || 0) >= quota) break;
    if (canSelect(candidate)) select(candidate);
  }
}

const allCandidates = [...candidatesByAspect.values()].flat().sort((a, b) =>
  stableHash(`${a.magazine_key}|${a.issue_key}|${a.article_key}|${a.aspect_bucket}`).localeCompare(
    stableHash(`${b.magazine_key}|${b.issue_key}|${b.article_key}|${b.aspect_bucket}`)
  )
);
for (const candidate of allCandidates) {
  if (selected.length >= targetCount) break;
  if (canSelect(candidate)) select(candidate);
}

if (selected.length < targetCount) {
  throw new Error(`Only selected ${selected.length}/${targetCount}; relax diversity caps.`);
}

const targetTasks = interleaveByMagazine(selected.map((item) => buildTask(item.row, item.index, {
  target_name: "target_1000_diverse",
  selection_policy: "one image per article, capped per issue and magazine, completed rows preferred only within caps",
  completed_at_build_time: item.completed,
  magazine_key: item.magazine_key,
  issue_key: item.issue_key,
  article_key: item.article_key,
  aspect_bucket: item.aspect_bucket,
}))).map((task, index) => ({ target_rank: index + 1, ...task }));

const pendingTasks = targetTasks.filter((task) => !completedShas.has(task.image.sha256));

await fs.mkdir(path.dirname(targetPath), { recursive: true });
await fs.writeFile(targetPath, `${targetTasks.map((task) => JSON.stringify(task)).join("\n")}\n`, "utf8");
await fs.writeFile(pendingPath, `${pendingTasks.map((task) => JSON.stringify(task)).join("\n")}\n`, "utf8");

const summary = {
  target_name: "target_1000_diverse",
  target_images_requested: targetCount,
  target_rows_written: targetTasks.length,
  pending_rows_written: pendingTasks.length,
  completed_in_target_at_build_time: targetTasks.length - pendingTasks.length,
  existing_completed_annotations_seen: completedShas.size,
  manifest_rows: rows.length,
  source_article_groups: articleGroups.size,
  diversity_caps: {
    max_per_article: maxPerArticle,
    max_per_issue: maxPerIssue,
    max_per_magazine: maxPerMagazine,
  },
  aspect_quotas_requested: Object.fromEntries(aspectQuotas),
  aspect_quotas_achieved: Object.fromEntries(aspectCounts),
  max_selected_per_article: Math.max(...topCounts(targetTasks, (task) => task.diversity.article_key, targetTasks.length).map(([, count]) => count)),
  max_selected_per_issue: Math.max(...topCounts(targetTasks, (task) => task.diversity.issue_key, targetTasks.length).map(([, count]) => count)),
  max_selected_per_magazine: Math.max(...topCounts(targetTasks, (task) => task.diversity.magazine_key, targetTasks.length).map(([, count]) => count)),
  adjacent_repeats_in_pending_queue: {
    magazine: adjacentRepeats(pendingTasks, (task) => task.diversity.magazine_key),
    issue: adjacentRepeats(pendingTasks, (task) => task.diversity.issue_key),
    article: adjacentRepeats(pendingTasks, (task) => task.diversity.article_key),
  },
  top_magazines: topCounts(targetTasks, (task) => task.image.magazine_name, 12),
  top_issues: topCounts(targetTasks, (task) => `${task.image.magazine_name}|${task.image.issue_month}`, 12),
  aspect_buckets: topCounts(targetTasks, (task) => task.diversity.aspect_bucket, 10),
  target_path: targetPath,
  pending_path: pendingPath,
  summary_path: summaryPath,
};

await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
