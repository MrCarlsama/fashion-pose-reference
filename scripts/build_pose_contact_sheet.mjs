import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATASET_ROOT } from "./fashion_tools.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--")) continue;
  args.set(key.slice(2), value ?? "true");
}

const annotationsDir = path.join(DATASET_ROOT, "pose_annotations");
const tasksPath = path.resolve(args.get("tasks") || path.join(annotationsDir, "pending_tasks.jsonl"));
const outDir = path.resolve(args.get("out-dir") || path.join(annotationsDir, "contact_sheets"));
const batch = Math.max(0, Number(args.get("batch") || 0));
const count = Math.max(1, Number(args.get("count") || 6));
const columns = Math.max(1, Number(args.get("columns") || 3));
const tileW = Math.max(240, Number(args.get("tile-width") || 420));
const tileH = Math.max(280, Number(args.get("tile-height") || 560));
const labelH = 44;

async function readJsonl(file) {
  const text = await fs.readFile(file, "utf8");
  return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr}`));
    });
  });
}

function ffmpegText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

const tasks = await readJsonl(tasksPath);
const start = batch * count;
const selected = tasks.slice(start, start + count);
if (!selected.length) {
  console.error(`No tasks selected for batch=${batch}, count=${count}`);
  process.exit(2);
}

await fs.mkdir(outDir, { recursive: true });
const tempDir = path.join(outDir, `.tmp_batch_${String(batch).padStart(5, "0")}`);
await fs.rm(tempDir, { recursive: true, force: true });
await fs.mkdir(tempDir, { recursive: true });

const tilePaths = [];
for (const [i, task] of selected.entries()) {
  const label = `${i + 1} | ${task.task_id} | idx ${task.image.manifest_index}`;
  const out = path.join(tempDir, `tile_${String(i).padStart(2, "0")}.png`);
  const vf = [
    `scale=${tileW}:${tileH - labelH}:force_original_aspect_ratio=decrease`,
    `pad=${tileW}:${tileH - labelH}:(ow-iw)/2:(oh-ih)/2:white`,
    `pad=${tileW}:${tileH}:0:${labelH}:white`,
    `drawbox=x=0:y=0:w=${tileW}:h=${labelH}:color=black@0.82:t=fill`,
    `drawtext=text='${ffmpegText(label)}':x=10:y=10:fontsize=20:fontcolor=white`,
  ].join(",");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", task.image.local_path, "-vf", vf, out]);
  tilePaths.push(out);
}

const rows = Math.ceil(selected.length / columns);
const inputs = tilePaths.flatMap((file) => ["-i", file]);
const layout = selected.map((_, i) => {
  const x = (i % columns) * tileW;
  const y = Math.floor(i / columns) * tileH;
  return `${x}_${y}`;
}).join("|");
const sheetPath = path.join(outDir, `batch_${String(batch).padStart(5, "0")}.png`);
await run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  ...inputs,
  "-filter_complex",
  `xstack=inputs=${selected.length}:layout=${layout}:fill=white`,
  sheetPath,
]);

const manifestPath = path.join(outDir, `batch_${String(batch).padStart(5, "0")}.json`);
await fs.writeFile(manifestPath, `${JSON.stringify({
  batch,
  start,
  count: selected.length,
  columns,
  rows,
  tile_width: tileW,
  tile_height: tileH,
  sheet_path: sheetPath,
  tasks: selected.map((task, i) => ({ sheet_slot: i + 1, ...task })),
}, null, 2)}\n`, "utf8");
await fs.rm(tempDir, { recursive: true, force: true });

console.log(JSON.stringify({ batch, start, count: selected.length, sheet_path: sheetPath, manifest_path: manifestPath }, null, 2));
