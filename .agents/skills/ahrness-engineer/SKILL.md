---
name: ahrness-engineer
description: Use when writing, editing, debugging, reviewing, or planning code anywhere in the ahrness-agent repo — the WhatsApp-first AI marketing agent platform (Strands SDK, Baileys, per-client store, scheduler, sessions/memory, onboarding/OAuth, Docker sandbox). Invoke before touching src/ so you develop in the right context.
---

# Ahrness Engineer

How to develop in the `ahrness-agent` codebase without breaking its non-obvious
contracts. This is the on-ramp — the authority is [`AGENTS.md`](../../../AGENTS.md)
(working contract) and [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) (deep design).

## Core principle

One personalized agent is **built fresh per conversation** in
`buildClientAgent(jid)` from the client's stored profile + role + connected
platforms. The Strands SDK gives the tool loop; **scheduler and memory are ours**
(`src/scheduler/`, `src/sessions/`). Make changes through the registry and store
seams, not by special-casing inside the agent.

## Pre-flight (do this before editing src/)

1. **Read `AGENTS.md`** for the build/test commands and the non-negotiables.
2. **Locate the seam** for your change in the AGENTS.md "Where things live" table —
   most work is *register a definition*, not edit `agent.ts`.
3. **Skim the neighbor** — open the nearest existing file of the same kind (a
   sibling MCP, role, tool factory, or `*.test.ts`) and match its shape.

## The five things that silently break

| Trap | Rule |
|---|---|
| Import extensions | Local imports use **`.js`** (NodeNext ESM), even for `.ts` files. Never `.ts`, never extensionless. |
| Wrong "skill" | Runtime agent skills → `src/skills/`. Dev skills (like this one) → `.Codex/skills/`. Don't cross them. |
| Committing data/secrets | `store/` and `.env` are gitignored. Client data keyed by `clientIdFromJid` (sha256 of JID); writes are atomic (tmp+rename). |
| Orphan definition | New role/MCP/skill must be **registered** in its registry, not just created. |
| Bedrock vs Anthropic | A bare string model id → Bedrock. Use `createModel()`/`AnthropicModel` for the Anthropic API. |

## Verify before "done"

Run `npm run type-check` and `npm test`. If you can't, **say so** — never imply
verification you didn't do. New behavior gets a colocated `*.test.ts`
(`node:test`); prefer deterministic, dependency-free tests. Git: commit/push only
when asked, branch off `main`, include the co-author trailer.

## When NOT to use

General questions unrelated to this repo's code, or pure WhatsApp-product usage
questions answered by `README.md`.
