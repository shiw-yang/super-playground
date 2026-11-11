# Testing and verification

The test suite pins the contracts of the domain, the Sources, the runtime, the panel and the documentation. This page says what the suites cover, how to run them, which suite a change needs, and how to write tests and report a check. Read [AGENTS.md](../AGENTS.md) for the repository rules; [Development](development.md) covers install, commands, layout and build, and [Architecture](architecture.md) maps the code each test exercises.

The suite contains spec files under `tests/`, plus shared fixtures in `tests/fixtures/`; the Test catalog below is the complete index. It needs no network access, no running DeepSeek Harness instance, no GitHub or Feishu account and no model provider: a simulated host, a fake management API and stub CLIs stand in for them.

## What the tests cover, and what they do not

They cover the parts that carry behavior and contracts:

- The Engine's domain rules on in-memory repositories: receiving, Eval, the Ticket lifecycle, Assignments, replies, Policy changes and recovery.
- Named GitHub and Feishu Source instances, instance-scoped identity/state/accounts, the Source registry and reads on a `SourceContext`.
- Same-machine execution selection and immutable bindings, revision-specific subprocess environments, preparation/recovery and legacy migration. Contract tests do not establish remote execution or an OS credential boundary.
- The whole Runtime, its tools and HTTP routes on a simulated DeepSeek Harness host, and the panel views derived from the Store.
- Worker-reported verification snapshots and compact briefs through tool validation, persistence, bounded reads and the Ticket panel. These tests check how evidence is recorded and displayed; they do not independently verify the Worker's reported checks or compare them with the current head.
- Each panel page and settings group against a fake management API.
- The contracts that must not drift: the model-facing surface, the two interface languages, the stylesheet, class JSDoc, the bundle patch and its presets, the `kv` key registry and the documentation structure.

They do not cover:

- A real deployment. No test contacts a real DeepSeek Harness host, GitHub, Feishu or model provider, so a passing test is evidence about a contract, not proof that a live deployment works. [Implementation status](status.md) records the same limit for its own rows.
- Load, speed or quality claims. There is no benchmark, baseline scenario or metrics harness; the tests assert behavior, not the article's scheduling results.
- The service script against a real host: `tests/service-script.spec.ts` runs `scripts/dsh-superagent` with stubbed `ps`, `tmux` and `dsh` binaries.

## Prerequisites

- Node.js `^22.19.0 || >=24.0.0` and pnpm `11.7.0`, as `package.json` declares in `engines` and `packageManager`.
- Dependencies installed with `pnpm install`. The runner is vitest 4.1.8 from `devDependencies`; `jsdom` from `devDependencies` serves the panel tests.
- `git` and `python3` on `PATH`: the deployment and environment tests start real local git processes, and the service-script test runs the Python script.
- Nothing else: no DeepSeek Harness installation, no GitHub or Feishu login and no model provider are needed for the suite.

Most tests run in Vitest's default Node environment. A file that renders panel components opts into jsdom with `// @vitest-environment jsdom` on its first line, as all `tests/panel-*.spec.tsx` files, `tests/client.spec.tsx`, `tests/navigation.spec.ts` and `tests/controls.spec.tsx` do.

## How to run

| Command | Runs |
| --- | --- |
| `pnpm test` | The whole suite: `vitest run` over `tests/**/*.spec.{ts,tsx}` |
| `./node_modules/.bin/vitest run tests/docs.spec.ts` | One file, or several paths; this is the same runner `pnpm test` invokes |
| `pnpm typecheck` | `tsc --noEmit` over `src/`, `tests/` and `tsdown.config.ts` |
| `pnpm build` | `tsdown`: the Node entries (`lib/index.js`, `lib/github-watch.js`, `lib/feishu-watch.js`, `lib/worker-environment.js`) with type declarations, and `lib/client.js` |
| `pnpm check` | `pnpm typecheck && pnpm test && pnpm build`: the delivery gate |

If `pnpm` cannot run in your environment, for example because its store is not writable, call the binaries installed under `node_modules/.bin/` directly: `./node_modules/.bin/vitest run <files>`, `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/tsdown`. They run the same tools as the scripts do.

## Test taxonomy by layer

