# Assistant Overhaul: Auth, Memory, Autonomy

Status: proposal (review artifact, no code changes yet)
Date: 2026-09-07
Scope: `src/supervisor`, `src/memory`, `src/initiative`, `extensions/memory`, CLI

## Summary

Tars has good bones: the pi SDK integration is clean, the MCP bridge and its security policies are
better than both OpenClaw and Hermes, and the cron outcome contract is solid. Three structural
problems hold it back:

1. **We use ~5% of pi's provider layer.** Auth is env-var-only and model resolution recognizes 3 of
   pi's 35 providers. pi already ships OAuth for Anthropic (Claude Pro/Max), OpenAI (Codex/ChatGPT),
   and GitHub Copilot, plus `AuthStorage` with token refresh and locking. We rebuilt a worse subset.
2. **Memory is five disconnected stores and none of it reaches the model's context.** The system
   prompt contains zero memory. The model only remembers the owner if it decides to call a search
   tool. `refreshSystemInstruction()` is a no-op. Chat transcripts are deleted after 3 days with no
   distillation step.
3. **Autonomy is three competing loops sharing one global lock.** A stateless agent ping every
   5 minutes (default on) that cannot remember its last tick, cannot know why it woke up, and blocks
   the owner's messages while it runs.

The plan: adopt pi's auth/model layer wholesale (P1), consolidate memory into a context-loaded
workspace (P2), replace heartbeat-agent + initiative with a single event-driven "Pulse" service
(P3), then take pi's compaction and other efficiency wins (P4).

---

## 1. Provider and auth: use pi's native layer

### Findings

- `getApiKeyForProvider` (`src/supervisor/tars-engine.ts:372`) reads env vars only. No OAuth, no
  stored credentials, no refresh.
- The pinned `@earendil-works/pi-ai@0.79.10` already exports `loginAnthropic`, `loginOpenAICodex`
  (browser + device-code flows), `loginGitHubCopilot`, `getOAuthApiKey` (auto-refresh), and
  `registerOAuthProvider`. `@earendil-works/pi-coding-agent` exports `AuthStorage`: `auth.json`
  persistence, file-locked token refresh, env fallback, runtime overrides. None of it is used.
- `isBuiltInProvider` (`tars-engine.ts:244`) limits the model registry to google/openai/anthropic.
  pi-ai knows 35 providers including `openai-codex`, `github-copilot`, `openrouter`,
  `amazon-bedrock`, `google-vertex`, `groq`. Everything else falls into a hand-built model object
  (`tars-engine.ts:406`) that hardcodes `openai-completions` (breaks Anthropic-compatible custom
  endpoints), `reasoning: false`, and zero cost metadata.
- One global `piProvider`/`piModel` serves everything: chat, heartbeat, cron, and the compression
  summarizer. There is no cheap-model routing and no fallback chain.
- The rate limiter defaults (14 RPM / 900k TPM, `src/config/schema.ts:99`) are Gemini free-tier
  numbers applied to every provider.

### Proposal

- **Adopt `AuthStorage`.** Instantiate at `~/.tars/auth.json` (0600). Wire the engine's
  `getApiKey` option to `authStorage.getApiKey(provider)`. Delete `getApiKeyForProvider`; env vars
  keep working through AuthStorage's fallback order.
- **Add `tars auth` CLI**: `tars auth login <provider>`, `logout`, `status`. Login drives
  `authStorage.login(providerId, callbacks)` with terminal callbacks (print URL, prompt for code;
  device-code path for headless servers). Providers at launch: `anthropic`, `openai-codex`,
  `github-copilot`. API keys stay in `tars secret`.
- **Resolve models from the registry for every known provider** via `getModels(provider)`; keep the
  hand-built object only for genuine custom `baseUrl` endpoints, and let the user pick the API
  shape (`openai-completions` | `anthropic-messages` | `google-generative-ai`) instead of inferring.
- **Role-based model config**: `models: { chat, background, summarizer }`, each `provider/model`,
  with an ordered fallback list. Background and summarizer default to a cheap model. This is the
  single biggest cost lever for autonomy.
- **Per-provider rate limits**, with the Gemini defaults applied only to `google`.

### Risks

- OAuth credentials are consumer-subscription grants. Background automation burns plan quota and
  can violate provider terms. Mitigation (same as OpenClaw): when the active credential for the
  background role is OAuth, stretch the autonomy fallback interval (30m → 60m) and prefer API-key
  providers for background roles by default.
- `auth.json` is a new secret file: include it in export exclusions and doctor permission checks.

---

## 2. Memory: one home, loaded into context

### Findings

