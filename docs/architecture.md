# Architecture

This is the entry to the architecture of the implementation. The architecture document itself is [007 Architecture](007-architecture.md), kept at that path because it belongs to the numbered implementation documents and is referenced by the documentation tests and by other documents.

Read [007 Architecture](007-architecture.md) when:

- you change module boundaries, class responsibilities or dependency direction;
- you add a class, a part of the Engine, a management route or a plugin entry;
- you need the code index: start with Runtime and Engine, then use the **Modules** table, which `tests/docs.spec.ts` keeps complete and current;
- you need the persistence layout, the model-facing interfaces (tools, presets, executor tools, result shapes, read resources, messages) or the configuration-reload rules.

The document covers core classes and glue, the Runtime, Engine, Model, Policy, Store, Effects, Sources, Executor, MasterAssessor, Settings, Prompts and Sessions; the dependency rules and set of Source-specific dependencies; the Modules table; persistence; model-facing interfaces; configuration reload; and the open questions of this implementation.

Related documents:

- [The Super-agent design](DESIGN.md) — the obligations the architecture has to meet; it decides intended behavior.
- [Implementation status](STATUS.md) — what is implemented, partial or absent, with evidence.
- [Subsystems](subsystems/README.md) — the precise behavior and protocol references this structure implements.
- [Testing and verification](testing.md) — the test catalog and how the structure is checked.
- [Development](development.md) — environment, commands and repository layout.

This page is only an entry. Do not add architecture content here: update [007 Architecture](007-architecture.md) in the same change, and keep this pointer accurate.
