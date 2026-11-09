# Implementation status

This document records how far the code in this repository gets toward the design in [the design](design.md). It is the only place that records limitations: the design does not change to match the implementation. A design obligation that is missing here is still a design obligation. This is a production line, not a frozen prototype: rows change as features land, and a row that no longer matches the code is a bug in this document.

**Checked against:** `origin/main` at commit `0563bd3` plus this documentation-restructure branch (documentation and documentation-path references only, with no behavior change). **Method:** reading [the design](design.md), this document, the implementation documents under `docs/subsystems/`, `docs/user/` and `docs/cookbook/`, the source tree and the tests; the audit does not run the agent against real DeepSeek Harness, GitHub or Feishu, and the repository's tests use a simulated host, so "Implemented" below means *the code and its tests implement this*, not *the behaviour has been proven end to end*.

**Status values:**

| Value | Meaning |
| --- | --- |
| Implemented | The obligation is met by the code; tests cover it |
| Partial | A meaningful part is present; the obligation as written is not met |
| Absent | Not implemented |
| Not claimed | The item is an open question or evidence claim, not a capability |

## Design obligations

| ID | Obligation | Status | Evidence | Main gap |
| --- | --- | --- | --- | --- |
| D1 | Two tiers: resident Router, isolated Workers | Implemented | Main Session plus one Executor Session per Ticket; separate presets; worker slots: [Execution](subsystems/execution.md), [Architecture](architecture.md), `cordis.patch.yml` | — |
| D2 | Router is the global sequence point and memory | Implemented | Single main Session owns Eval, dispatch and replies; Tickets, Threads and Decisions persist and are readable by id: [Domain model](subsystems/domain-model.md), [Authorization](subsystems/authorization.md) | Memory is per-object read and recent context; there is no cross-task long-range memory (see D16). A person can also write directly in a Worker Session in the Web UI, which the design routes through the Router |
| D3 | Router does not execute work, as a system constraint | Partial | Router preset drops write, subagent and web tools: `cordis.patch.yml`, [Architecture](architecture.md) | It keeps `bash`, `read` and job tools; "never read or execute work" is a prompt rule, not a tool restriction ([Architecture](architecture.md), main-Session tools) |
| D4 | Workers isolated, full tools, strongest model | Implemented | One Session and directory per Ticket; worker model setting; concurrency limit: [Execution](subsystems/execution.md), [Deployment](user/deployment.md) | — |
| D5 | Workers never talk to people; Router is the only writer | Partial | Results, questions and notices go through the Router: `src/app/notices.ts`, [Execution](subsystems/execution.md) | A worker may acknowledge a request directly on its Source channel (`orchestrator_ack`, `prompts/replies.md`; [Prompts](subsystems/prompts.md)); the article requires no direct Worker interaction |
| D6 | No direct Worker-to-Worker channel; shared Threads expose conflicts | Implemented | No peer channel exists; context-only subscriptions and ticket-unrelated/thread-follow tools: [Authorization](subsystems/authorization.md), [Execution](subsystems/execution.md) | — |
| D7 | Batching of Triggers at the Router | Implemented | Eval batches Triggers per Thread; notices arriving during a turn are delivered together at the next step: [Authorization](subsystems/authorization.md), [Architecture](architecture.md) | No benchmark of the article's batching effect (see D28) |
| D8 | Tiers may nest | Partial | Workers can run subagents under the standard preset: [Execution](subsystems/execution.md) | A Worker that is itself an agent team is not provided; no preset or tooling for a sub-team |
| D9 | Triggers from the environment are the primary input | Implemented | GitHub and optional Feishu Sources with live events, polling and history recovery: [Domain model](subsystems/domain-model.md), [Deployment](user/deployment.md) | Only these two Sources; mail, calendar and other enterprise channels are absent |
| D10 | Two-level filtering: program fast path, then model slow path | Implemented | Gate (allow lists, admission, bot rules, accept mode) then model assessment with prompts: [Authorization](subsystems/authorization.md) | — |
| D11 | Thread as a first-class event stream | Implemented | Threads stored with Triggers, Decisions and Subscriptions: [Domain model](subsystems/domain-model.md) | — |
| D12 | Subscribed Thread events pass straight to the Worker | Partial | Every message on a subscribed Thread reaches its Tickets; a person's message on a Ticket's own Thread skips Eval: [Authorization](subsystems/authorization.md), [Execution](subsystems/execution.md) | Only person-authored messages bypass Eval; bot and CI messages on subscribed Threads still enter Eval, so the Router still spends decisions on them. The article routes every later event of a subscribed Thread straight to the Worker |
| D13 | Router decides only unowned events; subscriptions are many-to-many | Implemented | Router keeps a filtered projection of events; N:M Subscriptions; hand-back and unsubscribe tools: [Domain model](subsystems/domain-model.md), [Authorization](subsystems/authorization.md) | The Router observes a filtered projection rather than every raw event |
| D14 | Output converges at the Router | Partial | Reports, questions and result relays go through the main Session: [Execution](subsystems/execution.md) | Same exception as D5 (direct acknowledgement) |
| D15 | Inline & Spill: context treated as a cache with budgets and read-on-demand | Partial | Fixed budgets for injected Triggers and neighbours; read pointers and paged resources: [Authorization](subsystems/authorization.md), [Architecture](architecture.md) | Budgets are per-injection constants, not a general inline/spill policy; most reading is still tool calls |
| D16 | Chain of recall across objects | Absent | Stable ids and paged reads exist (`src/core/ids.ts`, resource reads) | No next-hop references, no multi-hop recall, no global memory |
| D17 | Speculative action before a result is certain | Absent | — | The `off` / `observe` / `auto` accept modes are an authorization gate that records or accepts work; they are not speculative execution. No background preparation before acceptance exists |
| D18 | Asynchronous ReAct loop (`start` / `stop`) | Partial | Foreground worker commands move to background jobs after 5 s; job completion wakes the Worker; job waits are capped; a 30-minute limit: [Execution](subsystems/execution.md), `cordis.patch.yml` | Background execution and completion events come from the host; there is no explicit model-facing `start()` / `stop()` contract, and a command still runs synchronously for up to 5 s. The mechanism is switched on here, not implemented here |
| D19 | Full duplex: new input at the next reasoning step | Implemented | Session inputs are delivered at step boundaries; the main Session's wait guard: [Execution](subsystems/execution.md), [Architecture](architecture.md) | — |
| D20 | Channel-specific delivery discipline | Implemented | Per-Source reply rules; the 100-word limit for IM; pull request template and review rules: [Prompts](subsystems/prompts.md), `prompts/replies.md`, `prompts/work.md` | Channels are GitHub and Feishu only; structured mail and document delivery is absent; length rules are prompt text with a tool-level check, not a proven guarantee |
| D21 | State lives outside the agent loop | Implemented | SQLite store with transactions, persistent effect queue, idempotent outbox, restart recovery: [Execution](subsystems/execution.md), [Architecture](architecture.md) | — |
| D22 | Stateless compute, elastic and replaceable | Partial | State is behind a store port and the core has no harness imports; recovery after restart: [Architecture](architecture.md) | Deployment is one process on one machine; there is no container or cloud orchestration, so the loop is not actually replaceable or horizontally movable |
| D23 | Execution environment stays in place behind a stateless daemon (BYOM) | Absent | — | Workers run in the same process and as the same OS user as the router; [Deployment](user/deployment.md) describes the isolation limits. No remote daemon, device selection or intermittent-device queue |
| D24 | Security precondition: credentials never in model context | Absent | [Deployment](user/deployment.md) documents permissions and isolation defaults | No credential proxy or trust boundary between loop and environment. The deployment assumes a trusted local environment |
| D25 | External Watchdog control loop | Absent | — | Operator-level substitutes exist (health state, retries, pause, the `status` CLI and an hourly check that runs in another DeepSeek Harness profile: [Deployment](user/deployment.md)); none is an independent Watchdog session |
| D26 | Fault handling and model judgement of Worker progress | Absent | Infrastructure faults are retried and surfaced by the effect queue and health state: [Architecture](architecture.md) | No model judgement of whether a Worker is making progress or drifting; no intervention by a control loop |
| D27 | Watchdog is a full agent that can change behaviour | Absent | — | Not implemented |
| D28 | Evaluation claims carry their limits | Absent | — | No experiment harness, baseline scenarios or metrics. The repository tests verify contracts and behaviour, not the article's scheduling results |
| D29 | Open questions stay open | Not claimed | The design and this document keep them open | The verification and compact-report work below does not answer them |

