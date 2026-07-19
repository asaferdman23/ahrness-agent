# Observability UX field guide

These patterns were synthesized from official product documentation and the public OpenClaw repository in July 2026. Use them as interaction principles, not as a visual template to copy.

## Shared data model

Use three levels when the product supports them:

1. **Session/conversation** groups related turns across time.
2. **Run/trace** represents one end-to-end request or autonomous execution.
3. **Event/span** represents one model call, tool action, retrieval step, approval, delivery, or application operation.

Stable names and types matter because filters, charts, evaluations, and saved views depend on them. Do not derive core semantics from display strings.

## Proven interaction patterns

### Overview to evidence

Lead with health, attention, volume, error rate, latency, usage/cost, and quality signals over a selected period. Every aggregate should drill into the filtered runs behind it. Compare against a prior period only when the comparison window is explicit.

### Searchable run list

Provide fast time/status/channel/model filters before building a complex query language. Make rows scannable: outcome, time, channel, duration, usage, preview, and the strongest relevant quality signal. Preserve filters in the URL when routing allows.

### Multiple trace lenses

One view cannot serve every debugging task:

- conversation/narrative view for what happened in human order;
- tree view for call relationships and nested work;
- timeline view for latency and concurrency;
- structured/raw view for exact metadata.

Start with narrative for Ahrness clients. Add tree/timeline/raw detail progressively for operators.

### Inline operational metrics

Show duration, token use, estimated cost, retries, cache use, and error state beside the relevant run/span. Roll child cost and duration up only when the aggregation semantics are correct and labeled.

### Feedback loop

Attach feedback or evaluation to the scope it judges: event/span, run/trace, or session. Store a value plus optional reason. Let interesting failures become test/evaluation cases when the backend supports that workflow. Never present an automated score as objective truth without its criterion and provenance.

### Realtime truth

Show whether data is live, reconnecting, delayed, or stale. Merge replayed SSE events by stable identity and sequence. Avoid duplicated rows, out-of-order events, false pulsing indicators, or silently frozen dashboards.

### Privacy and safety

Default to redacted previews. Gate raw inputs, outputs, metadata, and share links. Make public/private scope explicit. Avoid exposing prompts, credentials, personal data, tool secrets, or hidden reasoning.

## OpenClaw lesson: purpose-built controls beat raw config

The OpenClaw Control UI’s public issue history highlights failure modes worth avoiding: stale values that disagree across views, deeply nested configuration without hierarchy, unclear update outcomes, raw provider settings for nontechnical users, and no reliable at-a-glance health/usage summary. For Ahrness:

- show the effective current value, source, and freshness;
- separate common safe actions from advanced configuration;
- preview consequential changes and report completion/failure clearly;
- never display a mutable control whose value is not synchronized with runtime truth;
- prefer guided connection and role workflows over JSON-like editing.

## Source notes

- [Langfuse observability overview](https://langfuse.com/docs/observability/overview): nested traces, model/tool steps, latency, usage, and cost.
- [Langfuse trace best practices](https://langfuse.com/docs/observability/best-practices): observations → traces → sessions and the importance of stable structure.
- [Langfuse sessions](https://langfuse.com/docs/observability/features/sessions): conversation replay, bookmarks, sharing, and session scoring.
- [Langfuse scores](https://langfuse.com/docs/evaluation/scores/overview): human, model, programmatic, and end-user evaluation at multiple scopes.
- [Datadog Agent Observability](https://docs.datadoghq.com/llm_observability/): operational, quality, privacy, and safety signals around agent traces.
- [Datadog monitoring](https://docs.datadoghq.com/llm_observability/monitoring/): error, latency, token, model, pattern, and trace-to-infrastructure analysis.
- [Braintrust trace viewer](https://www.braintrust.dev/docs/observe/examine-traces): hierarchy, timeline, conversation, search, structured formats, sharing, and replay.
- [Braintrust observability](https://www.braintrust.dev/docs/observe): searchable production traces, topics, dashboards, and production-to-evaluation feedback loops.
- [LangSmith observability concepts](https://docs.langchain.com/langsmith/observability-concepts): projects, traces, runs, threads, metadata, and feedback.
- [Arize Phoenix overview](https://arize.com/docs/phoenix): tracing, annotation, replay, datasets, and experiment comparison.
- [Helicone repository](https://github.com/Helicone/helicone): session/trace inspection plus cost, latency, and quality analysis.
- [OpenClaw getting started](https://github.com/openclaw/openclaw/blob/main/docs/start/getting-started.md): Control UI context.
- [OpenClaw Control UI UX issue](https://github.com/openclaw/openclaw/issues/13142): public examples of stale state, raw configuration, and unclear operational feedback.
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/): stable semantic attributes for portable telemetry.

Re-check official sources before making vendor-specific or standards claims that may have changed.
