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
const query = [args.get("query"), args.get("emotion"), args.get("action")]
  .filter(Boolean)
  .join(" ")
  .trim();
const person = args.get("person") || "单人角色";
const personEn = args.get("person-en") || englishPerson(person);
const limit = args.has("limit") ? Number(args.get("limit")) : 3;
const targetCount = args.has("target") ? Number(args.get("target")) : await defaultTargetCount();
const targetFile = path.resolve(args.get("target-file") || path.join(annotationsDir, "target_1000_diverse.jsonl"));
const requestedFraming = args.get("framing") || "";
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

async function defaultTargetCount() {
  const summaryPath = path.join(annotationsDir, "target_1000_diverse.summary.json");
  try {
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    return Number(summary.target_images_requested) || 1000;
  } catch (error) {
    if (error.code === "ENOENT") return 1000;
    throw error;
  }
}

const synonymMap = new Map([
  ["孤独", ["孤独", "离场", "背影", "荒凉", "逃离", "疲惫"]],
  ["压抑", ["压抑", "低落", "沉重", "疲惫", "自闭", "低头", "收缩", "阴影"]],
  ["委屈", ["委屈", "想哭", "脆弱", "难过", "低头", "收缩", "手靠脸", "手遮脸"]],
  ["想哭", ["想哭", "委屈", "脆弱", "难过", "低头", "手靠脸", "手遮脸", "眼部遮挡"]],
  ["惊恐", ["惊恐", "恐惧", "害怕", "后退", "退缩", "护脸", "护胸", "警觉", "僵住"]],
  ["害怕", ["害怕", "惊恐", "恐惧", "后退", "退缩", "护脸", "护胸", "躲避"]],
  ["后退", ["后退", "后撤", "退缩", "躲避", "重心后移", "后仰", "退让"]],
  ["兴奋", ["兴奋", "开心", "外放", "释放", "跳跃", "腾空", "舞动", "张扬", "大笑", "玩乐"]],
  ["开心", ["开心", "兴奋", "外放", "释放", "轻快", "玩乐", "大笑", "张扬"]],
  ["头盔", ["头盔", "护具", "helmet"]],
  ["冷", ["冷静", "冷淡", "疏离", "克制", "审视", "城市冷感"]],
  ["防御", ["防御", "抱臂", "交叉", "封闭", "克制"]],
  ["坐", ["坐姿", "seated", "sitting", "椅子", "坐"]],
  ["站", ["站姿", "standing", "站立", "全身"]],
  ["走", ["行走", "walking", "离开", "leaving", "步态"]],
  ["回头", ["回头", "回望", "over shoulder", "twisted", "扭转"]],
  ["优雅", ["优雅", "雕塑", "内省", "S 形", "wide stance"]],
  ["俯拍", ["高机位", "俯视", "high angle", "top down"]],
  ["仰拍", ["低机位", "low angle"]],
  ["侧光", ["侧光", "side_light", "硬阴影", "明暗切割"]],
  ["逆光", ["逆光", "back_light", "轮廓光", "剪影"]],
  ["顶光", ["顶光", "top_light", "上方来光"]],
  ["柔光", ["柔光", "front_soft", "even_soft", "低反差"]],
  ["硬光", ["硬光", "硬阴影", "高反差", "side_light", "spotlight"]],
  ["聚光", ["聚光", "spotlight", "舞台光"]],
  ["高反差", ["高反差", "high contrast", "contrast high", "硬阴影"]],
  ["低反差", ["低反差", "low contrast", "soft light", "柔光"]],
]);

