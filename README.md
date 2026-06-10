# Fashion Pose Reference

Contract-backed fashion pose retrieval for drawing, cosplay preproduction, and mannequin/stick-figure image prompting.

This repository is code-only. It does not publish the local image corpus or generated annotation dataset. The scripts expect you to build or provide a local corpus under `datasets/fashion_action_reference/`.

## What Is Included

- Codex skill: `.codex/skills/fashion-pose-reference/SKILL.md`
- Harvest scripts for publicly reachable fashion editorial pages
- Pose annotation task builders, validators, and contact-sheet helpers
- Retrieval logic that separates hard body actions from emotion gates

## What Is Not Included

- Downloaded fashion images
- Full annotation batches
- Contact sheets
- Generated outputs

Those files are intentionally ignored by Git because they are large, source-dependent, and may carry third-party image rights.

## Local Data Layout

Build or place your local corpus here:

```text
datasets/fashion_action_reference/
  manifest.jsonl
  images/
  pose_annotations/
```

`manifest.jsonl` is the source of truth for image provenance. Each row should keep source URL, image URL, local path, dimensions, download method, and `sha256` so the corpus can be audited and rebuilt.

## Harvest Images Locally

```bash
node scripts/harvest_magazine_images.mjs --target 20000 --sources fashionotography,designscene,lemile
```

Smaller smoke test:

```bash
node scripts/harvest_magazine_images.mjs --target 50 --sources designscene
```

Audit the local corpus:

```bash
node scripts/audit_fashion_dataset.mjs --min-count 20000
```

Rename images with magazine and issue month:

```bash
node scripts/rename_fashion_images.mjs --apply
```

## Pose Annotation Workflow

Detailed pose extraction lives under:

```text
datasets/fashion_action_reference/pose_annotations/
```

Generate a diverse 1,000-image target queue:

```bash
node scripts/build_diverse_pose_target.mjs
```

Validate the 1,000-image target:

```bash
node scripts/validate_pose_target.mjs --fail-if-incomplete true
```

Refresh pending tasks for the fixed 1,000-image target:

```bash
node scripts/rebuild_pose_target_pending.mjs
```

Generate contact sheets from pending tasks:

```bash
python3 scripts/build_pose_contact_sheet.py \
  --tasks datasets/fashion_action_reference/pose_annotations/pending_tasks_1000_diverse.jsonl \
  --batch 0 --count 6 --columns 3
```

Generate full-corpus pending tasks only when you intend to annotate the full local corpus:

```bash
node scripts/build_pose_annotation_tasks.mjs
```

Run vision annotation when `OPENAI_API_KEY` is available:

```bash
node scripts/annotate_pose_openai.mjs --limit 100
```

Validate annotation coverage:

```bash
node scripts/validate_pose_annotations.mjs
```

## Retrieval

Generate a skill-style action reference from completed local annotations:

```bash
node scripts/generate_pose_reference.mjs \
  --query "孤独 背影 离场" \
  --person "女性角色" \
  --limit 3
```

Explicit partial framing:

```bash
node scripts/generate_pose_reference.mjs \
  --query "托腮 坐姿 无聊 半身" \
  --person "女性角色" \
  --framing any \
  --limit 3
```

Run retrieval regression gates after changing retrieval or prompt logic:

```bash
node scripts/validate_pose_retrieval_gates.mjs
```

## Completion Rules

Do not claim the 1,000-image pose target is complete unless this passes:

```bash
node scripts/validate_pose_target.mjs --fail-if-incomplete true
```

Do not claim the full local corpus is annotated unless this proves `unique_annotated_images: 20000`, `pending_images: 0`, and `full_corpus_complete: true`:

```bash
node scripts/validate_pose_annotations.mjs --fail-if-incomplete true
```

## License

Code and documentation in this repository are released under the MIT License.

Image files, source editorial pages, and third-party visual content are not included and are not licensed by this repository.
