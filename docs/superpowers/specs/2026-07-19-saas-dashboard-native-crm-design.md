# BizzClaw SaaS Dashboard and Native CRM — Complete Experience Specification

> Status: design-ready, 2026-07-19. Companion to
> [`../plans/2026-07-19-saas-dashboard-native-crm.md`](../plans/2026-07-19-saas-dashboard-native-crm.md).
> This document defines the customer-facing screen system and interaction
> contract. Backend implementation remains governed by the companion plan,
> `AGENTS.md`, and `ARCHITECTURE.md`.

## 1. Experience outcome

A nontechnical business owner can open BizzClaw and answer four questions in
less than ten seconds:

1. Is BizzClaw ready and working?
2. What useful result did it deliver?
3. What needs my attention now?
4. Is the work creating sales opportunities and verified revenue?

The interface should feel like a focused SaaS product, not an AI debugger, a
generic admin template, or a pretend employee-management system.

## 2. Primary user and product posture

The primary user is an owner, founder, marketer, or small team lead. They know
their customers and goals but should not need to understand models, tokens,
traces, MCPs, OAuth, webhooks, sync cursors, or attribution theory.

The product posture is:

- BizzClaw is a **teammate** that helps produce business outcomes;
- the selected role is a **business goal**, not a simulated job title;
- the dashboard presents **verified results**, not invisible reasoning;
- CRM is a simple operating system for people, opportunities, and follow-ups;
- technical evidence remains available only behind deliberate disclosure.

## 3. Navigation and routes

### 3.1 Primary navigation

Use a top application bar at desktop and a compact top bar plus bottom
navigation at phone widths.

| Label | Route | Customer question |
|---|---|---|
| Home | `/dashboard` | What matters now? |
| Pipeline | `/dashboard/pipeline` | Where are my sales opportunities? |
| Recent work | `/dashboard/work` | What did BizzClaw do and deliver? |
| Connections | `/dashboard/connections` | What can BizzClaw access? |

The user menu contains **Account settings** and **Sign out**. Do not place sign
out in the main content.

Compatibility routes:

- `/dashboard/activity` redirects to `/dashboard/work` while preserving useful
  filters;
- old onboarding step links continue to resolve, but dashboard links use the
  activation-v2 customer phases;
- existing Agent Live JSON and SSE APIs remain tenant-scoped data sources.

### 3.2 Pipeline secondary navigation

The Pipeline area uses three secondary tabs:

- **Opportunities** — active and closed potential sales;
- **People** — leads and customers;
- **Follow-ups** — overdue, due today, and upcoming actions.

Tabs are real links with URL state, not JavaScript-only buttons. Deep links and
browser back navigation must preserve the selected view and filters.

### 3.3 Route inventory

| Screen | Route |
|---|---|
| Sign in | `/login` |
| Home | `/dashboard` |
| Opportunities | `/dashboard/pipeline` |
| Opportunity detail | `/dashboard/pipeline/opportunities/:id` |
| People | `/dashboard/pipeline/people` |
| Person detail | `/dashboard/pipeline/people/:id` |
| Follow-ups | `/dashboard/pipeline/follow-ups` |
| Import people | `/dashboard/pipeline/import` |
| Recent work | `/dashboard/work` |
| Work detail | `/dashboard/work/:runId` |
| Connections | `/dashboard/connections` |
| CRM connection detail | `/dashboard/connections/crm` |
| CRM sync conflicts | `/dashboard/connections/crm/conflicts` |
| Account settings | `/dashboard/settings` |

## 4. Customer vocabulary

### 4.1 Global dictionary

| Never lead with | Use instead |
|---|---|
| Agent | Your BizzClaw teammate |
| Role | Business goal |
| Automation | Recurring task |
| Integration / MCP | Connected app |
| Capability | What BizzClaw can do |
| Run / trace | Task |
| Run history | Recent work |
| Run completed | Result delivered |
| Run failed | Could not finish |
| Stale run | Stopped before finishing |
| Pending approval | Needs your OK |
| Output published | File ready |
| Required platform | Connect to unlock this |
| Token expired | Connection needs renewing |
| Sync cursor | Last checked |
| Conflict | Changes need review |
| CRM record/object | Person or opportunity |

Internal identifiers may appear only in an expandable **Technical details**
region intended for support and debugging.

### 4.2 Business-goal names

