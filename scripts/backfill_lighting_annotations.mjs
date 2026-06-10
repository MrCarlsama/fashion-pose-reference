import fs from "node:fs/promises";
import path from "node:path";
import { DATASET_ROOT } from "./fashion_tools.mjs";

const annotationsDir = path.join(DATASET_ROOT, "pose_annotations");
const files = [
  path.join(annotationsDir, "seed_annotations.jsonl"),
  path.join(annotationsDir, "builtin_preannotations.jsonl"),
];

const lightingBySha = {
  "7c042351173a9b205ecaf6ea0fa99ef67095cf64b366c21dd8d38ea8809c6f40": {
    distribution: "mixed_practical",
    direction: "front",
    contrast: "high",
    shadow_behavior_zh: "暖色灯泡和红色背景形成舞台式混合光，人物正面被弱光照亮，腿部和地面落入深阴影，背景上方灯点更亮。",
    pose_emotion_effect_zh: "强烈暖色背景和暗部压低人物情绪，让正面站姿不显开放，反而更冷静、疏离、有夜间舞台感。"
  },
  "c0bfd96244d114eb6817daffff72897f5e5f55ab614bcdb9e07e57747d813256": {
    distribution: "side_light",
    direction: "left",
    contrast: "high",
    shadow_behavior_zh: "暖色侧光从画面左侧打到脸和针织表面，另一侧脸、脖子和胸前进入深阴影，背景保持暗红。",
    pose_emotion_effect_zh: "侧光把抱臂姿势切成亮暗两面，加强防御、审视和冷淡的心理边界。"
  },
  "66d852d209663b51d0af8fb83ecb342d0edf03346d5808f0385a4beab48b9904": {
    distribution: "front_soft",
    direction: "front",
    contrast: "medium",
    shadow_behavior_zh: "正面偏软光均匀照亮脸、手和横杆，阴影主要藏在手臂内侧、座椅和衣服凹陷处。",
    pose_emotion_effect_zh: "平稳正面光让横杆和双臂结构清楚，强化机械、对称、被装置固定的控制感。"
  },
  "bc2dfdf859a996f31cf01e5510fcf2761a7bfc9c217226c8bc4a84f4e675d2f1": {
    distribution: "side_light",
    direction: "right",
    contrast: "high",
    shadow_behavior_zh: "强烈街头阳光从画面右侧照来，人物外套和手臂形成硬阴影，左侧街道区域大面积压黑。",
    pose_emotion_effect_zh: "硬光和高反差让行走动作更像抓拍，增强城市冷感、速度和疏离。"
  },
  "4d508a045ca678ebf888c54dd5f65c4a98058217649ab1695f7d9ee97db41146": {
    distribution: "spotlight",
    direction: "above",
    contrast: "high",
    shadow_behavior_zh: "局部强光落在额头、鼻梁和面部一侧，毛绒服装形成大块黑影，背景柔和发灰。",
    pose_emotion_effect_zh: "聚光和阴影把身体压缩成被观看的脸和肩颈，强化幽暗、脆弱、梦境般的内收情绪。"
  },
  "366d531fbbd109b519be20ee38b25099a37d7be9438e1764fd8db49eade0be46": {
    distribution: "front_soft",
    direction: "front",
    contrast: "low",
    shadow_behavior_zh: "浅色背景下的柔和正面光均匀覆盖人物，阴影很浅，主要在手臂、包和裙装褶皱内侧。",
    pose_emotion_effect_zh: "低反差柔光让一手叉腰一手拎包的姿势显得松弛、日常，减少攻击性，保留自信。"
  },
  "4d37fcf32674217f27142932f2e89629c6e7286775ffe31e08896ad3aec7cdcc": {
    distribution: "front_soft",
    direction: "front",
    contrast: "medium",
    shadow_behavior_zh: "黑白柔光从正面照亮身体轮廓，背景干净，阴影沿裤腿、腰侧和交叉手臂形成温和层次。",
    pose_emotion_effect_zh: "柔和黑白光强调身体曲线和宽站姿的雕塑感，让内省姿态显得优雅而非紧张。"
  },
  "63a5a53be5c8168a17a95b3105dd4ff45dece020a958ef7e37414dab138446c5": {
    distribution: "front_soft",
    direction: "front",
    contrast: "medium",
    shadow_behavior_zh: "均匀棚拍光照亮脸、肩背和手臂，阴影主要在身体侧面和背部挖空处，背景保持灰色。",
    pose_emotion_effect_zh: "柔光让侧身回头和低位交叠手臂更细腻，强化暧昧、保留和皮肤线条的安静张力。"
  },
  "aa993b1e7d74b6701d827ec0bd59ad9499921569c837f3c8394e0b05ee08ab4d": {
    distribution: "back_light",
    direction: "back",
    contrast: "high",
    shadow_behavior_zh: "橙色背景从后方和周围泛光，人物背部外套呈暗块，腿部和地面被暖色边缘光勾出。",
    pose_emotion_effect_zh: "背光让人物变成离场剪影，削弱面部信息，强化孤独、逃离和荒凉。"
  },
  "de839e4a9b6c36d8913a390a5ef5df08536cb2794884c0420fdacaafa84fa91c": {
    distribution: "even_soft",
    direction: "ambient",
    contrast: "medium",
    shadow_behavior_zh: "黑白室内环境光较均匀，门框和墙面有柔和阴影，人物手臂下方和衬衫褶皱形成轻微暗部。",
    pose_emotion_effect_zh: "均匀光让头后手和开肩动作更清楚，姿态显得平静、松弛、坦露。"
  },
  "64227c50774eb990f285dd21814bfef895d48b2be517f9b8d2186fd27aaa6a91": {
    distribution: "mixed_practical",
    direction: "front",
    contrast: "medium",
    shadow_behavior_zh: "游乐场自然光和环境反射混合，人物正面较均匀，桌面、外套和旋转木马下方有柔和阴影。",
    pose_emotion_effect_zh: "偏自然的混合光保留日常感，让托腮坐姿像真实等待而不是戏剧表演，强化无聊旁观。"
  },
  "b8ea7c5076cca5413194424e2fcd7011f40701556b7e9a743d5bf1d4311ffe30": {
    distribution: "spotlight",
    direction: "front",
    contrast: "high",
    shadow_behavior_zh: "帐篷内部暗，人物和圆台被较集中的正面暖光照亮，红色背景大面积暗下去。",
    pose_emotion_effect_zh: "聚光把人物从帐篷里推出来，配合圆台站姿形成被展示、被观看的舞台感。"
  },
  "21ab1a2c2312ec0ec1f3d8cb285abd8396b215038877bd25adb2b237faa21a9f": {
    distribution: "mixed_practical",
    direction: "front",
    contrast: "medium",
    shadow_behavior_zh: "游乐设施灯泡和环境光混合，人物脸部、座椅和腿部都有暖色反射，座椅内部和手臂下方较暗。",
    pose_emotion_effect_zh: "热闹灯光和人物出神托腮形成反差，让坐姿更显疲倦、抽离和等待。"
  },
  "3041534ec2ba11582728bc90197f7f8afa9dddd1e355634d34d06b5433d0cdb3": {
    distribution: "front_soft",
    direction: "front",
    contrast: "low",
    shadow_behavior_zh: "浅金背景下正面柔光均匀落在脸、颈和肩线，阴影很轻，头发后方略暗。",
    pose_emotion_effect_zh: "低反差柔光把近景回看处理得安静克制，减少攻击性，突出冷静注视。"
  },
  "df90cac069bfb079026c49a295c89d453e072ac5e0f1fcd9d4f7e412850bb46e": {
    distribution: "mixed_practical",
    direction: "front",
    contrast: "medium",
    shadow_behavior_zh: "户外游乐场环境光和招牌反射混合，人物脸部有柔光，身体和摊位下方有中等阴影。",
    pose_emotion_effect_zh: "复杂环境光让手扶头站姿有街头随性感，低头看镜头的挑衅不至于过分戏剧化。"
  },
  "a28fcadb763a6ce23be4aa6d2cf53b45504981fbf80820468943f82166b63e4c": {
    distribution: "side_light",
    direction: "left",
    contrast: "high",
    shadow_behavior_zh: "强侧光照亮脸部一侧和额头，另一侧脸与背景进入深阴影，肩部也被裁在暗处。",
    pose_emotion_effect_zh: "高反差侧光让头肩近景更有压迫感和神秘感，强化冷艳、警觉的直视。"
  }
};

async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

for (const file of files) {
  const rows = await readJsonl(file);
  let changed = 0;
  for (const row of rows) {
    const lighting = lightingBySha[row.image?.sha256];
    if (lighting && !row.lighting) {
      row.lighting = lighting;
      changed++;
    }
  }
  await fs.writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ file, changed, rows: rows.length }));
}
