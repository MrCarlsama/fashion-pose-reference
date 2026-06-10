---
name: "fashion-pose-reference"
description: "Use when the user provides an emotion, keyword, action, fashion/cosplay character, or body-pose request and wants a contract-backed fashion editorial pose reference plus a strict mannequin/stick-figure image-generation prompt."
---

# Fashion Pose Reference Skill

This skill turns annotated fashion editorial images into action references for drawing, cosplay preproduction, and mannequin image generation.

Use it for:
- "孤独 背影 离场"
- "冷淡 抱臂 男模"
- "无聊 托腮 等待"
- "兴奋 双手扶头 头盔"
- "给我一个人体模型简笔画动作参考提示词"

## Truth Sources

Corpus root is a local dataset directory. The open-source skill does not ship images or annotation batches.

Default corpus root, relative to the repository root:

```text
datasets/fashion_action_reference/
```

Annotation truth:

```text
datasets/fashion_action_reference/pose_annotations/seed_annotations.jsonl
datasets/fashion_action_reference/pose_annotations/builtin_preannotations.jsonl
datasets/fashion_action_reference/pose_annotations/annotations.jsonl
datasets/fashion_action_reference/pose_annotations/builtin_preannotation_batches/*.jsonl
```

If these files are absent, say the local corpus has not been built yet. Do not invent coverage numbers and do not call image generation from missing data.

Never claim the 1,000-image baseline is complete unless this passes:

```bash
node scripts/validate_pose_target.mjs --fail-if-incomplete true
```

Never claim the full 20,000-image corpus is complete unless this proves `unique_annotated_images: 20000`, `pending_images: 0`, and `full_corpus_complete: true`:

```bash
node scripts/validate_pose_annotations.mjs --fail-if-incomplete true
```

This public repository is code-only. Any coverage number is local-state-dependent and must be revalidated in the user's checkout before being reported.

## Core Contract

Emotion is a visible-body contract, not a label.

- `emotion_contract` is required for any emotion gate pass.
- `emotion_semantics` and narrative pose text are diagnostic fallback only; they may explain weak evidence, but must not make final emotion generation valid by themselves.
- `generation_decision.imagegen_validation_allowed === false` means do not call imagegen and do not present the result as a valid emotion pose reference.
- If emotion fails, return the failure reason and alternatives. Use `fallback_structure_prompt_zh` only for structural diagnosis, not final validation.
- Face expression, styling, prop, magazine title, scenery, or English substrings in source names must never satisfy emotion alone.

Hard actions outrank broad affect words:

- `托腮`, `抱臂`, `坐姿`, `跳跃`, `背影离场`, `双手护头/扶头`, `后退` must visibly match the body mechanic when matching rows exist.
- Contact actions require contact. `双手扶头/护头` needs both hands or arms visibly touching, pressing, holding, wrapping, covering, or protecting the head/helmet. Hands merely high above the head, hovering, or explicitly "not touching the head" are not matches.
- If hard action passes but emotion fails, keep the hard action and say the emotion gate failed.

Default references are full-body:

- Ordinary emotion/action requests must use full-body mechanics: head/neck, shoulders, spine, pelvis, arms/hands, legs/feet.
- Use `--framing any` only when the user explicitly asks for close-up, portrait, head-and-shoulders, half-body, upper body, or cropped detail.
- Cropped rows may be useful for structure, but must not be sold as default full-body references.

## Retrieval Workflow

Validate baseline first when answering a user request:

```bash
node scripts/validate_pose_target.mjs --fail-if-incomplete true
```

Generate a reference:

```bash
node scripts/generate_pose_reference.mjs \
  --query "<emotion keywords action>" \
  --person "<character/person description>" \
  --limit 3
```

For explicit partial framing:

```bash
node scripts/generate_pose_reference.mjs \
  --query "<close-up or half-body request>" \
  --person "<character/person description>" \
  --framing any \
  --limit 3
```

Read these fields before answering:

```text
retrieval_policy.hard_action_constraints
retrieval_policy.emotion_profile
matched_references[].hard_action_matched / hard_action_missed
matched_references[].emotion_profile_has_contract
matched_references[].emotion_required_group_misses
matched_references[].emotion_profile_blocking_conflict
matched_references[].emotion_profile_contract_blocks
generation_decision
```

Return in Chinese:

```text
动作参考描述
<pose, hard action gate, emotion gate, body mechanics, lighting distribution, crop/camera>

人体模型简笔画生图提示词
<stick_figure_prompt_zh or explain why null>

验证用 imagegen 英文提示词
<imagegen_prompt_en or explain why null>

生成决策
<generation_decision, especially failures and alternatives>

覆盖率
<1,000 baseline status and full 20k status if checked>
```