const emotionProfiles = [
  {
    id: "joy_release",
    label_zh: "开心/兴奋/释放",
    triggers: ["开心", "兴奋", "喜悦", "快乐", "外放", "释放", "张扬", "轻快", "雀跃", "自由", "玩乐", "派对", "大笑", "舞动"],
    minimum_score: 14,
    affect_vector: { valence: 3, arousal: 4, control: 2, tension: 1, social_distance: 1, vulnerability: 0 },
    body_signal_vector: ["open_limbs", "expanded_chest", "unstable_weight", "jump_spin_or_dance"],
    lighting_signal_vector: ["high_key_or_stage_light"],
    positive: [
      { label: "肢体打开", weight: 12, pattern: /双臂[^。,.]*(外展|张开|打开|上举|高举|伸展|抬起)|arms?[^.]*?(wide|open|raised|extend)|大\s*v|胸腔[^。,.]*(打开|开放)|开肩|宽站|wide stance|外放|张扬/iu },
      { label: "跃起/舞动/旋转", weight: 14, pattern: /跳跃|跃起|腾空|离地|舞动|旋转|dynamic\s+jump|\bairborne\b|\bspins?\b|\bspinning\b|身体[^。,.]*(甩|飞)|头发[^。,.]*(甩|飞)|腿[^。,.]*(踢|甩)|手臂[^。,.]*(甩|挥)/iu },
      { label: "不稳定动势", weight: 10, pattern: /重心[^。,.]*(偏|移|前|后|低)|脚位不稳定|不稳定|一腿[^。,.]*(抬|伸|屈|踢)|非对称|asymmetrical|失控|轻盈/iu },
      { label: "明亮或舞台光", weight: 6, pattern: /高调|high_key|明亮|正面柔光|聚光|spotlight|派对|镜球/iu },
    ],
    negative: [
      { label: "封闭防御", weight: -14, pattern: /抱臂|交叉手臂|arms crossed|封闭|内收|防御/iu },
      { label: "低垂离场", weight: -10, pattern: /背影|离场|低垂|孤独|疲惫|圆拱|back view|leaving/iu },
      { label: "局部裁切", weight: -12, pattern: /close_up|half_body|cropped_detail|只画到胸|近景|头肩/iu },
    ],
  },
  {
    id: "lonely_withdrawal",
    label_zh: "孤独/离场/抽离",
    triggers: ["孤独", "离场", "背影", "逃离", "疲惫", "荒凉", "疏离", "沉静", "漂流", "远行", "失落"],
    minimum_score: 14,
    affect_vector: { valence: -3, arousal: 1, control: 1, tension: 2, social_distance: 5, vulnerability: 2 },
    body_signal_vector: ["back_or_leaving", "lowered_head", "collapsed_shoulders", "small_body_in_space"],
    lighting_signal_vector: ["back_light_or_silhouette"],
    positive: [
      { label: "背向或离开", weight: 14, pattern: /背影|背对|离场|走开|离开|远行|逃离|back view|leaving/iu },
      { label: "身体收缩低垂", weight: 10, pattern: /头[^。,.]*(低|垂)|低头|肩[^。,.]*(圆|塌|低|收)|圆拱|双臂[^。,.]*(下垂|垂落|自然垂)|arms down|低垂/iu },
      { label: "人物被环境压小", weight: 8, pattern: /远景|小小|空背景|大面积空|海滩|荒凉|脚印|footprints|distant figure/iu },
      { label: "逆光剪影", weight: 8, pattern: /逆光|背光|剪影|轮廓光|back_light|低调|high contrast/iu },
    ],
    negative: [
      { label: "外放快乐动势", weight: -14, pattern: /跳跃|腾空|双臂[^。,.]*(外展|张开|打开)|大\s*v|开心|大笑|派对/iu },
      { label: "正面展示", weight: -6, pattern: /正面[^。,.]*(展示|直视)|front display|wide stance/iu },
    ],
  },
  {
    id: "distress_vulnerability",
    label_zh: "压抑/委屈/想哭",
    triggers: ["压抑", "委屈", "想哭", "脆弱", "难过", "伤心", "低落", "自闭", "羞耻", "崩溃"],
    minimum_score: 16,
    affect_vector: { valence: -4, arousal: 2, control: 1, tension: 3, social_distance: 3, vulnerability: 5 },
    body_signal_vector: ["lowered_or_averted_head", "rounded_shoulders", "collapsed_chest", "hands_near_face_or_hidden", "low_energy_support"],
    lighting_signal_vector: ["shadow_weight_on_face_or_torso", "low_key_or_side_light"],
    positive: [
      { label: "头颈低垂/避开", weight: 10, pattern: /低头|头[^。,.]*(低|垂|偏|避|埋)|下巴[^。,.]*(收|压)|看地|垂眼|避开|不看镜头|head[^.]*?(bowed|lowered|averted)/iu },
      { label: "肩胸收缩", weight: 10, pattern: /肩[^。,.]*(圆|塌|低|收|内扣|前卷|下沉)|胸[^。,.]*(塌|收|压|缩)|脊柱[^。,.]*(前弯|弯曲|圆拱)|身体[^。,.]*(缩|蜷|低)|rounded shoulders|collapsed chest/iu },
      { label: "手部靠脸或藏起", weight: 10, pattern: /托腮|扶脸|手[^。,.]*(脸|嘴|眼|太阳穴|额|胸|口袋|藏|遮|捂)|hands?[^.]*?(face|hidden|cover|pocket|chest)/iu },
      { label: "低能量支撑", weight: 8, pattern: /疲惫|压抑|委屈|脆弱|静止|倦|孤立|自闭|低位|坐|靠|倚|still|leaning|sitting/iu },
      { label: "阴影压低情绪", weight: 6, pattern: /低调|low_key|高反差|阴影|暗部|侧光|聚光|shadow|spotlight/iu },
    ],
    negative: [
      { label: "外放打开", weight: -14, pattern: /跳跃|腾空|双臂[^。,.]*(外展|张开|打开|高举)|大\s*v|开心|大笑|派对|open limbs|airborne/iu },
      { label: "强势对峙", weight: -8, pattern: /挑衅|支配|强势|宽站|直视镜头|对峙|wide stance|confrontation/iu },
    ],
  },
  {
    id: "fear_recoil",
    label_zh: "惊恐/害怕/后撤",
    triggers: ["惊恐", "恐惧", "害怕", "惊慌", "慌张", "后退", "退缩", "躲避", "戒备", "警觉"],
    minimum_score: 18,
    affect_vector: { valence: -5, arousal: 5, control: 0, tension: 5, social_distance: 4, vulnerability: 3 },
    body_signal_vector: ["back_shift_or_retreat", "guard_face_chest_or_head", "raised_or_tense_shoulders", "unstable_retreat_step", "freeze_or_recoil"],
    lighting_signal_vector: ["hard_shadow_or_side_top_light"],
    positive: [
      { label: "后撤/躲避动势", weight: 14, pattern: /后退|后撤|退缩|躲避|避开|退让|重心[^。,.]*(后移|后撤|远离)|身体[^。,.]*(后仰|撤离)|躯干[^。,.]*(后仰|后撤)|back\s*(step|shift)|recoil|retreat/iu },
      { label: "护头护脸护胸", weight: 12, pattern: /手[^。,.]{0,12}(护|挡|遮|捂|扶)[^。,.]{0,12}(头|脸|眼|嘴|胸口)|双手[^。,.]{0,16}(护头|护脸|护胸|挡脸|捂脸|遮脸)|protecting head|hands on head|guard(ing)? (face|chest|head)|cover(ing)? (face|chest|head)/iu },
      { label: "高张力肩颈", weight: 10, pattern: /肩[^。,.]*(耸|上提|紧|收|内扣)|颈[^。,.]*(缩|紧)|身体[^。,.]*(僵|紧)|警觉|戒备|tense|stiff|freeze/iu },
      { label: "不稳定退让脚位", weight: 8, pattern: /退步|后退步|脚[^。,.]{0,12}(后撤|后退)|后脚[^。,.]{0,12}(撤|退)|重心[^。,.]*(后移|后撤)|unstable retreat/iu },
      { label: "危险感光线", weight: 6, pattern: /高反差|硬阴影|侧光|顶光|低调|spotlight|shadow|hard light/iu },
    ],
    negative: [
      { label: "平静离场或商品展示", weight: -12, pattern: /提箱|都市疏离|独自离场|仪式|静态展示|手插袋|walking with suitcase|hand in pocket/iu },
      { label: "松弛低能量", weight: -8, pattern: /松弛|慵懒|平静|从容|优雅|放松|relaxed|calm/iu },
      { label: "逼近/攻击而非后撤", weight: -24, pattern: /逼近|向前|攻击|挑衅|爬伏|撑地|forward|confrontational|powerful/iu },
    ],
  },
  {
    id: "defensive_cool",
    label_zh: "冷淡/防御/克制",
    triggers: ["冷淡", "防御", "抱臂", "克制", "疏离", "冷峻", "封闭", "警觉", "对峙", "审视"],
    minimum_score: 14,
    affect_vector: { valence: -2, arousal: 2, control: 4, tension: 4, social_distance: 4, vulnerability: 1 },
    body_signal_vector: ["crossed_or_hidden_arms", "closed_upper_body", "direct_or_averted_rejecting_gaze"],
    lighting_signal_vector: ["cutting_side_light_or_high_contrast"],
    positive: [
      { label: "抱臂或交叉", weight: 16, pattern: /抱臂|交叉|arms crossed|crossed arms|手臂[^。,.]*胸/iu },
      { label: "上身封闭", weight: 10, pattern: /肩[^。,.]*(内收|压低|收)|封闭|克制|窄距|narrow stance|双手隐藏|hands hidden/iu },
      { label: "目光拒绝交流", weight: 8, pattern: /直视|凝视|审视|头[^。,.]*(转向|偏离)|direct gaze|turned away|不与镜头/iu },
      { label: "切割式光线", weight: 8, pattern: /侧光|高反差|硬阴影|side_light|low_key|一明一暗/iu },
    ],
    negative: [
      { label: "外放跳跃", weight: -14, pattern: /跳跃|腾空|大\s*v|双臂[^。,.]*(外展|张开|打开)|开心|大笑|高调光/iu },
    ],
  },
  {
    id: "calm_elegant",
    label_zh: "平静/优雅/内省",
    triggers: ["优雅", "平静", "内省", "安静", "松弛", "从容", "雕塑", "温柔"],
    minimum_score: 12,
    affect_vector: { valence: 1, arousal: 1, control: 4, tension: 1, social_distance: 2, vulnerability: 1 },
    body_signal_vector: ["long_body_line", "stable_weight", "slow_stillness"],
    lighting_signal_vector: ["soft_low_contrast_light"],
    positive: [
      { label: "长线条身体", weight: 10, pattern: /s\s*形|s 形|脊柱[^。,.]*(拉长|弯|曲|直立)|颈部拉长|长线条|雕塑/iu },
      { label: "稳定慢动作", weight: 8, pattern: /still|站姿|坐姿|平衡|稳定|松弛|安静|缓慢|从容/iu },
      { label: "柔和低反差", weight: 8, pattern: /柔光|低反差|even_soft|front_soft|自然光|黑白柔光/iu },
    ],
    negative: [
      { label: "失控动势", weight: -10, pattern: /跳跃|腾空|失控|高反差硬光|防御/iu },
    ],
  },
  {
    id: "bored_waiting",
    label_zh: "无聊/等待/倦怠",
    triggers: ["无聊", "等待", "疲倦", "抽离", "旁观", "倦怠", "发呆"],
    minimum_score: 18,
    affect_vector: { valence: -1, arousal: 1, control: 2, tension: 1, social_distance: 3, vulnerability: 1 },
    body_signal_vector: ["supported_body", "lowered_energy", "leaning_or_sitting"],
    lighting_signal_vector: ["everyday_ambient_or_low_contrast_light"],
    positive: [
      { label: "支撑身体", weight: 12, pattern: /托腮|撑|倚|靠|坐|桌|椅|chin|sitting|leaning/iu },
      { label: "能量下沉", weight: 10, pattern: /低头|前倾|肩[^。,.]*(塌|低)|出神|疲倦|等待|无聊|抽离/iu },
      { label: "日常环境光", weight: 6, pattern: /环境光|自然光|混合现场光|mixed_practical|低反差/iu },
    ],
    negative: [
      { label: "外放表演", weight: -12, pattern: /跳跃|腾空|开心|大笑|派对|大\s*v/iu },
    ],
  },
];

