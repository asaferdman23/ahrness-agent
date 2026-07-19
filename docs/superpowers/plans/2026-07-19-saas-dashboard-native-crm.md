# SaaS Dashboard and Native CRM

> Status: planned, 2026-07-19. This plan extends the activation-focused
> onboarding release with a customer-facing SaaS home, outcome-led language,
> and a native BizzClaw CRM. It does not authorize implementation or rollout by
> itself.

Companion screen and interaction specification:
[`../specs/2026-07-19-saas-dashboard-native-crm-design.md`](../specs/2026-07-19-saas-dashboard-native-crm-design.md).

## Outcome

A nontechnical business owner should open BizzClaw and understand, without
learning AI or observability terminology, what business result is being pursued,
what was delivered, what needs attention, and how marketing activity is becoming
sales pipeline and verified revenue.

The product promise becomes:

> BizzClaw finds opportunities, prepares the work, follows up, and shows what
> became pipeline and revenue.

CRM is a core BizzClaw capability available to every customer. It is not an
optional dashboard decoration and is not limited to the Pipeline Builder role.
Customers without another CRM use the native pipeline. Customers with an
existing CRM connect it and keep that system as the sales source of truth.

## Product principles

1. **Outcomes before AI jobs.** Lead with the customer's goal and verified
   result, not an internal role name, model action, run, trace, or tool call.
2. **Evidence before attribution claims.** Say that revenue is linked to
   BizzClaw activity only when the stored source and sales outcome support it.
   Do not claim that BizzClaw caused revenue from correlation alone.
3. **One useful CRM for everyone.** A customer can add people, track
   opportunities, schedule follow-ups, and record wins without buying or
   connecting another product.
4. **External CRM compatibility.** HubSpot is the first connector and Pipedrive
   is the second. When connected, the external CRM owns sales records while
   BizzClaw maintains a synchronized projection and its own verified work
   history.
5. **Progressive disclosure.** The home page shows status, attention, recent
   results, and pipeline. Full records, history, and technical activity are one
   level deeper.
6. **Safe assistance, not silent sales automation.** Reading, organizing, and
   preparing follow-ups may be proactive. Outbound contact, destructive changes,
   material value changes, and won/lost decisions require explicit authority.
7. **Mobile is a primary surface.** Business owners should be able to inspect
   pipeline and approve the next action from a phone without using a compressed
   desktop table.

## Customer vocabulary

Internal identifiers and runtime role IDs stay stable. Customer-facing copy uses
the following dictionary:

| Internal or technical term | Customer-facing term |
|---|---|
| Agent | Your BizzClaw teammate |
| Role | Business goal |
| Automation | Recurring task |
| Integration | Connected app |
| Capability | What BizzClaw can do |
| Run | Task |
| Run completed | Result delivered |
| Run failed | Could not finish |
| Pending approval | Needs your OK |
| Token expired | Connection needs renewing |
| Required platform | Connect to unlock this |
| No runs yet | Send your first request |
| Agent live | Ready on WhatsApp |
| Activity timeline | Recent work |
| Output published | File ready |
| Stale run | Stopped before finishing |

Role selection leads with an outcome rather than a simulated employee title:

| Runtime role | Customer-facing name | Promise |
|---|---|---|
| `marketing-manager` | Growth Planner | Find the best opportunities to grow leads and revenue |
| `creative-director` | Creative Producer | Create campaign-ready images, videos, and copy |
| `ads-analyst` | Ad Spend Optimizer | Find wasted spend and improve advertising returns |
| `social-media-manager` | Audience Builder | Grow attention, engagement, and consistent content |
| `gtm-operator` | Pipeline Builder | Turn posts, replies, and follow-ups into sales conversations |
| `personal-assistant-dev` | Business Assistant | Save time on research, writing, planning, and technical work |

The onboarding choice may use a verb-led headline above the stable name, such as
“Stop wasting advertising budget” or “Turn attention into sales conversations.”

## SaaS information architecture

Use a restrained top navigation because four destinations do not justify a
permanent desktop sidebar:

- **Home** — status, attention, verified results, and pipeline summary;
- **Pipeline** — people, opportunities, stages, values, and follow-ups;
- **Recent work** — customer-language view over Agent Live runs and events;
- **Connections** — channels, marketing platforms, and external CRM sync.

Account identity and sign-out live in the user menu rather than the primary page
content.

### Home

The page hierarchy is:

1. personalized greeting and the current business goal;
2. truthful readiness statement with one primary action;
3. a conditional “Needs your attention” region;
4. recent verified results;
5. pipeline summary;
6. a compact “Your BizzClaw teammate” configuration summary.

