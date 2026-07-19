# BizzClaw Activation V2 — SaaS Onboarding Experience

> Status: implementation specification, 2026-07-19. This document supersedes
> legacy six-equal-step customer presentation while preserving the six internal
> routes for compatibility. It complements
> [`../plans/2026-07-18-production-onboarding.md`](../plans/2026-07-18-production-onboarding.md)
> and the post-launch
> [`2026-07-19-saas-dashboard-native-crm-design.md`](2026-07-19-saas-dashboard-native-crm-design.md).

## Outcome

A nontechnical business owner receives useful personalized direction in under
90 seconds, chooses the business result they value most, decides what should
happen automatically, connects only the apps that improve the work, verifies
WhatsApp, and sends one real request.

The customer should never need to understand simulated job titles, agents,
models, MCPs, OAuth scopes, integrations, tool calls, or launch-readiness logic.

## Customer-facing phases

The interface shows three phases:

1. **Brief** — business name, one-sentence description, optional website, and a
   truthful personalized preview;
2. **Configure** — business goal, optional recurring tasks, and progressive
   connected apps;
3. **Launch** — verified WhatsApp connection and a guided first result.

The internal routes remain:

| Route step | Customer purpose | Phase |
|---|---|---|
| 1 | Business brief and preview | Brief |
| 2 | Business goal | Configure |
| 3 | Recurring tasks | Configure |
| 4 | Connected apps | Configure |
| 5 | WhatsApp | Launch |
| 6 | First result | Launch |

Phase navigation may return to completed work. It never allows the browser to
bypass server-derived prerequisites.

## Shared visual shell

- Reuse the BizzClaw mascot, EB Garamond display type, Inter interface type,
  stone canvas, white paper, mint action, and restrained pastel atmosphere.
- Keep the content width at `1180px` maximum with a primary work panel and a
  sticky setup summary on desktop.
- Hide the secondary summary on tablet and phone except for the final launch
  summary, which becomes a stacked card below the primary action.
- Use one dominant mint action per screen.
- Use 24px primary cards, quiet shadows, visible 3px focus rings, and controls
  at least 44px high.
- At phone widths, primary actions may become sticky only when they do not cover
  validation, QR instructions, or safe-area content.
- The header says **Get started** and the final verified state says **Ready on
  WhatsApp**.

## Vocabulary contract

| Avoid | Use |
|---|---|
| Agent | BizzClaw or your BizzClaw teammate |
| Specialist / role | Business goal |
| Automation / job / routine | Recurring task |
| Integration / platform | Connected app |
| Capability | Result or work unlocked |
| Agent live | Ready on WhatsApp |
| Assignment | Request or result |
| Commissioned | Ready to start |

Internal event names such as `specialist_selected` may remain stable because
they are not customer-visible.

## Persistent setup summary

The desktop summary shows only saved truth:

- business;
- business goal;
- number of recurring tasks selected;
- number of connected apps;
- setup state.

Copy:

- heading: **Your BizzClaw teammate**;
- incomplete state: **Getting BizzClaw ready**;
- verified state: **Ready on WhatsApp**.

The security note says account access stays private and that BizzClaw never asks
for an app password. It does not expose token, OAuth, credential, or scope
terminology.

## Screen 1 — Business brief

### Purpose

Produce first value before asking the customer to make configuration decisions.

### Required fields

- Business or project name
- What does the business do?

### Optional fields

- Website, explicitly saved as reference context and never presented as crawled
  or analyzed;
- audience;
- Instagram handle;
- TikTok handle.

Optional enrichment stays behind **Improve personalization**.

### Primary copy

- title before preview: **Get useful direction in under 90 seconds**;
- support: “Tell BizzClaw what you do. You will see a personalized opportunity
  brief before connecting any account.”;
- action: **Create my preview**.

### Preview

The preview contains:

- headline;
- one insight;
- exactly three opportunities;
- suggested first brief;
- Personalized or Starter plan evidence label.

Copy after generation:

- title: **Your first advantage is ready**;
- disclosure: “This is a starting point built from the brief you provided—not
  from live account data.”;
- primary action: **Choose your business goal**;
- secondary action: **Refresh preview**.

### States

- loading: “BizzClaw is turning your brief into an action plan…”;
- AI success: Personalized;
- deterministic fallback: Starter plan;
- validation error: retain all entered fields and focus the error;
- request failure: explain retry and allow setup to continue only if server
  progression permits it;
