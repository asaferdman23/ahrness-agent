# Frontend quality gates

Use the relevant gates for implementation and review. Do not claim a gate was checked when it was not.

## Product truth

- The primary status and action are obvious without scrolling.
- Labels describe business meaning before internal event names.
- All displayed values have a real source and a defined freshness model.
- Aggregates drill into supporting records or state clearly when they cannot.
- Loading, empty, filtered-empty, partial, stale, disconnected, unauthorized, and error states differ.
- Destructive, publishing, approval, reconnect, and OAuth actions explain consequences and completion.

## Visual hierarchy

- One focal point exists per screen/region.
- Typography, spacing, alignment, and contrast establish hierarchy before color or decoration.
- Telemetry numbers align and scan consistently; units and time zones are explicit.
- Status colors are semantic and consistent; text/icon shape also carries the meaning.
- Charts answer a decision, label axes/units, and have a table/text fallback where useful.
- Long names, previews, URLs, and localized dates wrap or truncate intentionally.

## Interaction and realtime

- Controls expose hover, focus, active, disabled, loading, success, and error states.
- Keyboard order follows visual order; focus is never trapped or lost after updates.
- Live regions announce important asynchronous changes without narrating every event.
- SSE events render idempotently by run/event identity and sequence.
- Reconnecting and polling fallback are visible; stale data does not masquerade as live.
- Back navigation retains filters, time range, selected run, and useful scroll position where feasible.

## Responsive behavior

- Verify about 375px, 768px, and 1440px widths.
- Primary action and critical status remain visible on narrow screens.
- Dense tables become purposeful stacked rows or controlled horizontal regions, not unreadably compressed grids.
- Touch targets are comfortably sized and do not depend on hover.
- Avoid horizontal page overflow with long unbroken content.

## Accessibility

- Use semantic landmarks, headings, lists, tables, buttons, links, labels, and fieldsets.
- Every input has a persistent accessible name and useful validation message.
- Focus indication is obvious against every surface.
- Color contrast is adequate in default, hover, focus, disabled, and status states.
- Reduced-motion users do not receive pulsing or entrance motion they did not request.
- Icons and charts have names or alternatives; decorative graphics are hidden from assistive technology.

## Security and privacy

- Escape all server-rendered/user-controlled strings.
- Use `textContent`, not `innerHTML`, for streamed values.
- No secrets, OAuth tokens, credentials, system prompts, chain-of-thought, or raw sensitive payloads appear.
- Every protected route and run-detail fetch is tenant-scoped on the server, not only hidden in the UI.
- External links use safe target/rel behavior where a new tab is appropriate.

## Verification evidence

- Add or update deterministic tests for state mapping, escaping, content, and authorization boundaries.
- Run `npm run type-check`, `npm test`, and `npm run build:frontend`.
- Exercise live/reconnect behavior when SSE changes.
- Capture or inspect rendered states in a real browser when possible.
- In the handoff, list tested commands, surfaces inspected, and any remaining limitations.
