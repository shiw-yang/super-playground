# Documentation

This index says what each document is for and when to read it. Committed documentation is written in English; the interface copy is localized separately ([Interface copy in two languages](i18n/README.md)).

Local-only working material is git-excluded and not shipped: `research/` and `docs/agent-roadmap/`. It may be in another language. Do not link it from committed documentation and do not treat it as current rules.

## Read in this order

Read the design first, then the status, then the implementation documents in order; each numbered document builds only on the ones before it. `README.md` at the repository root is the project entry.

1. [The Super-agent design](DESIGN.md) — the design definition, restated from the article as obligations. It is the authority for intended behavior.
2. [Implementation status](STATUS.md) — how far this fork gets toward the design, with evidence and known deviations. It is the only limitations list.
3. [000 Philosophy](000-philosophy.md) — the principle the project is judged by, and what it asks of the agent and its operator.
4. [001 Domain model](001-domain.md) — the concepts, the flow from Trigger to Ticket, the rejected concepts and the glossary.
5. [002 Authorization](002-authorization.md) — the two paths for a Trigger, the gate and Eval, Policy, strength, admission and Mandates.
6. [003 Execution](003-execution.md) — Ticket stages, the Executor, concurrency, verification, how a Ticket ends, and failure recovery.
7. [004 Prompts](004-prompts.md) — what a team writes, built-in parts, assembly and precedence, and prompt versions.
8. [005 Panel](005-panel.md) — the supervision panel: its three questions, tabs, record reading, settings groups, search and principles.
9. [006 Deployment](006-deployment.md) — install, accounts, machine configuration, settings, the management API, setup checks, upgrade and troubleshooting.
10. [007 Architecture](007-architecture.md) — core classes and glue, dependency rules, the module table, persistence, model-facing interfaces and configuration reload.
11. [008 Cookbook](008-cookbook.md) — the step-by-step procedure for adding a Source.

## Reference and entry documents

| Role | Document | Read it when |
| --- | --- | --- |
| Project entry | [`README.md`](../README.md) (root) | You first open the repository: what it is, how to install, start and make the first request |
| Agent instructions | [`AGENTS.md`](../AGENTS.md) (root) | Before changing anything: rules, task reading paths, verification, workspace protection |
| Setup with an operator | [`SETUP.md`](../SETUP.md) (root) | Installing and configuring a deployment, one operator question at a time |
| Design authority | [The Super-agent design](DESIGN.md) | You need to know intended behavior or whether a behavior is required |
| Implementation status | [Implementation status](STATUS.md) | You need to know what exists, what is partial and which deviations are known |
| Architecture | [Architecture](architecture.md) → [007 Architecture](007-architecture.md) | You change structure, dependencies or a code index entry |
| Subsystems | [Subsystems](subsystems/README.md) | You need the precise behavior, types or protocol of one subsystem |
| Development | [Development](development.md) | You set up the environment, run commands or need the repository layout |
| Testing and verification | [Testing and verification](testing.md) | You add a test, choose checks for a change, or report evidence |
| Task procedures | [Cookbook](cookbook/README.md) | You perform a repeated task: setup, deployment, adding a Source, upgrading |
| Operator documentation | [Using dsh-superagent](user/index.md) | A person uses, configures or operates the agent |
| Interface copy | [Interface copy in two languages](i18n/README.md) | You add or change panel text, labels, refusals or metadata |
| Review rules | [Defensive patterns](defensive-patterns/README.md) | You review a change or a defect class the tests deliberately prevent |
| Design decisions | [Design notes](../.agents/notes/README.md) | You need the rationale, alternatives and cost behind a long-lived choice |

## Maintaining the documentation

- **One main location per fact.** Other documents provide entries and point at it. Details about a configuration value live in [006 Deployment](006-deployment.md); the rules that mention the value point there.
- **English, numbered, linked.** Committed documentation is English. Numbered documents keep their numbers and order; a new numbered document takes the next number. A numbered document links only to earlier numbered documents or to documents outside the numbered sequence (the design, status, testing and other reference pages, including files outside `docs/`). Every local link and anchor resolves. `tests/docs.spec.ts` checks the consecutive numbering, the link and anchor rules, the English prose and the index.
- **The index is complete.** Every shipped document under `docs/` is linked from this page; `tests/docs.spec.ts` fails on an orphan. Add a new document to the table above, and to the [agent reading paths](../AGENTS.md) if it changes what an agent should read.
- **No translation of documentation.** Documentation is English; only the interface is bilingual. The pairing rules and checks are in [Interface copy in two languages](i18n/README.md).
- **Local-only material** under `research/` and `docs/agent-roadmap/` is excluded from git in this checkout (`.git/info/exclude`). Do not link it here.