- reload: reuse the cached preview for the unchanged profile.

## Screen 2 — Business goal

### Purpose

Choose the result BizzClaw should optimize its first work around.

### Primary copy

- title: **Choose the result you want most**;
- support: “Start with one business goal. BizzClaw will shape its plans,
  recommendations, and first tasks around that outcome.”;
- action: **Choose business goal**.

### Choices

| Runtime role | Customer name | Promise |
|---|---|---|
| `marketing-manager` | Growth Planner | Build a focused growth plan and prioritize moves likely to create leads and revenue |
| `creative-director` | Creative Producer | Create campaign-ready images, videos, concepts, and copy |
| `ads-analyst` | Ad Spend Optimizer | Find wasted budget and improve advertising returns |
| `social-media-manager` | Audience Builder | Prepare consistent content that earns attention and qualified conversations |
| `gtm-operator` | Pipeline Builder | Turn attention into sales conversations with channels, replies, and follow-ups |
| `personal-assistant-dev` | Business Assistant | Save time on research, writing, planning, follow-ups, and technical work |

Connected-app chips explain possible context, not a launch gate. Internal role
IDs and runtime system prompts stay unchanged.

### States

- none selected: primary action remains available to native validation but the
  form requires one choice;
- selected: card uses border, background, check icon, and Selected text;
- long description: wraps without changing selection-control position;
- keyboard: each card is a labeled radio with visible focus;
- returning customer: saved choice is selected.

## Screen 3 — Recurring tasks

### Purpose

Let the customer choose automatic value without creating fear of uncontrolled
actions.

### Primary copy

- title: **Choose what should happen automatically**;
- support: “Select the useful work you want BizzClaw to prepare and deliver on a
  schedule. Starting with none is completely fine.”;
- note: “Nothing runs automatically unless you select it.”;
- action: **Save recurring tasks**.

Every task card shows title, delivery cadence, and the result it produces.
Nothing is selected by default. An explicit empty selection is a valid saved
decision.

### States

- available tasks, none selected;
- one or several selected;
- no suggested tasks for the selected goal;
- save failure with selection preserved;
- returning customer with the exact saved selection.

## Screen 4 — Connected apps

### Purpose

Explain value unlocked by live data without delaying core activation.

### Primary copy

- title: **Connect apps when they add value**;
- support: “Connected apps let BizzClaw work from live business data. You can
  continue now and connect them later when a task needs them.”;
- primary action: **Continue to WhatsApp**.

### App card

Each card shows:

- app name;
- plain-language result unlocked;
- **Unlocks live results** or **Adds more context**;
- Connected, Connection unavailable, or a Connect action.

Customer descriptions replace raw OAuth scopes:

| App | Description |
|---|---|
| Meta Ads | Review campaign performance and spot wasted spend |
| Instagram | Understand content performance and prepare social work |
| TikTok | Review videos and prepare content for TikTok |
| Google | Connect search, website, and conversion signals |
| Higgsfield | Create campaign-ready images and videos |

Missing apps say **You can connect later** and name the result that remains
unavailable. The primary action never says “Continue without connecting,” which
frames a valid choice as failure.

OAuth errors and unavailable providers explain a next action. Live status
polling updates by stable app identity and announces connected or failed state.

## Screen 5 — WhatsApp

### Purpose

Verify the required delivery channel and make the connection model understandable.

### Primary copy

- title: **Choose where BizzClaw should reach you**;
- support: “WhatsApp is where you send requests, approve important actions, and
  receive finished work.”

### Managed number

- name: **Use the BizzClaw WhatsApp number**;
- badge: Recommended;
- provide three numbered instructions;
- primary action: **Open WhatsApp**;
- show a truthful waiting state until the server verifies the message.

### Linked number

- name: **Link your own WhatsApp number**;
- badge: Advanced;
- show exact WhatsApp Linked Devices navigation;
- QR code refreshes automatically;
- distinguish preparing, reconnecting, disconnected, expired, and linked states.

If group-scoped mode is active, the customer chooses the single group where
BizzClaw should respond. Linking alone is not presented as complete until the
group is saved.

### Verified state

- heading: **WhatsApp is ready**;
- support: “BizzClaw can now receive your requests and deliver results in the
  conversation.”;
- action: **Choose first result**.

Disconnect copy says exactly what will stop and requires confirmation.

