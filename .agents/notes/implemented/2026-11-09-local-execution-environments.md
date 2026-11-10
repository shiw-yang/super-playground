# Bind Tickets to named local execution snapshots

Status: implemented (2026-11-09)

## Context

One global execution root and account environment cannot safely express several repositories or account selections in one process. Mutable process-wide defaults also let one Worker's configuration affect another. The operator approved implementation phases 1 and 2 for **same-machine** execution only. The implementation Lead confirmed those code phases complete after contract and isolated-output build verification on 2026-11-09. This decision is implemented in the working tree; it is not a claim of deployment or end-to-end validation.

The design's environment daemon and credential-boundary obligations remain unchanged: [design D23/D24](../../../docs/design.md#34-compute-state-and-environment-article-5). [Implementation status](../../../docs/status.md) is the only limitations list.

## Decision

Use named local environment profiles and separate Source instance identity from reusable Source kind. A Source either fixes one environment or allows Router selection from an explicit list. Bind each accepted Ticket to an immutable snapshot and selection provenance; reuse it on attachment, resume, retry and restart. Keep captured configuration/account references separate from once-persisted identity facts, validate observed identities without replacing those facts, and keep credentials out of both. Explicit disable refuses execution instead of rebinding work.

Carry the snapshot's subprocess environment through actual Worker tool dispatch, including nested subagents and shared-preset shell consumers. Preserve the existing native subprocess provider behind a scoped overlay rather than mutating the host process environment. Keep the exact originating Channel for replies. Preserve legacy ids and directories during migration, with one-time adoption reserved for workspaces whose prior execution is evidenced rather than inferred from directory existence.

## Alternatives considered

- **Mutate global environment variables before each Worker.** Rejected: overlapping asynchronous tools and subagents can inherit another Worker's defaults, while setup and Source operations share the process.
- **Resolve every retry from current settings.** Rejected: a settings edit could silently move accepted work to a different repository, account reference or root. Reproducibility and auditability outweigh automatic adoption of updated configuration.
- **Treat each Source kind as its instance id.** Rejected: two repositories or bot configurations need independent durable ids, cursors, accounts and Channels without duplicating adapter implementations.
- **Start with remote daemons or containers.** Not selected for these phases: the approved scope is local profiles and their bindings, not a transport, credential proxy or OS trust boundary.

## Consequences and cost

The implementation stores immutable snapshots and retains old revision artifacts while Tickets may still need them. A failed prepare retry uses the same command; changing that command requires new work rather than a hidden migration. A Source's kind or repository cannot be repurposed after durable use, so a new target needs a new Source id. External CLI wrapper paths must remain stable; snapshotting a reference does not freeze the wrapper file or credential store behind it.

A whole-bundle subprocess composition is required. The current PTY API cannot represent every variable-removal overlay, so unsupported bound terminal calls must refuse rather than inherit unsafe ambient defaults. This trade-off preserves default-path account selection without claiming an OS security boundary.

Revisit the local-only boundary when a separately authorized remote transport and credential design are ready. Revisit migration only with an explicit, auditable Ticket-transfer operation; routing edits are not such an operation.

## Links

- Canonical terminology: [Domain model](../../../docs/subsystems/domain-model.md#glossary).
- Selection and lifecycle: [Authorization](../../../docs/subsystems/authorization.md#selecting-an-execution-environment), [Execution](../../../docs/subsystems/execution.md#the-executor).
- Configuration and migration: [Configuration](../../../docs/subsystems/configuration.md#named-local-environments).
- Binding and provider modules: [environments.ts](../../../src/app/environments.ts), [worker-environment.ts](../../../src/infra/worker-environment.ts), [migration.ts](../../../src/app/migration.ts).
- Verification contracts: [execution-environments.spec.ts](../../../tests/execution-environments.spec.ts), [Testing and verification](../../../docs/testing.md).