const structuredEmotionContracts = new Map([
  ["joy_release", {
    positive: [
      { label: "结构化肢体打开", weight: 10, pattern: /openness:[^ ]*(open|wide|expanded)|shoulders:[^ ]*(open|raised)|hands:[^ ]*(open|spread|raised)|legs_feet:[^ ]*(stride|jump|airborne|wide)|movement_energy:[^ ]*(high|jump|dance|running|dynamic)|arousal:[45]/iu },
      { label: "结构化跃起/释放动能", weight: 12, pattern: /movement_energy:[^ ]*(high|jump|airborne|dance|spin|running|release)|legs_feet:[^ ]*(airborne|stride|extended|open)|spine:[^ ]*(back|arch|dynamic|side)/iu },
      { label: "结构化明亮光线", weight: 6, pattern: /distribution:high_key|brightness_zone:[^ ]*(bright|high|stage|sky|white)|emotion_effect:[^ ]*(free|release|light|bright|joy|兴奋|释放|自由)/iu },
    ],
    negative: [
      { label: "结构化封闭/低能量冲突", weight: -16, pattern: /openness:[^ ]*(closed|semi_closed|defensive)|hands:[^ ]*(crossed|hidden|pocket)|movement_energy:[^ ]*(still|low|none)|head:[^ ]*(lowered|hidden|down)|body_count:none/iu },
      { label: "结构化局部裁切冲突", weight: -10, pattern: /camera_distance:[^ ]*(half|cropped|close)|framing:(half_body|close_up|cropped_detail)/iu },
    ],
  }],
  ["lonely_withdrawal", {
    positive: [
      { label: "结构化背离/远离", weight: 12, pattern: /orientation:back|support:back_view|head:[^ ]*(away|hidden|back)|movement_energy:[^ ]*(leaving|walking|still)|social_distance:[45]/iu },
      { label: "结构化小比例空间距离", weight: 8, pattern: /camera_distance:[^ ]*(wide|distant|full)|emotion_effect:[^ ]*(solitary|isolation|lonely|疏离|孤独|远行)/iu },
      { label: "结构化逆光疏离", weight: 8, pattern: /distribution:back_light|direction:back|contrast:high|shadow_weight:[^ ]*(heavy|dark)/iu },
    ],
    negative: [
      { label: "结构化外放快乐冲突", weight: -14, pattern: /openness:[^ ]*(open|wide)|movement_energy:[^ ]*(high|jump|dance|running)|valence:[3-5]/iu },
      { label: "结构化强正面展示冲突", weight: -8, pattern: /orientation:front|hands:[^ ]*(hip)|control:[45]/iu },
    ],
  }],
  ["distress_vulnerability", {
    positive: [
      { label: "结构化头颈低垂/遮蔽", weight: 12, pattern: /head:[^ ]*(lowered|down|hidden|obscured|averted|face_hidden|遮|低|埋)|vulnerability:[45]/iu },
      { label: "结构化肩胸收缩", weight: 10, pattern: /shoulders:[^ ]*(rounded|collapsed|closed|obscured|low|内|塌)|spine:[^ ]*(curved|forward|collapsed)|openness:[^ ]*(closed|hidden|obscured)/iu },
      { label: "结构化手靠脸/藏手", weight: 10, pattern: /hands:[^ ]*(face|hidden|cover|cheek|chest|pocket|手|脸|藏|遮)/iu },
      { label: "结构化暗部压迫", weight: 6, pattern: /shadow_weight:[^ ]*(heavy|dark|medium)|distribution:(low_key|side_light|spotlight|back_light)|contrast:high/iu },
    ],
    negative: [
      { label: "结构化外放动能冲突", weight: -16, pattern: /movement_energy:[^ ]*(high|jump|running|dance)|openness:[^ ]*(wide|open_stride|open_arms)|valence:[3-5]/iu },
      { label: "结构化强控制冲突", weight: -8, pattern: /control:[45]|hands:[^ ]*(hip)|legs_feet:[^ ]*(wide|grounded|stable)/iu },
    ],
  }],
  ["fear_recoil", {
    positive: [
      { label: "结构化后撤/避让", weight: 14, pattern: /movement_energy:[^ ]*(recoil|retreat|back|avoid)|spine:[^ ]*(back|away)|pelvis_weight:[^ ]*(back|retreat|后)|legs_feet:[^ ]*(back|retreat|unstable)/iu },
      { label: "结构化护脸护胸", weight: 12, pattern: /hands:[^ ]*(guard|protect|cover|face|head|chest|护|挡|遮)/iu },
      { label: "结构化高张力", weight: 10, pattern: /tension:[45]|arousal:[45]|shoulders:[^ ]*(raised|tense|closed|tight)|movement_energy:[^ ]*(freeze|tense)/iu },
      { label: "结构化危险光线", weight: 6, pattern: /contrast:high|distribution:(side_light|top_light|low_key|spotlight)|shadow_weight:[^ ]*(heavy|hard|dark)/iu },
    ],
    negative: [
      { label: "结构化逼近/攻击冲突", weight: -24, pattern: /movement_energy:[^ ]*(forward_drive|attack|approach)|spine:[^ ]*forward_leaning|pelvis_weight:[^ ]*rotated_forward|hands:[^ ]*(hip|pocket)/iu },
      { label: "结构化松弛低能量冲突", weight: -10, pattern: /movement_energy:[^ ]*(still|light|relaxed|low)|tension:[01]|control:[45]/iu },
    ],
  }],
  ["defensive_cool", {
    positive: [
      { label: "结构化手臂封闭/藏手", weight: 14, pattern: /hands:[^ ]*(crossed|hidden|pocket|behind|hip|藏|口袋)|openness:[^ ]*(closed|semi_closed|defensive|侧向关闭)/iu },
      { label: "结构化控制距离", weight: 10, pattern: /control:[45]|social_distance:[45]|head:[^ ]*(direct|away|回望|直视)|shoulders:[^ ]*(raised|level|broad|closed)/iu },
      { label: "结构化冷硬光线", weight: 8, pattern: /contrast:(medium|high)|distribution:(side_light|low_key|back_light)|emotion_effect:[^ ]*(controlled|scrutiny|cold|distance|克制|冷|审视)/iu },
    ],
    negative: [
      { label: "结构化快乐外放冲突", weight: -14, pattern: /movement_energy:[^ ]*(high|jump|dance)|openness:[^ ]*(open_arms|wide|open_stride)|valence:[3-5]/iu },
    ],
  }],
  ["calm_elegant", {
    positive: [
      { label: "结构化长线条/稳定", weight: 10, pattern: /spine:[^ ]*(upright|long|vertical|slight|arched)|head:[^ ]*(lifted|long|calm)|movement_energy:[^ ]*(still|slow|light|walking)/iu },
      { label: "结构化低张力", weight: 8, pattern: /tension:[01]|arousal:[01]|shadow_weight:[^ ]*(soft|light)|contrast:low|distribution:(even_soft|front_soft|high_key)/iu },
      { label: "结构化平衡控制", weight: 6, pattern: /control:[34]|legs_feet:[^ ]*(stable|together|grounded|balanced)|pelvis_weight:[^ ]*(centered|stable)/iu },
    ],
    negative: [
      { label: "结构化失控/强防御冲突", weight: -10, pattern: /movement_energy:[^ ]*(high|running|jump|attack)|tension:[45]|hands:[^ ]*(guard|protect|crossed)/iu },
    ],
  }],
  ["bored_waiting", {
    positive: [
      { label: "结构化支撑/倚靠", weight: 12, pattern: /support:(sitting|leaning)|hands:[^ ]*(chin|face|support|cheek)|pelvis_weight:[^ ]*(seated|supported)|camera_distance:[^ ]*(half|close)/iu },
      { label: "结构化低能量等待", weight: 10, pattern: /movement_energy:[^ ]*(still|low|none)|arousal:[01]|head:[^ ]*(lowered|averted|down|hidden)|shoulders:[^ ]*(low|slumped|relaxed)/iu },
      { label: "结构化日常低反差光", weight: 6, pattern: /contrast:low|distribution:(even_soft|front_soft|mixed_practical)|direction:(ambient|front|mixed)/iu },
    ],
    negative: [
      { label: "结构化外放表演冲突", weight: -12, pattern: /movement_energy:[^ ]*(high|jump|running|dance)|openness:[^ ]*(wide|open_arms|open_stride)|valence:[3-5]/iu },
    ],
  }],
]);

const emotionRequiredSignalGroups = new Map([
  ["joy_release", [
    { id: "open_body", labels: ["结构化肢体打开", "肢体打开"] },
    { id: "dynamic_release", labels: ["结构化跃起/释放动能", "跃起/舞动/旋转"] },
  ]],
  ["lonely_withdrawal", [
    { id: "withdrawal_or_space", labels: ["结构化背离/远离", "背向或离开", "人物被环境压小"] },
  ]],
  ["distress_vulnerability", [
    { id: "collapsed_or_hidden", labels: ["结构化头颈低垂/遮蔽", "结构化肩胸收缩", "头颈低垂/避开", "肩胸收缩", "手部靠脸或藏起"] },
  ]],
  ["fear_recoil", [
    { id: "retreat", labels: ["结构化后撤/避让", "后撤/躲避动势"] },
  ]],
  ["defensive_cool", [
    { id: "closed_boundary", labels: ["结构化手臂封闭/藏手", "抱臂或交叉", "上身封闭"] },
  ]],
  ["calm_elegant", [
    { id: "stable_long_line", labels: ["结构化长线条/稳定", "长线条身体", "稳定慢动作"] },
  ]],
  ["bored_waiting", [
    { id: "support", labels: ["结构化支撑/倚靠", "支撑身体"] },
    { id: "low_energy", labels: ["结构化低能量等待", "能量下沉"] },
  ]],
]);

const emotionBlockingConflictLabels = new Map([
  ["joy_release", ["封闭防御", "结构化封闭/低能量冲突", "结构化局部裁切冲突", "局部裁切"]],
  ["lonely_withdrawal", ["外放快乐动势", "结构化外放快乐冲突"]],
  ["distress_vulnerability", ["外放打开", "结构化外放动能冲突", "强势对峙", "结构化强控制冲突"]],
  ["fear_recoil", ["逼近/攻击而非后撤", "结构化逼近/攻击冲突"]],
  ["defensive_cool", ["外放跳跃", "结构化快乐外放冲突"]],
  ["calm_elegant", ["失控动势", "结构化失控/强防御冲突"]],
  ["bored_waiting", ["外放表演", "结构化外放表演冲突"]],
]);