| Runtime ID | Name shown to customers | Supporting promise |
|---|---|---|
| `marketing-manager` | Growth Planner | Find the best opportunities to grow leads and revenue |
| `creative-director` | Creative Producer | Create campaign-ready images, videos, and copy |
| `ads-analyst` | Ad Spend Optimizer | Find wasted spend and improve advertising returns |
| `social-media-manager` | Audience Builder | Grow attention, engagement, and consistent content |
| `gtm-operator` | Pipeline Builder | Turn attention and follow-ups into sales conversations |
| `personal-assistant-dev` | Business Assistant | Save time on research, writing, planning, and technical work |

### 4.3 Status language

| System state | Primary label | Supporting copy |
|---|---|---|
| WhatsApp verified, idle | Ready on WhatsApp | Send a request whenever you are ready. |
| Run received/queued | Request received | BizzClaw will start shortly. |
| Context loading | Preparing | Gathering the information needed for this task. |
| Model/tool active | Working on it | Your latest request is in progress. |
| Approval waiting | Needs your OK | Review the prepared action before it continues. |
| Delivery active | Sending your result | The work is finished and being delivered. |
| Completed and delivered | Result delivered | Sent successfully. |
| Completed, file published | File ready | Your file is ready to open or download. |
| Failed | Could not finish | Review what happened and try again. |
| Stale | Stopped before finishing | The task stopped unexpectedly and can be retried. |
| SSE reconnecting | Updating connection | Recent information may be delayed. |
| Polling fallback | Updates may be delayed | Refreshing periodically while live updates reconnect. |

## 5. Visual system

### 5.1 Brand materials

Use the same material system as activation onboarding:

- display type: **EB Garamond**, weight 300–500;
- body and controls: **Inter**, weight 400–700;
- telemetry values only: a restrained system monospace stack;
- local mascot: `/onboarding/bizzclaw-mascot.png`;
- canvas: `#f5f5f5`;
- paper: `#ffffff`;
- ink: `#0c0a09`;
- body: `#4e4e4e`;
- muted: `#777169`;
- hairline: `#e7e5e4`;
- strong hairline: `#d6d3d1`;
- brand mint: `#a7e5d3`;
- verified green: `#0fa300`.

Peach `#f4c5a8`, lavender `#c8b8e0`, sky `#a8c8e8`, and rose `#e8b8c4`
are atmosphere only. They never communicate status.

Semantic colors require a text or icon companion:

- verified/success: dark green on a pale mint surface;
- attention: dark amber on a pale amber surface;
- failure: dark red on a pale red surface;
- informational: stone or blue-gray on a neutral surface.

### 5.2 Layout

- maximum application width: `1180px`;
- desktop gutter: `24px` minimum;
- phone gutter: `16px`;
- desktop header height: approximately `72px`;
- main content top spacing: `32px`;
- primary card radius: `24px`;
- secondary card radius: `16px`;
- input and compact control radius: `10–12px`;
- primary action and navigation chips: fully pill-shaped;
- default control height: `44px`; primary hero action may use `48px`;
- touch targets: at least `44 × 44px`.

Breakpoints are behavior-based:

- **phone:** below `600px`;
- **tablet:** `600–899px`;
- **desktop:** `900px` and above.

At `1440px`, content remains centered at `1180px`; it does not stretch into a
wall of empty cards. At `375px`, the page never scrolls horizontally.

### 5.3 Typography

- page title: EB Garamond, `clamp(2.25rem, 4vw, 3.75rem)`, tight leading;
- section title: EB Garamond, `1.55–2rem`;
- card title: Inter, `0.9–1rem`, weight 650;
- body: Inter, `0.9–1rem`, line-height `1.5–1.65`;
- eyebrow: Inter or monospace, `0.65–0.7rem`, uppercase, tracked;
- numeric pipeline value: tabular figures, never decorative display type.

### 5.4 Motion

Use motion only for spatial continuity and confirmed state change:

- menu/drawer: `160–220ms` opacity and translation;
- moving a stage: the card settles into the new group after server confirmation;
- toast: short entrance and timed dismissal only for noncritical success;
- no continuous pulsing unless the server has confirmed active work;
- `prefers-reduced-motion` removes translation and continuous animation.

## 6. Shared application shell

### 6.1 Desktop header

```text
┌─────────────────────────────────────────────────────────────────────┐
│ [Mascot] BizzClaw   Home  Pipeline  Recent work  Connections  [SM] │
└─────────────────────────────────────────────────────────────────────┘
```