## Deliberately not adopted

The division is adopted as far as this repository needs it. Five roles are not created, and each reason is a decision, not an omission:

- **Per-directory `AGENTS.md`.** Nested instruction-file discovery has not been confirmed for this agent, so directory-specific rules live in this index and in [Testing and verification](testing.md). Revisit when the tool's discovery rules are known.
- **Module READMEs beside `src/`.** The repository is a single package; the Modules table in [007 Architecture](007-architecture.md#modules) is the canonical module reference and `tests/docs.spec.ts` keeps it complete. Revisit if the code splits into workspaces.
- **`.agents/skills/`.** No repeated multi-branch repository workflow has been identified; [SETUP.md](../SETUP.md), [006 Deployment](006-deployment.md) and [008 Cookbook](008-cookbook.md) hold the current procedures. Revisit when a workflow repeats and branches.
- **`docs/postmortem/`.** No incident has been recorded. Add `docs/postmortem/<incident>.md` after the first one, with impact, timeline, cause and prevention.
- **Generated `docs/tool-catalog.md` and `docs/config-catalog.md`.** No generator exists, so a hand-written catalog would drift; the interface reference stays in [007 Architecture](007-architecture.md) and the settings reference in [006 Deployment](006-deployment.md). Proposal: [Generated catalogs](../.agents/notes/proposed/2026-11-07-generated-catalogs.md).

## When code changes, which documents follow

| What changed | Update | Check |
| --- | --- | --- |
| A command, environment requirement or start/stop step | [`README.md`](../README.md), [`SETUP.md`](../SETUP.md), [Development](development.md), [006 Deployment](006-deployment.md) | The documented command works; the probe and prerequisites match `package.json` |
| A public interface or protocol: Session tools, management API, resources, prompt assembly, panel routes | [007 Architecture](007-architecture.md) (Model-facing interfaces), the subsystem document ([002](002-authorization.md), [003](003-execution.md), [004](004-prompts.md), [005](005-panel.md)), [006 Deployment](006-deployment.md) for the management API | `tests/tools.spec.ts`, `tests/http.spec.ts`, `tests/model-surface.spec.ts`, the panel tests |
| A configuration key, limit or default | [006 Deployment](006-deployment.md) (Settings, Management API), [005 Panel](005-panel.md) (settings groups), [002 Authorization](002-authorization.md) (Policy rules) | `tests/settings.spec.ts`, `tests/panel-settings.spec.tsx`, `tests/deployment.spec.ts` |
| Local environment selection, immutable Ticket binding or Source instance identity | [001 Domain model](001-domain.md) (glossary), [002 Authorization](002-authorization.md) (selection), [003 Execution](003-execution.md) (binding/recovery), [006 Deployment](006-deployment.md) (profiles), [007 Architecture](007-architecture.md), [008 Cookbook](008-cookbook.md) | Environment, settings, migration, Source, panel and bundle suites in [Testing and verification](testing.md) |
| Error handling, retry or resource cleanup | [003 Execution](003-execution.md) (failure and recovery), [006 Deployment](006-deployment.md) (Troubleshooting), [001 Domain model](001-domain.md) for the recorded reason | `tests/effects.spec.ts`, `tests/health.spec.ts`, `tests/runtime.spec.ts` |
| Module responsibility, dependency direction or the runtime skeleton | [007 Architecture](007-architecture.md) (Core classes, Dependency rules, Modules) | `tests/docs.spec.ts` (module table), `tests/runtime.spec.ts` |
| User-visible behavior, a setting a person sees or an upgrade step | [005 Panel](005-panel.md), [006 Deployment](006-deployment.md), [Using dsh-superagent](user/index.md) | The panel tests and a real deployment when the change needs one |
| Interface copy in either language | [Interface copy in two languages](i18n/README.md), `src/client/locales.ts`, `locale/` | `tests/locales.spec.ts` |
| A long-lived design choice, a rejected alternative or a known cost | [Design notes](../.agents/notes/README.md) under the matching status directory | The note names the decision, alternatives and consequences |
| A test, a fixture or a verification procedure | [Testing and verification](testing.md), [Defensive patterns](defensive-patterns/README.md) | `pnpm check` |
| A new document, or a change to where a document lives | This index, [`AGENTS.md`](../AGENTS.md) reading paths | `tests/docs.spec.ts` |

## Checking the documentation

```sh
pnpm test -- tests/docs.spec.ts   # numbering, link direction, link and anchor resolution, English, module table, test catalog, index completeness
pnpm check                        # typecheck, all tests, build
```

A link check cannot check a claim. For behavior, commands and defaults, verify against the source, the schemas and the tests; when a claim cannot be checked, list it as unverified instead of writing it as fact.
