# Adopt the DSH documentation division in place

Status: implemented (2026-11-07).

## Context

Before this change the repository documented itself through the project entry [README.md](../../../README.md), the setup procedure [SETUP.md](../../../SETUP.md), the design authority [docs/DESIGN.md](../../../docs/DESIGN.md), the only limitations list [docs/STATUS.md](../../../docs/STATUS.md), and the numbered implementation documents [docs/000-philosophy.md](../../../docs/000-philosophy.md) to [docs/008-cookbook.md](../../../docs/008-cookbook.md). There was no agent instruction file, no documentation index or maintenance map, no architecture entry separate from the 007 developer guide, no defined place for development, testing, defensive-pattern, subsystem, cookbook, user or i18n references, and no record of design decisions and their alternatives.

The reorganization followed the operator's documentation guidance: inventory the existing documents first, map the target division onto the files that already exist, update from facts, connect the reading paths, and do not move or delete files just to fit a directory.

## Decision

Adopt the DSH-style documentation division in place, without moving the numbered documents.

- **Kept:** `docs/000`–`008` stay at `docs/` in their numbered order as the linear implementation narrative. [007 Architecture](../../../docs/007-architecture.md) stays the canonical architecture document; the new [docs/architecture.md](../../../docs/architecture.md) is only its entry and router.
- **Added:** the new canonical documents below, each a router or a task reference that points at the one canonical location for a fact. A new document is added to the [documentation index](../../../docs/README.md) and, when it changes what an agent should read, to the reading paths in [AGENTS.md](../../../AGENTS.md).
- **Moved, once:** the `## Tests` catalog of 007 (its `| Test | Covers |` table and the `tests/fixtures/` paragraph) moves to `## Test catalog` in [docs/testing.md](../../../docs/testing.md). The test paths in the rows are unchanged; one Covers cell is updated to describe the split, and the `tests/fixtures/` paragraph is unchanged. 007 keeps a one-line pointer.
- **Extended:** [tests/docs.spec.ts](../../../tests/docs.spec.ts) reads the test catalog from `docs/testing.md` instead of 007, requires [docs/README.md](../../../docs/README.md) to link every shipped document under `docs/` (except `docs/agent-roadmap/` and itself), and resolves anchors as well as links.
- **Left local-only:** `research/` and `docs/agent-roadmap/` stay git-excluded and unlinked from committed documentation.
- **Deliberately not adopted, recorded in shipped docs:** per-directory `AGENTS.md`, module READMEs, `.agents/skills/`, `docs/postmortem/` and generated tool/config catalogs; the reasons are in [Deliberately not adopted](../../../docs/README.md#deliberately-not-adopted).

| New document | Role |
| --- | --- |
| [AGENTS.md](../../../AGENTS.md) | Agent instructions: read-before-changing order, task reading paths, rules, verification, workspace protection |
| [docs/README.md](../../../docs/README.md) | Documentation index, read order, maintenance map and change-to-document matrix |
| [docs/architecture.md](../../../docs/architecture.md) | Entry and router for the architecture; points at 007 |
| [docs/development.md](../../../docs/development.md) | Environment, commands, repository layout, workflow, build and CI facts |
| [docs/testing.md](../../../docs/testing.md) | Test taxonomy, how to run checks, evidence rules, test catalog |
| [docs/defensive-patterns/README.md](../../../docs/defensive-patterns/README.md) | Defect classes the test suite deliberately prevents, with the positive rule and its detection |
| [docs/subsystems/README.md](../../../docs/subsystems/README.md) | Index of the precise behavior, type and protocol references |
| [docs/cookbook/README.md](../../../docs/cookbook/README.md) | Index of repeated tasks, each pointing at its one canonical procedure |
| [docs/user/index.md](../../../docs/user/index.md) | Operator-facing entry: set up, first request, supervise, configure, recover |
| [docs/i18n/README.md](../../../docs/i18n/README.md) | Bilingual interface-copy rules and checks |
| [.agents/notes/README.md](../README.md) | This decision record's home: when to write a design note and how to shape it |

## Alternatives considered

1. **Full migration into the new layout.** Move `001`–`006` into `docs/subsystems/`, `008` into `docs/cookbook/`, and dissolve `007` into `docs/architecture.md` plus `docs/testing.md`. This makes the directory layout match the DSH division most literally, and the source of each fact would sit in the directory its name suggests. It was rejected for this change; the reasons, the evidence and the conditions for revisiting it are in [the rejected note](../rejected/2026-11-07-move-numbered-docs.md).
2. **Minimal change: add `AGENTS.md` only.** One agent instruction file would tell a coding agent what to read without touching the documentation set. It was rejected because the other gaps stay: there would still be no documentation index or maintenance map, no architecture entry, no defined testing, development, subsystem, cookbook, user or i18n references, and no place to record a decision's alternatives and cost. The operator's guidance asks to connect the reading paths, and a set of eleven documents cannot be found from one instruction file.
3. **Change the reading order instead of adding entry documents.** Rewrite README to the new division and skip the separate index. Rejected because one document would then hold both the project entry and the maintenance map, and the numbered narrative and agent instructions would still be undiscoverable.

## Consequences and cost

- **Two front doors must stay in sync.** [AGENTS.md](../../../AGENTS.md) says what an agent reads before a task; [docs/README.md](../../../docs/README.md) is the complete documentation index and maintenance map. They overlap by design. The index completeness is enforced by [tests/docs.spec.ts](../../../tests/docs.spec.ts); keeping AGENTS.md's task table current remains a review rule.
- **Transient link churn.** Moving the test catalog changes where 007 and the tests point, and the new documents add links that must resolve in the same change. The change pays this once; no existing path breaks, so no code reference or locale string changes.
- **Entry documents add reading overhead.** A reader now crosses one router page per task. The cost is accepted because each router states when to follow it and points at the single canonical document.
- **One source of truth per fact.** The new documents are indexes and task references, not second copies; they must not grow tables the canonical document already owns.
- **A catalog generator remains open.** `docs/tool-catalog.md` and `docs/config-catalog.md` are still absent because no generator exists; a hand-written catalog would drift. The proposed direction is in [the generated-catalogs note](../proposed/2026-11-07-generated-catalogs.md).

## Links

- New entries: [AGENTS.md](../../../AGENTS.md), [docs/README.md](../../../docs/README.md), [docs/architecture.md](../../../docs/architecture.md), [docs/development.md](../../../docs/development.md), [docs/testing.md](../../../docs/testing.md), [docs/defensive-patterns/README.md](../../../docs/defensive-patterns/README.md), [docs/subsystems/README.md](../../../docs/subsystems/README.md), [docs/cookbook/README.md](../../../docs/cookbook/README.md), [docs/user/index.md](../../../docs/user/index.md), [docs/i18n/README.md](../../../docs/i18n/README.md), [.agents/notes/README.md](../README.md)
- Unchanged canonical documents: [docs/DESIGN.md](../../../docs/DESIGN.md), [docs/STATUS.md](../../../docs/STATUS.md), [007 Architecture](../../../docs/007-architecture.md), [docs/006-deployment.md](../../../docs/006-deployment.md)
- Checks: [tests/docs.spec.ts](../../../tests/docs.spec.ts); the written result of running it is reported with the change, not here.
- Related notes: [rejected move of the numbered documents](../rejected/2026-11-07-move-numbered-docs.md), [proposed generated catalogs](../proposed/2026-11-07-generated-catalogs.md)
