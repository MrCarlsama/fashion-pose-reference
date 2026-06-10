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
const tasksPath = path.resolve(args.get("tasks") || path.join(annotationsDir, "pending_tasks.jsonl"));
const outPath = path.resolve(args.get("out") || path.join(annotationsDir, "annotations.jsonl"));
const errorsPath = path.resolve(args.get("errors") || path.join(annotationsDir, "annotation_errors.jsonl"));
const promptPath = path.resolve(args.get("prompt") || path.join(annotationsDir, "annotation_prompt.md"));
const schemaPath = path.resolve(args.get("schema") || path.join(annotationsDir, "pose_annotation_schema.json"));
const model = args.get("model") || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const detail = args.get("detail") || "high";
const limit = args.has("limit") ? Number(args.get("limit")) : Infinity;
const concurrency = Math.max(1, Number(args.get("concurrency") || 1));
const maxRetries = Math.max(0, Number(args.get("max-retries") || 2));
const retryDelayMs = Math.max(0, Number(args.get("retry-delay-ms") || 1500));
const maxOutputTokens = Math.max(512, Number(args.get("max-output-tokens") || 3500));
const dryRun = args.get("dry-run") === "true";

if (!process.env.OPENAI_API_KEY && !dryRun) {
  console.error("OPENAI_API_KEY is not set. Full pose annotation needs a vision-capable model; no fake annotations were written.");
  process.exit(2);
}

function extToMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
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

async function appendJsonl(file, row) {
  await fs.appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
}

function outputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function imageDataUrl(file) {
  const buffer = await fs.readFile(file);
  return `data:${extToMime(file)};base64,${buffer.toString("base64")}`;
}

function buildInputText(prompt, task) {
  return [
    prompt,
    "",
    "Image metadata JSON:",
    JSON.stringify(task.image, null, 2),
    "",
    "Return JSON only. The output must describe this exact image and must preserve the image metadata fields.",
  ].join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function annotateTask(prompt, schema, task) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildInputText(prompt, task) },
            { type: "input_image", image_url: await imageDataUrl(task.image.local_path), detail },
          ],
        },
      ],
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "json_schema",
          name: "pose_annotation",
          description: "Detailed fashion pose, camera, emotion, and stick-figure prompt annotation.",
          schema,
          strict: false,
        },
      },
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify({ status: response.status, body }));
  }
  const parsed = JSON.parse(outputText(body));
  parsed.annotation_version = "pose-v1";
  parsed.annotation_status = "vision_model";
  parsed.image = task.image;
  return parsed;
}

const prompt = await fs.readFile(promptPath, "utf8");
const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
const tasks = await readJsonl(tasksPath);
const existing = await readJsonl(outPath);
const seed = await readJsonl(path.join(annotationsDir, "seed_annotations.jsonl"));
const builtin = await readJsonl(path.join(annotationsDir, "builtin_preannotations.jsonl"));
const builtinBatches = (await Promise.all((await listJsonlFiles(builtinBatchDir)).map(readJsonl))).flat();
const done = new Set([...existing, ...seed, ...builtin, ...builtinBatches].map((row) => row.image?.sha256).filter(Boolean));
let written = 0;
let failed = 0;
let nextIndex = 0;
const selectedTasks = [];

for (const task of tasks) {
  if (done.has(task.image.sha256)) continue;
  selectedTasks.push(task);
  if (selectedTasks.length >= limit) break;
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.mkdir(path.dirname(errorsPath), { recursive: true });

async function processTask(task) {
  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, task_id: task.task_id, image: task.image.local_path }));
    written++;
    return;
  }

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const annotation = await annotateTask(prompt, schema, task);
      await appendJsonl(outPath, annotation);
      done.add(task.image.sha256);
      written++;
      console.log(JSON.stringify({ written, task_id: task.task_id, sha256: task.image.sha256 }));
      return;
    } catch (error) {
      attempt++;
      const message = String(error.message || error);
      if (attempt > maxRetries) {
        failed++;
        await appendJsonl(errorsPath, { task_id: task.task_id, image: task.image, attempts: attempt, error: message });
        console.error(JSON.stringify({ failed: task.task_id, attempts: attempt, error: message }));
        return;
      }
      await sleep(retryDelayMs * attempt);
    }
  }
}

async function worker() {
  while (nextIndex < selectedTasks.length) {
    const task = selectedTasks[nextIndex++];
    await processTask(task);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, selectedTasks.length) }, worker));

console.log(JSON.stringify({
  model,
  detail,
  schema_path: schemaPath,
  dry_run: dryRun,
  tasks_seen: tasks.length,
  selected_tasks: selectedTasks.length,
  concurrency,
  tasks_processed: written + failed,
  annotations_written: dryRun ? 0 : written,
  failures: failed,
  out_path: outPath,
}, null, 2));
