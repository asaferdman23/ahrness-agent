---
name: ahrness-observability-frontend
description: Design, implement, debug, or review polished Ahrness web interfaces, especially agent activity, run history, traces, status, cost, latency, evaluation, approvals, onboarding, and operational dashboards. Use for changes in frontend/onboarding, src/dashboard.ts, src/onboarding, src/callback-server.ts dashboard routes, or the linked @agent-live/dashboard package; also use for frontend UX audits, responsive/accessibility work, realtime SSE states, and observability information architecture in this repository.
---

# Ahrness Observability Frontend

Build calm, legible interfaces that let a business owner answer three questions quickly: Is my agent healthy? What did it do? What needs me now? Favor trustworthy operational clarity over decorative dashboard density.

## Start with repository truth

1. Read `AGENTS.md` and the relevant sections of `ARCHITECTURE.md`.
2. Read [references/ahrness-surfaces.md](references/ahrness-surfaces.md) to choose the correct implementation seam.
3. Inspect the target and its closest test before editing. Preserve unrelated work.
4. For activity, trace, evaluation, or monitoring UX, also read [references/observability-ux.md](references/observability-ux.md).
5. For implementation or review, use [references/frontend-quality.md](references/frontend-quality.md) as the completion checklist.

Do not mistake this development skill for a runtime agent skill under `src/skills/`.

## Frame the outcome before the screen

Write a one-sentence user outcome before changing UI. Identify:

- primary user: client/business owner first; operator or developer only when explicitly scoped;
- decision: the action the screen should make obvious;
- evidence: the smallest reliable data that supports that decision;
- state model: loading, empty, live, success, partial, stale, error, disconnected, and unauthorized;
- privacy boundary: what the user may see and what must remain hidden.

Do not invent backend data. If the design needs a field that is not persisted or exposed, call out the contract change and implement it only when the task includes backend work.

## Use the Ahrness information hierarchy

For client-facing agent operations, order information like this:

1. **Outcome and attention** — current status, latest result, approval or reconnect needed.
2. **Trend and scope** — time range, volume, success rate, latency, usage/cost when available.
3. **Runs or conversations** — searchable/filterable rows with channel, time, status, duration, and concise preview.
4. **Run detail** — human-readable event sequence plus duration, status, model/tool labels, and error context.
5. **Raw detail** — metadata or JSON behind deliberate disclosure, permission, and redaction.

Keep user language separate from telemetry vocabulary. Say “Waiting for approval” before `approval.waiting`; show exact event identifiers only in technical detail views.

## Design observability as progressive disclosure

- Make every summary drill into the records that explain it.
- Preserve filter and time-range context when navigating into a run and back.
- Offer a chronological narrative by default. Add hierarchy or duration-scaled timelines only when the data supports them.
- Place status, latency, token usage, and cost beside the operation they describe rather than in a detached metrics wall.
- Use color as reinforcement, never as the only carrier of status.
- Distinguish `running`, `completed`, `failed`, and `stale`; never collapse stale into failure or idle.
- Explain empty states with cause and next action. “No runs yet” is different from “No results for these filters.”
- Treat SSE reconnecting, replay, duplication, and fallback polling as visible state transitions, not invisible implementation details.
- Never display chain-of-thought, system prompts, secrets, credentials, raw tokens, or unrestricted tool payloads. Prefer concise action labels and redacted previews.

## Preserve the visual character

Extend the existing Geist-based, near-black/white, Ahrness-green system unless the user asks for a rebrand. Use restrained surfaces, crisp borders, deliberate whitespace, tabular/monospace numerals for telemetry, and one dominant action per region.

Avoid generic dashboard habits: equal-weight card grids, ornamental gradients, excessive pills, charts without decisions, tiny gray text, and motion that implies liveness when no live signal exists. A polished screen may be dense, but its hierarchy must be unmistakable at a glance.

## Implement from semantic structure outward

1. Make the document order and headings meaningful before styling.
2. Centralize repeated tokens and status mappings; do not scatter inline colors or duplicate labels.
3. Render user-controlled strings with the existing escaping pattern. Use `textContent` for realtime DOM updates.
4. Keep local TypeScript imports on `.js` specifiers and strict types intact.
5. Preserve tenant scoping and authentication on every dashboard/API path.
6. Make controls keyboard-operable, visibly focused, labeled, and large enough for touch.
7. Add motion only for state change or spatial continuity; honor `prefers-reduced-motion`.
8. Design narrow screens intentionally. Move secondary detail below primary content instead of shrinking everything.

## Verify the experience

Exercise realistic data, long labels, zero data, one item, errors, stale runs, and live updates. Inspect at approximately 375px, 768px, and 1440px; test keyboard-only use, focus visibility, contrast, reduced motion, and reconnect behavior when relevant.

Add deterministic tests for rendered content, state labels, escaping, authorization boundaries, and event mapping. Then run:

```bash
npm run type-check
npm test
npm run build:frontend
```

Use browser automation or an available in-app browser for visual verification when a runnable surface exists. Report exactly what was and was not verified.

## Review standard

Reject a frontend change if it is attractive but misleading, responsive but inaccessible, live but duplication-prone, detailed but privacy-unsafe, or visually complete without useful empty/error states. The strongest Ahrness UI makes system truth understandable without pretending the agent is more certain or capable than the data proves.