Avoid an equal-weight metric-card wall. Do not show a chart unless it answers a
business decision and its source and time window are explicit.

Example desktop structure:

```text
┌─────────────────────────────────────────────────────────────────┐
│ BizzClaw     Home  Pipeline  Recent work  Connections     User  │
├─────────────────────────────────────────────────────────────────┤
│ Good morning, Sarah.                                            │
│ Your Pipeline Builder is ready.                  [Open WhatsApp]│
├─────────────────────────────────────────────────────────────────┤
│ Needs your attention — approve the follow-up draft    [Review] │
├───────────────────────────────────────┬─────────────────────────┤
│ Recent results                        │ Pipeline this month     │
│ Weekly plan delivered                 │ €24,500 open value      │
│ Three follow-ups prepared             │ 18 new opportunities    │
│ Meta Ads check could not finish       │ 5 need follow-up        │
│ [View all recent work]                │ [Open pipeline]         │
├───────────────────────────────────────┴─────────────────────────┤
│ Your BizzClaw teammate: goal, connected apps, recurring tasks  │
└─────────────────────────────────────────────────────────────────┘
```

On narrow screens the order is readiness, attention, primary action, pipeline,
recent results, then configuration. Nothing important depends on hover.

### Truthful value proof

The first release may show only values supported by persisted evidence:

- completed tasks;
- successful delivery events;
- published files;
- opportunities created or advanced;
- follow-ups due or completed;
- won opportunity value recorded manually or synchronized from a CRM;
- failed delivery, stale work, and connection failures.

Do not show “hours saved,” “leads converted,” attributed revenue, generated
revenue, or return on investment until a defined evidence contract supports the
number. Prefer “€6,200 in won business linked to BizzClaw activity” over
“BizzClaw generated €6,200.”

## Native BizzClaw CRM

Every tenant receives three plain-language areas:

- **People** — leads and customers;
- **Opportunities** — potential sales and their monetary value;
- **Follow-ups** — the next action and when it is due.

The fixed first-release stages are:

1. New lead
2. Contacted
3. Replied
4. Qualified
5. Proposal sent
6. Won
7. Lost

Custom pipelines and stage editing are later capabilities. A fixed initial
pipeline keeps reporting and agent behavior deterministic.

### Persisted model

CRM data lives under `store/clients/<clientId>/` and never enters Git. A
tenant-owned SQLite database provides transactional writes and indexed queries.
Every query remains tenant-bound even though the file boundary already isolates
the tenant.

The minimum entities are:

- `Contact`: name, company, encrypted email and phone, consent state, source,
  created time, and last activity time;
- `Opportunity`: contact, title, stage, value in minor currency units, currency,
  expected close date, won/lost timestamps, and loss reason;
- `Activity`: immutable note, message, form submission, stage change, task,
  delivery, or imported CRM event with actor and source run ID;
- `FollowUp`: contact or opportunity, plain-language next action, due time,
  completion state, and completion time;
- `Attribution`: first touch, latest touch, source, campaign, external evidence,
  confidence state, and the activity or import that established it;
- `ExternalLink`: provider, external object type and ID, sync cursor, last sync,
  and conflict state.

Sensitive contact fields and notes use the existing `AGENT_MASTER_KEY` vault
pattern. Normalized keyed hashes support exact email/phone deduplication without
persisting searchable plaintext. Monetary values use integers plus an ISO
currency code rather than floating-point amounts.

Every mutation records an immutable activity entry so the customer can see who
or what changed the pipeline.

### Attribution language

Attribution has explicit states:

- **Verified** — a form, CRM sync, explicit customer update, or signed source
  event connects the opportunity and result;
- **Influenced** — BizzClaw work is linked to the opportunity, but causation is
  not proven;
- **Unknown** — no reliable source is stored.

The UI always displays the state and evidence source. It never silently upgrades
an inferred relationship into verified revenue.

### Lead capture

The first production release supports:

1. add or update a person through WhatsApp;
2. add or edit from the Pipeline screen;
3. CSV import and export with preview, validation, and duplicate reporting;
4. a signed website-form webhook;
5. Meta lead-form ingestion when the connected Meta account grants the required
   permissions;
6. automatic source and campaign fields when the inbound evidence supplies
   them.

Imports are idempotent and use normalized email/phone hashes for duplicate
detection. Unknown or conflicting matches are presented for review rather than
merged silently.

## Agent tools and authority

