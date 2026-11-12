# The Super-agent design

This document is the design definition for this repository. It restates the design of a **Super-agent** from the article *Exploring Super-agent Design: Towards a More Autonomous Agent System* (DeepSeek Harness Team, 2026-10-31, <https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg>) as obligations that an implementation has to meet. The repository is the operator's production line for that design: it starts from the DeepSeek Harness team's research prototype and is developed into a personal Super-agent.

The article is the authority. This document is this repository's binding interpretation of it; where the two disagree, the article wins and this document has a bug. The code and the implementation documents under `docs/subsystems/`, `docs/user/` and `docs/cookbook/` describe *one implementation*. When that implementation differs from this document, the design stays the authority and the implementation is incomplete. [The status document](status.md) records how far the current code gets; it never redefines the design. [The documentation index](README.md) gives the reading order.

## 1. What a Super-agent is

A Super-agent is a hosted agent that is not bound to a single manual session. It stays in a team's real working environment, keeps context across sessions and channels, advances several complex tasks without blocking each other, and keeps running and recovering over time.

The article defines four basic characteristics. An implementation that only schedules work cannot show them; they have to hold together:

| Characteristic | Meaning |
| --- | --- |
| **Continuous** | People interact with it where they already work — IM, GitHub, mail — and feel there is one agent, not a set of sessions. A decision made in IM and a direction changed in a pull request review reach the same thread of work. |
| **Efficient** | It answers quickly and advances multiple complex tasks in parallel with good quality. A new instruction is accepted while the previous command or task is still running. |
| **Proactive** | It watches environment events and advances what is worth advancing without being asked event by event, and stays silent when nothing needs a person. |
| **Persistent** | It is always online, is attached to the real working environment, and recovers by itself from failures over long runs. |

A single ReAct loop cannot provide these four at once. The article therefore names five modules, which sections 3.1 to 3.5 of this document turn into design obligations:

1. A two-tier architecture (§2 of the article) for *continuous* and *efficient* interaction.
2. Event-driven intake and routing (§3) for *proactive* behaviour.
3. Human-facing interaction (§4) that stays both continuous and efficient.
4. Separation of compute, state and environment (§5) for *persistent* operation.
5. A Watchdog (§6) that keeps the system running and recovering.

The design is a system design, not a product feature list. The article says so itself, and it marks several parts as future work or open questions. An implementation may be smaller than the design; it may not call the smaller thing the design.

## 2. What work the agent takes on

The design is about the agent's relationship to a person's work, not about a task type. Its unit is whatever the operator would otherwise hand to a teammate — coding, decisions, coordination, documents, operations and follow-ups alike. Whether work is code, a team matter or an enterprise matter changes the Source it arrives on, the Channel it is answered on, the authorization it needs, the tools and prompts a Worker uses and the evidence a result carries. It does not change the architecture.

This project therefore has one agent for one operator's whole work inside their team, with the following scope:

- **Coding is the first and main workload.** It covers the work around a code review, not only typing code: reading an issue, reproducing a problem, implementing, reviewing, responding to review comments, following CI, delivering a pull request, reporting the outcome. This is the workload the current implementation covers.
- **Team affairs are part of the target.** Requests, decisions, follow-ups, reminders, summaries and coordination that arrive in the team's channels. They use the same intake, routing and delivery; only the deliverable differs.
- **Enterprise affairs are part of the target.** The administrative and cross-team matters a person would hand to an assistant: approvals, schedules, correspondence, forms and documents. They are in the design's scope even though the current implementation does not cover them; the status document says so.
- **The work is not limited to what is implemented.** A boundary in the current implementation is an implementation gap recorded in the status document, not a boundary of the product.

Two constraints follow:

1. **The architecture is domain-agnostic.** Supporting another kind of work must be a Source, a Channel, a Policy rule, a tool or a prompt — not a new architectural concept. If a new kind of work seems to need a new core concept, the design is wrong or the work is not really new; decide that explicitly.
2. **Authority does not grow with breadth.** The agent acts only when asked or when a written Policy allows it, whatever the work is. A broader scope widens what the agent *may* be asked to do, not what it may do unasked.

## 3. Design obligations

An implementation of the design has to meet the obligations below. IDs are stable so that [the status document](status.md) can point at them. "Must" means the design requires it; "may" marks an intended property that an implementation can scope down, provided the status document says so.

### 3.1 Two tiers: Router and Worker (article §2)

The design splits "keep the whole context continuous" from "execute many things at once". Sending every event to one session keeps the most context but is serial and mixes tasks together; giving every event its own session is parallel but fragments the context and produces several competing voices. The two tiers resolve the trade-off.

