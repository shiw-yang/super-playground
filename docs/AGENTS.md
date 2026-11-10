# Documentation maintenance

Instructions for editing the documentation under `docs/`. The repository rules are in [`../AGENTS.md`](../AGENTS.md); this file adds what is specific to documentation.

## Rules

1. **English.** Committed documentation is written in English. Code samples may quote another language, such as an example of Chinese interface copy. `tests/docs.spec.ts` enforces the rule.
2. **Links and anchors resolve.** Every local link and every `#anchor` must point at a file and a heading that exist. The test checks both; the index and the routers rely on anchors, so do not rename a heading without updating them.
3. **The indexes stay complete.** Every document under `docs/` is reachable from [`README.md`](README.md), every subsystem page from [`subsystems/README.md`](subsystems/README.md), and every cookbook page from [`cookbook/README.md`](cookbook/README.md). Add a new document to the index of its section in the same change.
4. **One main location per fact.** Write a fact where it belongs, then point at it from the other documents. Do not copy a table or a rule into a second place; when the fact changes, one edit must be enough. The map of which document a change updates is in [`README.md`](README.md).
5. **Grouped by role, not numbered.** Put a document in the directory of its role (`design`, `status`, `architecture`, `subsystems/`, `user/`, `cookbook/`, `development`, `testing`, `defensive-patterns/`, `i18n/`). Do not encode a reading order in file names (no numbered documents); [`README.md`](README.md) gives a reading order for orientation and says which document a task needs.
6. **The generated tables stay complete.** When a change adds or removes a module of `src` or a test file, update the Modules table in [`architecture.md`](architecture.md) or the Test catalog in [`testing.md`](testing.md) in the same change. `tests/docs.spec.ts` checks both.
7. **No invented facts, no invented paths.** A document states what the code, the configuration, the tests or a canonical document verifies. Anything unverified is reported as unverified, not written as fact. A file path in a document must exist in the repository, except where the document explicitly presents it as proposed, absent or removed.
8. **No generated documents without a generator.** Do not add `tool-catalog.md`, `config-catalog.md` or a similar file by hand; the reasons and the proposal are in [`README.md`](README.md) and [`../.agents/notes/proposed/2026-11-07-generated-catalogs.md`](../.agents/notes/proposed/2026-11-07-generated-catalogs.md).
9. **Local-only material stays out.** `research/` and `docs/agent-roadmap/` are git-excluded; do not link them from committed documentation.

## Check a documentation change

```sh
pnpm test -- tests/docs.spec.ts   # entry points, links and anchors, English, indexes, module table, test catalog
```

Then review the diff against the source: a link check cannot check whether a sentence is true. When behavior changed, verify the affected claim against the code and the tests, and name what you could not verify in the change description.

## Where the rules come from

The division of documentation into roles follows the operator's documentation guidance: a project entry, agent instructions, architecture, subsystem references, development and testing guides, task procedures, operator documentation, interface-copy rules, design notes and defensive patterns. The choices this repository made about that division are in [`README.md`](README.md) and in the [design notes](../.agents/notes/README.md).
