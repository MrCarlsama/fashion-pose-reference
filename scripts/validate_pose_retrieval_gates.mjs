import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const generatorPath = fileURLToPath(new URL("./generate_pose_reference.mjs", import.meta.url));

function assert(condition, message) {
  if (!condition) {
    console.error(`Retrieval gate validation failed: ${message}`);
    process.exit(1);
  }
}

async function generate(args) {
  const { stdout } = await execFileAsync("node", [generatorPath, ...args], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

const joy = await generate([
  "--query", "兴奋 开心 头盔",
  "--person", "中性时装模特",
  "--limit", "1",
]);
assert(joy.retrieval_policy.emotion_profile?.id === "joy_release", "joy query should resolve to joy_release profile");
assert(joy.retrieval_policy.emotion_profile?.gate_used === true, "joy profile gate should be active");
assert(
  joy.matched_references[0]?.emotion_profile_signals?.includes("跃起/舞动/旋转"),
  "joy top result should contain dynamic body motion",
);
assert(
  /情绪硬约束：开心\/兴奋/.test(joy.stick_figure_prompt_zh || ""),
  "joy stick-figure prompt should carry the emotion body contract",
);
assert(
  /Emotion contract: joy or excitement/.test(joy.imagegen_prompt_en || "")
    && /dynamic release/.test(joy.imagegen_prompt_en || ""),
  "joy imagegen prompt should carry visible body mechanics, not just an emotion label",
);

const joyHandsOnHead = await generate([
  "--query", "兴奋 双手扶头 头盔",
  "--person", "中性时装模特",
  "--limit", "3",
]);
assert(
  joyHandsOnHead.retrieval_policy.hard_action_constraints?.gate_used === true,
  "hands-on-head joy query should still honor the hands-on-head hard action gate",
);
assert(
  joyHandsOnHead.retrieval_policy.hard_action_constraints?.labels_zh?.includes("双手护头/扶头")
    && !joyHandsOnHead.retrieval_policy.hard_action_constraints?.labels_zh?.includes("手扶头/护头"),
  "explicit both-hands-on-head queries should not be downgraded to generic one-hand head contact",
);
assert(
  !joyHandsOnHead.matched_references.some((item) => /腹前握住小包|王座椅坐姿/.test(item.action_reference_zh || "")),
  "hands-on-head hard action must not be satisfied by cross-field false positives",
);
assert(
  joyHandsOnHead.retrieval_policy.emotion_profile?.gate_used === false,
  "static or protective hands-on-head poses must not pass the joy/release emotion gate",
);
assert(
  joyHandsOnHead.generation_decision?.status === "hard_action_only_emotion_failed"
    && joyHandsOnHead.generation_decision?.imagegen_validation_allowed === false,
  "weak joy hard-action fallback should be blocked from final imagegen validation",
);
assert(
  joyHandsOnHead.stick_figure_prompt_zh === null
    && joyHandsOnHead.imagegen_prompt_en === null
    && /情绪门禁未通过/.test(joyHandsOnHead.fallback_structure_prompt_zh || ""),
  "weak joy hard-action fallback should expose only a diagnostic structure prompt, not final generation prompts",
);

const boredFullBody = await generate([
  "--query", "无聊 托腮 等待",
  "--person", "中性时装模特",
  "--limit", "1",
]);
assert(
  boredFullBody.retrieval_policy.hard_action_constraints?.gate_used === true,
  "chin-supported query should use hard action gate",
);
assert(
  boredFullBody.matched_references[0]?.hard_action_matched?.includes("托腮/手撑下巴"),
  "chin-supported query should return a chin-supported pose",
);
assert(
  boredFullBody.retrieval_policy.emotion_profile?.gate_used === true,
  "full-body chin-supported query should pass boredom/waiting emotion gate when contract-backed evidence exists",
);
assert(
  boredFullBody.matched_references[0]?.emotion_profile_has_contract === true
    && boredFullBody.matched_references[0]?.emotion_profile_contract_strength === "strong",
  "full-body chin-supported boredom match should be backed by a strong emotion contract",
);
assert(
  /Emotion contract: boredom or waiting/.test(boredFullBody.imagegen_prompt_en || ""),
  "boredom imagegen prompt should carry supported low-energy body mechanics",
);

const boredAny = await generate([
  "--query", "托腮 坐姿 无聊 游乐场",
  "--person", "中性时装模特",
  "--framing", "any",
  "--limit", "2",
]);
assert(
  boredAny.retrieval_policy.hard_action_constraints?.labels_zh?.includes("托腮/手撑下巴")
    && boredAny.retrieval_policy.hard_action_constraints?.labels_zh?.includes("坐姿"),
  "explicit chin-supported seated query should detect both hard constraints",
);
assert(boredAny.retrieval_policy.emotion_profile?.gate_used === true, "partial-capable bored query should pass emotion gate");

const joyWithCrossedArms = await generate([
  "--query", "兴奋 抱臂 全身",
  "--person", "中性时装模特",
  "--limit", "1",
]);
assert(
  joyWithCrossedArms.retrieval_policy.hard_action_constraints?.gate_used === true,
  "joy plus crossed-arms query should still honor the crossed-arms hard action",
);
assert(
  joyWithCrossedArms.matched_references[0]?.hard_action_matched?.includes("抱臂/手臂交叉"),
  "joy plus crossed-arms query should return a crossed-arms pose, not a bag-hug or leg-cross false positive",
);
assert(
  joyWithCrossedArms.retrieval_policy.emotion_profile?.gate_used === false,
  "closed crossed-arms poses should not pass the joy/release emotion gate",
);
assert(
  joyWithCrossedArms.matched_references[0]?.emotion_required_group_misses?.includes("dynamic_release")
    || joyWithCrossedArms.matched_references[0]?.emotion_profile_blocking_conflict === true,
  "joy plus crossed-arms fallback should expose missing release evidence or a blocking closed-body conflict",
);

const distress = await generate([
  "--query", "压抑 委屈 想哭 全身",
  "--person", "中性时装模特",
  "--limit", "1",
]);
assert(
  distress.retrieval_policy.emotion_profile?.id === "distress_vulnerability",
  "distress query should resolve to distress_vulnerability profile",
);
assert(distress.retrieval_policy.emotion_profile?.gate_used === true, "distress profile gate should be active");
assert(
  distress.matched_references[0]?.emotion_profile_signals?.includes("头颈低垂/避开")
    || distress.matched_references[0]?.emotion_profile_signals?.includes("肩胸收缩"),
  "distress top result should expose lowered/collapsed body evidence",
);
assert(
  /Emotion contract: distress or vulnerability/.test(distress.imagegen_prompt_en || "")
    && /lowered or averted head/.test(distress.imagegen_prompt_en || ""),
  "distress imagegen prompt should carry lowered/collapsed body mechanics",
);

const fear = await generate([
  "--query", "惊恐 警觉 后退 全身",
  "--person", "中性时装模特",
  "--limit", "1",
]);
assert(fear.retrieval_policy.emotion_profile?.id === "fear_recoil", "fear query should resolve to fear_recoil profile");
assert(
  fear.retrieval_policy.hard_action_constraints?.labels_zh?.includes("后退/退缩/后撤"),
  "fear retreat query should detect retreat as a hard action constraint",
);
assert(fear.retrieval_policy.emotion_profile?.gate_used === true, "fear/recoil emotion gate should be active");
assert(
  fear.matched_references[0]?.emotion_profile_signals?.includes("后撤/躲避动势"),
  "fear top result should contain retreat/avoidance body evidence",
);
assert(
  !/逼近|爬伏|挑衅/.test(fear.matched_references[0]?.action_reference_zh || ""),
  "fear retreat query must not return an attacking/approaching crawl as the top pose",
);
assert(
  /Emotion contract: fear or recoil/.test(fear.imagegen_prompt_en || "")
    && /backward weight shift/.test(fear.imagegen_prompt_en || ""),
  "fear imagegen prompt should carry retreat/recoil body mechanics",
);

console.log(JSON.stringify({
  ok: true,
  validated_queries: [
    "兴奋 开心 头盔",
    "兴奋 双手扶头 头盔",
    "无聊 托腮 等待",
    "托腮 坐姿 无聊 游乐场 --framing any",
    "兴奋 抱臂 全身",
    "压抑 委屈 想哭 全身",
    "惊恐 警觉 后退 全身",
  ],
}, null, 2));
