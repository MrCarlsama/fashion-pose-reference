---
name: "fashion-pose-reference"
description: "Use when the user provides an emotion, keyword, action, fashion/cosplay character, or body-pose request and wants a strict body-mechanics pose reference plus a mannequin/stick-figure image-generation prompt."
---

# Fashion Pose Reference Skill

Turn emotion/action words into visible body-pose references for drawing, cosplay preproduction, mannequin prompts, and stick-figure pose generation.

Use it for:
- "孤独 背影 离场"
- "冷淡 抱臂 男模"
- "无聊 托腮 等待"
- "兴奋 双手扶头 头盔"
- "惊恐 警觉 后退"
- "给我一个人体模型简笔画动作参考提示词"

## Core Contract

Emotion is a visible-body contract, not a label.

- Do not validate an emotion from face expression, styling, prop, scenery, title words, or mood words alone.
- A final pose must be described through visible mechanics: head/neck, shoulders, spine, pelvis, arms/hands, legs/feet, weight shift, contact, support, camera/framing, and light direction.
- If the requested emotion fails the body contract, say it failed and give a usable alternative.
- If the hard action passes but the emotion fails, keep the hard action and explain the emotion failure.

## Hard Action Gates

Hard actions outrank broad affect words:

- `托腮`: hand, fist, palm, wrist, or fingers must visibly support chin, cheek, jaw, or lower face.
- `抱臂`: arms must cross, lock, hide, or close over the chest.
- `坐姿`: pelvis and legs must clearly read as seated or supported.
- `跳跃`: feet, weight, or body line must show airborne/dynamic release.
- `背影离场`: torso/head must turn away or move out, with readable leaving direction.
- `双手扶头/护头`: both hands or arms must touch, press, hold, wrap, cover, or protect the head/helmet.
- `后退`: body must show backward weight shift, recoil, retreating step, or unstable withdrawal.

Contact actions require contact. Hands hovering near a target do not count.

## Framing

Default references are full-body.

- Ordinary emotion/action requests should cover head/neck, shoulders, spine, pelvis, arms/hands, legs/feet.
- Use partial framing only when the user explicitly asks for close-up, portrait, head-and-shoulders, half-body, upper body, or cropped detail.
- Cropped detail can help diagnose a gesture, but do not sell it as a full-body reference.

## Emotion Profiles

Use these gates. Do not invent softer substitutes.

- `joy_release`: opened body plus dynamic release such as jump, airborne body, dance, spin, running, large stride, limb swing, or unstable release. Static raised arms are not enough.
- `lonely_withdrawal`: turning away/leaving, small body in space, lowered head, collapsed shoulders, back light, silhouette, or environmental distance.
- `distress_vulnerability`: lowered/averted head, rounded shoulders, collapsed chest, hands near face or hidden hands, low support, and shadow pressure.
- `fear_recoil`: backward weight shift, retreat/recoil, guarding face/chest/head, tense raised shoulders, and unstable retreat step. Forward attack blocks this.
- `defensive_cool`: crossed/hidden arms, closed chest, controlled gaze or social distance, and cutting side light or high contrast.
- `calm_elegant`: long body line, stable weight, low tension, slow stillness, and soft low-contrast light.
- `bored_waiting`: supported body weight, low energy, leaning/sitting support, lowered head/shoulders, and everyday low-contrast or ambient light.

## Workflow

1. Parse the user's hard action, emotion, subject/person, framing, props, and camera constraints.
2. Decide whether the hard action is mechanically possible and what contact/support is required.
3. Apply the relevant emotion profile.
4. If mechanics conflict, report the conflict instead of forcing a valid result.
5. Produce a strict pose reference and mannequin/stick-figure prompt in Chinese.

## Output Format

Always answer in Chinese with these sections:

```text
动作参考描述
<pose, hard action gate, emotion gate, body mechanics, lighting distribution, crop/camera>

人体模型简笔画生图提示词
<simple mannequin/stick-figure prompt, or explain why null>

验证用 imagegen 英文提示词
<English validation prompt, or explain why null>

生成决策
<pass/fail, conflict, missing evidence, alternatives>
```

## Mannequin Prompt Rules

The mannequin/stick-figure prompt must:

- Use a plain neutral body or stick figure.
- Avoid fashion styling, facial beauty, brand names, and decorative atmosphere.
- State contact points clearly.
- State weight shift and support clearly.
- State camera/framing clearly.
- Keep the pose readable before adding any character or costume detail.