- **D1 — Two tiers.** The system has a resident **Router** tier and isolated **Worker** tiers. Each tier is a logical role and may hold more than one session internally.
- **D2 — Router is the global sequence point.** The Router accepts all human interaction on every channel and holds the cross-task information and decisions: the global memory, the order of work and the coordination between tasks.
- **D3 — Router does not execute work.** The Router's job is interaction and dispatch; it does not do the concrete work of a task, and it may not even have a shell. This must be a system constraint (tools, permissions), not only a prompt rule. If the Router starts executing, the architecture has collapsed into a single session.
- **D4 — Workers are isolated and complete.** Each Worker runs one task in its own context with the full execution tool set. Workers decide the quality of the result, so they get the strongest model available; the Router may use a lighter one.
- **D5 — Workers do not talk to people.** A Worker does not answer a human directly and its reasoning and tool calls do not reach an external channel. It reports state and conclusions to the Router, and the Router is the only writer to the outside world. This keeps concurrent work from producing several competing voices.
- **D6 — No direct Worker-to-Worker channel.** Conflicts between concurrent Workers are expected in shared working objects such as one pull request. They are made visible through shared Thread subscriptions (D12, D13) so Workers can notice each other's work; the few cross-task decisions go through the Router.
- **D7 — Batching is intended.** Triggers that arrive while the Router is reasoning accumulate and are handled together in its next turn. A single resident Router session is the default; its scale limits are a known trade-off, not a reason to split it early.
- **D8 — Tiers may nest.** A Worker may run subagents or an agent team internally, transparently to the Router.

### 3.2 Event-driven intake and routing (article §3)

The driver of a Super-agent is the environment, not only a typed prompt. Environment events — group messages, mail and calendar reminders, review comments, CI results — are **Triggers**.

- **D9 — Triggers are the primary input.** The system listens to its Sources and is woken by events; it does not wait for a person to type each instruction.
- **D10 — Two-level filtering.** Before any model call, deterministic program rules (source, group, allow lists, bots) decide what may enter at all; only then does a model apply written policy to decide whether to act. The order is fixed: fast path first, slow path second. The semantic layer is a natural-language extension point, so policy can be extended or switched by editing prompts.
- **D11 — Threads are first-class.** Triggers that belong to one conversation — one pull request, one IM topic, one mail thread — form a **Thread**. Thread identity is durable and drives context and routing.
- **D12 — Subscribed events pass through.** A Worker that owns work on a Thread subscribes to it. Later events on that Thread go directly to the Worker by program routing, without the Router spending a model decision on them.
- **D13 — Unsubscribed events go to the Router.** The Router observes all events for global state, but spends model decisions only on events that are not yet owned. Subscriptions are many-to-many: a Worker may follow several Threads and a Thread may reach several Workers. A Worker may drop a subscription and hand events back when they leave its task's scope.
- **D14 — Output converges at the Router.** Workers report key conclusions to the Router; the Router replies to people and updates the global memory. Doing so is what keeps one voice and one continuous memory.
- **D15 — Context behaves like a cache (Inline & Spill).** Information that is likely to be used soon is inlined into the window; the rest is left outside as a reference or summary and read on demand. Injected context has a budget and an entry point to read more; the full object is never inlined by default.
- **D16 — Chain of recall.** Triggers, Threads and Worker sessions have stable IDs, and injected context includes the IDs of closely related objects. Objects returned by a read follow the same Inline & Spill rule, so a model can walk from an event to its Thread, to a Worker, to another related Thread, and recover context across long runs.
- **D17 — Speculative action (intended capability).** On an environment signal the agent may prepare a result in the background before it is certain the result will be used — check a calendar, gather background, draft a reply, reproduce and propose a fix — and deliver it only when it has value, staying silent otherwise. An implementation may delay this capability; the status document records that it is delayed.

### 3.3 Human-facing interaction (article §4)

- **D18 — Asynchronous ReAct loop.** Long-running tools (commands, subtasks) are started asynchronously: `start()` returns "started" immediately, the loop does not wait, the final result later arrives as a new event in the session, and `stop()` can end a runaway task. This is what lets background work and conversation run at the same time.
- **D19 — Full duplex.** New human input is processed at the end of the current reasoning step, without waiting for the background task. Conversation never blocks on execution.
- **D20 — Channel-specific delivery.** Output matches the channel's density and habits. IM is low-disturbance: only decisions and acceptance need a message, questions are direct and answers short — the article's verified rule is a single reply of at most 100 words. GitHub, mail and documents are asynchronous channels: structured, information-dense delivery, with background, change and verification stated the way the project expects (for a pull request, in its description).