| Layer | Runs against | Representative tests |
| --- | --- | --- |
| Core domain | `MemoryRepositories` (`src/core/memory.ts`): the Store's repositories in memory, with its order and nested rollback, plus stand-in ports | `tests/core-engine.spec.ts`, `tests/stage.spec.ts`, `tests/policy.spec.ts` |
| Sources | A `SourceContext` built from a real Store, an Engine with stand-in ports and a `HealthBoard`; CLI calls are spied on | `tests/sources.spec.ts`, `tests/registry.spec.ts`, `tests/commands.spec.ts` |
| Runtime | `tests/fixtures/host.ts`: an in-memory DeepSeek Harness host running a configured Runtime | `tests/runtime.spec.ts`, `tests/effects.spec.ts`, `tests/outbox.spec.ts`, `tests/followups.spec.ts` |
| Panel | jsdom plus `tests/fixtures/panel-server.ts`, the typed fake management API, and `tests/fixtures/panel.tsx`, the panel around a page | `tests/panel-*.spec.tsx`, `tests/client.spec.tsx`, `tests/navigation.spec.ts` |
| Contract and invariant | The repository itself: the source tree, `docs/`, the panel copy dictionaries in `src/client/locales.ts`, the SQLite Store and `cordis.patch.yml` | `tests/docs.spec.ts`, `tests/class-docs.spec.ts`, `tests/locales.spec.ts`, `tests/model-surface.spec.ts`, `tests/bundle-patch.spec.ts`, `tests/store.spec.ts` |
| Client styles | `src/client/client.css` against the classes its components use | `tests/styles.spec.ts` |

The rules these contract tests enforce, and what a defect looks like for each, are collected in [Defensive patterns](defensive-patterns/README.md).

## Per-change check matrix

Run the narrowest row that covers the change, then the delivery gate.

| Change | Run first |
| --- | --- |
| Domain rules, Ticket stages, types (`src/core/`) | `tests/core-engine.spec.ts`, `tests/stage.spec.ts`, `tests/policy.spec.ts` |
| Policy, gate, admission, settings schemas (`src/policy.ts`, `src/admission.ts`) | `tests/policy.spec.ts`, `tests/settings.spec.ts`, `tests/core-engine.spec.ts` |
| Sources and Channels (`src/sources/`) | `tests/sources.spec.ts`, `tests/registry.spec.ts`, `tests/commands.spec.ts` |
| Runtime, effects, passes, outbox (`src/app/`) | `tests/runtime.spec.ts`, `tests/effects.spec.ts`, `tests/passes.spec.ts`, `tests/outbox.spec.ts` |
| HTTP routes and panel views (`src/app/http.ts`, `src/app/views/`) | `tests/http.spec.ts`, `tests/views.spec.ts`, `tests/timeline.spec.ts` |
| Store, persistence, migration (`src/app/store.ts`, `src/app/migration.ts`) | `tests/store.spec.ts`, `tests/migration.spec.ts`, `tests/cache.spec.ts` |
| Prompts, skills, text and inputs models read (`prompts/`, `skills/`) | `tests/prompts.spec.ts`, `tests/cards.spec.ts`, `tests/prompt-config.spec.ts`, `tests/model-surface.spec.ts` |
| Worker verification snapshots, report briefs and evidence presentation | `tests/verification.spec.ts`, `tests/panel-verification.spec.tsx`, `tests/model-surface.spec.ts` |
| Panel pages and components (`src/client/`) | `tests/panel-*.spec.tsx`, `tests/client.spec.tsx`, `tests/navigation.spec.ts`, `tests/controls.spec.tsx` |
| Interface copy (`src/client/locales.ts`) | `tests/locales.spec.ts` |
| Stylesheet (`src/client/client.css`) | `tests/styles.spec.ts` |
| Deployment, setup, environment, service script (`src/deployment.ts`, `src/setup.ts`, `scripts/dsh-superagent`) | `tests/deployment.spec.ts`, `tests/environment.spec.ts`, `tests/execution-environments.spec.ts`, `tests/settings.spec.ts`, `tests/bundle-patch.spec.ts`, `tests/service-script.spec.ts` |
| Named environments, selection, snapshots and Source instance identity | `tests/environments.spec.ts`, `tests/execution-environments.spec.ts`, plus `tests/settings.spec.ts`, `tests/migration.spec.ts`, `tests/registry.spec.ts`, `tests/sources.spec.ts`, `tests/commands.spec.ts`, `tests/tools.spec.ts`, `tests/panel-settings.spec.tsx`, `tests/panel-source.spec.tsx` |
| Bundle patch and agent presets (`cordis.patch.yml`) | `tests/bundle-patch.spec.ts` |
| Module boundaries and dependency direction (`src/core/`, `src/sources/`, panel imports) | `tests/docs.spec.ts` (module table), `tests/runtime.spec.ts` |
| Classes and their JSDoc (`src/`) | `tests/class-docs.spec.ts` |
| Documentation (`docs/`, `.agents/notes/`, `AGENTS.md`, `docs/AGENTS.md`, `README.md`) | `tests/docs.spec.ts` |
| Every change, before delivery | `pnpm check`, or name the narrower command you ran instead |

