# Production Onboarding Redesign

> Status: implemented foundation with activation-v2 extension, 2026-07-18. The first release covers truthful
> readiness, guarded progression, and a premium redesign of the complete six-step
> flow. It does not add website ingestion or new OAuth providers.

## Outcome

A business owner should feel that they are commissioning a trusted marketing
operator and should finish knowing what the agent understands, what it can
access, what it will do automatically, and whether it is genuinely reachable.

The activation-v2 extension reduces time-to-value by generating a cached
personalized preview after the first brief, presenting three customer-facing
phases, allowing progressive integration unlocks, and ending with role-aware
starter briefs that open directly in WhatsApp. Privacy-safe funnel events are
allowlisted server-side, saved in a bounded tenant record, and forwarded to
PostHog only when configured.

## Product principles

1. **System truth before celebration.** “Live” means the profile, role,
   automation decision, required connections, and WhatsApp binding are all
   verified by the server. A URL or optimistic client transition cannot create
   readiness.
2. **Business language before infrastructure.** The customer chooses between
   the managed WhatsApp number and their own linked number. Twilio and Baileys
   remain implementation details.
3. **Intentional automation.** No recurring job is enabled by default. The user
   opts into each job and the selection survives backward navigation.
4. **Explain access.** Required and optional connections are distinct. Required
   connections block the next stage; unavailable or failed providers explain
   the next action.
5. **Progressive disclosure.** Each screen has one decision, while a contextual
   agent brief shows what has been learned and what remains.
6. **Accessible by construction.** Semantic forms, visible keyboard focus,
   announced asynchronous state, sufficient contrast, reduced motion, and
   deliberate 375 px behavior are release requirements.

## Shared Bizzclaw brand material

The onboarding UI deliberately shares its material system with the sibling
`bizz-claw-landing` project. That project does not contain a `design.md` in its
current worktree or Git history, so the maintained sources of truth are:

- `src/app/globals.css` for implementation tokens;
- `README.md` for the product-facing design direction;
- `marketing/launch-drop/CONTENT-PACK.md` for the campaign palette;
- `marketing/bizzclaw-ad/mascot-cut.png` for the production mascot asset.

The shared contract is an editorial light canvas (`#f5f5f5`) with white cards,
stone ink (`#0c0a09`), Inter body text, EB Garamond display type, pill-shaped
actions, and restrained pastel atmosphere. Mint `#a7e5d3` is the primary brand
material; active/verified state uses `#0fa300`. Peach `#f4c5a8`, lavender
`#c8b8e0`, sky `#a8c8e8`, and rose `#e8b8c4` are atmospheric accents, not
semantic status colors.

The optimized onboarding copy of the mascot lives at
`frontend/onboarding/public/bizzclaw-mascot.png`. Keep that local asset stable so
the setup shell and favicon do not depend on the sibling repository at runtime.

## Server-owned state contract

`GET /api/onboarding/bootstrap` returns a `progress` object derived from
persisted state:

```ts
interface OnboardingProgress {
  allowedStep: 1 | 2 | 3 | 4 | 5 | 6
  readiness: 'needs_profile' | 'needs_role' | 'needs_automations'
    | 'needs_connections' | 'needs_whatsapp' | 'live'
  checks: {
    profile: boolean
    role: boolean
    automations: boolean
    requiredConnections: boolean
    whatsapp: boolean
  }
  missingRequiredPlatforms: string[]
}
```

The allowed step is recomputed rather than trusted from the requested URL:

- profile missing → step 1;
- role missing → step 2;
- automation decision not saved → step 3;
- required role platforms missing → step 4;
- WhatsApp not verified → step 5;
- every check verified → step 6.

POST endpoints validate their own prerequisites. Client-side disabling is
guidance, not enforcement. If a connection or WhatsApp binding later disappears,
bootstrap moves the customer back to the relevant recovery screen.

## Experience specification

### 1. Understand Your Business

- Ask for business name, concise description, audience, and optional public
  references.
- Say that links are saved as business context; do not claim the product has
  crawled or learned from them.
- Explain the immediate benefit: answers, plans, and creative work reflect this
  brief.

### 2. Choose Your Specialist

- Present role outcomes and connected capabilities, not internal skill names.
- Use coherent product icons instead of emoji as the primary visual system.
- Require an explicit selection.

### 3. Set Its Routine

- Start with every automation off.
- Explain that selected jobs send results automatically and can be changed
  later.
- Persist the saved selection, including the valid choice of no automations.

### 4. Grant Access

- Show required versus optional services, human-readable access scopes, and
  verified connected state.
- Disable advancement while required services are missing and announce status
  changes without rebuilding the whole screen.

### 5. Choose Where You Will Work

- Recommend the managed business number when configured.
- Offer the customer's own linked number as an advanced alternative.
- Show explicit waiting, connected, disconnected, unavailable, and QR error
  states. There is no manual “Continue” before verified binding.

### 6. Review & Launch

- Render a server-derived readiness checklist.
- Say “Your agent is live” only for `readiness === 'live'`.
- Make “Send Your First Brief” the primary action and the account dashboard the
  secondary destination.

## Implementation seams

- `src/onboarding/server.ts`: readiness derivation, bootstrap contract, POST
  prerequisite validation, persisted automation selection.
- `frontend/onboarding/src/main.ts`: typed contract, guarded routing, semantic
  views, non-destructive live updates, and honest launch state.
- `frontend/onboarding/src/styles.css`: premium responsive shell, components,
  focus states, contrast, and reduced motion.
- `frontend/onboarding/index.html`: truthful brand header, loading status, and
  skip navigation.
- `src/onboarding/onboarding-progress.test.ts`: deterministic readiness and
  gating cases.

## Release evidence

- `npm run type-check`
- `npm test`
- `npm run build:frontend`
- Browser inspection at approximately 375 px, 768 px, and 1440 px
- Keyboard-only navigation and visible focus
- Direct future-step URL recovery
- Empty automation selection, missing required connection, OAuth retry,
  WhatsApp waiting/error/linked, and truthful launch states

## Follow-up releases

- Website/profile ingestion with evidence and freshness timestamps.
- Role recommendation based on the saved brief.
- Timezone and delivery-time controls for scheduled automations.
- Privacy-safe funnel telemetry and time-to-first-message measurement.
- Localized copy and right-to-left layout after the English production flow is
  stable.