## Screen 6 — First result

### Purpose

Turn setup completion into a real request rather than sending the customer to a
generic dashboard.

### Primary copy

- title: **BizzClaw is ready on WhatsApp**;
- support: “{Business goal} is set. Choose one useful result to start with.”;
- overline: **Ready to start**;
- heading: **Begin with one real business result.**;
- note: “Choose meaningful work, not a test prompt. BizzClaw already has the
  context you saved.”

Present exactly three role-aware starter choices. The first may use the cached
preview's suggested brief. The selected brief updates the WhatsApp deep link.

- primary action: **Send to BizzClaw in WhatsApp**;
- secondary action: **Go to BizzClaw home**.

Opening the brief records the activation event. Completion itself remains based
on verified WhatsApp and persisted setup, not a click.

## Launch summary

The summary labels are:

- Business brief
- Business goal
- Recurring tasks
- Connected apps
- WhatsApp

Missing optional apps show “available later,” not an incomplete launch state.
The summary says these choices can be changed later from the account.

## Native CRM handoff

Native CRM is not another onboarding form and must not lengthen time to value.
When the native CRM backend and Pipeline screen are enabled, every tenant receives
an empty pipeline automatically.

Only then may the launch screen add a compact, truthful handoff:

> **Your pipeline is ready**
> Add the first person or opportunity from WhatsApp or BizzClaw home.

The launch actions may then include **Add first opportunity** as a secondary
choice. Until the CRM is implemented and provisioned, onboarding must not claim
that a pipeline, lead, conversion, or revenue record exists.

Connecting HubSpot or another external CRM remains optional in Configure or the
post-launch Connections screen. It never blocks WhatsApp activation.

## Error, recovery, and reload contract

- Requested future routes redirect to the server-derived allowed step.
- Refresh returns to the saved state without regenerating an unchanged preview.
- Profile and role changes invalidate dependent preview or recurring-task state
  only where the server contract requires it.
- OAuth return restores the correct Configure screen and connection state.
- WhatsApp disconnect returns to Launch recovery rather than showing false live
  state.
- Loading failure preserves a simple **Try again** action.
- Browser-only optimistic states never mark an app or WhatsApp connected.

## Responsive contract

At approximately 1440px:

- phase rail spans the app width;
- primary panel and sticky setup summary use a balanced two-column layout;
- the preview remains inside the primary panel and does not become a detached
  dashboard card wall.

At approximately 768px:

- use one main column;
- hide the nonessential setup summary;
- retain phase numbers and screen heading;
- launch summary stacks below starter actions.

At approximately 375px:

- hide phase text but retain three meaningful markers;
- use one-column fields and app cards;
- actions are full-width where appropriate;
- QR content fits without horizontal overflow;
- the launch primary action appears before the readiness summary;
- safe-area padding prevents sticky actions from covering content.

## Accessibility contract

- skip link targets the main setup region;
- one `h1` per screen and semantic fieldsets/legends;
- labels persist above inputs;
- selection cards remain native radio/checkbox controls;
- error focus moves to an alert or invalid field;
- preview completion moves focus to its heading;
- async connection and QR copy uses restrained live regions;
- status is never color-only;
- reduced motion removes smooth scroll, translation, spin repetition where safe,
  and decorative animation;
- every action meets a 44px target and has visible focus.

## Privacy and analytics

- Never send descriptions, websites, prompts, handles, phone numbers, tokens,
  OAuth data, or QR values to product analytics.
- Activation events remain server-allowlisted.
- Provider access copy is customer-friendly, while the actual authorization
  request still uses the exact least-privilege scopes.
- User-entered content is escaped before insertion into rendered HTML.
- The preview never implies website ingestion.

## Acceptance checklist

- Brief, Configure, and Launch are the only customer-visible phases.
- All six internal screens use business-result language.
- Every role uses its outcome-led customer name while preserving runtime IDs.
- No raw provider scope appears in the onboarding UI.
- Missing optional apps do not block launch or create failure-framed copy.
- WhatsApp is the only final channel gate.
- Launch presents three useful role-aware first results.
- CRM is mentioned only when a real provisioned pipeline exists.
- Desktop, tablet, mobile, keyboard, slow preview, fallback preview, OAuth
  failure, skipped apps, WhatsApp recovery, and reload are verified.
- `npm run type-check`, `npm test`, and `npm run build:frontend` pass.