## Writing tests

- Put a spec under `tests/`, named `*.spec.ts` or `*.spec.tsx`; `vitest.config.ts` picks up `tests/**/*.spec.{ts,tsx}`.
- Prefer the shared fixtures over a new one. `tests/fixtures/host.ts` runs a configured Runtime on an in-memory DSH host; `tests/fixtures/panel-server.ts` and `panel.tsx` provide the fake management API and the panel around a page; `tests/fixtures/deployment.ts` supplies a resolved deployment; `tests/fixtures/git.ts` gives every git process an environment without the repository variables; `tests/fixtures/async.ts` has the async helpers. The full list is in the Test catalog below.
- Keep state local: create a temporary directory and remove it, as the fixtures do. No test may read or write the operator's real state directory, profile or repository.
- Replace the outside world with stubs. Spy on `Commands.prototype` methods (`run`, `gh`, `lark`, `git`) as `tests/sources.spec.ts`, `tests/runtime.spec.ts` and `tests/model-surface.spec.ts` do; let `tests/fixtures/panel-server.ts` answer every route in `src/app/api.ts`; let the host fixture simulate Sessions, tools, prompts, skills and inputs. The service-script test is the one place that starts a loopback HTTP server for the management API, and it answers on the local machine only.
- Assert behavior, not implementation: one observable rule per test, with a name that states the rule. Domain tests use `MemoryRepositories`, so they exercise the Engine with the Store's order and transaction semantics without opening SQLite.
- Panel tests declare their queries and bodies in the fake server; it records any undeclared query parameter or body mismatch in `server.misuse`, which the fixture asserts is empty after each test.
- Use `deferred`, `track` and `waitUntil` from `tests/fixtures/async.ts` to observe async ordering.
- New behavior gets a test, and a behavior change updates the tests that pin the old behavior. Read the test before editing the surface it checks.
- A contract constant is deliberate: when the model-facing surface shrinks, lower its size budget; raise a budget only intentionally and explain why, as the comment on `BUDGET` in `tests/model-surface.spec.ts` states. The same holds for the word limits from `src/infra/text.ts`.

## Evidence rules

- A test existing is not a test passed. Run it, and report the exact command and its result.
- A simulated host, a fake API and fake CLIs are evidence about contracts, not end-to-end proof. Scoped-provider tests exercise service composition and tool dispatch with stand-ins; they are not a live multi-environment deployment. End-to-end claims need a real deployment the operator approved.
- When real-process verification is explicitly authorized only in isolation, use a wholly new profile, process, state directory and port with synthetic data. Leave production configuration, databases, workdirs and control files untouched, and do not restart an existing instance. Permission to edit code or run contract tests is not permission to start a service.
- Say what you did not run. If `pnpm check` cannot run in your environment, name the commands you ran instead and why, as [AGENTS.md](../AGENTS.md) asks.
- A failing test is information: read the assertion, fix the cause and rerun. Do not weaken a test or change its expected value just to make a real failure pass.
- When you report a check, give the command, the test files, the pass or fail counts, and anything skipped.

## Reviewing a change against real data

