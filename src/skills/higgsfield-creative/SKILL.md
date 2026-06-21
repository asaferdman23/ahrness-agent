---
name: higgsfield-creative
description: Generate and edit ad creatives using Higgsfield AI — images, videos, audio, 3D assets, background removal, upscaling, and motion effects. Covers model selection, prompt crafting, and delivering results via WhatsApp.
allowed-tools: generate_image generate_video generate_audio generate_3d upscale_image upscale_video remove_background outpaint_image reframe motion_control share_input_with_higgsfield deliver_higgsfield_output publish_output media_import_url
---

# Higgsfield Creative Skill

You are operating in creative generation mode. Follow these guidelines when generating media assets.

## Model Selection

Before calling a generation tool, call `models_explore` with `action: 'recommend'` and the client's goal if you are unsure which model fits best. Do not invent model IDs.

## Image Generation

- Craft prompts with: subject → style → lighting → composition → color palette.
- For ad creatives, include brand context: product category, target emotion, and CTA if known.
- After generation, offer to upscale (`upscale_image`) to 2K or 4K if the client needs print or large-format quality.

## Video Generation

- Specify aspect ratio (16:9 for YouTube/feed, 9:16 for Reels/Stories, 1:1 for feed square).
- For talking-head or product videos, prefer motion transfer or puppeteer modes in `motion_control`.
- Use `reframe` to reformat existing videos for different placements without re-generating.

## Handling Client-Supplied Media

- When the client shares a WhatsApp attachment, it is saved under `/workspace/inbox/`.
- Before passing any local file to a Higgsfield tool, call `share_input_with_higgsfield` and use its returned URL.
- When the client provides a web URL, call `media_import_url` first and use the returned `media_id`.

## Delivering Results

1. For every completed Higgsfield result URL, call `deliver_higgsfield_output` with the URL and a descriptive `fileName`.
2. For files created locally in the sandbox, call `publish_output` with the file path inside `/workspace/outputs/`.
3. Never claim delivery succeeded unless the tool call returned without error.

## Usage Limits

The client has a daily generation limit. If you receive a limit-reached error, tell the client clearly and do not retry until the next day.

## Prompt Tips for Ad Creatives

- **Urgency**: include phrases like "golden hour lighting", "cinematic depth of field" for premium look.
- **Brand consistency**: if the client has brand colors, mention them explicitly (e.g. "deep navy blue background, white sans-serif text overlay").
- **Negative prompts**: avoid blur, watermarks, extra limbs, text errors.
