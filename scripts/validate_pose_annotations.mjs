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
const builtinBatchDir = path.join(annotationsDir, "builtin_preannotation_batches");
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

const requireEmotionSemanticsFilePattern = args.get("require-emotion-semantics-file-pattern")
  ? new RegExp(args.get("require-emotion-semantics-file-pattern"))
  : null;
const requireEmotionContractFilePattern = args.get("require-emotion-contract-file-pattern")
  ? new RegExp(args.get("require-emotion-contract-file-pattern"))
  : null;
const requireSchemaEnumsFilePattern = args.get("require-schema-enums-file-pattern")
  ? new RegExp(args.get("require-schema-enums-file-pattern"))
  : null;

const schemaEnums = [
  ["annotation_status", (row) => row.annotation_status, new Set(["seed_manual", "manual", "vision_model", "builtin_multimodal_preannotation", "non_model_detail", "needs_review"])],
  ["pose.body_count", (row) => row.pose?.body_count, new Set(["none", "single", "pair", "group"])],
  ["pose.framing", (row) => row.pose?.framing, new Set(["full_body", "three_quarter", "half_body", "close_up", "cropped_detail"])],
  ["pose.support", (row) => row.pose?.support, new Set(["standing", "sitting", "walking", "leaning", "kneeling", "lying", "back_view", "unknown"])],
  ["pose.orientation", (row) => row.pose?.orientation, new Set(["front", "three_quarter", "profile", "back", "twisted", "top_down_face", "unknown"])],
  ["pose.camera_angle", (row) => row.pose?.camera_angle, new Set(["eye_level", "slight_low_angle", "low_angle", "slight_high_angle", "high_angle", "top_down", "tilted"])],
  ["pose.movement_state", (row) => row.pose?.movement_state, new Set(["still", "walking", "leaving", "held_by_prop", "turning", "reaching", "unknown"])],
  ["lighting.distribution", (row) => row.lighting?.distribution, new Set(["even_soft", "front_soft", "side_light", "back_light", "top_light", "low_key", "high_key", "mixed_practical", "spotlight", "unknown"])],
  ["lighting.direction", (row) => row.lighting?.direction, new Set(["front", "left", "right", "above", "below", "back", "ambient", "mixed", "unknown"])],
  ["lighting.contrast", (row) => row.lighting?.contrast, new Set(["low", "medium", "high"])],
];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function shouldRequireEmotionSemantics(item) {
  if (!requireEmotionSemanticsFilePattern) return false;
  return requireEmotionSemanticsFilePattern.test(path.basename(item.file));
}

function shouldRequireEmotionContract(item) {
  if (!requireEmotionContractFilePattern) return false;
  return requireEmotionContractFilePattern.test(path.basename(item.file));
}

function shouldRequireSchemaEnums(item) {
  if (!requireSchemaEnumsFilePattern) return false;
  return requireSchemaEnumsFilePattern.test(path.basename(item.file));
}

function emotionSemanticsMissingFields(row) {
  const missing = [];
  const semantics = row.emotion_semantics;
  if (!semantics) return ["emotion_semantics"];
  const checks = [
    ["emotion_semantics.affect_vector", semantics.affect_vector],
    ["emotion_semantics.body_signal_vector", semantics.body_signal_vector],
    ["emotion_semantics.lighting_signal_vector", semantics.lighting_signal_vector],
  ];
  for (const [name, value] of checks) {
    if (!value || typeof value !== "object") missing.push(name);
  }
  if (!Array.isArray(semantics.evidence_zh) || semantics.evidence_zh.length === 0) missing.push("emotion_semantics.evidence_zh");
  if (!Array.isArray(semantics.conflicts_zh)) missing.push("emotion_semantics.conflicts_zh");
  const bodySignals = ["openness", "head", "shoulders", "spine", "hands", "pelvis_weight", "legs_feet", "movement_energy", "camera_distance"];
  for (const key of bodySignals) {
    if (!hasOwn(semantics.body_signal_vector, key)) missing.push(`emotion_semantics.body_signal_vector.${key}`);
  }
  const lightingSignals = ["brightness_zone", "shadow_weight", "direction", "contrast", "emotion_effect"];
  for (const key of lightingSignals) {
    if (!hasOwn(semantics.lighting_signal_vector, key)) missing.push(`emotion_semantics.lighting_signal_vector.${key}`);
  }
  return missing;
}

function emotionContractMissingFields(row) {
  const missing = [];
  const contract = row.emotion_contract;
  if (!contract) return ["emotion_contract"];
  if (!Array.isArray(contract.candidate_emotions) || contract.candidate_emotions.length === 0) {
    missing.push("emotion_contract.candidate_emotions");
  }
  if (!["strong", "partial", "weak", "reject"].includes(contract.strength)) {
    missing.push("emotion_contract.strength");
  }
  if (!contract.visible_evidence || typeof contract.visible_evidence !== "object") {
    missing.push("emotion_contract.visible_evidence");
  } else {
    const evidenceGroups = [
      "face_gaze",
      "head_neck",
      "shoulders_chest",
      "arms_hands",
      "pelvis_weight",
      "legs_feet",
      "movement_energy",
      "lighting_distribution",
      "camera_space",
    ];
    for (const key of evidenceGroups) {
      if (!hasOwn(contract.visible_evidence, key)) missing.push(`emotion_contract.visible_evidence.${key}`);
    }
  }
  if (!Array.isArray(contract.missing_evidence)) missing.push("emotion_contract.missing_evidence");
  if (!Array.isArray(contract.conflicts)) missing.push("emotion_contract.conflicts");
  if (!Array.isArray(contract.reject_emotions)) missing.push("emotion_contract.reject_emotions");
  return missing;
}