Only with explicit operator authorization to use real data, point `DSH_HOME` at a temporary directory and create a new profile there. Copy the database from an authorized backup; before starting the isolated process, disable every Source, pause processing and remove the main Session id in the copy. Give the GitHub and Feishu CLIs read-only stand-ins. Do not access production credentials or start the existing instance. If authorization permits synthetic data only, use synthetic data as described in the evidence rules instead of copying a backup.

## Test catalog

| Test | Covers |
| --- | --- |
| `tests/core-engine.spec.ts` | Domain rules on in-memory repositories: receiving, Eval, fan-out, resume and stop, interrupted Assignments, the pause, Policy changes, reports and outcomes, attaching, replies, failed deliveries and dismissed problems |
| `tests/stage.spec.ts` | The Ticket stages, row by row |
| `tests/policy.spec.ts` | Source scope, the gate, the admission table, Mandate revalidation, the Policy version, settings migrations and assessment outcomes |
| `tests/registry.spec.ts` | `SourceRegistry`: instances, validation, Policy parts, Channels and Thread context |
| `tests/sources.spec.ts` | Feishu and GitHub instance contexts: translation, polls/cursors, pull-request rules, health, connection-generation invalidation and late-response refusal |
| `tests/commands.spec.ts` | CLI calls as the deployment's accounts, the Channels' answers, and repository-scoped GitHub calls |
| `tests/feishu-read.spec.ts`, `tests/github-read.spec.ts` | Feishu and GitHub reads |
| `tests/admission-context.spec.ts`, `tests/feishu-image.spec.ts` | The Thread window of assessments, and Feishu image reads |
| `tests/assessment.spec.ts` | What the MasterAssessor keeps per Eval, and when it lets go |
| `tests/background.spec.ts` | Waiting for a worker's shell jobs and subagents: an end that woke it, and a host that stops |
| `tests/bundle-patch.spec.ts` | The bundle's patch, read as DeepSeek Harness reads it, and the agent preset of Executor Sessions it defines |
| `tests/effects.spec.ts` | The effect queue: coalescing, limits, retries with backoff, health and shutdown |
| `tests/passes.spec.ts` | Passes: one at a time, the ones asked for during a pass run as one after it, and the runtime health a failed pass reports |
| `tests/outbox.spec.ts` | The Outbox on a running Runtime: messages wait while processing is paused or their Source is not installed |
| `tests/cache.spec.ts` | `TextCache` |
| `tests/queue.spec.ts` | The Runtime's work through the effect queue, and what earlier versions stored |
| `tests/followups.spec.ts` | A person's follow-up on a Ticket's Thread: its notice to the main Session, the tools that act on it, what a burst costs; a worker's hand-back and context follow, and the main Session's note |
| `tests/health.spec.ts` | One health entry per part, each cleared by its own next success |
| `tests/delivery.spec.ts` | `AgentDelivery` |
| `tests/retry-health.spec.ts`, `tests/role-models.spec.ts` | Model budget retries, and the models of the two roles |
| `tests/runtime.spec.ts` | The whole application on a simulated DeepSeek Harness host, through tools and HTTP |
| `tests/tools.spec.ts` | The Sessions' tools: what `orchestrator_read` reads for each role, and the shapes and checks of the other main Session tools |
| `tests/verification.spec.ts`, `tests/panel-verification.spec.tsx` | Worker verification snapshots and compact briefs through tool schemas, Engine, SQLite, relays and bounded reads; panel provenance, revision details, check outcomes, limitations, evidence links, submission-order history and legacy Tickets |
| `tests/runtime-concurrency.spec.ts` | Work that overlaps: Triggers during a pass, Tickets that change during deliveries and launches |
| `tests/runtime-status.spec.ts`, `tests/panel-status.spec.tsx` | Live worker activity across panel projections and Assignment indicators: ready/waiting reports, follow-ups, direct Session turns, background work and handoff servers |
| `tests/http.spec.ts` | The same-origin and loopback checks, the status of each kind of failure, the body limit, path parameters and queries |
| `tests/settings.spec.ts` | Settings saves that race a model or account check, a Policy sync that a save outran, and the refusals of the pause, a sync and a block |
| `tests/views.spec.ts` | What the management views derive from the Store, such as the Thread a dropped message belongs to |
| `tests/timeline.spec.ts` | A Thread's pages and a Trigger's neighbours by time and then id, with every received Trigger's time in one form |
| `tests/migration.spec.ts` | Legacy record migration through schema 11 to current storage, and refusal of unsupported older schemas |
| `tests/store.spec.ts` | Repositories and their working sets, in SQLite as in memory, the kv area, with every key of `KV` spelled only in `src/kv.ts` and the migration, settings history and queries |
| `tests/prompts.spec.ts` | Prompt validation, assembly and versions |
| `tests/cards.spec.ts` | The rules the built-in text must state, file by file |
| `tests/model-surface.spec.ts` | Everything models read: tools, prompts, skills and inputs, checked against the tool schemas, the execution environment and the glossary, within a size budget per role |
| `tests/deployment.spec.ts`, `tests/environment.spec.ts`, `tests/index.spec.ts` | Plugin configuration/setup and entry; explicit Worker environment materialization, Runtime-lifetime deduplication/reverification, aborted/failed attempts and credential guardrails |
| `tests/execution-environments.spec.ts` | Scoped subprocess overlays: concurrent Workers, shared-preset shell dispatch, nested/cold descendants, tombstones, fail-closed PTY handling, cleanup and absence of global environment mutation; preparation readiness after partial failures and legacy-marker adoption |
| `tests/environments.spec.ts` | Environment/scheduling schemas, fixed/Router selection and stale refusals, repository compatibility, immutable snapshots and disable, persisted-account drift rejection and historical-reference revalidation, retry/restart, schema-12 legacy binding and both acceptance tools |
| `tests/service-script.spec.ts` | `scripts/dsh-superagent` against fake `ps`, `tmux` and `dsh` |
| `tests/session-view.spec.tsx` | Executor Session overview, Ticket ownership and navigation to the panel |
| `tests/client.spec.tsx`, `tests/navigation.spec.ts`, `tests/controls.spec.tsx` | The client plugin's registration and polling, Session navigation and route memory, the local controls, and the panel's imports, which have no cycle |
| `tests/panel-overview.spec.tsx`, `panel-source.spec.tsx`, `panel-trigger.spec.tsx`, `panel-eval.spec.tsx`, `panel-execution.spec.tsx` | Each page of the panel, against a fake management API answered by route |
| `tests/panel-settings.spec.tsx`, `panel-prompts.spec.tsx`, `panel-deployment.spec.tsx`, `panel-panel.spec.tsx` | The settings groups, drafts and history, the prompts, the Deployment page, and the panel's search, glossary and route memory |
| `tests/draft.spec.ts`, `tests/prompt-config.spec.ts`, `tests/markdown.spec.ts`, `tests/marks.spec.ts` | Draft states, merges and the save bar's line; the prompt configuration by section and the line diff; the Markdown subset and its links; the mark of every state the views classify |
| `tests/locales.spec.ts`, `tests/styles.spec.ts` | The copy in both languages, the stylesheet |
| `tests/class-docs.spec.ts` | Every class in `src` has a JSDoc block before it |
| `tests/docs.spec.ts` | The entry documents exist; every local link and anchor resolves; no document has merge conflict markers; documentation prose is written in English; every document under `docs/` is reachable from docs/README.md, every subsystem page from docs/subsystems/README.md and every cookbook page from docs/cookbook/README.md; and the Modules table in docs/architecture.md plus the Test catalog here list every module and every test |

`tests/fixtures/` holds what several tests share: `host.ts`, a simulated DeepSeek Harness host; `panel-server.ts` and `panel.tsx`, the fake management API and the panel around a page; `deployment.ts`, a resolved deployment; `git.ts`, the environment of every git the tests start, which names no repository; and `async.ts`.

## Where to go next

- [AGENTS.md](../AGENTS.md) gives the repository rules and the verify gate.
- [documentation index](README.md) is the documentation index and the map of what to update for each change.
- [Development](development.md) covers install, the full command list, the repository layout and the build.
- [Architecture](architecture.md) has the module table that maps code to the classes each test exercises.
- [Defensive patterns](defensive-patterns/README.md) states, pattern by pattern, the rules the test suite enforces.