const hardActionIntents = [
  {
    id: "chin_supported",
    label_zh: "托腮/手撑下巴",
    triggers: ["托腮", "撑脸", "托住脸", "托住下巴", "手撑下巴", "chin in hand", "chin on hand"],
    weight: 26,
    pattern: /托腮|托住脸|托住下巴|手[^\s。！？；，,.]{0,10}(托|撑|抵)[^\s。！？；，,.]{0,10}(脸颊|脸|下巴)|一肘[^\s。！？；，,.]{0,10}(托|撑|抵)[^\s。！？；，,.]{0,10}(脸颊|脸|下巴)|肘[^\s。！？；，,.]{0,10}(桌|支撑)[^\s。！？；，,.]{0,10}(托|撑|抵)[^\s。！？；，,.]{0,10}(脸颊|脸|下巴)|chin (in|on) hand|hand under chin|hand supporting chin|elbow[^.]{0,40}chin/iu,
  },
  {
    id: "arms_crossed",
    label_zh: "抱臂/手臂交叉",
    triggers: ["抱臂", "交叉手臂", "arms crossed", "crossed arms"],
    weight: 22,
    pattern: /抱臂|抱胸|交叉手臂|双臂[^。！？；;，,.、：:]{0,24}(胸前|胸口|胸部)[^。！？；;，,.、：:]{0,12}(交叉|交叠|抱|封)|双臂[^。！？；;，,.、：:]{0,24}(交叉|交叠|抱)[^。！？；;，,.、：:]{0,12}(胸前|胸口|胸部)|手臂[^。！？；;，,.、：:]{0,24}(胸前|胸口|胸部)[^。！？；;，,.、：:]{0,12}(交叉|交叠|抱|封)|arms crossed|crossed arms/iu,
  },
  {
    id: "seated",
    label_zh: "坐姿",
    triggers: ["坐姿", "坐着", "坐", "seated", "sitting"],
    weight: 18,
    pattern: /support:sitting|坐姿|坐在|坐着|骨盆坐|椅子|座椅|seated|sitting|chair/iu,
  },
  {
    id: "jumping",
    label_zh: "跳跃/腾空",
    triggers: ["跳跃", "腾空", "跃起", "jump", "airborne"],
    weight: 22,
    pattern: /跳跃|腾空|跃起|离地|dynamic jump|airborne|jump/iu,
  },
  {
    id: "back_leaving",
    label_zh: "背影离场",
    triggers: ["背影", "离场", "离开", "leaving", "back view"],
    weight: 22,
    pattern: /背影|背对|离场|离开|走开|远行|back view|leaving/iu,
  },
  {
    id: "both_hands_on_head",
    label_zh: "双手护头/扶头",
    triggers: ["双手扶头", "双手护头", "两手扶头", "两手护头", "双手抱头", "both hands on head", "both hands protecting head"],
    weight: 22,
    pattern: /(?:双手|两手|双臂|两臂)[^\s。！？；，,.、：:]{0,20}(?:扶|护|贴|按|捂|抓|抱|压|覆盖|包住)[^\s。！？；，,.、：:]{0,16}(?:头|头部|头盔|后脑|太阳穴|头部两侧|头两侧)|both hands? (?:on|protecting|holding|touching|pressing|covering) (?:head|helmet)|both arms? (?:around|wrapping|covering) (?:the )?(?:head|helmet)/iu,
    rejectPattern: /(?:不|未|没有|没有真正|并不)[^\s。！？；，,.、：:]{0,10}(?:接触|碰|贴|扶|护|按|压)[^\s。！？；，,.、：:]{0,10}(?:头|头部|头盔|后脑)|(?:双手|两手)[^\s。！？；，,.、：:]{0,20}(?:不|未|没有)[^\s。！？；，,.、：:]{0,10}(?:接触|碰|贴)[^\s。！？；，,.、：:]{0,10}(?:头|头部|头盔|后脑)|do(?:es)? not touch (?:the )?(?:head|helmet)|not touching (?:the )?(?:head|helmet)/iu,
  },
  {
    id: "hand_on_head",
    label_zh: "手扶头/护头",
    triggers: ["护头", "扶头", "抱头", "手贴头", "hands on head", "protecting head"],
    weight: 18,
    pattern: /(?:双手|两手|一手|手)[^\s。！？；，,.、：:]{0,16}(?:扶|护|贴|按|捂|抓|抱|压|覆盖|包住)[^\s。！？；，,.、：:]{0,12}(?:头|头部|头盔|后脑|太阳穴)|hands? (?:on|protecting|holding|touching|pressing|covering) (?:head|helmet)|protecting head|hands protecting head/iu,
    rejectPattern: /(?:不|未|没有|没有真正|并不)[^\s。！？；，,.、：:]{0,10}(?:接触|碰|贴|扶|护|按|压)[^\s。！？；，,.、：:]{0,10}(?:头|头部|头盔|后脑)|(?:双手|两手|一手|手)[^\s。！？；，,.、：:]{0,20}(?:不|未|没有)[^\s。！？；，,.、：:]{0,10}(?:接触|碰|贴)[^\s。！？；，,.、：:]{0,10}(?:头|头部|头盔|后脑)|do(?:es)? not touch (?:the )?(?:head|helmet)|not touching (?:the )?(?:head|helmet)/iu,
  },
  {
    id: "retreating",
    label_zh: "后退/退缩/后撤",
    triggers: ["后退", "后撤", "退缩", "躲避", "退让", "retreat", "recoil", "back step"],
    weight: 22,
    pattern: /后退|后撤|退缩|躲避|避开|退让|重心[^。,.]*(后移|后撤|远离)|身体[^。,.]*(后仰|撤离)|躯干[^。,.]*(后仰|后撤)|back\s*(step|shift)|retreat|recoil/iu,
  },
];

