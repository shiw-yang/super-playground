# AGENTS

Instructions for any coding agent working in this repository. It applies to a general coding agent and to a dsh-superagent Executor Session working on this repository: the worker prompt tells Executors to follow the repository's `AGENTS.md`.

This repository is the operator's production Super-agent, forked from the DeepSeek Harness team's research prototype. `README.md` says what it is; `docs/DESIGN.md` is the design authority; `docs/STATUS.md` is the only limitations list. The numbered documents `docs/000-philosophy.md` to `docs/008-cookbook.md` describe one implementation of the design, in order.

## Read before changing anything

1. `README.md` — what the project does and its entry points.
2. `docs/README.md` — the documentation index and the map of what to update for each kind of change.
3. `docs/DESIGN.md` — the obligations the code has to meet; the article is the authority, this document is its binding interpretation.
4. `docs/STATUS.md` — what is implemented, partial or absent, with evidence; the only place that records gaps.

Then read the documents for your task:

| Task | Read first | Verify with |
| --- | --- | --- |
| Change domain concepts, types or Ticket stages | `docs/001-domain.md`, `docs/002-authorization.md`, `src/core/model.ts`, `src/core/stage.ts` | `tests/core-engine.spec.ts`, `tests/policy.spec.ts`, `tests/stage.spec.ts` |
| Change authorization, gate, Eval, Policy or Mandate | `docs/002-authorization.md`, `src/policy.ts`, `src/admission.ts`, `src/core/evals.ts` | `tests/policy.spec.ts`, `tests/core-engine.spec.ts`, `tests/settings.spec.ts` |
| Change Ticket execution, recovery, retry or restart | `docs/003-execution.md`, `src/core/tickets.ts`, `src/core/assignments.ts`, `src/executor/`, `src/app/effects.ts` | `tests/core-engine.spec.ts`, `tests/effects.spec.ts`, `tests/health.spec.ts`, `tests/runtime.spec.ts` |
| Change prompts, skills or the text models read | `docs/004-prompts.md`, `prompts/`, `skills/`, `src/app/prompts.ts`, `src/app/skill-files.ts` | `tests/prompts.spec.ts`, `tests/cards.spec.ts`, `tests/prompt-config.spec.ts`, `tests/model-surface.spec.ts` |
| Change the panel or another client view | `docs/005-panel.md`, `src/client/` | `tests/client.spec.tsx`, `tests/styles.spec.ts`, `tests/panel-*.spec.tsx`, `tests/locales.spec.ts` |
| Change deployment, setup, settings or machine limits | `docs/006-deployment.md`, `SETUP.md`, `src/deployment.ts`, `src/app/settings.ts`, `src/setup.ts`, `cordis.patch.yml` | `tests/deployment.spec.ts`, `tests/environment.spec.ts`, `tests/settings.spec.ts`, `tests/bundle-patch.spec.ts`, `tests/service-script.spec.ts` |
| Add or change a Source or Channel | `docs/008-cookbook.md`, `docs/002-authorization.md`, `src/sources/`, `src/core/ports.ts` | `tests/sources.spec.ts`, `tests/registry.spec.ts`, `tests/commands.spec.ts` |
| Change module boundaries, dependencies or the runtime skeleton | `docs/007-architecture.md` (Core classes, Dependency rules, Modules), `docs/architecture.md` | `tests/docs.spec.ts` (module table), `tests/runtime.spec.ts` |
| Add or change tests, or report verification | `docs/testing.md` | the checks named there |
| Change documentation | `docs/README.md` (index and maintenance map) | `tests/docs.spec.ts` |
| Change interface copy in either language | `docs/i18n/README.md`, `src/client/locales.ts`, `locale/` | `tests/locales.spec.ts` |
| Decide a long-lived design choice | `.agents/notes/README.md` | — |

`docs/subsystems/README.md` is the index of the precise behavior, type and protocol references. `docs/development.md` covers the environment, commands and repository layout. `docs/cookbook/README.md` is the task-procedure index; `docs/user/index.md` is the operator-facing entry.

## Rules