function schemaEnumMissingFields(row) {
  const missing = [];
  for (const [name, getValue, allowed] of schemaEnums) {
    const value = getValue(row);
    if (!value) {
      missing.push(name);
    } else if (!allowed.has(value)) {
      missing.push(`${name}=${value}`);
    }
  }
  return missing;
}

function missingFields(item) {
  const row = item.value;
  const missing = [];
  const checks = [
    ["annotation_version", row.annotation_version],
    ["annotation_status", row.annotation_status],
    ["image.sha256", row.image?.sha256],
    ["image.local_path", row.image?.local_path],
    ["pose.body_description_zh", row.pose?.body_description_zh],
    ["pose.skeleton_notes_zh", row.pose?.skeleton_notes_zh],
    ["pose.props_and_environment_zh", row.pose?.props_and_environment_zh],
    ["lighting.distribution", row.lighting?.distribution],
    ["lighting.distribution_notes_zh", row.lighting?.distribution_notes_zh],
    ["lighting.direction", row.lighting?.direction],
    ["lighting.contrast", row.lighting?.contrast],
    ["lighting.shadow_behavior_zh", row.lighting?.shadow_behavior_zh],
    ["lighting.pose_emotion_effect_zh", row.lighting?.pose_emotion_effect_zh],
    ["emotion.primary_zh", row.emotion?.primary_zh],
    ["emotion.action_match_zh", row.emotion?.action_match_zh],
    ["reference_outputs.action_reference_zh", row.reference_outputs?.action_reference_zh],
    ["reference_outputs.stick_figure_prompt_zh", row.reference_outputs?.stick_figure_prompt_zh],
    ["reference_outputs.imagegen_prompt_en", row.reference_outputs?.imagegen_prompt_en],
    ["retrieval.action_tags", row.retrieval?.action_tags?.length],
    ["retrieval.emotion_tags", row.retrieval?.emotion_tags?.length],
    ["retrieval.lighting_tags", row.retrieval?.lighting_tags?.length],
  ];
  for (const [name, value] of checks) {
    if (!value) missing.push(name);
  }
  if (shouldRequireEmotionSemantics(item)) {
    missing.push(...emotionSemanticsMissingFields(row));
  }
  if (shouldRequireEmotionContract(item)) {
    missing.push(...emotionContractMissingFields(row));
  }
  if (shouldRequireSchemaEnums(item)) {
    missing.push(...schemaEnumMissingFields(row));
  }
  return missing;
}

const manifestRows = await loadRows();
const manifestShas = new Set(manifestRows.map((row) => row.sha256));
const annotationFiles = [...baseAnnotationFiles, ...await listJsonlFiles(builtinBatchDir)];
const annotationRows = (await Promise.all(annotationFiles.map(readJsonl))).flat();
const seen = new Map();
const duplicateShas = [];
const unknownShas = [];
const incompleteRows = [];
let nonModelDetailRows = 0;
let poseReferenceRows = 0;

for (const item of annotationRows) {
  const row = item.value;
  const sha = row.image?.sha256;
  if (!sha || !manifestShas.has(sha)) unknownShas.push({ file: item.file, line: item.line, sha });
  if (sha && seen.has(sha)) duplicateShas.push({ sha, first: seen.get(sha), duplicate: { file: item.file, line: item.line } });
  if (sha) seen.set(sha, { file: item.file, line: item.line });
  if (row.annotation_status === "non_model_detail" || row.pose?.body_count === "none") nonModelDetailRows++;
  else poseReferenceRows++;
  const missing = missingFields(item);
  if (missing.length) incompleteRows.push({ file: item.file, line: item.line, sha, missing });
}

const report = {
  manifest_rows: manifestRows.length,
  annotation_rows: annotationRows.length,
  unique_annotated_images: seen.size,
  full_corpus_complete: seen.size === manifestRows.length,
  usable_pose_reference_rows: poseReferenceRows,
  non_model_detail_rows: nonModelDetailRows,
  pending_images: manifestRows.length - seen.size,
  duplicate_annotation_shas: duplicateShas.length,
  unknown_annotation_shas: unknownShas.length,
  incomplete_annotation_rows: incompleteRows.length,
  annotation_files: annotationFiles,
};

console.log(JSON.stringify(report, null, 2));
if (duplicateShas.length || unknownShas.length || incompleteRows.length || (args.get("fail-if-incomplete") === "true" && report.pending_images > 0)) {
  console.error(JSON.stringify({ duplicateShas, unknownShas, incompleteRows: incompleteRows.slice(0, 20) }, null, 2));
  process.exit(2);
}