- The mascot and wordmark link to Home.
- The current navigation item uses weight and a quiet mint underline or surface;
  color alone is insufficient.
- The user trigger shows initials/avatar and an accessible name such as “Open
  account menu.”
- The menu contains the account email, Account settings, and Sign out.

### 6.2 Phone shell

The top bar contains the wordmark and account trigger. A four-item bottom bar
contains Home, Pipeline, Work, and Connections. Icons always include visible
labels. The bar respects safe-area insets and does not cover form actions.

### 6.3 Global feedback

- **Toast:** saved, follow-up completed, retry started, connection restored.
- **Inline alert:** validation, sync delay, failed mutation, permission issue.
- **Dialog:** consequential confirmation only.
- **Drawer:** quick create/edit on desktop; becomes a full-height sheet on phone.
- **Skeleton:** initial page or section loading; it must preserve the expected
  content shape and stop on error.
- **Live status:** “Live,” “Updating connection,” or “Updates may be delayed”
  appears beside Recent work, not as an unexplained colored dot.

Focus moves to the first meaningful heading after full-page navigation, to the
drawer heading after open, and back to the invoker after close.

## 7. Screen specification: Sign in

### User outcome

Understand the product and enter through one trustworthy action.

### Content

- mascot and BizzClaw wordmark;
- headline: **“Your business, moving forward.”**
- support: “BizzClaw helps turn marketing work into follow-ups, sales
  opportunities, and measurable results.”
- primary action: **Continue with Google**;
- privacy support in plain language;
- inline failure message with **Try again**.

Do not mention agents, models, dashboards, CRM objects, or OAuth.

### Layout

A single centered paper card on the branded canvas. Maximum width `420px`. The
Google action remains a familiar white provider button rather than mint, because
the provider identity matters more than brand emphasis here.

## 8. Screen specification: Home

### User outcome

Know the current business status, see the newest value, and take the single most
important next action.

### Desktop wireframe

```text
┌──────────────────────────────────────────────────────────────────────┐
│ GOOD MORNING                                                        │
│ Sarah, your Pipeline Builder is ready.              [Open WhatsApp] │
│ Turn attention and follow-ups into sales conversations.             │
├──────────────────────────────────────────────────────────────────────┤
│ NEEDS YOUR ATTENTION                                                 │
│ Follow-up for Acme is ready for your OK.                [Review]    │
├────────────────────────────────────────┬─────────────────────────────┤
│ Recent results                         │ Pipeline this month         │
│ ✓ Weekly growth plan delivered   12m   │ €24,500 open value         │
│ ✓ 3 follow-ups prepared          2h    │ 18 active opportunities    │
│ ! Meta Ads check could not finish 1d   │ 5 need follow-up           │
│ [View all recent work]                  │ [Open pipeline]            │
├────────────────────────────────────────┴─────────────────────────────┤
│ Your BizzClaw teammate                                         [›] │
│ Pipeline Builder · 3 connected apps · 2 recurring tasks             │
└──────────────────────────────────────────────────────────────────────┘
```

### Hero variants

**Ready**

- heading: “{First name}, your {goal name} is ready.”
- support: role promise;
- action: **Open WhatsApp**.

**Working**

- heading: “BizzClaw is working on your latest request.”
- support: safe task label or “Started {relative time}.”
- action: **See progress**.

**Setup incomplete**

- heading: “Finish connecting WhatsApp to start receiving results.”
- support names the remaining core launch step only;
- action: **Continue setup**.

Missing optional connected apps never changes the core status to inactive.

### Attention region

Render only when there is an actionable item. Order:

1. approval waiting;
2. failed delivery;
3. external CRM sync conflict;
4. expired or failed connection;
5. overdue follow-up;
6. incomplete personalization.

Show at most the highest-priority item plus “{n} more.” Every item has a concrete
verb: Review, Retry, Renew connection, Follow up, or Improve profile. Do not use
“FYI,” “warning,” or “action required” without describing the action.

### Recent results

Show the latest three customer-language results. Each row contains status icon,
result title, relative time, and optional evidence preview. Clicking opens Work
detail. Do not show token counts, model names, or internal event types.

Empty state:

- heading: **“Your first result will appear here.”**
- support: “Send BizzClaw a request in WhatsApp and the delivered work will be
  saved here.”
- action: **Send your first request**.

### Pipeline summary

