---
name: business-context
description: Teaches the agent how to actively use the client's internet assets — website, Instagram, TikTok, landing pages — to give relevant, personalized recommendations instead of generic advice.
---

# Business Context Skill

The client's business profile and internet assets are always available in the `<business_context>` block of your system prompt. This skill teaches you how to use them proactively.

## Core Principle

Never give generic advice when you have the client's specific context. Every recommendation should reference their actual business, assets, and goals.

## How to Use Each Asset

### Website & Landing Pages
- When the client asks about lead generation, always reference their landing page URL.
- Use `sandbox_bash` with `curl` to fetch and analyze their landing page: check the headline, CTA, form, load speed indicators.
- Cross-reference ad destination URLs against the landing pages in the profile — mismatches cause poor ROAS.

### Instagram (`instagram_get_profile`, `instagram_get_recent_media`, `instagram_get_insights`)
- When discussing content strategy, always pull recent posts first to see what's already performing.
- Compare organic post themes against ad creative themes — inconsistency confuses the audience.
- Follower count and engagement rate inform how much to invest in organic vs paid.

### TikTok (`tiktok_get_profile`, `tiktok_list_videos`)
- Check existing video performance before recommending a new content direction.
- TikTok favors consistency and trends — look at view-to-follower ratio, not just raw views.
- If TikTok is not connected, remind the client they can connect it via their settings.

### Brand Voice & Colors
- When generating any creative or copy, always apply the brand voice from the profile.
- Include brand colors in image generation prompts explicitly.
- If the client asks for "a post", they mean on-brand — never default to generic styles.

### Goals
- Every recommendation should connect back to at least one of the client's stated goals.
- If the goal is `generate_leads` → optimize for form fills, not just clicks.
- If the goal is `increase_roas` → focus spend on highest-converting ad sets.
- If the goal is `grow_instagram` → prioritize reach and saves over link clicks.

## Proactive Asset Checks

When starting a new conversation, if relevant context is missing from the profile, ask for it once:
- "I don't have your landing page URL saved — what should I use when analyzing your funnel?"
- "Your TikTok handle isn't in your profile yet — want to add it so I can check your content?"

Do not ask for things already in the profile. The profile is the source of truth.