## Work scope

| Area | Status | Evidence | Gap |
| --- | --- | --- | --- |
| Coding (one GitHub repository) | Implemented | Issue and pull-request intake, CI events, Tickets, worker sessions, pull requests, reviews: [Domain model](subsystems/domain-model.md), [Execution](subsystems/execution.md), [Deployment](user/deployment.md) | One repository per deployment; no multi-repository routing |
| Team affairs on chat channels | Partial | Feishu bot listens to allowed conversations and can answer there; Tickets are work-type agnostic: [Domain model](subsystems/domain-model.md) | No non-code deliverable or workflow; every Ticket ends in a code-shaped result path (pull request or report) |
| Team affairs beyond chat | Absent | — | No mail, calendar, document, task-tracker or wiki Source or Channel |
| Enterprise affairs | Absent | — | No approval, scheduling, correspondence or form workflows. This is target scope in [the design](design.md), not current capability |
| Adding a new kind of work | Partial | Source plugin protocol and the cookbook: [Add a Source](cookbook/add-a-source.md) | The path is proven only for event Sources; delivery and execution still assume code work, and the panel and setup are coding-shaped. The Worker persona is a coding agent (`cordis.patch.yml`) and every Ticket loads the coding prompt ([Prompts](subsystems/prompts.md)) |