- **Memory never enters context.** `getSystemPrompt` (`tars-engine.ts:428`) reads `system.md` plus
  skills. Facts and notes are reachable only if the model chooses to call `manage_facts` /
  `manage_notes`. In practice it rarely does, which is why memory "doesn't work".
- `refreshSystemInstruction()` (`tars-engine.ts:930`) is a no-op with a log line. The supervisor
  name-sniffs tool calls (`supervisor.ts:128`) to trigger it. Storing a fact changes nothing in the
  live session.
- **Five stores**: `facts.json` (KV), `notes/*.md`, `knowledge.db` (FTS index of facts + skills +
  transcripts), `chats/*.json`, `system.md`. Two search implementations: the memory extension
  (`extensions/memory/src/store.ts:307`) reopens `knowledge.db` and duplicates the FTS query code
  from `src/memory/knowledge-store.ts:170`, plus a substring scan over 30 days of notes.
- FTS terms are AND-joined: a query with one novel word returns nothing. Facts are indexed as one
  blob (`memory-manager.ts:66`) that the paragraph chunker keeps as a single chunk.
- **Episodic memory has a 3-day TTL.** Heartbeat GC deletes chats older than 3 days
  (`heartbeat-service.ts:139`), then `reconcileFiles` purges them from the index. Nothing distills
  them first. The assistant permanently forgets conversations after 3 days.

### Proposal (shape borrowed from OpenClaw, kept file-first)

- **Memory workspace** at `~/.tars/memory/`:
    - `USER.md` — owner profile and durable preferences.
    - `MEMORY.md` — curated durable facts and standing decisions (absorbs `facts.json`; migration
      command converts existing facts into sections).
    - `notes/YYYY-MM-DD.md` — existing daily notes, unchanged.
- **Context injection.** Prompt assembly becomes: `system.md` + `USER.md` + `MEMORY.md` (token
  budget with a truncation marker) + today's and yesterday's notes. The engine already re-reads the
  prompt every run, so `refreshSystemInstruction` becomes real by construction and the tool-call
  sniffing in the supervisor is deleted. This one change fixes most of "memory is not working".
- **Pre-compaction memory flush.** Before `compressSession` summarizes, run one silent turn:
  "persist anything durable from the conversation to memory files now." Only after a flush is chat
  GC safe. This converts episodic → durable at exactly the right moment.
- **Nightly consolidation task** (a bundled cron task, digest mode): distill the last day's notes
  and session summaries into proposed `MEMORY.md` edits; keep the diff reviewable.
- **One search path.** Extract the FTS store into a small shared package used by both the engine
  and the memory extension. Change term joining to OR + prefix matching with BM25 ranking, keep the
  20-char chunk floor, index facts one-per-chunk. Optional later: hybrid embeddings via sqlite-vec
  with a configurable provider, which is where OpenClaw and Hermes are ahead.
- Tool API (`manage_facts`, `manage_notes`) stays stable; `manage_facts` writes to `MEMORY.md`
  sections instead of `facts.json`.

---

## 3. Autonomy: from three loops to one Pulse

### Findings

Today there are three schedulers with three state files and three delivery policies:

| Loop       | Interval     | State                      | Delivery policy                |
| ---------- | ------------ | -------------------------- | ------------------------------ |
| Heartbeat  | 300s default | none (ephemeral runs)      | agent may `send_notification`  |
| Initiative | 900s default | `initiative-state.json`    | quiet hours, budget, dedupe    |
| Cron       | 60s poll     | `tasks.json`, digest store | notify/digest/on-change/silent |

- **Stateless.** `executeTask` runs ephemeral (`supervisor.ts:248`): the heartbeat agent has no
  memory of its previous tick. It re-derives everything, repeats work, or does nothing.
- **Blind.** It wakes on a timer, never because something happened (task failed, finding appeared,
  objective due, owner idle). The static prompt (`schema.ts:15`) gives it no reason to act.
- **Blocking.** All runs share the supervisor lock. While a heartbeat run executes, the owner gets
  "I'm currently working on a task. Please retry" (`supervisor.ts:61`). The owner loses to a
  janitor process. With a 5-minute default interval this is frequent.
- **Expensive.** Default config = up to 288 full agent runs/day on the main model with no state.
- **No reply contract.** The prompt says "work silently" but there is no NO_REPLY convention, no
  per-channel visibility flags, and no journal — autonomy is invisible when it works and noisy when
  it misfires.
- Quiet hours and daily budgets exist only in initiative, not for the heartbeat agent.

### Proposal: the Pulse service

Merge the heartbeat agent invocation and the initiative service into one **Pulse** service. Keep
the dumb maintenance tick (cleanup, sync, GC) as-is — it is cheap and correct. Keep cron as
explicit, owner-authorized schedules. All three share one delivery module.

