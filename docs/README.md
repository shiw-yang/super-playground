# Documentation

This is the index of the repository documentation. Committed documentation is written in English; the interface copy is localized separately ([Interface copy in two languages](i18n/README.md)). Local-only working material is git-excluded and not shipped: `research/` and `docs/agent-roadmap/`. It may be in another language; do not link it from committed documentation.

## Start here

1. [`README.md`](../README.md) (root) — the project entry: what it is, how to set it up, and the first request.
2. [The design](design.md) — the design definition, restated from the article as obligations. It is the authority for intended behavior.
3. [Implementation status](status.md) — how far the implementation gets toward the design, with evidence and known deviations. It is the only limitations list.
4. [Architecture](architecture.md) — the classes and glue, the dependency rules and the complete module index.
5. [Subsystems](subsystems/README.md) — the precise behavior, types and protocols: domain model, authorization, execution, prompts, panel, persistence, model-facing interfaces and configuration.
6. The operator entry ([Using dsh-superagent](user/index.md)), the [Deployment](user/deployment.md) guide and the [Cookbook](cookbook/README.md) — how to install, configure, use and operate the agent, and how to extend it.
7. [Development](development.md) and [Testing and verification](testing.md) — for changing the code.

## Reference and entry documents

| Role | Document | Read it when |
| --- | --- | --- |
| Project entry | [`README.md`](../README.md) (root) | You first open the repository |
| Agent instructions | [`AGENTS.md`](../AGENTS.md) (root) | Before changing anything: rules, task reading paths, verification, workspace protection |
| Documentation maintenance | [`docs/AGENTS.md`](AGENTS.md) | Before adding, moving or rewriting a document |
| Design authority | [The design](design.md) | You need to know intended behavior or whether a behavior is required |
| Implementation status | [Implementation status](status.md) | You need to know what exists, what is partial and which deviations are known |
| Architecture | [Architecture](architecture.md) | You change structure, dependencies or a code index entry |
| Subsystems | [Subsystems](subsystems/README.md) | You need precise behavior, a type or a protocol of one subsystem |
| Development | [Development](development.md) | You set up the environment, run commands or need the repository layout |
| Testing and verification | [Testing and verification](testing.md) | You add a test, choose checks for a change, or report evidence |
| Task procedures | [Cookbook](cookbook/README.md) | You perform a repeated task: setup, adding a Source, reviewing against real data |
| Operator documentation | [Using dsh-superagent](user/index.md) | A person installs, configures, uses, upgrades or troubleshoots the agent |
| Deployment procedure | [Deployment](user/deployment.md) | You install, start, stop, upgrade or troubleshoot a deployment |
| Setup with an operator | [Setup](cookbook/setup.md) | An agent sets up a deployment with its operator, one question at a time |
| Interface copy | [Interface copy in two languages](i18n/README.md) | You add or change panel text, labels, refusals or metadata |
| Review rules | [Defensive patterns](defensive-patterns/README.md) | You review a change or a defect class the tests deliberately prevent |
| Design decisions | [Design notes](../.agents/notes/README.md) | You need the rationale, alternatives and cost behind a long-lived choice |
| Feature evidence | [Compact worker reports](evidence/compact-reports/README.md) | You need the presentation evidence captured for a feature |

## Documentation conventions

- **One main location per fact.** Other documents provide entries and point at it. Details about a configuration value live in [Configuration](subsystems/configuration.md); the rules that mention the value point there.
- **Written in English, linked and indexed.** Committed documentation is English; code samples may quote other languages. Every local link and anchor resolves. Every document under `docs/` is reachable from this index, every subsystem page from [Subsystems](subsystems/README.md), and every cookbook page from [Cookbook](cookbook/README.md). New documents go into the directory of their role and are added to the matching index in the same change. The full rules are in [`docs/AGENTS.md`](AGENTS.md).
- **Documents are grouped by role, not numbered.** There is no reading sequence to maintain: the design, status, architecture, subsystems, user and cookbook trees each answer a different question, and the index says which one a task needs.
- **No generated documents yet.** `docs/tool-catalog.md` and `docs/config-catalog.md` do not exist because the repository has no generator for them; the interface reference stays in [Model-facing interfaces](subsystems/model-interfaces.md), the class structure in [Architecture](architecture.md), and the settings reference in [Configuration](subsystems/configuration.md). A proposal to add generators is in [Generated catalogs](../.agents/notes/proposed/2026-11-07-generated-catalogs.md).
- **No translation of documentation.** Documentation is English; only the interface is bilingual. The pairing rules and checks are in [Interface copy in two languages](i18n/README.md).
- **Local-only material** under `research/` and `docs/agent-roadmap/` is excluded from git in a development checkout (`.git/info/exclude`). Do not link it here.

