# Ahrness frontend surfaces

Use this map before choosing files. The repository has multiple presentation stacks; do not assume a single SPA.

## Surface map

| User surface | Source of truth | Rendering model | Verification seam |
|---|---|---|---|
| Login and account dashboard | `src/dashboard.ts` | Server-rendered HTML/CSS/JS strings | `src/dashboard.test.ts`; `/login`, `/dashboard` |
| Six-step onboarding | `frontend/onboarding/src/main.ts`, `styles.css`, `index.html` | Vite client app using JSON endpoints | `npm run dev:onboarding:api` + `npm run dev:frontend`; `npm run build:frontend` |
| Onboarding API/static host | `src/onboarding/server.ts` | Node HTTP handler, JSON, SSE, legacy server HTML | colocated onboarding tests and full test suite |
| Account/dashboard routing | `src/callback-server.ts` | Authenticated Node server | route/session tests and full test suite |
| Agent activity | `@agent-live/dashboard` from `file:../agent-live/packages/dashboard` | Separate local package mounted by `src/callback-server.ts` | package tests in `../agent-live`; Ahrness integration tests |
| Observability data | `@agent-live/sdk` from `file:../agent-live/packages/sdk` | Tenant-scoped SQLite store + pub/sub | SDK tests in `../agent-live`; delivery/integration tests here |

Before editing `../agent-live`, confirm that the task includes the sibling package and inspect its independent Git state. A change there is not an Ahrness repository change even though the local file dependency makes it immediately visible.

## Current product flow

Onboarding collects a business profile, role, automations, platform connections, and WhatsApp link. The account dashboard summarizes readiness, business knowledge, capabilities, automations, approvals, alerts, and latest activity. `/dashboard/activity` mounts the Agent Live package for tenant-scoped run history and an SSE event stream.

The primary audience is a marketing client, not an observability engineer. Preserve business-language labels and reveal technical identifiers only on demand.

## Existing visual vocabulary

The customer-facing brand is Bizzclaw. Onboarding follows the sibling
`bizz-claw-landing` material system:

- EB Garamond for editorial display type and Inter for interface/body copy
- stone ink `#0c0a09` on white cards and a `#f5f5f5` canvas
- mint `#a7e5d3` for brand actions and dark green `#0fa300` for verified state
- peach `#f4c5a8`, lavender `#c8b8e0`, sky `#a8c8e8`, and rose `#e8b8c4` only as atmospheric accents
- quiet borders/shadows, large card radii, and fully pill-shaped actions
- compact uppercase labels for metadata and deliberate mobile breakpoint behavior

The landing repository currently has no `design.md`; use its `src/app/globals.css`,
`README.md`, and `marketing/launch-drop/CONTENT-PACK.md` as the brand sources.
The onboarding mascot is a local optimized copy at
`frontend/onboarding/public/bizzclaw-mascot.png`.

Treat this as a foundation, not a reason to duplicate CSS. Consolidate tokens when a task touches enough of the system to justify it.

## Agent Live data contract

Runs expose: id, tenant, session key, channel, status, model, input/output previews, input/output tokens, timestamps, duration, error code, and optional external trace id.

Run statuses are exact: `running`, `completed`, `failed`, `stale`.

Events are append-only and ordered by `sequence`:

- run: `run.received`, `run.queued`, `run.completed`, `run.failed`
- context: `context.loading`, `context.loaded`
- model: `model.started`, `model.completed`, `model.failed`
- tool: `tool.started`, `tool.completed`, `tool.failed`
- approval: `approval.waiting`, `approval.approved`, `approval.cancelled`
- output: `output.published`
- delivery: `delivery.started`, `delivery.completed`, `delivery.failed`

The mounted API provides paginated run lists, tenant-checked run detail, and SSE with `Last-Event-ID` replay plus heartbeat. Preserve ordering, idempotent rendering, auth, tenant ownership checks, and polling fallback.

## Repository contracts that affect UI

- Local TypeScript imports use `.js` specifiers under NodeNext ESM.
- User/client data remains tenant-scoped; never leak cross-tenant activity.
- Secrets and OAuth tokens never enter HTML, logs, screenshots, or telemetry.
- Raw chain-of-thought is intentionally excluded. Show action summaries and verified events.
- Best-effort observability must fail soft and never block message delivery.
- Run `npm run type-check` and `npm test` before declaring completion.