Show only after CRM is enabled. Values have an explicit window:

- open opportunity value;
- active opportunity count;
- follow-ups overdue or due today;
- won value this month only when recorded.

Every value links to the filtered supporting records. Mixed currencies are not
summed; show “Multiple currencies” and group values by currency.

CRM empty state:

- heading: **“Start proving what turns into business.”**
- support: “Add your first lead or import an existing list.”
- actions: **Add a person** and secondary **Import CSV**.

### Mobile order

Hero → primary action → attention → pipeline summary → recent results → teammate
summary. The desktop two-column row becomes a single column. The primary action
is full width.

## 9. Screen specification: Opportunities

### User outcome

See every active sales opportunity, understand its next step, and move it
forward safely.

### Header

- eyebrow: **Pipeline**;
- title: **“Opportunities”**;
- support: “Track potential sales from first conversation to a clear result.”;
- primary action: **Add opportunity**;
- secondary action: **Import**.

Below the header, show a single summary sentence rather than four equal cards:

> €24,500 open across 18 opportunities · 5 need follow-up

The amount and counts link to filtered records.

### Views and filters

- view switch: **Active**, **Won**, **Lost**;
- search by person, company, or opportunity title;
- filters: stage, source, follow-up state, currency;
- sort: most recently active, highest value, oldest follow-up;
- filters persist in URL query parameters;
- **Clear filters** appears only when filters are active.

### Desktop active board

Use five columns:

1. New lead
2. Contacted
3. Replied
4. Qualified
5. Proposal sent

Won and Lost are closed views, not squeezed into the active board. Each column
shows count and currency-aware total. Each opportunity card shows:

- opportunity title;
- person and company;
- value and currency, or “Value not added”;
- next follow-up and overdue state;
- source label when verified;
- sync state only when it needs attention.

Cards are links. Drag-and-drop is progressive enhancement. Keyboard and touch
users use **Move to…**. The UI updates only after the server confirms the stage
change; failures restore the original stage and explain why.

### Phone and tablet list

Do not render a horizontally compressed board. Use a stage selector followed by
stacked cards. A sticky filter button opens a sheet. Stage movement is a labeled
menu on each card.

### Empty states

**No opportunities at all**

“No opportunities yet. Add a lead you are already speaking with, or import your
current list.”

**Stage empty**

“Nothing is in Qualified right now.” Do not display a creation CTA in every
column.

**Filtered empty**

“No opportunities match these filters.” Action: **Clear filters**.

## 10. Screen specification: Opportunity detail

### User outcome

Understand the opportunity, its evidence, and the next action before changing
its sales state.

### Structure

```text
Back to opportunities

Acme annual plan                         [Edit] [More]
Sarah Chen · Acme Ltd

[Qualified ▼]     €12,000 EUR     Follow up tomorrow

Next best action                         Attribution
Send pricing clarification               Verified
[Prepare follow-up]                      Website demo form · Jul 14

History
Jul 18  Follow-up draft prepared
Jul 17  Moved from Replied to Qualified
Jul 14  Website form received
```

### Required regions

- title, associated person, company;
- stage control;
- value, currency, expected close date;
- next follow-up;
- source and attribution evidence;
- immutable history;
- related BizzClaw work;
- external CRM synchronization state when connected.

### Consequential actions

**Mark Won** dialog:

- title: “Mark this opportunity as won?”;
- amount and currency are visible and editable;
- close date defaults to today;
- support: “This will count toward won business in your dashboard.”;
- primary action: **Mark as won**.

**Mark Lost** dialog:

- asks for an optional plain-language reason;
- primary action: **Mark as lost**;
- never presents loss as destructive deletion.

**Delete** is not part of the first-release customer UI. Archive may be added
later. External-source records explain when a field must be changed in the
connected CRM.

### Attribution panel

Show one of:

- **Verified source** — “Website demo form · received Jul 14”;
- **Influenced by BizzClaw** — “Follow-up work is linked, but the original source
  is not verified”;
- **Source unknown** — action: **Add source**.

An expandable **Why this label?** describes the stored evidence without claiming
causation.

## 11. Screen specification: People

### User outcome

Find a lead or customer quickly and see who needs attention.

### Header and controls

- title: **“People”**;
- support: “The leads and customers connected to your pipeline.”;
- primary action: **Add person**;
- secondary: **Import CSV**;
- search: name, company, exact email, or exact phone;
- filters: relationship, source, has open opportunity, needs follow-up;
- sort: latest activity, newest, name.