1. **The design decides; the code follows.** A behavior that exists in code is not thereby intended. If code and `docs/DESIGN.md` disagree, fix the code or record the gap in `docs/STATUS.md` — do not weaken the design or edit it to match the code. Read `docs/DESIGN.md` section 5 before changing intended behavior.
2. **Keep the implementation documents true in the same change.** Every change to behavior, a command, an interface, a configuration value, a default or a visible state updates the affected document: the numbered document for the subsystem, `docs/007-architecture.md` for structure, and the entry documents (`README.md`, `SETUP.md`, `docs/development.md`) for how the project is run. `docs/README.md` has the matrix of change to documents. A stale document is a bug in the change that made it stale.
3. **Documentation conventions.** Committed documentation is written in English, and `tests/docs.spec.ts` enforces it. The numbered documents stay numbered and in order; a new numbered document takes the next number. A numbered document links only to earlier numbered documents or to documents outside the numbered sequence (the design, status, testing and other reference pages); the test enforces that too. Every local link and anchor must resolve. Add a new document to the index in `docs/README.md`. Do not create generated catalogs unless a generator exists.
4. **Tests carry the contract.** New behavior gets a test; a behavior change updates the tests that pin it. `tests/docs.spec.ts` pins the documentation structure, `tests/class-docs.spec.ts` the JSDoc of every class, `tests/locales.spec.ts` the two interface languages, `tests/styles.spec.ts` the stylesheet, and `tests/model-surface.spec.ts` the tools, prompts, skills and inputs models read. Read the test before editing the surface it checks.
5. **Respect the structure.** `src/core` imports nothing outside itself apart from Node's hashing and does no I/O; `src/sources` imports nothing from `src/app`; the panel imports only types from the host side plus the plain values listed in `docs/007-architecture.md`. Each kind of state has one writer (table in `docs/007-architecture.md`). A refusal a person or an agent can cause is a `UserError` code, not a thrown string.
6. **Verify with what you actually ran.** The tests use a simulated DeepSeek Harness host, a fake management API and fake CLIs; they need no network, no DSH installation and no GitHub or Feishu account. That makes passing tests evidence about contracts, not proof that a live deployment works. End-to-end claims need a real deployment the operator approved. Never write that a check passed when it was not run.
7. **Protect the workspace and the operator's environment.** Other sessions may have uncommitted changes in this working tree; preserve them. Git worktrees under `.agents/worktrees/` belong to other tasks: do not edit or remove them. Do not commit, push, deploy, restart the running instance, change CI or dependencies, or send a real channel message unless the task asks for it. Do not read secrets, tokens or private keys.
8. **Report what a reviewer needs.** Name the files changed, the evidence for factual claims, the checks actually run and their results, what remains unverified, and any decision the operator has to make.

## Verify

Run the narrowest suite that covers the change, then the repository check:

```sh
pnpm test -- tests/docs.spec.ts   # documentation structure, links, language, indexes
pnpm check                        # typecheck, all tests, build
```

`pnpm check` is the delivery gate. If it cannot run in your environment, say which command you ran instead and why. The full suite and the per-change check matrix are in `docs/testing.md`.

## Where the documentation lives

- Entry: `README.md` (the project) and `docs/README.md` (the documentation index).
- Design authority and status: `docs/DESIGN.md`, `docs/STATUS.md`.
- Implementation sequence: `docs/000-philosophy.md` to `docs/008-cookbook.md`.
- Architecture and subsystem references: `docs/architecture.md` → `docs/007-architecture.md`, `docs/subsystems/README.md`.
- Development and verification: `docs/development.md`, `docs/testing.md`.
- Task procedures: `docs/cookbook/README.md`, `SETUP.md`, `docs/008-cookbook.md`.
- Operator documentation: `docs/user/index.md`.
- Interface copy in two languages: `docs/i18n/README.md`.
- Review rules the test suite enforces: `docs/defensive-patterns/README.md`.
- Design decisions and their rationale: `.agents/notes/README.md`.

Local-only working material is git-excluded and not shipped: `research/` and `docs/agent-roadmap/`. It may be in another language. Do not link it from committed documentation; use it as working context only.
