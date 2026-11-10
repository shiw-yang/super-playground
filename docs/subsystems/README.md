# Subsystems

This page is the index of where precise behavior, types and protocols are defined, and when each reference is worth reading. Use it when you need a rule, a type or a protocol rather than an orientation.

The documents describe one implementation of [the Super-agent design](../DESIGN.md). Code and tests are the final truth for what the implementation does today; the design decides what it is intended to do. When behavior changes, the affected document changes in the same change, and a disagreement between code and a document is a bug in that change. Intended-versus-implemented gaps are recorded only in [Implementation status](../STATUS.md).

| Subsystem | Reference | Read when |
| --- | --- | --- |
| Domain model | [001 Domain model](../001-domain.md) | You name a domain concept, add or change a field or state, or decide whether a business need is a new concept. It defines Source, Trigger, Thread, Correlation, Channel, Policy, Eval, Mandate, Ticket, Assignment and Subscription, and the rules each keeps. |
| Authorization | [002 Authorization](../002-authorization.md) | You change the gate, the admission table, accept modes, strength, Policy versions, follow-ups, resume and stop, or Mandate revalidation. |
| Execution and recovery | [003 Execution](../003-execution.md) | You change Ticket stages, the Executor, worker slots and concurrency, prepare commands, execution variables, Reports and verification evidence, how a Ticket ends, retry, restart recovery, pause handling or delivery failure. |
| Prompts | [004 Prompts](../004-prompts.md) | You edit a team section or a built-in prompt part, change prompt assembly or versions, or change instructions the agents read. |
| Panel behavior | [005 Panel](../005-panel.md) | You change a tab, page, search, settings group, label or action, or need the rule a panel element follows. |
| Deployment operations and management API | [006 Deployment](../006-deployment.md) | You install, configure, upgrade or troubleshoot a deployment; or you change or call a management API route, setup check, setup problem, status exit code or health entry. |
| Persistence | [007 Architecture: Persistence](../007-architecture.md#persistence) | You read or write a stored record, change a SQLite table or KV key, add a migration, or decide which records grow without bound. |
| Model-facing interfaces | [007 Architecture: Model-facing interfaces](../007-architecture.md#model-facing-interfaces) | You change a tool, a read resource, a card or message delivered to a Session, a result shape, the assessment context, a preset or its wait limits. |
| Configuration reload | [007 Architecture: Configuration reload](../007-architecture.md#configuration-reload) | You add or change a machine configuration key, or decide whether a setting applies without a restart. |
| Source plugin protocol | [007 Architecture: Sources](../007-architecture.md#sources) and [008 Cookbook: Add a Source](../008-cookbook.md) | You implement or change a Source kind: the `SourceKind` contract, `SourceContext`, its scope, Channel, thread context or Policy part. The architecture section defines the protocol; 008 is the end-to-end procedure. |
| Design authority (context) | [The Super-agent design](../DESIGN.md) | You decide whether a behavior is intended, need the design obligation (`D1`–`D29`) behind a row in STATUS, or map a design term to this implementation's term. It is the authority; do not edit it to match the code. |
| Implementation status (context) | [Implementation status](../STATUS.md) | You need to know whether something is implemented, partial or absent, with its evidence and main gap. It is the only limitations list. |

[007 Architecture](../007-architecture.md) is the developer guide as a whole: the runtime, Engine parts, dependency rules and the module index. Protocol-only pages do not exist yet; until a protocol outgrows its section, the 007 sections above are the reference, and when one is split out it becomes the canonical page this table points at.

## Documentation rules

The numbered documents 000–008 are a linear narrative: each builds only on the ones before it, and a new numbered document is appended, never inserted between existing numbers. A numbered document links only to earlier numbered documents or to documents outside the numbered sequence (the design, the status, the testing and other reference pages), and every local link must resolve; `tests/docs.spec.ts` enforces the numbering and the link rules. The documentation index and the map of which documents each kind of change updates are in [the documentation index](../README.md).

These pages are references, not procedures. For repeated task procedures use [the cookbook](../cookbook/README.md) and [SETUP.md](../../SETUP.md); for commands, repository layout and verification use [development](../development.md) and [testing](../testing.md).