## Emotion Profiles

Use the generator's profile gates. Do not invent softer substitutes.

- `joy_release`: requires opened body plus dynamic release such as jump, airborne body, dance, spin, running, large stride, limb swing, or unstable release. Static raised arms or hands near head are not enough.
- `lonely_withdrawal`: requires turning away/leaving, small body in space, lowered head, collapsed shoulders, back light, silhouette, or environmental distance.
- `distress_vulnerability`: requires lowered/averted head, rounded shoulders, collapsed chest, hands near face or hidden hands, low support, and shadow pressure.
- `fear_recoil`: requires backward weight shift, retreat/recoil, guarding face/chest/head, tense raised shoulders, and unstable retreat step. Forward attack is a blocker.
- `defensive_cool`: requires crossed/hidden arms, closed chest, controlled gaze or social distance, and cutting side light or high contrast.
- `calm_elegant`: requires long body line, stable weight, low tension, slow stillness, and soft low-contrast light.
- `bored_waiting`: requires supported body weight, low energy, leaning/sitting support, lowered head/shoulders, and everyday low-contrast or ambient light.

## Annotation Workflow

Refresh full-corpus pending tasks:

```bash
node scripts/build_pose_annotation_tasks.mjs
```

Generate a contact sheet from the full 20k pending queue:

```bash
python3 scripts/build_pose_contact_sheet.py \
  --tasks datasets/fashion_action_reference/pose_annotations/pending_tasks.jsonl \
  --batch <batch_index> --count 12 --columns 3 \
  --out-dir datasets/fashion_action_reference/pose_annotations/contact_sheets_full20k
```

`--count` is images per sheet, not number of sheets. For six parallel sheets, run the command six times with consecutive `--batch` values.

Before assigning annotation work, verify the selected sheets are diverse:

```text
rows per sheet should match --count
unique sha count should equal total rows
adjacent magazine/issue/article repeats should be 0 when possible
each sheet should span multiple magazines, issues, and articles
```

Append full-corpus batches under:

```text
datasets/fashion_action_reference/pose_annotations/builtin_preannotation_batches/full20k_batch_<NNNNN>_idx_<first>_<last>.jsonl
```

Each new row must include:

- detailed body description: head, neck, shoulders, spine, pelvis, arms, hands, legs, feet
- crop/camera: full/three-quarter/half/close-up/cropped detail, direction, angle
- lighting distribution: bright/dark body zones, background/floor shadows, direction, contrast, emotion effect
- `emotion_semantics` with `affect_vector`, `body_signal_vector`, `lighting_signal_vector`, `evidence_zh`, `conflicts_zh`
- `emotion_contract` with `candidate_emotions`, `strength`, `visible_evidence`, `missing_evidence`, `conflicts`, `reject_emotions`
- separated `retrieval.action_tags`, `retrieval.emotion_tags`, `retrieval.camera_tags`, `retrieval.prop_tags`, `retrieval.lighting_tags`

If no usable model body is visible, set `annotation_status: "non_model_detail"` and `pose.body_count: "none"`. Still include semantics and contract fields that explicitly reject human action/emotion use, so strict validation passes.

## Validation Gates

After each new batch, run a strict file-pattern validation:

```bash
node scripts/validate_pose_annotations.mjs \
  --require-emotion-semantics-file-pattern "full20k_batch_002(14|15|16)" \
  --require-emotion-contract-file-pattern "full20k_batch_002(14|15|16)" \
  --require-schema-enums-file-pattern "full20k_batch_002(14|15|16)"
```

Use the actual batch numbers. Then refresh pending:

```bash
node scripts/build_pose_annotation_tasks.mjs
```

For retrieval or prompt changes, run:

```bash
node scripts/validate_pose_retrieval_gates.mjs
```

This gate must cover:

- `兴奋 开心 头盔`: passes joy/release only with contract-backed dynamic motion.
- `兴奋 双手扶头 头盔`: honors both-hands head contact but must not force joy if release evidence fails.
- `无聊 托腮 等待`: passes boredom only with support plus low-energy contract evidence.
- `托腮 坐姿 无聊 游乐场 --framing any`: can use partial framing and still pass hard action plus emotion gates.
- `兴奋 抱臂 全身`: honors crossed arms but must not pass joy without dynamic release.
- `压抑 委屈 想哭 全身`: exposes lowered/collapsed distress evidence.
- `惊恐 警觉 后退 全身`: requires retreat/recoil and must not return attacking/approaching poses as the valid emotion match.

Before claiming final completion of the full objective, run:

```bash
node scripts/validate_pose_annotations.mjs --fail-if-incomplete true
```

Completion requires `unique_annotated_images: 20000`, `pending_images: 0`, and `full_corpus_complete: true`.