### Desktop table

Semantic columns:

- Person;
- Company;
- Relationship: Lead or Customer;
- Open opportunity;
- Next follow-up;
- Last activity.

Email and phone are not primary table columns. They appear in detail or an
explicit contact disclosure to reduce accidental PII exposure.

### Mobile list

Each row becomes a card with name, company, open opportunity, and next follow-up.
The entire card is a link; secondary menus have their own accessible target.

### Empty states

- no people: “Add the first person you want BizzClaw to help you follow up with.”;
- filtered empty: “No people match these filters.”;
- import in progress: show a persistent status link, not fake completed rows.

## 12. Screen specification: Person detail

### User outcome

Understand the relationship and take the next appropriate action without
searching across tools.

### Regions

- name, company, Lead/Customer label;
- contact methods with consent state and explicit reveal/copy controls;
- next follow-up and **Prepare follow-up** action;
- open and closed opportunities;
- source and acquisition evidence;
- chronological activity and notes;
- external CRM source and last checked time.

Do not expose encrypted values, hashes, raw provider IDs, or synchronization
metadata.

### Actions

- Edit person;
- Add opportunity;
- Add note;
- Schedule follow-up;
- Prepare message;
- Merge duplicate only through a dedicated reviewed flow, not a one-click menu.

Preparing a message does not send it. Sending requires a separate explicit
confirmation and a supported consent/channel state.

## 13. Screen specification: Follow-ups

### User outcome

Know exactly who needs attention today and complete or reschedule the work.

### Groups

1. Overdue
2. Due today
3. Upcoming
4. Completed, behind a filter

Each row shows person, opportunity, next action, due time in the user's timezone,
and source. Actions:

- **Mark complete**;
- **Prepare message**;
- **Reschedule**;
- open person/opportunity.

Completing a follow-up uses an optimistic progress state but is final only after
server confirmation. Undo is offered briefly only when the backend supports a
reversible state transition.

Empty healthy state:

> “You are caught up. No follow-ups are due today.”

This is visually positive but not celebratory confetti.

## 14. Create and edit experiences

Desktop uses a right-side drawer; phone uses a full-height sheet. Every form has
a stable route or server fallback so core work is not JavaScript-dependent.

### Add person

Required:

- name.

Optional:

- company;
- email;
- phone;
- relationship: Lead or Customer;
- source;
- consent status;
- note.

Before save, exact email/phone duplicates produce:

> “This may already be Sarah Chen at Acme.”

Actions: **Review existing person** or **Add separately**. Never merge silently.

### Add opportunity

Required:

- title;
- person;
- stage, default New lead.

Optional:

- value and currency;
- expected close date;
- source;
- next follow-up.

The currency defaults from account settings. If no default exists, it is
required when a value is entered.

### Add follow-up

Required:

- person or opportunity;
- next action;
- due date and time.

The UI always names the timezone. Natural shortcuts such as Tomorrow and Next
week resolve to a visible exact date before save.

### Validation

- persistent labels never disappear when typing;
- errors appear beside the field and in a summary for long forms;
- focus moves to the first invalid field after submission;
- entered values survive server validation errors;
- primary action changes to **Saving…** and prevents duplicate submission;
- success closes the drawer and moves focus to the created/updated record.

## 15. Screen specification: CSV import

### User outcome

Bring an existing lead list into BizzClaw without corrupting or duplicating CRM
data.

### Step 1 — Choose file

- accepted format: CSV;
- explain maximum size and row count;
- offer a downloadable template;
- do not upload until the user chooses **Review file**.

### Step 2 — Match columns

Show source headings and sample values beside BizzClaw fields. Automatically
suggest mappings but require review for ambiguous fields. At minimum one name or
contact identifier must map.

### Step 3 — Review

Summary:

- ready to add;
- possible duplicates;
- invalid rows;
- unchanged existing people.

Provide downloadable error details. Duplicate choices are Review, Skip, or Add
separately; Merge requires field-by-field review.

### Step 4 — Confirm and finish

Confirmation states the exact effect:

> “Add 184 people, skip 12 duplicates, and ignore 4 invalid rows?”

After commit, show added/skipped/failed counts and links to the imported people
filter and error file. Retrying uses the same import id and cannot create
duplicate commits.

At phone widths, large preview tables become row cards. Mapping selectors remain
full-width and labeled.

