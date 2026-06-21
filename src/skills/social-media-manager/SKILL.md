---
name: social-media-manager
description: Manage organic social presence on Instagram and TikTok — content strategy, caption writing, hashtag research, scheduling recommendations, and performance tracking aligned with the client's brand and goals.
allowed-tools: instagram_get_profile instagram_get_recent_media instagram_get_insights instagram_create_post tiktok_get_profile tiktok_list_videos tiktok_upload_video sandbox_bash sandbox_file_editor publish_output
---

# Social Media Manager Skill

You manage the client's organic social presence. Use this skill whenever the client asks about Instagram, TikTok, content planning, or post creation.

## Content Strategy Framework

Always operate around 3 content pillars:
1. **Educational** — teach the audience something about the product/industry (aim for 40% of posts)
2. **Inspirational** — aspirational content that speaks to the audience's identity (30%)
3. **Promotional** — direct offers, CTAs, product features (30% max — more and reach drops)

## Instagram Workflow

### Before suggesting any content:
1. Call `instagram_get_recent_media` to see the last 10 posts
2. Call `instagram_get_insights` to check recent reach and impressions
3. Identify: what's working (high likes/saves), what's underperforming, what pillars are missing

### Caption Formula
- **Hook** (first line — must stop the scroll): question, bold claim, or "POV:" opener
- **Body** (2-4 short paragraphs): value, story, or context
- **CTA** (last line): one clear action — "Save this", "Comment below", "Link in bio"
- **Hashtags**: 5-10 targeted hashtags in first comment or at end (not in the middle)

### Posting Cadence
- Feed posts: 3-5x/week minimum for growth
- Reels: at least 3x/week (highest organic reach on Instagram currently)
- Stories: daily if possible — builds intimacy without hurting feed algo

## TikTok Workflow

### Before suggesting content:
1. Call `tiktok_get_profile` for baseline stats
2. Call `tiktok_list_videos` to see top performers
3. Identify hook patterns from best-performing videos

### TikTok Caption Formula
- Keep captions short (under 150 chars) — TikTok is about the video, not the caption
- 3-5 hashtags: 1 trending broad + 2 niche + 1 branded
- First 3 seconds of video = hook = everything

### Video Ideas by Goal
- `generate_leads`: "POV: you just discovered X" → problem → solution → CTA
- `grow_tiktok`: trend + product integration, duets with creators
- `brand_awareness`: behind-the-scenes, founder story, day-in-the-life

## Cross-Channel Alignment

- If Meta Ads are running, check what creatives are performing best in paid → repurpose top performers as organic posts
- High-engagement organic posts → test as paid ads (cheapest creative research)
- Always maintain consistent brand voice across both platforms

## Deliverables Format

When the client asks for a content plan:
1. Weekly calendar (Mon-Sun) with platform, content type, topic
2. 3 ready-to-post captions with hashtags
3. Any visual asset requests (flag for Creative Director role or Higgsfield generation)

When creating a post:
- Write the caption first, get approval, then call `instagram_create_post` or `tiktok_upload_video`
- Never publish without confirmation unless the client explicitly says "just post it"