## Deliberately not adopted

The division is adopted as far as this repository needs it. Four roles are not created, and each reason is a decision, not an omission:

- **Module READMEs beside `src/`.** The repository is a single package; the Modules table in [Architecture](architecture.md#modules) is the canonical module reference and `tests/docs.spec.ts` keeps it complete. Revisit if the code splits into workspaces.
- **`.agents/skills/`.** No repeated multi-branch repository workflow has been identified; [Setup](cookbook/setup.md), [Deployment](user/deployment.md) and [Add a Source](cookbook/add-a-source.md) hold the current procedures. Revisit when a workflow repeats and branches.
- **`docs/postmortem/`.** No incident has been recorded. Add `docs/postmortem/<incident>.md` after the first one, with impact, timeline, cause and prevention.
- **Generated `docs/tool-catalog.md` and `docs/config-catalog.md`.** No generator exists, so a hand-written catalog would drift; see the bullet above.

## When code changes, which documents follow

| What changed | Update | Check |
| --- | --- | --- |
| A command, environment requirement or start/stop step | [`README.md`](../README.md), [Setup](cookbook/setup.md), [Development](development.md), [Deployment](user/deployment.md) | The documented command works; the prerequisites match `package.json` |
| A public interface or protocol: Session tools, management API, resources, prompt assembly, panel routes | [Model-facing interfaces](subsystems/model-interfaces.md), the matching subsystem page ([Authorization](subsystems/authorization.md), [Execution](subsystems/execution.md), [Prompts](subsystems/prompts.md), [Panel](subsystems/panel.md), [Configuration](subsystems/configuration.md)), [Architecture](architecture.md) for the classes | `tests/tools.spec.ts`, `tests/http.spec.ts`, `tests/model-surface.spec.ts`, the panel tests |
| A configuration key, limit or default | [Configuration](subsystems/configuration.md), [Panel](subsystems/panel.md) settings groups, [Authorization](subsystems/authorization.md) Policy rules | `tests/settings.spec.ts`, `tests/panel-settings.spec.tsx`, `tests/deployment.spec.ts` |
| Local environment selection, immutable Ticket binding or Source instance identity | [Domain model](subsystems/domain-model.md), [Authorization](subsystems/authorization.md), [Execution](subsystems/execution.md), [Configuration](subsystems/configuration.md), [Architecture](architecture.md) and [Add a Source](cookbook/add-a-source.md) | Environment, settings, migration, Source, panel and bundle suites in [Testing and verification](testing.md) |
| Error handling, retry or resource cleanup | [Execution](subsystems/execution.md) failure and recovery, [Deployment](user/deployment.md) Troubleshooting, [Domain model](subsystems/domain-model.md) for the recorded reason | `tests/effects.spec.ts`, `tests/health.spec.ts`, `tests/runtime.spec.ts` |
| Module responsibility, dependency direction or the runtime skeleton | [Architecture](architecture.md) (Core classes, Dependency rules, Modules) | `tests/docs.spec.ts` (module table), `tests/runtime.spec.ts` |
| User-visible behavior, a setting a person sees or an upgrade step | [Panel](subsystems/panel.md), [Deployment](user/deployment.md), [Using dsh-superagent](user/index.md) | The panel tests and a real deployment when the change needs one |
| Interface copy in either language | [Interface copy in two languages](i18n/README.md), `src/client/locales.ts`, `locale/` | `tests/locales.spec.ts` |
| A long-lived design choice, a rejected alternative or a known cost | [Design notes](../.agents/notes/README.md) under the matching status directory | The note names the decision, alternatives and consequences |
| A test, a fixture or a verification procedure | [Testing and verification](testing.md), [Defensive patterns](defensive-patterns/README.md) | `pnpm check` |
| A new document, or a change to where a document lives | This index, the matching section index, [`docs/AGENTS.md`](AGENTS.md) and [`AGENTS.md`](../AGENTS.md) reading paths | `tests/docs.spec.ts` |

## Checking the documentation

```sh
pnpm test -- tests/docs.spec.ts   # entry points, link and anchor resolution, English, indexes, module table, test catalog
pnpm check                        # typecheck, all tests, build
```

A link check cannot check a claim. For behavior, commands and defaults, verify against the source, the schemas and the tests; when a claim cannot be checked, list it as unverified instead of writing it as fact.