## 16. Screen specification: Recent work

### User outcome

See delivered business work, work in progress, and failures without reading AI
telemetry.

### Header and filters

- title: **“Recent work”**;
- support: “Results and actions BizzClaw handled for your business.”;
- live state with text: Live, Updating connection, or Updates may be delayed;
- filters: status, channel, time range;
- search safe result previews;
- technical model filter is excluded from the customer screen.

### List row

- outcome icon and label;
- human task title derived from stored safe preview or deterministic event
  mapping;
- channel in customer language: WhatsApp, Telegram, Slack, or Recurring task;
- started/finished relative time;
- duration only when useful;
- strongest outcome: Delivered, File ready, Needs your OK, Could not finish, or
  Stopped.

Do not display input/output token counts on the list.

### Empty states

- no work: “No results yet. Send your first request in WhatsApp.”;
- filtered empty: “No recent work matches these filters.”;
- delayed connection: preserve existing rows and show freshness; never replace
  them with a full-page error.

### Realtime behavior

- merge SSE events by stable run/event identity and sequence;
- never duplicate a task after replay;
- do not reorder completed history merely because an old event was replayed;
- announce important state transitions through a restrained live region;
- after repeated SSE failure, poll and label the data delayed;
- pause visual updates while a user is reading a detail drawer only when needed,
  then offer “3 new updates.”

## 17. Screen specification: Work detail

### User outcome

Understand what was requested, what useful steps occurred, what was delivered,
and what can be done next.

### Customer narrative

```text
Weekly growth report
Delivered to WhatsApp · Jul 19 at 10:42 · 18 seconds

Requested
Compare this week's campaign results and recommend next actions.

What happened
10:42  Prepared business context
10:42  Checked Meta Ads
10:42  Created the report
10:42  Delivered to WhatsApp

Result
[Safe output preview]
[Open file]
```

Technical event names, model IDs, token use, trace IDs, and redacted metadata
live under **Technical details**, collapsed by default. Raw prompts, secrets,
credentials, chain-of-thought, and unrestricted tool payloads never appear.

### Failure state

Show:

- what the customer asked for;
- the last safe completed step;
- plain-language failure category;
- whether any partial result was delivered;
- **Try again** when retry is safe;
- **Renew connection** when access caused the failure;
- a support reference ID only under Technical details.

## 18. Screen specification: Connections

### User outcome

Understand where BizzClaw can work and connect only what unlocks a useful result.

### Groups

1. **Where you talk to BizzClaw** — WhatsApp, Telegram, Slack;
2. **Apps that improve your results** — Meta Ads, Instagram, TikTok, Google,
   Higgsfield;
3. **Your sales system** — Native BizzClaw CRM, HubSpot, later Pipedrive.

Each card shows:

- app name and recognizable icon;
- outcome unlocked, such as “See which ads create qualified opportunities”;
- state: Connected, Not connected, Needs renewing, Connecting, or Could not
  connect;
- last verified time when connected;
- one action: Connect, Manage, Renew, or Try again.

Never show OAuth scopes as the headline. A **What access is needed?** disclosure
lists permissions in plain language before connection.

Missing growth apps do not mark the teammate inactive. They state the exact
result that remains unavailable.

## 19. Screen specification: CRM connection and sync

### Native mode

State:

> “BizzClaw CRM is keeping your people, opportunities, and follow-ups here.”

Actions: Import CSV, Export data, Connect an existing CRM.

### Connected HubSpot mode

Show:

- **HubSpot is your sales source of truth**;
- last successful check;
- people and opportunities synchronized counts;
- pending writes and failures;
- field ownership explanation;
- actions: Check now, Review changes, Renew connection, Disconnect.

Disconnect dialog explains whether synchronized data remains as read-only local
history and what will stop updating. It never implies provider data will be
deleted.

### Sync progress

Use determinate counts when known. Copy:

> “Checking HubSpot · 420 of 1,240 people”

The user may leave the screen. Progress persists and is not tied to an open tab.

### Sync failure

Keep the last successful data visible with a freshness warning:

> “HubSpot has not updated since Jul 18 at 14:20. Your WhatsApp teammate still
> works, but sales changes may be out of date.”

Actions depend on cause: Try again, Renew connection, or Review changes.

## 20. Screen specification: Sync conflicts

### User outcome

Resolve important differences without losing sales data.

