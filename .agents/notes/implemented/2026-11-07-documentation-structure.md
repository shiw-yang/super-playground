# Migrate the documentation into the role-based layout

Status: implemented (2026-11-09).

## Context

Before this change the repository documented itself through the project entry `README.md`, the setup procedure `SETUP.md`, the design authority `docs/DESIGN.md`, the only limitations list `docs/STATUS.md`, and the numbered implementation documents `docs/000-philosophy.md` to `docs/008-cookbook.md`. The code and the interface copy named those paths, and `tests/docs.spec.ts` was built on the numbering. An earlier decision of 2026-11-07 adopted the DSH-style division in place: it added the indexes and reference pages but kept the numbered files. The operator reversed that decision on 2026-11-09 and instructed a bold migration to the directory layout, with every reference updated in the same change.

## Decision

Adopt the role-based directory layout as the documentation structure, migrating every shipped document and every reference to it in one change.

- **Numbered documents moved:** `000-philosophy.md` to [Principles](../../../docs/user/principles.md), `001-domain.md` to [Domain model](../../../docs/subsystems/domain-model.md), `002-authorization.md` to [Authorization](../../../docs/subsystems/authorization.md), `003-execution.md` to [Execution](../../../docs/subsystems/execution.md), `004-prompts.md` to [Prompts](../../../docs/subsystems/prompts.md), `005-panel.md` to [Panel](../../../docs/subsystems/panel.md).
- **006 split:** install, operation, upgrade and troubleshooting stay in [Deployment](../../../docs/user/deployment.md); Settings and the management API become [Configuration](../../../docs/subsystems/configuration.md), which also takes the configuration-reload section of 007.
- **007 split:** the architecture guide, core classes, dependency rules and Modules table become [Architecture](../../../docs/architecture.md); Persistence becomes [Persistence](../../../docs/subsystems/persistence.md), Model-facing interfaces becomes [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md), and Configuration reload joins [Configuration](../../../docs/subsystems/configuration.md).
- **Other moves:** `008-cookbook.md` becomes [Add a Source](../../../docs/cookbook/add-a-source.md), root `SETUP.md` becomes [Setup](../../../docs/cookbook/setup.md), `docs/DESIGN.md` becomes [the design](../../../docs/design.md), and `docs/STATUS.md` becomes [Implementation status](../../../docs/status.md).
- **Indexes and rules:** [the documentation index](../../../docs/README.md) holds the reading order and the change-to-document map; [Subsystems](../../../docs/subsystems/README.md), [Cookbook](../../../docs/cookbook/README.md) and [the operator entry](../../../docs/user/index.md) index their sections. [Documentation maintenance](../../../docs/AGENTS.md) holds the documentation rules and is loaded automatically as a nested instruction file; the root [AGENTS.md](../../../AGENTS.md) carries the repository rules.
- **References:** doc paths in code comments, setup problem text, configuration errors and interface copy are changed to the new paths, and [tests/docs.spec.ts](../../../tests/docs.spec.ts) is rewritten to pin the layout — links and anchors, English prose, index reachability, the Modules table and the test catalog — instead of the numbering.

## Alternatives considered

1. **Keep the numbering.** Keep `docs/000`–`008` as the implementation narrative, with no directories for roles. It keeps every path stable and needs no code or interface-copy change, and the numbering carries the reading order. It was rejected because the operator asked for the directory layout itself: the paths would keep encoding order rather than role, and the index now owns the reading order.
2. **Hybrid index-only layout (the 2026-11-07 decision).** Keep the numbered files and add the index, architecture, testing, defensive-pattern and note pages that point at them. It delivered the reading paths without link churn, but the numbered files stayed at the top level, so the directories did not describe the roles; the operator reversed it on 2026-11-09.

## Consequences and cost

- **One-time link and string churn.** Every shipped document, code comment, setup problem text, configuration error and interface-copy string that named an old path is updated in this change. The change pays this once; after it, each reference has one stable target.
- **Less stable file paths.** Bookmarks and external links to the numbered files, `SETUP.md`, `docs/DESIGN.md` and `docs/STATUS.md` break. The [documentation index](../../../docs/README.md) and the design and status pages give the new entry points.
- **A layout that matches the roles.** Design, status, architecture, subsystem references, user documentation, task procedures and review rules each have a directory, and the indexes and tables the test suite checks stay complete.
- **Per-directory instructions are adopted.** Nested `AGENTS.md` discovery was observed working, so [Documentation maintenance](../../../docs/AGENTS.md) carries the rules for work under `docs/`; an earlier "no per-directory `AGENTS.md`" decision was reversed once nested discovery was confirmed.
- **A catalog generator remains open.** The generated tool and configuration catalogs stay absent because no generator exists; the proposal is in [the generated-catalogs note](../proposed/2026-11-07-generated-catalogs.md).

## Links

- New structure: [documentation index](../../../docs/README.md), [Documentation maintenance](../../../docs/AGENTS.md), [Architecture](../../../docs/architecture.md), [Subsystems](../../../docs/subsystems/README.md), [Cookbook](../../../docs/cookbook/README.md), [the operator entry](../../../docs/user/index.md), [Development](../../../docs/development.md), [Testing and verification](../../../docs/testing.md), [Defensive patterns](../../../docs/defensive-patterns/README.md), [Interface copy in two languages](../../../docs/i18n/README.md), [Design notes](../README.md)
- Canonical documents: [the design](../../../docs/design.md), [Implementation status](../../../docs/status.md), [Deployment](../../../docs/user/deployment.md), [Configuration](../../../docs/subsystems/configuration.md), [Persistence](../../../docs/subsystems/persistence.md), [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md), [Setup](../../../docs/cookbook/setup.md), [Add a Source](../../../docs/cookbook/add-a-source.md)
- Checks: [tests/docs.spec.ts](../../../tests/docs.spec.ts); the written result of running it is reported with the change, not here.
- Related: [proposed generated catalogs](../proposed/2026-11-07-generated-catalogs.md).