async function readJsonl(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readTargetRows(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function keywords(value) {
  const raw = String(value || "").toLowerCase();
  const items = new Map();
  const add = (item, weight) => {
    const word = String(item || "").trim().toLowerCase();
    if (!word) return;
    items.set(word, Math.max(items.get(word) || 0, weight));
  };
  raw
    .split(/[^\p{L}\p{N}'’.-]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => add(item, 4));
  for (const [key, expansions] of synonymMap) {
    if (raw.includes(key.toLowerCase())) {
      for (const item of expansions) add(item, 1);
    }
  }
  return [...items.entries()].map(([word, weight]) => ({ word, weight }));
}

function haystack(row) {
  return [
    row.pose?.support,
    row.pose?.orientation,
    row.pose?.camera_angle,
    row.pose?.movement_state,
    row.pose?.body_description_zh,
    row.pose?.skeleton_notes_zh,
    row.pose?.props_and_environment_zh,
    row.lighting?.distribution,
    row.lighting?.distribution_notes_zh,
    row.lighting?.direction,
    row.lighting?.contrast,
    row.lighting?.shadow_behavior_zh,
    row.lighting?.pose_emotion_effect_zh,
    row.emotion?.primary_zh,
    ...(row.emotion?.secondary_zh || []),
    row.emotion?.action_match_zh,
    row.emotion_semantics ? JSON.stringify(row.emotion_semantics) : "",
    row.emotion_contract ? JSON.stringify(row.emotion_contract) : "",
    row.reference_outputs?.action_reference_zh,
    row.reference_outputs?.stick_figure_prompt_zh,
    ...(row.retrieval?.action_tags || []),
    ...(row.retrieval?.emotion_tags || []),
    ...(row.retrieval?.camera_tags || []),
    ...(row.retrieval?.prop_tags || []),
    ...(row.retrieval?.lighting_tags || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreText(text, queryKeywords, multiplier = 1) {
  const value = String(text || "").toLowerCase();
  let total = 0;
  for (const item of queryKeywords) {
    const word = typeof item === "string" ? item : item.word;
    const weight = typeof item === "string" ? 1 : item.weight;
    if (!word) continue;
    if (value.includes(word)) total += (word.length > 1 ? 2 : 1) * weight * multiplier;
  }
  return total;
}

function score(row, queryKeywords) {
  const primaryText = [
    row.emotion?.primary_zh,
    ...(row.retrieval?.action_tags || []),
    ...(row.retrieval?.emotion_tags || []),
    ...(row.retrieval?.lighting_tags || []),
  ].filter(Boolean).join(" ");
  return scoreText(primaryText, queryKeywords, 3) + scoreText(haystack(row), queryKeywords);
}

function emotionProfileFor(value) {
  const text = String(value || "").toLowerCase();
  let best = null;
  for (const profile of emotionProfiles) {
    const triggerScore = profile.triggers.reduce((total, trigger) => {
      const word = String(trigger || "").toLowerCase();
      return word && text.includes(word) ? total + Math.max(2, word.length) : total;
    }, 0);
    if (!best || triggerScore > best.triggerScore) best = { profile, triggerScore };
  }
  return best?.triggerScore > 0 ? best.profile : null;
}

function profileText(row) {
  return [
    `framing:${row.pose?.framing || ""}`,
    `body_count:${row.pose?.body_count || ""}`,
    `support:${row.pose?.support || ""}`,
    `orientation:${row.pose?.orientation || ""}`,
    `camera:${row.pose?.camera_angle || ""}`,
    `movement:${row.pose?.movement_state || ""}`,
    `lighting_distribution:${row.lighting?.distribution || ""}`,
    `lighting_direction:${row.lighting?.direction || ""}`,
    `lighting_contrast:${row.lighting?.contrast || ""}`,
    row.pose?.body_description_zh,
    row.pose?.skeleton_notes_zh,
    row.pose?.props_and_environment_zh,
    row.lighting?.distribution_notes_zh,
    row.lighting?.shadow_behavior_zh,
    row.lighting?.pose_emotion_effect_zh,
    ...(row.retrieval?.action_tags || []),
    ...(row.retrieval?.camera_tags || []),
    ...(row.retrieval?.prop_tags || []),
    ...(row.retrieval?.lighting_tags || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function objectSignalText(object) {
  return Object.entries(object || {})
    .map(([key, value]) => `${key}:${String(value || "")}`)
    .join(" ");
}

function flattenEvidence(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenEvidence);
  if (typeof value === "object") return Object.entries(value).flatMap(([key, item]) =>
    [`${key}:${Array.isArray(item) ? item.join(" ") : String(item || "")}`, ...flattenEvidence(item)]
  );
  return [String(value)];
}

function structuredProfileText(row) {
  const semantics = row.emotion_semantics || {};
  const contract = row.emotion_contract || {};
  return [
    `framing:${row.pose?.framing || ""}`,
    `body_count:${row.pose?.body_count || ""}`,
    `support:${row.pose?.support || ""}`,
    `orientation:${row.pose?.orientation || ""}`,
    `emotion_contract_strength:${contract.strength || ""}`,
    ...(contract.candidate_emotions || []).map((item) => `candidate_emotion:${item}`),
    ...(contract.reject_emotions || []).map((item) => `reject_emotion:${item}`),
    ...flattenEvidence(contract.visible_evidence).map((item) => `visible_evidence:${item}`),
    ...(contract.missing_evidence || []).map((item) => `missing_evidence:${item}`),
    ...(contract.conflicts || []).map((item) => `contract_conflict:${item}`),
    objectSignalText(semantics.affect_vector),
    objectSignalText(semantics.body_signal_vector),
    objectSignalText(semantics.lighting_signal_vector),
    ...(semantics.evidence_zh || []).map((item) => `evidence:${item}`),
    ...(semantics.conflicts_zh || []).map((item) => `conflict:${item}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreSignals(text, signals) {
  const matched = [];
  let total = 0;
  for (const signal of signals || []) {
    if (!signal.pattern.test(text)) continue;
    total += signal.weight;
    matched.push(signal.label);
  }
  return { score: total, matched };
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function affectProfileAlignment(row, profile) {
  const actual = row.emotion_semantics?.affect_vector;
  const target = profile?.affect_vector;
  if (!actual || !target) return { score: 0, matched: [], conflicts: [] };
  let score = 0;
  let closeDimensions = 0;
  const conflicts = [];
  for (const [dimension, targetValue] of Object.entries(target)) {
    const actualValue = actual[dimension];
    if (!Number.isFinite(actualValue) || !Number.isFinite(targetValue)) continue;
    const diff = Math.abs(actualValue - targetValue);
    if (diff <= 1) {
      closeDimensions++;
      score += dimension === "valence" || dimension === "arousal" ? 2 : 1;
    }
    if (targetValue >= 3 && actualValue <= 1) {
      score -= 4;
      conflicts.push(`${dimension}过低`);
    }
    if (targetValue <= -2 && actualValue >= 2) {
      score -= 4;
      conflicts.push(`${dimension}反向偏正`);
    }
    if (targetValue <= 1 && actualValue >= 4) {
      score -= 2;
      conflicts.push(`${dimension}过高`);
    }
  }
  return {
    score: Math.max(-10, Math.min(10, score)),
    matched: closeDimensions >= 4 ? ["情绪向量接近"] : [],
    conflicts,
  };
}

function profileNeedles(profile) {
  return [
    profile?.id,
    profile?.label_zh,
    ...(profile?.triggers || []),
  ].filter(Boolean).map((item) => String(item).toLowerCase());
}

function textContainsAny(text, needles) {
  const value = String(text || "").toLowerCase();
  return needles.some((item) => item && value.includes(item));
}

function emotionContractProfileAlignment(row, profile) {
  const contract = row.emotion_contract;
  if (!contract || !profile) {
    return {
      score: -12,
      matched: [],
      conflicts: ["缺少情绪合约"],
      blocks_profile: true,
      strength: null,
      has_contract: false,
    };
  }
  const needles = profileNeedles(profile);
  const candidateText = (contract.candidate_emotions || []).join(" ");
  const rejectText = (contract.reject_emotions || []).join(" ");
  const candidateMatched = textContainsAny(candidateText, needles);
  const rejected = textContainsAny(rejectText, needles);
  const visibleEvidenceText = flattenEvidence(contract.visible_evidence).join(" ");
  const conflictText = [
    ...(contract.conflicts || []),
    ...(contract.missing_evidence || []).map((item) => `缺失:${item}`),
  ].join(" ");
  const positive = scoreSignals(visibleEvidenceText, profile.positive);
  const negative = scoreSignals(conflictText, profile.negative);
  let score = positive.score + negative.score;
  const matched = [...positive.matched];
  const conflicts = [...negative.matched];
  let blocksProfile = false;

  if (rejected) {
    score -= 30;
    conflicts.push("情绪合约明确排除");
    blocksProfile = true;
  }

  if (candidateMatched) {
    if (contract.strength === "strong") {
      score += 18;
      matched.push("情绪合约强匹配");
    } else if (contract.strength === "partial") {
      score += 8;
      matched.push("情绪合约部分匹配");
    } else if (contract.strength === "weak") {
      score -= 4;
      conflicts.push("情绪合约弱匹配");
    } else if (contract.strength === "reject") {
      score -= 30;
      conflicts.push("情绪合约拒绝匹配");
      blocksProfile = true;
    }
  } else if (!rejected) {
    score -= 8;
    conflicts.push("情绪合约未列为候选");
  }

  return {
    score,
    matched: unique(matched),
    conflicts: unique(conflicts),
    blocks_profile: blocksProfile,
    strength: contract.strength || null,
    has_contract: true,
  };
}

function requiredSignalGroupAlignment(profile, signals) {
  const groups = emotionRequiredSignalGroups.get(profile?.id) || [];
  const signalSet = new Set(signals || []);
  const hits = [];
  const misses = [];
  for (const group of groups) {
    const matched = group.labels.some((label) => signalSet.has(label));
    if (matched) hits.push(group.id);
    else misses.push(group.id);
  }
  return { hits, misses, passed: misses.length === 0 };
}

function hasBlockingConflict(profile, conflicts) {
  const blockers = emotionBlockingConflictLabels.get(profile?.id) || [];
  const conflictSet = new Set(conflicts || []);
  return blockers.some((label) => conflictSet.has(label));
}

function emotionProfileAlignment(row, profile) {
  if (!profile) return null;
  const narrativeText = profileText(row);
  const structuredText = structuredProfileText(row);
  const contract = structuredEmotionContracts.get(profile.id) || {};
  const positive = scoreSignals(narrativeText, profile.positive);
  const negative = scoreSignals(narrativeText, profile.negative);
  const structuredPositive = scoreSignals(structuredText, contract.positive);
  const structuredNegative = scoreSignals(structuredText, contract.negative);
  const affect = affectProfileAlignment(row, profile);
  const emotionContract = emotionContractProfileAlignment(row, profile);
  const positiveSignals = unique([...structuredPositive.matched, ...emotionContract.matched, ...affect.matched, ...positive.matched]);
  const requiredGroups = requiredSignalGroupAlignment(profile, positiveSignals);
  const conflicts = unique([...structuredNegative.matched, ...emotionContract.conflicts, ...affect.conflicts, ...negative.matched]);
  const blockingConflict = hasBlockingConflict(profile, conflicts);
  return {
    id: profile.id,
    label_zh: profile.label_zh,
    score: positive.score + negative.score + structuredPositive.score + structuredNegative.score + emotionContract.score + affect.score,
    narrative_score: positive.score + negative.score,
    structured_score: structuredPositive.score + structuredNegative.score,
    contract_score: emotionContract.score,
    contract_strength: emotionContract.strength,
    affect_score: affect.score,
    positive_signals: positiveSignals,
    structured_signals: unique(structuredPositive.matched),
    narrative_signals: unique(positive.matched),
    contract_signals: unique(emotionContract.matched),
    conflicts,
    blocking_conflict: blockingConflict,
    contract_blocks_profile: emotionContract.blocks_profile,
    has_emotion_contract: emotionContract.has_contract,
    required_group_hits: requiredGroups.hits,
    required_group_misses: requiredGroups.misses,
    passes_required_groups: requiredGroups.passed && emotionContract.has_contract && !emotionContract.blocks_profile && !blockingConflict,
  };
}

function emotionTargetForOutput(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    label_zh: profile.label_zh,
    affect_vector: profile.affect_vector,
    required_body_signals: profile.body_signal_vector || [],
    required_lighting_signals: profile.lighting_signal_vector || [],
  };
}

function rowEmotionSemanticsForOutput(row, alignment) {
  if (row.emotion_semantics) return row.emotion_semantics;
  return {
    source: "derived_from_pose_lighting_text",
    body_signal_matches: alignment?.positive_signals || [],
    conflicts: alignment?.conflicts || [],
    affect_label_zh: row.emotion?.primary_zh,
    lighting_signal: {
      distribution: row.lighting?.distribution || "unknown",
      direction: row.lighting?.direction || "unknown",
      contrast: row.lighting?.contrast || "unknown",
    },
  };
}

function actionIntentsFor(value) {
  const text = String(value || "").toLowerCase();
  const intents = hardActionIntents.filter((intent) =>
    intent.triggers.some((trigger) => text.includes(String(trigger || "").toLowerCase()))
  );
  const ids = new Set(intents.map((intent) => intent.id));
  return intents.filter((intent) => {
    if (intent.id === "hand_on_head" && ids.has("both_hands_on_head")) return false;
    return true;
  });
}

function hardActionText(row) {
  return [
    `support:${row.pose?.support || ""}`,
    `orientation:${row.pose?.orientation || ""}`,
    `movement:${row.pose?.movement_state || ""}`,
    row.pose?.body_description_zh,
    row.pose?.skeleton_notes_zh,
    ...(row.retrieval?.action_tags || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function hardActionAlignment(row, intents) {
  if (!intents.length) return null;
  const text = hardActionText(row);
  const matched = [];
  const missed = [];
  let total = 0;
  for (const intent of intents) {
    if (intent.rejectPattern?.test(text)) {
      missed.push(intent.label_zh);
      total -= intent.weight;
    } else if (intent.pattern.test(text)) {
      matched.push(intent.label_zh);
      total += intent.weight;
    } else {
      missed.push(intent.label_zh);
      total -= intent.weight;
    }
  }
  return { score: total, matched, missed };
}

function textOf(row) {
  return [
    row.pose?.framing,
    row.pose?.body_description_zh,
    row.pose?.skeleton_notes_zh,
    row.reference_outputs?.action_reference_zh,
    row.reference_outputs?.stick_figure_prompt_zh,
    row.reference_outputs?.imagegen_prompt_en,
    ...(row.retrieval?.action_tags || []),
    ...(row.retrieval?.camera_tags || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function wantsPartialFraming(value) {
  const text = String(value || "").toLowerCase();
  return /特写|近景|头肩|半身|上半身|脸部|面部|肖像|头像|胸像|close[-_\s]?up|headshot|portrait crop|half[-_\s]?body/.test(text);
}

function hasMissingLowerBody(row) {
  const text = textOf(row);
  return /不画骨盆|不画[^。,.]*腿|不要画[^。,.]*腿|只画到胸|身体只画到胸|只裁到上胸|身体只裁到|脚部裁切|腿脚裁切|脚被裁切|腿脚被裁切|feet cropped|legs cropped|omit pelvis|omit[^.]*legs|do not draw[^.]*legs|crop at the chest/.test(text);
}

function isDefaultFullBodyReference(row) {
  return row.pose?.framing === "full_body" && !hasMissingLowerBody(row);
}

function framingModeFor(query, requested) {
  if (requested) return requested;
  return wantsPartialFraming(query) ? "any" : "full_body";
}

function framingScore(row, mode) {
  if (mode === "any") {
    if (row.pose?.framing === "close_up") return 18;
    if (row.pose?.framing === "half_body") return 12;
    if (row.pose?.framing === "three_quarter") return 6;
    if (row.pose?.framing === "full_body") return 0;
    if (row.pose?.framing === "cropped_detail") return -18;
    return 0;
  }
  if (isDefaultFullBodyReference(row)) return 24;
  if (row.pose?.framing === "full_body") return 14;
  if (row.pose?.framing === "three_quarter") return 4;
  if (row.pose?.framing === "half_body") return -8;
  if (row.pose?.framing === "close_up") return -16;
  if (row.pose?.framing === "cropped_detail") return -24;
  return 0;
}

function issueKey(row) {
  return [row.image?.magazine_name, row.image?.issue_month].filter(Boolean).join("|").toLowerCase();
}

function articleKey(row) {
  return [issueKey(row), row.image?.article_title].filter(Boolean).join("|").toLowerCase();
}

function magazineKey(row) {
  return String(row.image?.magazine_name || "").toLowerCase();
}

function diverseSelection(items, selectionLimit) {
  const selected = [];
  const seenArticles = new Set();
  const seenIssues = new Set();
  const magazineCounts = new Map();

  const tryPass = (relaxIssue = false, relaxMagazine = false) => {
    for (const item of items) {
      if (selected.length >= selectionLimit) break;
      const row = item.row;
      const article = articleKey(row);
      const issue = issueKey(row);
      const magazine = magazineKey(row);
      if (article && seenArticles.has(article)) continue;
      if (!relaxIssue && issue && seenIssues.has(issue)) continue;
      if (!relaxMagazine && magazine && (magazineCounts.get(magazine) || 0) >= 2) continue;
      selected.push(item);
      if (article) seenArticles.add(article);
      if (issue) seenIssues.add(issue);
      if (magazine) magazineCounts.set(magazine, (magazineCounts.get(magazine) || 0) + 1);
    }
  };

  tryPass(false, false);
  if (selected.length < selectionLimit) tryPass(true, false);
  if (selected.length < selectionLimit) tryPass(true, true);
  return selected;
}

function isGenericPerson(value) {
  const text = String(value || "").trim();
  return !text || ["单人角色", "角色", "人物", "人体模型"].includes(text);
}

function adaptChinesePrompt(prompt, person, bodyCount) {
  const value = String(prompt || "");
  if (bodyCount !== "single" && isGenericPerson(person)) return value;
  if (value.includes("人体模型简笔画动作参考图：单人")) {
    return value.replace("人体模型简笔画动作参考图：单人", `人体模型简笔画动作参考图：${person}`);
  }
  if (/人体模型简笔画动作参考图：[双多]人/.test(value) && isGenericPerson(person)) return value;
  return value.replace("人体模型简笔画动作参考图：", `人体模型简笔画动作参考图：${person}，`);
}

function englishPerson(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("女")) return "female figure";
  if (text.includes("男")) return "male figure";
  if (text.includes("中性")) return "androgynous human mannequin";
  if (text.includes("人体模型")) return "human mannequin";
  return "human figure";
}

const lightingDistributionLabels = new Map([
  ["even_soft", "均匀柔光"],
  ["front_soft", "正面柔光"],
  ["side_light", "侧光"],
  ["back_light", "逆光"],
  ["top_light", "顶光"],
  ["low_key", "低调暗光"],
  ["high_key", "高调亮光"],
  ["mixed_practical", "混合现场光"],
  ["spotlight", "聚光"],
  ["unknown", "未知"],
]);

const lightingDirectionLabels = new Map([
  ["front", "正面"],
  ["left", "左侧"],
  ["right", "右侧"],
  ["above", "上方"],
  ["below", "下方"],
  ["back", "背后"],
  ["ambient", "环境光"],
  ["mixed", "混合"],
  ["unknown", "未知"],
]);

const lightingContrastLabels = new Map([
  ["low", "低反差"],
  ["medium", "中反差"],
  ["high", "高反差"],
]);

function labelFrom(map, value) {
  return map.get(value) || value || "未知";
}

function formatLighting(lighting) {
  if (!lighting) return "";
  const distribution = labelFrom(lightingDistributionLabels, lighting.distribution);
  const direction = labelFrom(lightingDirectionLabels, lighting.direction);
  const contrast = labelFrom(lightingContrastLabels, lighting.contrast);
  const notes = lighting.distribution_notes_zh || "";
  const shadow = lighting.shadow_behavior_zh || "";
  const shouldAppendShadow = shadow && !notes.includes(shadow);
  const summary = `光线分布：${distribution}，方向：${direction}，对比：${contrast}。`;
  return [
    notes.includes("光线分布") ? notes : [summary, notes].filter(Boolean).join(" "),
    shouldAppendShadow ? shadow : "",
    lighting.pose_emotion_effect_zh,
  ].filter(Boolean).join(" ");
}

function adaptEnglishPrompt(prompt, personEnglish, bodyCount, person) {
  let value = String(prompt || "");
  if (bodyCount !== "single" && isGenericPerson(person)) return value;
  const personLabel = String(personEnglish || "human figure").trim();
  let matched = false;
  const replaced = value.replace(/\bone(?:\s+([^,.]*?))?\s+figure\b/i, (match, descriptor = "") => {
    matched = true;
    if (match.toLowerCase().includes(personLabel.toLowerCase())) return match;
    const poseDescriptor = descriptor.trim();
    return poseDescriptor ? `one ${poseDescriptor} ${personLabel}` : `one ${personLabel}`;
  });
  if (matched) return replaced;
  return value.replace(/\bone\b/i, `one ${personLabel}`);
}

function stripLineArtStyle(prompt) {
  return String(prompt || "")
    .replace(/^Create a clean black-line (?:human )?mannequin pose reference on a white background:\s*/i, "")
    .replace(/^Create a clean black-line figure pose reference on a white background:\s*/i, "")
    .replace(/^Create a clean black-line\s*/i, "")
    .replace(/\bblack-line\b/gi, "")
    .replace(/\bwhite background\b/gi, "plain studio background")
    .replace(/\bNo clothing details,?\s*/gi, "")
    .replace(/\bno clothing details,?\s*/gi, "")
    .replace(/\bno background\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildImagegenValidationPrompt(prompt, personEnglish, bodyCount, person, fullBodyRequired) {
  return buildImagegenValidationPromptWithDirective(prompt, personEnglish, bodyCount, person, fullBodyRequired, null);
}

const emotionPromptDirectives = new Map([
  ["joy_release", {
    zh: "情绪硬约束：开心/兴奋必须通过身体动能表达，必须保留胸腔打开、四肢外展、重心不稳定，并且至少出现跳跃、旋转、舞动、奔跑或明显甩动释放；禁止只靠笑脸、道具、手贴头或静态站姿表达兴奋。",
    en: "Emotion contract: joy or excitement must be visible through body mechanics: open chest, expanded limbs, unstable weight, and dynamic release such as jumping, spinning, dancing, running, or a clear limb swing. Do not rely on a smile, prop, hands on head, or a static stance to express excitement.",
  }],
  ["lonely_withdrawal", {
    zh: "情绪硬约束：孤独/抽离必须通过背离、远离、小比例空间、低头或塌肩表达；禁止用正面强展示、外放跳跃或大幅张开动作替代孤独。",
    en: "Emotion contract: loneliness or withdrawal must be visible through turning away, leaving, small scale in space, lowered head, or collapsed shoulders. Do not replace it with a front-facing power display, jumping, or wide open celebratory limbs.",
  }],
  ["distress_vulnerability", {
    zh: "情绪硬约束：压抑/委屈/想哭必须通过低头或避开视线、圆肩塌胸、手靠脸或藏手、低能量支撑表达；禁止宽站、挑衅直视或外放快乐动作。",
    en: "Emotion contract: distress or vulnerability must be visible through a lowered or averted head, rounded shoulders, collapsed chest, hands near the face or hidden hands, and low-energy support. Do not use a wide power stance, confrontational directness, or joyful open movement.",
  }],
  ["fear_recoil", {
    zh: "情绪硬约束：惊恐/后退必须通过重心后撤、身体避让、手护脸/护胸/护头、肩颈紧张和不稳定退步表达；禁止画成向前逼近、攻击或松弛站姿。",
    en: "Emotion contract: fear or recoil must be visible through backward weight shift, retreating body, hands guarding the face, chest, or head, tense raised shoulders, and an unstable retreat step. Do not turn it into a forward attack, approach, or relaxed stance.",
  }],
  ["defensive_cool", {
    zh: "情绪硬约束：冷淡/防御必须通过交叉或隐藏手臂、封闭胸腔、社交距离、控制感视线和切割式明暗表达；禁止外放跳跃或快乐释放动作。",
    en: "Emotion contract: defensive coolness must be visible through crossed or hidden arms, closed chest, social distance, controlled gaze, and cut light or contrast. Do not use jumping or joyful release movement.",
  }],
  ["calm_elegant", {
    zh: "情绪硬约束：平静/优雅必须通过长身体线、稳定重心、低张力、慢速静止和柔和低反差光表达；禁止失控动势或强防御张力。",
    en: "Emotion contract: calm elegance must be visible through a long body line, stable weight, low tension, slow stillness, and soft low-contrast light. Do not use chaotic motion or strong defensive tension.",
  }],
  ["bored_waiting", {
    zh: "情绪硬约束：无聊/等待必须通过身体支撑、低能量、倚靠或坐姿、头肩下沉和日常低反差光表达；禁止跳跃、表演性外放或只靠场景说明无聊。",
    en: "Emotion contract: boredom or waiting must be visible through supported body weight, low energy, leaning or seated support, lowered head or shoulders, and everyday low-contrast light. Do not use jumping, performative openness, or scenery alone to signal boredom.",
  }],
]);

function weakEmotionPromptDirective(profile, alignment) {
  if (!profile) return null;
  const misses = alignment?.required_group_misses?.length
    ? ` Missing required signal groups: ${alignment.required_group_misses.join(", ")}.`
    : "";
  const conflicts = alignment?.conflicts?.length
    ? ` Conflicting signals: ${alignment.conflicts.join(", ")}.`
    : "";
  return {
    zh: `情绪门禁未通过：不要把“${profile.label_zh}”当成画面标签；优先保持真实硬动作，只描述已存在的身体证据，不要用笑脸、道具或背景强行补情绪。`,
    en: `Emotion gate did not pass for ${profile.label_zh}: preserve the real hard action first, describe only visible body evidence, and do not force the emotion with a smile, prop, label, or background.${misses}${conflicts}`,
  };
}

function emotionPromptDirective(profile, alignment, gateUsed) {
  if (!profile) return null;
  if (!gateUsed || alignment?.passes_required_groups === false) {
    return weakEmotionPromptDirective(profile, alignment);
  }
  return emotionPromptDirectives.get(profile.id) || {
    zh: `情绪硬约束：${profile.label_zh} 必须由可见身体信号表达，不能只靠表情、道具、背景或文字标签。`,
    en: `Emotion contract: ${profile.label_zh} must be expressed by visible body mechanics, not by facial expression, prop, background, or text label alone.`,
  };
}

function buildGenerationDecision({
  emotionProfile,
  emotionGateUsed,
  actionGateUsed,
  actionIntents,
  profileAlignedCandidates,
  bestItem,
}) {
  if (!emotionProfile) {
    return {
      status: "no_emotion_profile",
      imagegen_validation_allowed: true,
      reason_zh: "输入没有命中结构化情绪画像，按动作和关键词生成姿势参考。",
      reason_en: "No structured emotion profile was detected; pose generation follows action and keyword retrieval.",
      alternatives_zh: [],
    };
  }

  if (emotionGateUsed) {
    return {
      status: "emotion_contract_passed",
      imagegen_validation_allowed: true,
      reason_zh: `情绪门禁通过：${emotionProfile.label_zh} 有足够的可见身体证据。`,
      reason_en: `Emotion gate passed: ${emotionProfile.label_zh} has enough visible body evidence.`,
      alternatives_zh: [],
    };
  }

  const misses = bestItem?.emotion_alignment?.required_group_misses || [];
  const conflicts = bestItem?.emotion_alignment?.conflicts || [];
  const actionLabels = actionIntents.map((intent) => intent.label_zh);
  const alternatives = [];

  if (actionGateUsed && actionLabels.length) {
    alternatives.push(`保留硬动作「${actionLabels.join("、")}」，但不要把它标成「${emotionProfile.label_zh}」。`);
  }
  if (profileAlignedCandidates.length) {
    alternatives.push(`放宽硬动作，改用已通过「${emotionProfile.label_zh}」身体契约的参考。`);
  } else {
    alternatives.push(`补充或等待更多带「${emotionProfile.label_zh}」可见身体证据的标注样本。`);
  }
  alternatives.push("重新输入时把情绪拆成身体条件，例如胸腔打开、四肢外展、重心后撤、塌肩低头等。");

  return {
    status: actionGateUsed ? "hard_action_only_emotion_failed" : "emotion_contract_failed",
    imagegen_validation_allowed: false,
    reason_zh: [
      `情绪门禁未通过：不能把「${emotionProfile.label_zh}」当成画面标签。`,
      misses.length ? `缺失必要身体信号组：${misses.join("、")}。` : "",
      conflicts.length ? `冲突信号：${conflicts.join("、")}。` : "",
      "因此不输出最终 imagegen 验证提示词。",
    ].filter(Boolean).join(""),
    reason_en: [
      `Emotion gate failed for ${emotionProfile.label_zh}.`,
      misses.length ? ` Missing required signal groups: ${misses.join(", ")}.` : "",
      conflicts.length ? ` Conflicting signals: ${conflicts.join(", ")}.` : "",
      " No final image-generation validation prompt is allowed for this result.",
    ].filter(Boolean).join(""),
    alternatives_zh: alternatives,
  };
}

function buildImagegenValidationPromptWithDirective(prompt, personEnglish, bodyCount, person, fullBodyRequired, emotionDirective) {
  const adapted = adaptEnglishPrompt(prompt, personEnglish, bodyCount, person);
  const poseSpec = stripLineArtStyle(adapted);
  const countLabel = bodyCount === "pair"
    ? "two plain wooden artist drawing mannequins"
    : bodyCount === "group"
      ? "a small group of plain wooden artist drawing mannequins"
      : `one plain wooden artist drawing mannequin, ${String(personEnglish || "human figure").trim()}`;
  const visibilityRule = fullBodyRequired
    ? "Full body must be visible from head to feet; include pelvis, both legs, both feet, and both hands when they are part of the pose; do not crop limbs."
    : "Preserve the requested crop; do not invent unseen torso, pelvis, legs, feet, or off-frame joints; keep the visible joints and pose mechanics clear.";
  return [
    "Create a simple studio photo for pose verification.",
    `Subject: ${countLabel}, visible ball joints, no clothing, no facial features.`,
    `Pose to recreate: ${poseSpec}`,
    emotionDirective?.en || "",
    visibilityRule,
    "Scene: seamless white studio backdrop, neutral soft light, pose clearly readable.",
    "Forbidden: no text, no labels, no infographic, no yoga diagram, no vehicle, no insects, no animals, no fashion styling, no scenery, no watermark.",
  ].filter(Boolean).join(" ");
}

function buildStrictStickFigurePrompt(prompt, person, bodyCount, fullBodyRequired, emotionDirective = null) {
  const adapted = adaptChinesePrompt(prompt, person, bodyCount);
  const styleRule = "画法必须是单线骨架：头部只用简单椭圆，躯干只用脊柱线和肩/骨盆横线，四肢用单线，关节点用圆点；不画胸部块面、肌肉、五官、头发、服装、性别特征和装饰。";
  const emotionRule = emotionDirective?.zh ? `${emotionDirective.zh} ` : "";
  if (!fullBodyRequired) {
    return `${adapted} ${emotionRule}${styleRule} 只画原参考中真实可见的关节，不要补画画面外肢体。`;
  }
  return `${adapted} ${emotionRule}必须完整画出头颈、肩、脊柱、骨盆、双臂、双手、双腿和双脚；不允许半身裁切、胸像构图或省略骨盆腿脚。${styleRule} 默认全身图的手脚只画简单末端短线或小楔形，不画手指、脚趾和指节细节，除非用户明确要求手部特写。`;
}

const annotationFiles = [...baseAnnotationFiles, ...await listJsonlFiles(builtinBatchDir)];
const annotations = (await Promise.all(annotationFiles.map(readJsonl))).flat();
const poseAnnotations = annotations.filter((row) => row.annotation_status !== "non_model_detail" && row.pose?.body_count !== "none");
const targetRows = await readTargetRows(targetFile);
const targetShas = new Set(targetRows.map((row) => row.image?.sha256).filter(Boolean));
const targetAnnotations = targetRows.length ? annotations.filter((row) => targetShas.has(row.image?.sha256)) : annotations;
const targetUsableAnnotations = targetAnnotations.filter((row) => row.annotation_status !== "non_model_detail" && row.pose?.body_count !== "none");
const effectiveTargetCount = targetRows.length || targetCount;
if (!poseAnnotations.length) {
  console.error("No pose annotations found. Run pose annotation first.");
  process.exit(2);
}

const queryKeywords = keywords(query);
const emotionProfile = emotionProfileFor(query);
const actionIntents = actionIntentsFor(query);
const framingMode = framingModeFor(query, requestedFraming);
const usesEmotionContractPool = Boolean(emotionProfile);
const usesTargetPool = !usesEmotionContractPool && framingMode === "full_body" && targetUsableAnnotations.length;
const sourcePool = usesEmotionContractPool ? poseAnnotations : usesTargetPool ? targetUsableAnnotations : poseAnnotations;
const defaultFullBodyPool = sourcePool.filter(isDefaultFullBodyReference);
const candidatePool = framingMode === "full_body" && defaultFullBodyPool.length ? defaultFullBodyPool : sourcePool;
const fullBodyRequired = framingMode === "full_body" && defaultFullBodyPool.length > 0;
const scoredCandidates = candidatePool.map((row) => {
  const lexicalScore = score(row, queryKeywords);
  const cropScore = framingScore(row, framingMode);
  const emotionAlignment = emotionProfileAlignment(row, emotionProfile);
  const emotionScore = emotionAlignment?.score || 0;
  const actionAlignment = hardActionAlignment(row, actionIntents);
  const actionScore = actionAlignment?.score || 0;
  return {
    row,
    score: lexicalScore + cropScore + emotionScore + actionScore,
    lexical_score: lexicalScore,
    framing_score: cropScore,
    hard_action_score: actionScore,
    hard_action_alignment: actionAlignment,
    emotion_profile_score: emotionScore,
    emotion_alignment: emotionAlignment,
  };
});
const actionAlignedCandidates = actionIntents.length
  ? scoredCandidates.filter((item) => item.hard_action_alignment?.missed.length === 0)
  : [];
function passesEmotionGate(item, profile) {
  if (!profile) return false;
  return item.emotion_profile_score >= profile.minimum_score
    && item.emotion_alignment?.has_emotion_contract === true
    && item.emotion_alignment?.passes_required_groups !== false;
}
const profileAlignedCandidates = emotionProfile
  ? scoredCandidates.filter((item) => passesEmotionGate(item, emotionProfile))
  : [];
let rankingPool = scoredCandidates;
let actionGateUsed = false;
let emotionGateUsed = false;
if (actionAlignedCandidates.length) {
  rankingPool = actionAlignedCandidates;
  actionGateUsed = true;
}
if (emotionProfile) {
  const profileAlignedRankingPool = rankingPool.filter((item) => passesEmotionGate(item, emotionProfile));
  if (profileAlignedRankingPool.length) {
    rankingPool = profileAlignedRankingPool;
    emotionGateUsed = true;
  } else if (!actionGateUsed && profileAlignedCandidates.length) {
    rankingPool = profileAlignedCandidates;
    emotionGateUsed = true;
  }
}
const ranked = rankingPool
  .sort((a, b) => b.score - a.score)
  .slice(0, Math.max(limit * 8, 24));
const positiveRanked = ranked.filter((item) => item.score > 0);
const visibleRanked = diverseSelection(positiveRanked.length ? positiveRanked : ranked.slice(0, 1), limit);
const bestItem = visibleRanked[0];
const best = bestItem.row;
const bestEmotionPromptDirective = emotionPromptDirective(emotionProfile, bestItem.emotion_alignment, emotionGateUsed);
const generationDecision = buildGenerationDecision({
  emotionProfile,
  emotionGateUsed,
  actionGateUsed,
  actionIntents,
  profileAlignedCandidates,
  bestItem,
});
const fallbackStructurePromptZh = buildStrictStickFigurePrompt(
  best.reference_outputs.stick_figure_prompt_zh,
  person,
  best.pose?.body_count,
  fullBodyRequired,
  bestEmotionPromptDirective,
);
const finalImagegenPromptEn = generationDecision.imagegen_validation_allowed
  ? buildImagegenValidationPromptWithDirective(
      best.reference_outputs.imagegen_prompt_en,
      personEn,
      best.pose?.body_count,
      person,
      fullBodyRequired,
      bestEmotionPromptDirective,
    )
  : null;

const result = {
  input: { query, person },
  retrieval_policy: {
    source_pool: usesEmotionContractPool
      ? "all_annotations_emotion_contract_required"
      : usesTargetPool
        ? "target_1000_diverse"
        : "all_annotations",
    framing_mode: framingMode,
    full_body_required: fullBodyRequired,
    source_pool_size: sourcePool.length,
    strict_full_body_candidates: defaultFullBodyPool.length,
    candidate_pool_size: candidatePool.length,
    hard_action_constraints: actionIntents.length
      ? {
          labels_zh: actionIntents.map((intent) => intent.label_zh),
          aligned_candidate_count: actionAlignedCandidates.length,
          gate_used: actionGateUsed,
        }
      : null,
    emotion_profile: emotionProfile
      ? {
          id: emotionProfile.id,
          label_zh: emotionProfile.label_zh,
          minimum_score: emotionProfile.minimum_score,
          affect_vector: emotionProfile.affect_vector,
          required_body_signals: emotionProfile.body_signal_vector || [],
          required_lighting_signals: emotionProfile.lighting_signal_vector || [],
          aligned_candidate_count: profileAlignedCandidates.length,
          gate_used: emotionGateUsed,
          contract_source: "emotion_contract is required for any emotion gate pass; emotion_semantics and narrative pose text are diagnostic fallback only",
          prompt_directive_used: Boolean(bestEmotionPromptDirective),
        }
      : null,
    diversity: "selected references avoid repeating the same article and prefer different issues; magazines are capped before fallback",
  },
  annotated_pool_size: annotations.length,
  pose_reference_pool_size: poseAnnotations.length,
  non_model_detail_count: annotations.length - poseAnnotations.length,
  target_pool_size: effectiveTargetCount,
  completed_target_images: targetAnnotations.length,
  usable_completed_target_images: targetUsableAnnotations.length,
  non_model_completed_target_images: targetAnnotations.length - targetUsableAnnotations.length,
  coverage_warning: targetUsableAnnotations.length < effectiveTargetCount
    ? `当前 1000 多样化目标只有 ${targetUsableAnnotations.length}/${effectiveTargetCount} 张可用动作参考完成；这是可运行 skill，不是目标完成状态。`
    : null,
  matched_references: visibleRanked.map(({ row, score, lexical_score, framing_score, hard_action_score, hard_action_alignment, emotion_profile_score, emotion_alignment }) => ({
    score,
    lexical_score,
    framing_score,
    hard_action_score,
    hard_action_matched: hard_action_alignment?.matched || [],
    hard_action_missed: hard_action_alignment?.missed || [],
    emotion_profile_score,
    emotion_profile_structured_score: emotion_alignment?.structured_score || 0,
    emotion_profile_contract_score: emotion_alignment?.contract_score || 0,
    emotion_profile_contract_strength: emotion_alignment?.contract_strength || null,
    emotion_profile_has_contract: emotion_alignment?.has_emotion_contract || false,
    emotion_profile_narrative_score: emotion_alignment?.narrative_score || 0,
    emotion_profile_affect_score: emotion_alignment?.affect_score || 0,
    emotion_profile_signals: emotion_alignment?.positive_signals || [],
    emotion_profile_structured_signals: emotion_alignment?.structured_signals || [],
    emotion_profile_contract_signals: emotion_alignment?.contract_signals || [],
    emotion_profile_narrative_signals: emotion_alignment?.narrative_signals || [],
    emotion_profile_conflicts: emotion_alignment?.conflicts || [],
    emotion_profile_blocking_conflict: emotion_alignment?.blocking_conflict || false,
    emotion_profile_contract_blocks: emotion_alignment?.contract_blocks_profile || false,
    emotion_required_group_hits: emotion_alignment?.required_group_hits || [],
    emotion_required_group_misses: emotion_alignment?.required_group_misses || [],
    magazine_name: row.image.magazine_name,
    issue_month: row.image.issue_month,
    local_path: row.image.local_path,
    framing: row.pose?.framing,
    action_tags: row.retrieval.action_tags,
    emotion_tags: row.retrieval.emotion_tags,
    lighting_tags: row.retrieval.lighting_tags || [],
    lighting: row.lighting,
    emotion_semantics: rowEmotionSemanticsForOutput(row, emotion_alignment),
    emotion_contract: row.emotion_contract || null,
    action_reference_zh: row.reference_outputs.action_reference_zh,
  })),
  emotion_prompt_contract: bestEmotionPromptDirective
    ? {
        profile_id: emotionProfile?.id,
        gate_used: emotionGateUsed,
        directive_zh: bestEmotionPromptDirective.zh,
        directive_en: bestEmotionPromptDirective.en,
      }
    : null,
  generation_decision: generationDecision,
  action_reference_description_zh: [
    `人物设定：${person}。`,
    actionIntents.length
      ? `硬动作约束：${actionIntents.map((intent) => intent.label_zh).join("、")}；已命中：${bestItem.hard_action_alignment?.matched?.join("、") || "无"}。`
      : "",
    emotionProfile
      ? `情绪画像：${emotionProfile.label_zh}；命中的身体信号：${bestItem.emotion_alignment?.positive_signals?.join("、") || "无"}${bestItem.emotion_alignment?.required_group_misses?.length ? `；缺失必要信号组：${bestItem.emotion_alignment.required_group_misses.join("、")}` : ""}${bestItem.emotion_alignment?.conflicts?.length ? `；冲突信号：${bestItem.emotion_alignment.conflicts.join("、")}` : ""}${emotionGateUsed ? "" : "；情绪门禁未通过，当前结果只按硬动作/关键词兜底"}。`
      : "",
    emotionProfile
      ? `情绪目标向量：${JSON.stringify(emotionTargetForOutput(emotionProfile))}`
      : "",
    emotionProfile && !generationDecision.imagegen_validation_allowed
      ? `生成决策：${generationDecision.reason_zh} 替代路径：${generationDecision.alternatives_zh.join(" / ")}`
      : "",
    `核心动作：${best.reference_outputs.action_reference_zh}`,
    `肢体拆解：${best.pose.skeleton_notes_zh}`,
    formatLighting(best.lighting),
    `情绪匹配：${best.emotion.action_match_zh}`,
    visibleRanked.length > 1 ? `可混合参考：${visibleRanked.slice(1).map(({ row }) => row.reference_outputs.action_reference_zh).join(" / ")}` : "",
  ].filter(Boolean).join("\n"),
  stick_figure_prompt_zh: generationDecision.imagegen_validation_allowed ? fallbackStructurePromptZh : null,
  fallback_structure_prompt_zh: generationDecision.imagegen_validation_allowed ? null : fallbackStructurePromptZh,
  imagegen_prompt_en: finalImagegenPromptEn,
};

console.log(JSON.stringify(result, null, 2));
