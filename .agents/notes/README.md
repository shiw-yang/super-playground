# Design notes

Status: current. This file defines when a note is written and how it is shaped; it is not itself a decision.

A design note records one long-lived choice: the problem it answers, the alternative that was not taken, and what the choice costs. The current design definition is [the design](../../docs/design.md); the current behavior is described by the implementation documents under `docs/subsystems/`, `docs/user/` and `docs/cookbook/`, whose reading order is in [the documentation index](../../docs/README.md). Notes explain why those documents and the code look the way they do. They never override them.

## When to write a note

Write one when a choice has alternatives and a lasting cost, so that a later reader can judge it instead of re-litigating it:

- a design choice the design definition leaves open. [The design](../../docs/design.md) says to choose the simplest implementation that does not close the door on an obligation and to record the choice; this directory is where that record lives;
- a choice that changes a documented behavior, a public interface, a configuration value or a file layout;
- a choice that was proposed or rejected and is likely to be proposed again.

Do not write one for a spelling edit, a local refactor, ordinary work tracked in a Ticket, or anything that is already stated in a canonical document.

## What does not belong here

| Content | Where it lives instead |
| --- | --- |
| The design definition: what the agent must be and do | [the design](../../docs/design.md) |
| Gaps, limitations and deviations from the design | [Implementation status](../../docs/status.md) — the only limitations list |
| Subsystem behavior, types and protocols | [Subsystems](../../docs/subsystems/README.md) indexes them, with [Architecture](../../docs/architecture.md) as the code-level reference; [Principles](../../docs/user/principles.md) states the principle they serve |
| Procedures for the operator or an agent | [Cookbook](../../docs/cookbook/README.md): [Setup](../../docs/cookbook/setup.md), [Add a Source](../../docs/cookbook/add-a-source.md) |
| How to run and verify a change | [Development](../../docs/development.md), [Testing and verification](../../docs/testing.md) |
| The rules the test suite enforces | [Defensive patterns](../../docs/defensive-patterns/README.md) |

A note that starts restating subsystem behavior is a bug in the note: link the canonical document and state only the decision.

## Status is the directory

- `proposed/` — under consideration, not decided, not in effect. A proposed note may be implemented or rejected; mark it in its first line.
- `implemented/` — decided and in effect. The decision explains why the current code and documents are as they are.
- `rejected/` — considered and declined. The note records the reasons so the same proposal is not made again without new facts, and says what would justify revisiting it.

When a proposal becomes implemented, or is rejected, move the file to the matching directory and keep its name, then update the links to it. Do not keep two copies.

Every note states its status in its first line after the title, as `Status: proposed | implemented | rejected (YYYY-MM-DD)`. Examples:

- [implemented/2026-11-07-documentation-structure.md](implemented/2026-11-07-documentation-structure.md)
- [proposed/2026-11-07-generated-catalogs.md](proposed/2026-11-07-generated-catalogs.md)

## Filename

`YYYY-MM-DD-<topic>.md`, where the date is the day the decision was made and `<topic>` is a few lowercase hyphenated words naming the subject, such as `2026-11-07-documentation-structure.md`. Use the subject, not the outcome: a proposal does not rename when it is rejected or implemented.

## Shape

Keep it short; a note is read by someone deciding whether to revisit the choice.

1. **Status** — first line, as above.
2. **Context** — what situation required a decision. Link the documents and code that show it.
3. **Decision** — what was decided, in one paragraph or a short list.
4. **Alternatives considered** — each realistic alternative and why it lost. A rejected note is mostly this section.
5. **Consequences and cost** — what the choice makes harder, what it leaves open, and what would justify revisiting it.
6. **Links** — the code, tests and documents the decision touches, with relative paths.

## Notes are history, not current rules

An archived note records what was decided and why at its date. It does not bind the current code: when behavior changes, update the canonical documents and add or supersede the note. If a note and the current implementation document disagree, the document describes the current implementation and the note is stale — fix it in the same change. A decision stays in effect only while the canonical documents and tests say so.

## How a change points at a note

- In the change description (the commit or pull request body), name the note when the change carries a decision: `Design note: .agents/notes/implemented/2026-11-07-documentation-structure.md`. A change that keeps an earlier decision adds nothing; a change that alters one adds a note or updates the existing note in the same change.
- In code, a comment may name a note when the reason for a non-obvious constraint is not visible from the code (`// See .agents/notes/implemented/...`). Do not copy the note's reasoning into the code.
- In documentation, link the note where its history helps a reader choose, not as a substitute for the rule: the rule stays in the canonical document.

[The documentation index](../../docs/README.md) links this directory from its reference table and maintenance map; individual notes are linked from the documents and the change descriptions they concern.
