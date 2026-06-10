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
const targetPath = path.resolve(args.get("target-file") || path.join(annotationsDir, "target_1000_diverse.jsonl"));
const pendingPath = path.resolve(args.get("pending-out") || path.join(annotationsDir, "pending_tasks_1000_diverse.jsonl"));
const summaryPath = path.resolve(args.get("summary") || path.join(annotationsDir, "target_1000_diverse.summary.json"));
const targetCount = args.has("target") ? Number(args.get("target")) : 1000;
const maxPerArticle = args.has("max-per-article") ? Number(args.get("max-per-article")) : 1;
const maxPerIssue = args.has("max-per-issue") ? Number(args.get("max-per-issue")) : 2;
const maxPerMagazine = args.has("max-per-magazine") ? Number(args.get("max-per-magazine")) : 18;
const aspectQuotas = parseAspectQuotas(args.get("aspect-quotas") || "landscape:200,square:50,tall_portrait:150,portrait:600", targetCount);
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

function buildTask(candidate, rank, completedShas) {
  const row = candidate.row;
  return {
    target_rank: rank,
    task_id: taskId(candidate.index, row.sha256),
    annotation_version: "pose-v1",
    schema_path: path.join(annotationsDir, "pose_annotation_schema.json"),
    prompt_path: path.join(annotationsDir, "annotation_prompt.md"),
    image: {
      manifest_index: candidate.index,
      sha256: row.sha256,
      local_path: row.local_path,
      magazine_name: row.magazine_name || "Unknown Magazine",
      issue_month: row.issue_month || "unknown-date",
      article_title: row.article_title || "",
      width: row.width,
      height: row.height,
    },
    diversity: {
      target_name: "target_1000_diverse",
      selection_policy: "one image per article, capped per issue and magazine, completed rows preferred only within caps; confirmed non-model targets are replaced",
      completed_at_build_time: completedShas.has(row.sha256),
      magazine_key: candidate.magazine_key,
      issue_key: candidate.issue_key,
      article_key: candidate.article_key,
      aspect_bucket: candidate.aspect_bucket,
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

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function decrement(map, key) {
  map.set(key, (map.get(key) || 0) - 1);
  if (map.get(key) <= 0) map.delete(key);
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

function interleaveByMagazine(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.magazine_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const group of groups.values()) {
    group.sort((a, b) =>
      String(a.row.issue_month).localeCompare(String(b.row.issue_month)) ||
      stableHash(a.article_key).localeCompare(stableHash(b.article_key))
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

function isNonModel(annotation) {
  return annotation?.annotation_status === "non_model_detail" || annotation?.pose?.body_count === "none";
}

function canSelect(candidate, counts) {
  return (
    (counts.article.get(candidate.article_key) || 0) < maxPerArticle &&
    (counts.issue.get(candidate.issue_key) || 0) < maxPerIssue &&
    (counts.magazine.get(candidate.magazine_key) || 0) < maxPerMagazine
  );
}

function addCandidate(candidate, selected, selectedShas, counts) {
  selected.push(candidate);
  selectedShas.add(candidate.row.sha256);
  increment(counts.article, candidate.article_key);
  increment(counts.issue, candidate.issue_key);
  increment(counts.magazine, candidate.magazine_key);
  increment(counts.aspect, candidate.aspect_bucket);
}

function removeCandidate(candidate, counts) {
  decrement(counts.article, candidate.article_key);
  decrement(counts.issue, candidate.issue_key);
  decrement(counts.magazine, candidate.magazine_key);
  decrement(counts.aspect, candidate.aspect_bucket);
}

const manifestRows = await loadRows();
const manifestBySha = new Map();
const candidates = [];
for (const [index, row] of manifestRows.entries()) {
  if (!row.sha256) continue;
  const candidate = {
    row,
    index,
    magazine_key: normalizeKey(row.magazine_name || "Unknown Magazine"),
    issue_key: issueKey(row),
    article_key: articleKey(row),
    aspect_bucket: aspectBucket(row),
    area: (row.width || 0) * (row.height || 0),
  };
  manifestBySha.set(row.sha256, candidate);
  candidates.push(candidate);
}

const annotationFiles = [...baseAnnotationFiles, ...await listJsonlFiles(builtinBatchDir)];
const annotationRows = (await Promise.all(annotationFiles.map(readJsonl))).flat();
const annotationsBySha = new Map();
for (const row of annotationRows) {
  const sha = row.image?.sha256;
  if (sha && !annotationsBySha.has(sha)) annotationsBySha.set(sha, row);
}
const completedShas = new Set(annotationsBySha.keys());
const nonModelShas = new Set([...annotationsBySha.entries()].filter(([, row]) => isNonModel(row)).map(([sha]) => sha));

const targetRows = await readJsonl(targetPath);
const selected = [];
const selectedShas = new Set();
const counts = { article: new Map(), issue: new Map(), magazine: new Map(), aspect: new Map() };
const removed = [];

for (const task of targetRows) {
  const sha = task.image?.sha256;
  const candidate = manifestBySha.get(sha);
  if (!sha || !candidate) {
    removed.push({ sha, reason: "missing_manifest_candidate" });
    continue;
  }
  if (nonModelShas.has(sha)) {
    removed.push({ sha, reason: "confirmed_non_model" });
    continue;
  }
  if (selectedShas.has(sha)) {
    removed.push({ sha, reason: "duplicate_target_sha" });
    continue;
  }
  addCandidate(candidate, selected, selectedShas, counts);
}

const selectedByArticle = new Map();
for (const candidate of selected) {
  if (!selectedByArticle.has(candidate.article_key)) selectedByArticle.set(candidate.article_key, []);
  selectedByArticle.get(candidate.article_key).push(candidate);
}

function replacementCandidatesForAspect(aspect) {
  const bestByArticle = new Map();
  for (const candidate of candidates) {
    if (candidate.aspect_bucket !== aspect) continue;
    if (selectedShas.has(candidate.row.sha256)) continue;
    if (nonModelShas.has(candidate.row.sha256)) continue;
    if (!canSelect(candidate, counts)) continue;
    const existing = bestByArticle.get(candidate.article_key);
    const score = [
      completedShas.has(candidate.row.sha256) ? 0 : 1,
      -candidate.area,
      stableHash(`${candidate.magazine_key}|${candidate.issue_key}|${candidate.article_key}|${candidate.row.sha256}`),
    ];
    const existingScore = existing && [
      completedShas.has(existing.row.sha256) ? 0 : 1,
      -existing.area,
      stableHash(`${existing.magazine_key}|${existing.issue_key}|${existing.article_key}|${existing.row.sha256}`),
    ];
    if (!existing || compareScore(score, existingScore) < 0) bestByArticle.set(candidate.article_key, candidate);
  }
  return [...bestByArticle.values()].sort((a, b) =>
    Number(completedShas.has(b.row.sha256)) - Number(completedShas.has(a.row.sha256)) ||
    stableHash(`${a.aspect_bucket}|${a.magazine_key}|${a.issue_key}|${a.article_key}`).localeCompare(
      stableHash(`${b.aspect_bucket}|${b.magazine_key}|${b.issue_key}|${b.article_key}`)
    )
  );
}

function compareScore(a, b) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

const replacements = [];
for (const [aspect, quota] of aspectQuotas) {
  while ((counts.aspect.get(aspect) || 0) < quota) {
    const [candidate] = replacementCandidatesForAspect(aspect);
    if (!candidate) break;
    addCandidate(candidate, selected, selectedShas, counts);
    replacements.push(candidate);
  }
}

if (selected.length < targetCount) {
  const anyAspectCandidates = () => candidates
    .filter((candidate) => !selectedShas.has(candidate.row.sha256) && !nonModelShas.has(candidate.row.sha256) && canSelect(candidate, counts))
    .sort((a, b) =>
      Number(completedShas.has(b.row.sha256)) - Number(completedShas.has(a.row.sha256)) ||
      stableHash(`${a.magazine_key}|${a.issue_key}|${a.article_key}|${a.aspect_bucket}`).localeCompare(
        stableHash(`${b.magazine_key}|${b.issue_key}|${b.article_key}|${b.aspect_bucket}`)
      )
    );
  while (selected.length < targetCount) {
    const [candidate] = anyAspectCandidates();
    if (!candidate) break;
    addCandidate(candidate, selected, selectedShas, counts);
    replacements.push(candidate);
  }
}

if (selected.length < targetCount) {
  throw new Error(`Only repaired target to ${selected.length}/${targetCount}; relax caps or add more candidates.`);
}

while (selected.length > targetCount) {
  const removable = [...selected].reverse().find((candidate) => (counts.aspect.get(candidate.aspect_bucket) || 0) > (aspectQuotas.get(candidate.aspect_bucket) || 0));
  if (!removable) break;
  const index = selected.findIndex((candidate) => candidate.row.sha256 === removable.row.sha256);
  selected.splice(index, 1);
  selectedShas.delete(removable.row.sha256);
  removeCandidate(removable, counts);
}

const ordered = interleaveByMagazine(selected);
const targetTasks = ordered.map((candidate, index) => buildTask(candidate, index + 1, completedShas));
const pendingTasks = targetTasks.filter((task) => !completedShas.has(task.image.sha256));

await fs.writeFile(targetPath, `${targetTasks.map((task) => JSON.stringify(task)).join("\n")}\n`, "utf8");
await fs.writeFile(pendingPath, `${pendingTasks.map((task) => JSON.stringify(task)).join("\n")}\n`, "utf8");

const summary = {
  target_name: "target_1000_diverse",
  target_images_requested: targetCount,
  target_rows_written: targetTasks.length,
  pending_rows_written: pendingTasks.length,
  completed_in_target_after_repair: targetTasks.length - pendingTasks.length,
  removed_target_rows: removed,
  replacements_added: replacements.map((candidate) => ({
    manifest_index: candidate.index,
    sha256: candidate.row.sha256,
    magazine_name: candidate.row.magazine_name || "Unknown Magazine",
    issue_month: candidate.row.issue_month || "unknown-date",
    article_title: candidate.row.article_title || "",
    aspect_bucket: candidate.aspect_bucket,
  })),
  diversity_caps: {
    max_per_article: maxPerArticle,
    max_per_issue: maxPerIssue,
    max_per_magazine: maxPerMagazine,
  },
  aspect_quotas_requested: Object.fromEntries(aspectQuotas),
  aspect_quotas_achieved: Object.fromEntries(counts.aspect),
  max_selected_per_article: Math.max(...topCounts(targetTasks, (task) => task.diversity.article_key, targetTasks.length).map(([, count]) => count)),
  max_selected_per_issue: Math.max(...topCounts(targetTasks, (task) => task.diversity.issue_key, targetTasks.length).map(([, count]) => count)),
  max_selected_per_magazine: Math.max(...topCounts(targetTasks, (task) => task.diversity.magazine_key, targetTasks.length).map(([, count]) => count)),
  adjacent_repeats_in_pending_queue: {
    magazine: adjacentRepeats(pendingTasks, (task) => task.diversity.magazine_key),
    issue: adjacentRepeats(pendingTasks, (task) => task.diversity.issue_key),
    article: adjacentRepeats(pendingTasks, (task) => task.diversity.article_key),
  },
  top_magazines: topCounts(targetTasks, (task) => task.image.magazine_name, 12),
  target_file: targetPath,
  pending_file: pendingPath,
};

await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