Add a `src/crm/` subsystem with a typed store and a `createCrmTools(clientId)`
factory. CRM is a native app capability, not an MCP definition.

Read tools:

- search people and opportunities;
- summarize pipeline;
- list follow-ups due;
- show an opportunity's verified history and attribution.

Write tools:

- add a person or opportunity;
- add a note;
- record an interaction;
- schedule or complete a follow-up;
- move an opportunity to a new stage;
- record attribution evidence.

Read operations may run without confirmation. Creating ordinary internal notes
and follow-ups is reversible and audited. Outbound messages, deletions, merges,
material value changes, and moving an opportunity to Won or Lost require
explicit confirmation. No agent tool permanently deletes CRM history.

All roles receive the safe CRM tools. The Pipeline Builder role receives
additional instructions to use the pipeline proactively, while other roles link
their work to contacts and opportunities only when there is reliable context.

## Server and browser contracts

Authenticated, tenant-scoped JSON endpoints:

- `GET /api/crm/summary`
- `GET|POST /api/crm/contacts`
- `GET|PATCH /api/crm/contacts/:id`
- `GET|POST /api/crm/opportunities`
- `GET|PATCH /api/crm/opportunities/:id`
- `GET|POST /api/crm/follow-ups`
- `POST /api/crm/activities`
- `POST /api/crm/import/preview`
- `POST /api/crm/import/commit`
- `GET /api/crm/export`

Browser requests never choose a tenant ID. The server derives tenant identity
from the authenticated session. Mutations require same-origin requests and CSRF
protection, strict body schemas, size limits, and allowlisted fields.

Inbound lead webhooks use a separate signed endpoint with timestamp and replay
protection. They do not accept browser sessions or arbitrary tenant IDs.

## External CRM connectors

Do not force CRM providers into `src/mcps/registry.ts`; that registry assumes an
MCP client and is the wrong abstraction for bidirectional synchronization.
Create `src/crm/connectors/` with a provider adapter contract for OAuth, contact
and opportunity mapping, cursors, idempotency, retries, and conflict reporting.

### HubSpot first

Use OAuth with the minimum contact and deal scopes. Store encrypted refresh and
access tokens using the existing connection-security pattern. HubSpot remains
the source of truth for connected sales objects; BizzClaw stores external IDs,
a synchronized projection, attribution evidence, and its own activity links.

Reference:
[HubSpot CRM contacts](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide)
and
[HubSpot OAuth](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide).

### Pipedrive second

Map persons, deals, stages, values, notes, and activities through OAuth. Use
provider cursors and external IDs for idempotent synchronization.