- **Wake reasons, not polls.** An in-process event queue with a JSONL spill
  (`data/wake-events.jsonl`). Producers: cron task failure, doctor finding, objective due, owner
  idle N hours, channel signal; later: webhooks and file watches. Pulse runs when events arrive
  (debounced, 30s min-gap, flood guard) and on a fallback interval (default 30m; 60m when the
  background credential is OAuth). Every run's prompt starts with the wake reasons.
- **Persistent working state.** Pulse keeps `memory/PULSE.md`: a short checklist plus a rolling
  journal of its last ticks, loaded into each pulse prompt and rewritten by the agent. Bounded, so
  cost stays flat. This replaces amnesia with continuity — the OpenClaw `HEARTBEAT.md` insight.
- **Reply contract.** Pulse prompt ends with: reply `NO_REPLY` if nothing needs the owner. The
  service suppresses `NO_REPLY` responses and routes everything else through the shared delivery
  module (quiet hours, daily budget, fingerprint dedupe, digest batching — all lifted from
  initiative and cron into one place).
- **Owner preemption.** An owner message during a background run calls `agent.abort()` on the
  background agent; the pulse re-queues its wake event. Background work never rejects the owner.
  pi-agent-core already exposes `abort()` plus `steer()`/`followUp()` queues; adopt `followUp` so a
  second owner message during an owner run is queued instead of bounced.
- **Outcome journal.** Reuse the cron `TaskOutcome` JSON contract for pulse runs; append to
  `data/pulse-journal.jsonl`; surface the last runs in `tars status` and the dashboard. Autonomy
  becomes observable.
- **Config.** Replace `heartbeatRunAgent`, `heartbeatAgentPrompt`, and `initiative.*` with one
  block: `autonomy { mode: off|observe|act, fallbackIntervalSec, activeHours, maxNotificationsPerDay, model: background }`.
  Doctor/repairs stay and become wake-event producers. Provide a config migration.

Sequencing note: Pulse quality depends on memory injection (P2). A pulse agent whose context
already contains `MEMORY.md`, `PULSE.md`, and wake reasons needs no discovery tool calls to act.

---

## 4. Efficiency quick wins

- **Adopt pi's compaction** (`pi-coding-agent/dist/core/compaction`): usage-based
  `estimateContextTokens`, `shouldCompact`, turn-boundary cut points by token budget. Replaces the
  chars/3.8 estimator and the message-count cut (`tars-engine.ts:813` keeps 60% of messages
  regardless of size, so one huge tool result in the tail defeats compression).
- Run the compression summarizer on the `summarizer` model role, not the chat model.
- Cache `loadSkills` with an mtime check; today every message rescans the skills tree
  (`tars-engine.ts:436`).
- Use the `usage.totalTokens` already present on the last assistant message instead of
  re-estimating context size.
- Move the legacy Gemini history migration (~200 lines in `tars-engine.ts`) behind `tars import`.

---

## 5. Positioning vs OpenClaw and Hermes

| Dimension                         | Tars today                                        | After this proposal                                                               |
| --------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Auth                              | env API keys only                                 | pi OAuth (Claude Pro/Max, ChatGPT, Copilot) + keys — matches Hermes' portal story |
| Models                            | 3 providers + raw custom                          | 35 providers, role routing, fallback                                              |
| Memory                            | tool-only, 5 stores, 3-day TTL                    | context-loaded workspace, flush + consolidation                                   |
| Autonomy                          | 3 timer loops, blocking                           | event-driven Pulse, reply contract, preemption                                    |
| Security posture                  | already ahead (env allowlists, DLP, owner gating) | unchanged — keep leading here                                                     |
| Multi-agent, voice, many channels | out of scope                                      | still out of scope — state it as positioning                                      |

Deliberate non-goals: sub-agent orchestration (Hermes), multi-channel gateway breadth and
mobile/voice (OpenClaw). Tars' pitch stays "small, transparent, secure, one agent done well".
Hermes' self-writing skills are worth borrowing later as a consolidation-time step ("promote a
solved problem into a skill draft"), not as a new subsystem.

## 6. Phasing

| Phase | Content                                                           | Size   | Risk                                          |
| ----- | ----------------------------------------------------------------- | ------ | --------------------------------------------- |
| P1    | AuthStorage + `tars auth` CLI + full model registry + role models | small  | low — additive, env keys keep working         |
| P2    | Memory workspace + context injection + flush + shared search lib  | medium | medium — migration for facts.json             |
| P3    | Pulse service + wake events + delivery module + preemption        | large  | medium — replaces heartbeat/initiative config |
| P4    | pi compaction, per-provider limits, skills cache                  | small  | low                                           |

Each phase is an independent PR stack; P1 and P4 have no dependencies on the others.