## Implementation additions beyond the design

The article does not specify authorization, delivery mechanics or operations, and this repository adds a substantial amount around them. These are allowed additions, not evidence of design conformance:

- The Policy, Mandate, Ticket and Assignment model, including the distinction between authority and context ([Domain model](subsystems/domain-model.md), [Authorization](subsystems/authorization.md)).
- A supervision panel with work needing a person, system health and per-record history ([Panel](subsystems/panel.md)).
- Setup, deployment, upgrade and troubleshooting guidance, prompt versions and settings ([Prompts](subsystems/prompts.md), [Deployment](user/deployment.md)).
- Durable effects, an idempotent outbox, pause/resume, retry and restart recovery ([Execution](subsystems/execution.md), [Architecture](architecture.md)).
- Worker-reported verification snapshots and compact reports (merged in the base commit): worker self-reports that guide repair and rechecking, not independent acceptance or CI evidence.

## Known deviations from the design

These are the mismatches to keep in mind when reading the code or the implementation documents. They are ordered by how much they change the architecture:

1. **Router purity (D3).** The Router keeps execution and read tools; not executing work depends on prompt text. The design calls for a system constraint.
2. **Worker voice (D5, D14).** Workers can acknowledge people directly; the design gives the Router the only external write path.
3. **Execution environment (D23) and credentials (D24).** Everything runs on one machine as one user, with no daemon and no credential boundary. The current deployment is usable in a trusted single-user setting only.
4. **Persistence (D22).** The state/compute split exists in code, not in deployment; the agent is still tied to one process on one machine.
5. **Async loop (D18).** Background execution and completion events come from the host; there is no explicit `start` / `stop` tool contract, and a foreground command still runs synchronously for up to 5 seconds.
6. **Recall (D15, D16).** Context budgeting is a set of fixed injection limits; chain-of-recall is a foundation of ids and reads, not a working multi-hop mechanism.
7. **Speculation (D17).** `observe` means "record what would have been accepted", not "prepare the result in advance". Do not count it as speculative execution.
8. **Watchdog (D25–D27).** Absent; operational scripts are not a control loop.
9. **Evidence (D28).** No experiment reproduces or extends the article's measurements, so no speed or quality claim about this fork is supported.

## How to re-check this document

- Read [the design](design.md) first; every row above names the obligation it judges.
- Re-run the evidence paths: `pnpm check` for types, tests and build; `pnpm test` for the contract suites; [docs/architecture.md](architecture.md#modules) for the module index and [docs/testing.md](testing.md#test-catalog) for the test catalog.
- Check the deviations with the code: the main-Session preset in `cordis.patch.yml` (D3), `orchestrator_ack` in the executor tools and `prompts/replies.md` (D5), deployment and isolation in [Deployment](user/deployment.md) (D22–D24).
- When behaviour changes, update the affected row and its evidence in the same change. If a row cannot be judged from code or tests, say so instead of guessing.
