# Do not move the numbered documents into the new directory layout

Status: rejected (2026-11-07); superseded by the operator-approved [role-based migration](../implemented/2026-11-07-documentation-structure.md) on 2026-11-09. This note records the earlier rationale, not current paths or rules.

## Context

The documentation reorganization added entry and index documents: [Subsystems](../../../docs/subsystems/README.md), [Cookbook](../../../docs/cookbook/README.md), [Architecture](../../../docs/architecture.md) and [Testing](../../../docs/testing.md). The proposed next step was to move the then-existing numbered domain and deployment documents into `docs/subsystems/`, move the cookbook into `docs/cookbook/`, and dissolve the old architecture guide into the role-based references, so that every document sits in the directory that names it.

## Decision

Rejected for this change. The numbered documents stay at their paths in `docs/`; only the test catalog moves out of 007, to `## Test catalog` in [docs/testing.md](../../../docs/testing.md). Recorded as the accepted alternative in [the documentation-structure note](../implemented/2026-11-07-documentation-structure.md).

## Reasons

1. **Code and interface copy name the files.** Moving a document would either break these references or change runtime strings, translations and their tests in the same change:
   - [src/setup.ts](../../../src/setup.ts) line 20: the `feishuUserIdentity` setup problem text tells the operator to give the bot its own configuration "as docs/006-deployment.md describes".
   - [src/deployment.ts](../../../src/deployment.ts) line 40: the unknown-configuration-key error ends with "docs/006-deployment.md lists the keys".
   - [src/app/http.ts](../../../src/app/http.ts) line 104: the route comment for `/orchestrator/api/state` names `docs/006-deployment.md`.
   - [src/client/locales.ts](../../../src/client/locales.ts) line 2: the file comment says the glossary follows the domain terms in `docs/001-domain.md`.
   - [src/client/locales.ts](../../../src/client/locales.ts) line 779: the Chinese half of the `setup.feishuUserIdentity` interface copy names `docs/006-deployment.md`.
   A documentation change should not rewrite the product's error text or the user-visible interface copy.
2. **The documentation test is built on the numbering.** [tests/docs.spec.ts](../../../tests/docs.spec.ts) discovers every numbered document by its `NNN-topic.md` name, asserts the numbers run consecutively from `000`, and allows a numbered document to link only to an earlier numbered document or to any document outside the numbered sequence: the design and status documents, the new reference pages such as `docs/testing.md`, and files outside `docs/`; a link to the same or a later numbered document is a violation. It also reads the module table from `docs/007-architecture.md` (the test catalog moves to `docs/testing.md` in this same change). Moving `001`–`008` would redefine that discovery contract and its link rule, and moving 007 would change where the module index lives, in the same change that reports on the documentation layout.
3. **The numbering was the reading order.** At the time, `README.md` said the numbered documents described one implementation "in order, and each builds only on the ones before it". The old index listed them in that order, and the old setup procedure started from philosophy and followed the flow of work in the domain model. Grouping the files by directory would group them by type and hide the sequence the documents were written for.
4. **The task's ground rule says not to move files just to fit a directory.** The reorganization followed the operator's documentation guidance: inventory first, map the target division onto existing files, update from facts, connect the reading paths, and do not move or delete files just to fit a directory. The new division was adopted with index documents that point at the files; no move was needed to get the reading paths.
5. **The cost outweighs the gain.** The new directory names are suggestions, not the source of truth; the numbered paths are stable references already used by code, tests and documentation. Moving them would buy a shorter path at the price of a cross-cutting link and string change.

## What would justify revisiting

- The numbered filenames stop being referenced outside the numbered documents — a repository-wide search of `src/`, `locale/`, `scripts/`, `tests/`, `README.md`, `SETUP.md` and `docs/` finds no `00N-*.md` path — and the remaining links are updated in one change.
- [tests/docs.spec.ts](../../../tests/docs.spec.ts) no longer depends on the numbered names or on 007 as the location of the module table.
- A numbered document stops being a linear successor: for example, the former `docs/007-architecture.md` outgrows one document and its model-facing interfaces, persistence or protocol sections need independent reference pages, or a rewrite makes the narrative no longer build only on the documents before it.
- The operator decides the directory layout itself is worth the link churn.

## Links

- [docs/subsystems/README.md](../../../docs/subsystems/README.md), [docs/cookbook/README.md](../../../docs/cookbook/README.md), [docs/architecture.md](../../../docs/architecture.md), [docs/testing.md](../../../docs/testing.md) — the entry documents this move would have populated.
- The former `docs/001-domain.md`, `docs/006-deployment.md`, `docs/007-architecture.md` and `docs/008-cookbook.md` — the documents kept in place by the original decision and moved by the later migration.
- [tests/docs.spec.ts](../../../tests/docs.spec.ts) — the documentation contract the numbering supports.
- [the documentation-structure note](../implemented/2026-11-07-documentation-structure.md) — the decision this rejection is part of.