### 3.4 Compute, state and environment (article §5)

- **D21 — State lives outside the loop.** The agent loop can be restarted or replaced; session state, tasks, Threads, subscriptions and memory live in persistent storage, and the continuity of work survives the restart.
- **D22 — Compute is stateless.** The design puts the agent loop in stateless, elastic compute and keeps persistent state in a database, so the agent is not tied to one machine's lifetime. A single-process deployment is a scoped implementation of this obligation and must be recorded as such.
- **D23 — The environment stays where the work is.** The design does not copy the user's environment into the cloud. A lightweight, stateless daemon at the environment executes commands and returns results; the cloud agent loop reads its context through that interface. This supports **BYOM** (the user's own machine, including one that is online only intermittently) and hosted machines alike, and lets the agent switch environments and use context from each.
- **D24 — Security is a precondition, not a detail.** The cloud loop is attached to environments full of private code and credentials; a compromised loop or a prompt injection would reach every attached environment. Credentials must not enter model context — the agent needs mechanisms to use credentials without seeing them. The article lists this among its open questions; an implementation that attaches to real environments must say how it addresses it or must not attach.

### 3.5 Watchdog (article §6)

- **D25 — External control loop.** Long-running systems need a control loop outside the main system. The design uses an independent **Watchdog** session driven by timed messages, separated from the main system but able to read its state.
- **D26 — Faults and progress.** The Watchdog handles infrastructure faults (interface errors, failed state recovery) and retries transient ones until they recover. It also judges, with a model, whether a Worker is making real progress or has drifted from the goal, because a live process is not the same as live work; when it finds a problem it intervenes.
- **D27 — Watchdog is a full agent.** The Watchdog is itself an agent session with tools; maintainers can ask it why something failed and have it change the main system's behaviour, such as adding or removing prompts or adjusting trigger rules. The power this grants is the reason D24 is a precondition.

### 3.6 Evidence and open questions (article §7, §8)

- **D28 — Evaluation claims carry their limits.** The article's experiment measures scheduling and collaboration, not the quality of coding: about 300 synthetic messages with about 20 work requests, coding replaced by a tool that only consumes time, time scaled by 1/4, five runs per variant. Any claim about speed or completion has to carry these conditions. The double-tier result is about completion time and stability, and pass-through is about saved Router decisions and tokens, not better work.
- **D29 — Open questions stay open.** The design does not answer: how to extend or shard the two tiers; long-horizon memory across months; how people collaborate when sessions are no longer the product surface; A2A between isolated instances; and security and privacy, including credentials. An implementation must not present these as solved.

## 4. Vocabulary

The article's names and this repository's names for the same roles. The implementation documents and the code use the local names; design discussion should use the design names.

| Design term | This repository | Meaning |
| --- | --- | --- |
| Super-agent | dsh-superagent | The hosted agent as a whole |
| Router | Main Session, `orchestrator` | The resident global tier: interaction, memory, dispatch |
| Worker | Executor Session, `worker` | An isolated execution session for one task |
| Trigger | Trigger | One environment event |
| Thread | Thread | One conversation's event stream |
| Subscription / pass-through | Subscription / fan-out | Routing later Thread events straight to a Worker |
| Gate + assessment | Gate + Assessment in `Eval` | The two filtering layers |
| Ticket | Ticket | One unit of authorized work |
| Channel | Channel | The write side of a Thread |
| Watchdog | Watchdog (demo) | The external control loop |

The domain model in [Domain model](subsystems/domain-model.md) refines these roles for this implementation. It adds authorization (Policy, Mandate) and delivery details that the article leaves open; such additions are allowed as long as they do not contradict this document.

## 5. How to use this document

1. **Read the design first.** Before changing behaviour, read the article section this document cites and the relevant obligations; then read the implementation documents.
2. **Design decides, code follows.** A behaviour that exists in code is not thereby intended. If code and this document disagree, either fix the code or record the gap in [the status document](status.md) — do not edit this document to match the code. Edit this document only when the design itself changes or its interpretation here was wrong, and say why.
3. **The status document is the only limitations list.** Every gap between this document and the implementation lives in [docs/status.md](status.md), with evidence. A design obligation is never softened because the implementation lacks it.
4. **New kinds of work are configuration, not architecture.** Add a Source, Channel, Policy rule, tool or prompt. D1–D29 stay as they are.
5. **When in doubt, be smaller.** The article does not specify many engineering details (database, queues, deduplication, concurrency, retries, permissions, observability). Choose the simplest implementation that does not close the door on an obligation, and record the choice.
