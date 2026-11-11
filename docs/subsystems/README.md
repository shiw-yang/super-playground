# Subsystems

This page is the index of the precise behavior, type and protocol references, and when each one is worth reading. Use it when you need a rule, a type or a protocol rather than an orientation.

The pages describe one implementation of [the Super-agent design](../design.md). Code and tests are the final truth for what the implementation does today; the design decides what it is intended to do. When behavior changes, the affected page changes in the same change, and a disagreement between code and a page is a bug in that change. Intended-versus-implemented gaps are recorded only in [Implementation status](../status.md).

| Subsystem | Reference | Read when |
| --- | --- | --- |
| Domain model | [Domain model](domain-model.md) | You name a domain concept, add or change a field or state, or decide whether a business need is a new concept. It defines Source, Trigger, Thread, Correlation, Channel, Policy, Eval, Mandate, Ticket, Assignment and Subscription, and the rules each keeps. |
| Authorization | [Authorization](authorization.md) | You change the gate, the admission table, accept modes, strength, Policy versions, follow-ups, resume and stop, or Mandate revalidation. |
| Execution and recovery | [Execution](execution.md) | You change Ticket stages, the Executor, worker slots and concurrency, prepare commands, execution variables, Reports and verification evidence, how a Ticket ends, retry, restart recovery, pause handling or delivery failure. |
| Watchdog | [Watchdog](watchdog.md) | You change the external control loop, its cycles, its tools, its report or its configuration. |
| Prompts | [Prompts](prompts.md) | You edit a team section or a built-in prompt part, change prompt assembly or versions, or change instructions the agents read. |
| Panel behavior | [Panel](panel.md) | You change a tab, page, search, settings group, label or action, or need the rule a panel element follows. |
| Persistence | [Persistence](persistence.md) | You read or write a stored record, change a SQLite table or KV key, add a migration, or decide which records grow without bound. |
| Model-facing interfaces | [Model-facing interfaces](model-interfaces.md) | You change a tool, a read resource, a card or message delivered to a Session, a result shape, the assessment context, a preset or its wait limits. |
| Configuration | [Configuration](configuration.md) | You change a settings group, a management API route or a machine configuration key, or decide whether a setting applies without a restart. |
| Source plugin protocol | [Architecture: Sources](../architecture.md#sources) and [Add a Source](../cookbook/add-a-source.md) | You implement or change a Source kind: the `SourceKind` contract, `SourceContext`, its scope, Channel, thread context or Policy part. The architecture section defines the protocol; [Add a Source](../cookbook/add-a-source.md) is the end-to-end procedure. |
| Design authority (context) | [The Super-agent design](../design.md) | You decide whether a behavior is intended, need the design obligation (`D1`–`D29`) behind a row in the implementation status, or map a design term to this implementation's term. It is the authority; do not edit it to match the code. |
| Implementation status (context) | [Implementation status](../status.md) | You need to know whether something is implemented, partial or absent, with its evidence and main gap. It is the only limitations list. |
| Architecture (context) | [Architecture](../architecture.md) | You change module boundaries, dependencies or the runtime skeleton, or need the module table that indexes the code. |

These pages are references, not procedures. For the operator procedure, use [Deployment](../user/deployment.md); for repeated tasks, use [the cookbook](../cookbook/README.md); for commands, repository layout and verification, use [development](../development.md) and [testing](../testing.md).

## Documentation conventions

- Committed documentation is written in English.
- Every local link and every `#anchor` resolves.
- Every document under `docs/` is reachable from [the documentation index](../README.md). Every page in this directory is linked from this page, and every cookbook page from [the cookbook index](../cookbook/README.md).
- The Modules table in [Architecture](../architecture.md#modules) and the Test catalog in [Testing and verification](../testing.md#test-catalog) stay complete. `tests/docs.spec.ts` checks these rules.

The map of which documents each kind of change updates is in [the documentation index](../README.md).
