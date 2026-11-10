# Persistence

This page is the persistence reference for the implementation. The stored state is one SQLite file, `<stateDir>/orchestrator.sqlite`, which only the Store opens. The design it implements is [the design](../design.md).

Runtime locks the state directory before opening the Store. SQLite uses WAL and `synchronous=FULL`; related changes run in transactions. An `afterCommit` callback runs after the outermost transaction commits, or immediately when there is no transaction. Durable external work is queued as effects rather than relying on those callbacks.

| Table | Holds | Written by |
| --- | --- | --- |
| `trigger` | Each Trigger, its time `at` in the one form `Date#toISOString` gives, set when the Engine receives it, so times compare as text | Engine |
| `disposition` | Where each Trigger went: `filtered` with the Source's reason code, its Eval and Decision, the Tickets it reached, by fan-out or attachment, whether it was requeued, the Tickets that handed it back with their reasons, and those whose Executor acknowledged or answered it | Engine |
| `trigger_thread` | Which Threads each Trigger is on, with its time and whether a person wrote it, so a Thread's Triggers are read without scanning every Trigger, in order of time and then id: a page of a Thread's timeline continues from a `<at>|<id>` cursor, and Triggers that share a time are not skipped | Store, with each Trigger |
| `thread` | Threads: Subscriptions, the Tickets that follow it for context, queued Triggers, the Eval in progress, the count of its expiries and `meta`; the generated columns `active`, set while Triggers are queued or an Eval runs, and `subscribed`, its Source while a Ticket subscribes to it | Engine; Sources write `meta` |
| `ticket` | Tickets with their Mandate, origin, execution, Assignments, Channels, Inputs and the Threads they follow; execution includes the immutable environment binding. The generated columns `open`, set while it has not ended, and `active`, set while Inputs are undelivered or the latest Assignment is pending or running | Engine |
| `decision` | Decisions, by Thread | Engine |
| `effect` | The effect queue: per kind and key, the payload, its order, failed attempts with the last error, and when it is due | Effects; the schema 11 migration queues what earlier versions kept for the main Session |
| `outbox` | A receipt for each queued Channel message, by id, with the Ticket it is for and its `status`, `pending`, `sent` or `dropped`. A retained receipt prevents the same id being queued twice; a pending message can be withdrawn. A dropped receipt records when and why, with its time in the generated column `dropped`. A message that waits has a `reply` effect, which holds its attempts | The Outbox |
| `kv` | Every other record, by key | The part that names it |

A generated column is computed from its row's JSON and is empty outside its set, and each has an index over its set, so a pass reads only active work. A database that predates a column gets it when the Store opens it.

`KV` (`src/kv.ts`) defines each key-value record's owner, key and type. All readers and writers use these entries; only migration code names older keys.

| Records | Keys or contents |
| --- | --- |
| Schema | Current schema version |
| Settings versions | `settings-revision`, `settings-version:<n>`, `settings-block-revision:<block>`; snapshots include origin, Policy version and affected Tickets |
| Prompt versions | `prompt-revision`, `prompt-version:<n>` |
| Main Session | `master-id` |
| Session prompt history | `session-prompts:<session id>` |
| Source state | Read positions such as `github-cursor:<number>`, PR CI fingerprints and seen Feishu-topic messages; named instances use `source-state:<source id>:<key>` |
| Display names | `source-labels:<source id>` |
| Execution snapshots | `environment-snapshot:<environment id>:<revision>`: immutable root, environment configuration and Source connection references |
| Execution accounts | `environment-accounts:<environment id>:<revision>`: the separately resolved account identities for that snapshot |
| Preparation | `execution-prepared:<ticket id>`: the environment revision and directory after successful preparation, or a migration-created legacy adoption marker |

A `SourceContext` whose instance id equals its kind keeps the original keys, such as `github-cursor:<number>`, so legacy positions remain usable. Other instance ids prefix plugin-owned state with `source-state:<source id>:`; the context maps keys back when listing them. Display names are already keyed by Source id and are not wrapped in this namespace.

At acceptance, `Environments` validates the selection and records the snapshot and setup-verified account identities inside the Ticket's transaction. The Ticket keeps the environment id and revision, selected Source ids, originating Source, selection mode, routing revision and optional reason; retries and restarts use that binding rather than choosing again. A later explicit disable prevents execution, and a missing binding or snapshot fails rather than falling back to the current default. A migrated snapshot can initially lack account facts: resolution checks the captured references, writes identities if absent and refuses a mismatch instead of replacing saved facts. Historical references not covered by current setup must be successfully probed once per Runtime before use; failed or mismatching probes are not cached, and the saved facts alone are not a continuous credential check.

The account records represent identities, not credential values. The snapshot stores configuration literally, including the prepare command, so it must not contain secrets. Neither these records nor their identity checks establish an OS or credential security boundary; see [implementation status](../status.md) and [Execution](execution.md).

The Executor writes a preparation marker only after the pinned prepare command and directory checks succeed. A later launch reuses it only when its revision and directory match and the directory still exists; it checks the directory again. Before re-preparing a missing directory or replacing a mismatched marker, it removes the old marker, so a failed attempt that leaves partial files cannot reuse an earlier success. Migration can seed a `legacy` marker only when an Assignment shows historical use; after a matching directory passes the checks, the Executor replaces that marker with an ordinary one. See [Preparing a Ticket directory](execution.md#preparing-a-ticket-directory).

Dismissal is stored on its Decision. Input text is rendered from the Ticket when read, so neither needs a separate key-value record.

Read caches use bounded in-memory `TextCache` instances and are lost on restart. A Session paging through an original Source record or prompt preview must reread offset 0 after a restart. Feishu links resolved after intake are cached the same way; link-based search finds them only after that link has been read during the current process lifetime.

There is no general retention pruning for the `trigger`, `disposition` and `decision` rows, ended Tickets and their Threads, settled outbox receipts, or the saved settings and prompt versions, Session prompt histories, Source records and execution snapshots, account records and preparation markers in `kv`. These records can therefore grow without bound. Pending outbox receipts can still be withdrawn, and migrations remove obsolete records.

`SCHEMA_VERSION` is 12 and only increases. On opening a database, `src/app/migration.ts` upgrades schema 10 through 11 to 12, or schema 11 directly to 12, in one transaction; a database older than 10 or newer than 12 is refused. If a migration step fails, its transaction rolls back and the stored schema version remains unchanged. A new database is initialized at schema 12.

The schema 11 migration normalizes earlier records and moves old main-Session queues into effects. Schema 12 moves legacy global execution fields into the `default` environment, preserving settings revisions it can convert and retaining unparseable historical revisions; current settings must validate. It binds Tickets that have execution metadata but no environment to a snapshot of the default configuration, without moving their directories or rewriting Source and Thread identities in this step. Only Tickets with an Assignment showing evidence of starting or using the workspace receive a legacy preparation marker. Migration captures connection references, while account identities for legacy snapshots are resolved separately before use.

Related: [Subsystems](README.md), [the design](../design.md), [implementation status](../status.md).