Each conflict shows the person/opportunity, field, BizzClaw value, HubSpot value,
last modified evidence, and consequence. For monetary value, contact identity,
and Won/Lost status, require a deliberate choice:

- **Use HubSpot value**;
- **Send BizzClaw value to HubSpot**;
- **Decide later**.

Bulk resolution is allowed only for low-risk fields with the same conflict
shape. “Use newest” is not offered as a universal rule. Resolved conflicts record
an immutable activity entry.

Empty state:

> “Everything matches. No changes need review.”

## 21. Screen specification: Account settings

### Sections

- Account: name, email read-only when provider-owned;
- Business: business name and customer-facing goal link back to onboarding
  personalization;
- Preferences: timezone, default currency, date format;
- Data: CRM export and privacy information;
- Session: sign out.

Do not mix app connections into account settings. Destructive account deletion
is out of first-release scope unless a complete retention and recovery contract
is implemented.

Timezone and currency changes explain their scope. Changing currency never
converts existing opportunity values automatically.

## 22. Dialogs and confirmation language

Consequential dialogs name the object and effect. Buttons use the actual verb,
not “Confirm.”

| Action | Dialog title | Primary action |
|---|---|---|
| Send prepared message | Send this message to Sarah? | Send message |
| Move to Won | Mark Acme annual plan as won? | Mark as won |
| Move to Lost | Mark Acme annual plan as lost? | Mark as lost |
| Change value materially | Update the opportunity value? | Update value |
| Merge duplicate | Merge these two people? | Review and merge |
| Disconnect HubSpot | Stop syncing with HubSpot? | Stop syncing |
| Retry failed task | Try this task again? | Try again |

The least destructive action receives focus by default when the consequence is
material. Escape closes only when no mutation is processing.

## 23. State matrix

Every screen defines these states before implementation:

| State | Required treatment |
|---|---|
| Loading | Shape-preserving skeleton and accessible loading label |
| Empty | Explain cause and next useful action |
| Filtered empty | Preserve controls and offer Clear filters |
| Success | Show persisted result, not only a toast |
| Partial | Keep available data and name what is missing |
| Stale | Show last verified time and recovery action |
| Error | Preserve entered/previous data and explain next step |
| Unauthorized | Redirect page routes; return safe 401 JSON for APIs |
| Disconnected | Explain what stops and what still works |
| Sync conflict | Preserve both values until reviewed |
| Offline browser | Preserve page, mark mutations unavailable, retry when online |

## 24. Responsive behavior matrix

| Region | Desktop | Tablet | Phone |
|---|---|---|---|
| Navigation | Top links | Top links or compact overflow | Bottom labeled navigation |
| Home results/pipeline | 2 columns | 2 balanced columns where viable | Single ordered column |
| Active pipeline | 5-column horizontal board | stage-filtered list by default | stage-filtered stacked cards |
| Data tables | semantic table | controlled table/list | stacked record cards |
| Detail | centered page with side facts | centered page | single column |
| Create/edit | right drawer | right drawer or sheet | full-height sheet |
| Filters | inline controls | inline plus overflow | filter sheet with active count |
| Dialog | centered, max 480px | centered | bottom/full-width safe-area sheet |

At 375px, fixed action areas include bottom padding for the navigation bar.
Long names and email addresses wrap or truncate with an accessible full value.

## 25. Accessibility contract

- Include a skip link to main content.
- Use one `h1` and logical nested headings.
- Primary navigation uses `nav` and marks the current page.
- Pipeline columns are named regions; cards remain links in document order.
- Every drag action has a keyboard-accessible Move to alternative.
- Tables use captions and real headers.
- Forms use persistent labels, descriptions, and linked errors.
- Status never depends only on color.
- Focus indicators are at least a high-contrast 3px ring.
- Drawers and dialogs trap focus only while open and restore it on close.
- Live regions announce task completion, failure, and material connection changes
  without narrating every event.
- Decorative mascot and atmosphere are hidden from assistive technology.
- Reduced motion removes translation and pulses.
- Target WCAG 2.2 AA contrast and interaction behavior.

## 26. Privacy and trust contract

- Render only tenant-owned data after server-side authentication.
- Escape every user-controlled value, including avatar URL and alt text.
- Reveal email and phone only where needed; do not place them in broad overview
  tables.
- Do not put PII, prompts, URLs, message bodies, CRM values, or OAuth state into
  analytics events.
