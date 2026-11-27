# GitHub polling by batch change check

Status: implemented (2026-11-27)

## Context

One GitHub account's REST budget (5,000 requests an hour) was close to exhaustion. Every Source read every subscribed Thread on every round, and every pull request of an open Ticket read its record and its CI on every round: roughly 4,150 requests an hour and peaks above 5,000 for three Sources with about 140 recently active Threads. GitHub's GraphQL budget is separate from the REST budget and was almost unused. The analysis and the operator's approval are in the source conversation that produced the read-layer Ticket.

## Decision

Each GitHub polling round asks one batched GraphQL query per 100 numbers (`probeChanges`), on the account's separate GraphQL budget, which of its subscribed Threads and open-Ticket pull requests changed. It then reads only the changed targets through REST: a Thread whose `updatedAt` is not strictly before its stored read position, and an open Ticket's pull request only when its `updatedAt`, state, head commit or overall check result differs from the previous answer (then its record, conversation and full CI snapshot are read). A Thread without a live Ticket is checked at most every ten minutes (`QUIET_POLL_MS`); a live Ticket's Thread is checked on every poll. A failed batch check falls back to the previous per-target reads and is named in the Source's health rather than failing the poll.

## Alternatives considered

- **Raise polling intervals or add another account.** Reduces freshness for every Thread and needs a new account, which the operator declined.
- **Move every read to GraphQL.** Removes REST reads but rewrites every read path and its tests, and full conversations cost GraphQL nodes; the probe gets most of the saving without changing the read paths.
- **Probe comment and review counts instead of `updatedAt`.** Costs more nodes and no less REST work; GitHub moves an Issue's or pull request's `updatedAt` on comments, reviews, edits, labels, state changes and merges.
- **Read open-Ticket pull requests and their CI every round.** Three REST requests per pull request per round; the overall check result is enough to decide when the full snapshot is needed.

## Consequences and cost

- A Thread without a live Ticket can wait up to ten minutes for its own check. Human activity normally arrives earlier through notifications, and through the repository streams when they are on.
- CI Triggers follow the overall check result, not every intermediate change of the check set while the result stays pending.
- The probe needs a token that may use GraphQL and spends points from that budget; when it fails, the Source returns to the old REST volume instead of losing polling.
- Revisit if GraphQL becomes the constrained budget, if delivery latency on ended Tickets matters, or if a Trigger for every intermediate check change is needed again.

## Links

- `src/sources/github-probe.ts`, `src/sources/github.ts`, `src/infra/commands.ts`, `src/kv.ts`
- `tests/sources.spec.ts` (`GitHub change probe` and the batch polling cases), `tests/commands.spec.ts`
- [Execution: polling of subscribed Threads](../../../docs/subsystems/execution.md#follow-ups-and-context-threads), [Architecture: Modules](../../../docs/architecture.md#modules)