Reference:
[Pipedrive Persons](https://developers.pipedrive.com/docs/api/v1/Persons),
[Pipedrive Deals](https://developers.pipedrive.com/docs/api/v1/Deals), and
[Pipedrive OAuth](https://developers.pipedrive.com/docs/api/v1/Oauth).

Salesforce and custom CRM adapters remain out of the initial release.

### Sync rules

- Native mode: BizzClaw is the source of truth.
- Connected mode: the external CRM is the source of truth for sales records.
- BizzClaw-originated changes write through with an idempotency key, then update
  the local projection only after provider confirmation.
- Provider failures remain queued with visible retry state and never pretend to
  be synchronized.
- Field conflicts are shown for review; the system does not use last-write-wins
  for monetary value, Won/Lost state, or contact identity.
- Connector failures fail soft for agent delivery and do not block WhatsApp.

## Visual system

The dashboard uses the same maintained BizzClaw material as activation
onboarding:

- EB Garamond display type and Inter interface copy;
- `#f5f5f5` canvas, white cards, and stone `#0c0a09` ink;
- mint `#a7e5d3` for primary actions and `#0fa300` for verified state;
- peach, lavender, sky, and rose only as restrained atmosphere;
- the local optimized mascot asset;
- quiet shadows and borders, 24 px primary cards, and pill actions.

Use semantic headings and lists before styling. The pipeline may be a horizontal
board on wide screens, but becomes a filtered stacked list on mobile. Drag and
drop is optional enhancement; every stage move must also work through a labeled
keyboard-accessible control.

## Existing behavior to correct

- Replace the five equal-weight dashboard stat cards with status, attention,
  results, and pipeline hierarchy.
- Remove old “step N of 6” dashboard copy and use activation-v2 readiness.
- Missing marketing integrations unlock capability but do not make the core
  teammate inactive.
- Replace “required connection” alerts with the specific outcome that remains
  unavailable.
- Include actual recent Agent Live runs in `lastActivityAt` and the recent-results
  model.
- Escape user names, email values, avatar URLs, CRM values, and every
  user-controlled server-rendered string.
- Align `/dashboard/activity` with the shared BizzClaw shell and customer
  vocabulary so it no longer appears to be a separate product.

## Implementation seams

- `src/dashboard.ts`: shared app shell, Home and Pipeline rendering, business
  vocabulary, responsive and accessible states.
- `src/callback-server.ts`: authenticated dashboard and CRM routes, tenant-bound
  view models, readiness, and connector callbacks.
- `src/crm/types.ts`: domain types and validation boundaries.
- `src/crm/store.ts`: tenant-owned SQLite schema, migrations, transactions, and
  encrypted field handling.
- `src/crm/tools.ts`: safe read/write agent tools and confirmation boundaries.
- `src/crm/attribution.ts`: evidence mapping and customer-facing attribution
  states.
- `src/crm/import.ts`: CSV preview, validation, dedupe, and commit.
- `src/crm/connectors/`: HubSpot and later Pipedrive adapters.
- `src/agent.ts`: register the CRM tool factory for every client-built agent.
- `src/roles/registry.ts`: customer-facing outcome labels while preserving role
  IDs and runtime prompt contracts.
- `frontend/onboarding/`: use the same outcome naming during selection and
  launch.
- `vendor/agent-live/packages/dashboard`: shared customer-language recent-work
  shell, or an expanded host-theme contract followed by a pinned submodule
  update.
- `ARCHITECTURE.md`: document the final CRM persistence, authority, and sync
  contracts after implementation.

## Delivery phases

### Phase 1 — SaaS home and language

- Shared BizzClaw app shell and top navigation.
- Activation-v2 readiness and corrected links.
- Status, attention, recent results, and compact teammate summary.
- Customer vocabulary and outcome-led role presentation.
- Recent-work page aligned to the same shell.

### Phase 2 — Native CRM foundation

- Tenant-owned CRM schema and migrations.
- People, opportunities, activities, follow-ups, and fixed stages.
- Pipeline summary and responsive Pipeline screen.
- Safe CRM agent tools and immutable audit activity.
- Manual dashboard and WhatsApp creation/update flows.

### Phase 3 — Capture and attribution

- CSV preview/import/export.
- Signed website-form lead ingestion.
- Meta lead-form capture.
- Verified/influenced/unknown attribution evidence.
- Dashboard pipeline and won-value proof.

### Phase 4 — External sync

- HubSpot OAuth and bidirectional write-through with conflict handling.
- Operational retry state and reconnect UX.
- Pipedrive connector after HubSpot production stability.

## Tests and verification

Unit and integration coverage must include:

- tenant isolation on every read and mutation;
- CRM schema migration and transaction rollback;
- encrypted contact data and exact duplicate hashes;
- stage transitions, won/lost confirmation, and immutable activity history;
- attribution state and evidence mapping;
- webhook signature, timestamp, replay, and size validation;
- CSV preview, invalid rows, duplicates, idempotent commit, and export;
- connector refresh, pagination, retry, idempotency, and conflict behavior;
- CRM tools, permission boundaries, and confirmation requirements;
- server-rendered escaping and unauthorized route behavior;
- dashboard setup, empty, healthy, working, attention, partial-sync, failed, and
  stale states;
- keyboard pipeline movement, focus visibility, and mobile list behavior.

Required checks:

```bash
npm run type-check
npm test
npm run build:frontend
```

Render and inspect Home, Pipeline, Recent work, and Connections at approximately
375 px, 768 px, and 1440 px. Test keyboard-only navigation and reduced motion.

## Rollout and success measures

Ship behind separate flags for the dashboard shell, native CRM, inbound capture,
and each external connector. Seed internal/demo tenants before customer rollout.

Monitor:

- users who add a first person or opportunity;
- time from onboarding to first pipeline record;
- opportunities advanced and follow-ups completed;
- verified won value linked to BizzClaw activity;
- duplicate/import failures;
- external sync delay, retry volume, and conflict rate;
- seven-day return rate for customers with and without CRM activation.

Never use onboarding completion or dashboard page views alone as proof of CRM
value.

## Initial non-goals

- customizable pipelines and arbitrary fields;
- email inbox hosting or a full outbound sequencer;
- unapproved automated outreach;
- lead scraping or spam automation;
- Salesforce, custom enterprise objects, forecasting, or territory management;
- causal multi-touch attribution presented as certainty;
- replacing a connected external CRM's full user interface.