- Never expose access/refresh tokens, provider credentials, blind indexes,
  system prompts, chain-of-thought, or unrestricted tool payloads.
- External links opened in a new tab use safe `rel` behavior.
- Customer-visible attribution includes evidence and freshness.
- “Live,” “Connected,” “Delivered,” “Won,” and monetary totals are always
  server-derived states.

## 27. Product analytics

Add only allowlisted, server-bound events with IDs or coarse categories rather
than customer content:

- dashboard home viewed;
- primary action opened;
- pipeline viewed;
- person or opportunity creation completed;
- opportunity stage changed;
- follow-up completed;
- CSV preview and import completed/failed;
- recent work opened;
- connection started/completed/failed;
- CRM sync completed/failed/conflict surfaced;
- first opportunity created;
- first Won opportunity recorded.

Revenue amounts, names, email, phone, notes, titles, prompts, and provider tokens
never enter product analytics.

## 28. Component inventory

The first release needs a small, reusable server-rendered component vocabulary:

- AppShell
- BrandMark
- PrimaryNav and MobileNav
- UserMenu
- PageHeader
- StatusLine
- PrimaryAction
- AttentionBanner
- ResultRow
- PipelineSummary
- OpportunityCard
- StageSelector
- PersonRow
- FollowUpRow
- EvidenceBadge
- FreshnessLabel
- ConnectionCard
- SyncStatus
- EmptyState
- FilterBar and FilterSheet
- SearchField
- FormField and ErrorSummary
- Drawer / Sheet
- ConfirmationDialog
- ToastRegion
- Skeleton
- TechnicalDetails

Repeated status, stage, role, and evidence mappings are centralized. Inline
colors and one-off copy branches are not acceptable.

## 29. Screen-to-data contract

| Screen | Minimum reliable data |
|---|---|
| Home | readiness, goal, attention items, three recent runs, CRM summary |
| Opportunities | paginated/filterable opportunities, stage counts, currency totals |
| Opportunity detail | opportunity, contact, follow-up, attribution, activity history |
| People | paginated/filterable contacts and open-opportunity summaries |
| Person detail | person, consent, opportunities, follow-ups, activity history |
| Follow-ups | due-state groups in account timezone |
| Recent work | tenant runs, safe previews, delivery state, freshness |
| Work detail | ordered redacted events and safe result preview |
| Connections | effective connection state, outcome unlocked, last verification |
| CRM sync | provider ownership, progress, freshness, failures, conflicts |

If the server cannot produce a field reliably, the UI omits it or labels it
unknown. Client code does not infer business truth from presentation strings.

## 30. Release acceptance checklist

### Product truth

- A business owner can identify status, newest result, attention, and pipeline
  without scrolling at 1440px.
- Every aggregate drills into supporting records.
- Missing growth apps do not incorrectly mark the core teammate inactive.
- Won value is displayed only from explicit or synchronized Won records.
- Attribution language distinguishes Verified, Influenced, and Unknown.

### Screen completeness

- Sign in, Home, Opportunities, Opportunity detail, People, Person detail,
  Follow-ups, CSV import, Recent work, Work detail, Connections, CRM sync,
  conflict review, and Account settings are implemented.
- Every screen covers loading, empty, filtered-empty where applicable, success,
  partial, stale, error, disconnected, and unauthorized states.
- Consequential actions have reviewed confirmation copy.

### Visual and interaction quality

- The BizzClaw onboarding material system is used consistently.
- No generic equal-weight dashboard card wall remains.
- Phone navigation, sheets, lists, and safe areas are intentional at 375px.
- Keyboard-only use can complete every core CRM workflow.
- Focus, contrast, reduced motion, and live announcements pass review.

### Verification

- deterministic tests cover state labels, escaping, permissions, filters, and
  event mapping;
- rendered checks are captured at approximately 375px, 768px, and 1440px;
- real browser checks cover long content, zero/one/many records, reconnect,
  duplicate import, sync failure, and conflict resolution;
- `npm run type-check`, `npm test`, and `npm run build:frontend` pass.

## 31. Deliberate first-release exclusions

- customizable pipeline stages;
- forecasting and AI-generated close probability;
- arbitrary CRM fields;
- lead scraping;
- unapproved outreach sequences;
- email inbox hosting;
- causal multi-touch attribution presented as certainty;
- a technical trace tree or raw JSON view for customer accounts;
- replacing the complete HubSpot or Pipedrive product UI;
- Salesforce integration.
