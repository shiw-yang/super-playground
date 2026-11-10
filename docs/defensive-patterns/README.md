# Defensive patterns

These are the defect classes the test suite deliberately prevents, each with the positive rule to follow. A rule belongs on this page only when a test enforces it; rules without a test live in [AGENTS.md](../../AGENTS.md), [docs/AGENTS.md](../AGENTS.md) or in the document of their subsystem. Each section names the test that detects the defect, the command that runs it, one correct and one incorrect example, and who can grant an exception.

Read [Testing and verification](../testing.md) first for how to run a suite and report a result, and [AGENTS.md](../../AGENTS.md) for the repository rules. A policy change, such as relaxing one of these rules, is a design decision: the operator decides it, and it is recorded as a note under [Design notes](../../.agents/notes/README.md).

## Documentation invariants

**Rule.** Committed documentation is written in English; Chinese appears only as a code sample, in an inline code span or a fenced code block. Every local link and anchor resolves, no document contains merge conflict markers, and shipped documentation does not link local-only material (`research/`, `docs/agent-roadmap/`). The indexes stay complete: every shipped document under `docs/` is reachable from [the documentation index](../README.md), every subsystem page from [Subsystems](../subsystems/README.md) and every cookbook page from [Cookbook](../cookbook/README.md). The `Modules` table in [Architecture](../architecture.md#modules) and the `Test catalog` in [Testing and verification](../testing.md#test-catalog) list every file and only files that exist. Documents are grouped by role, not numbered; when a change adds a module, a test or a document, update those tables and indexes in the same change.

**Defect it prevents.** A stale or incomplete index, a dead link or anchor, non-English prose, linked local-only material, or a module or test that exists but is not listed.

**How it is detected.** `tests/docs.spec.ts`; run `./node_modules/.bin/vitest run tests/docs.spec.ts`. It checks English prose outside code, link and anchor resolution, the reachable indexes and the two generated tables; the role directories and the rule against numbered documents are conventions it enforces through those checks, not a separate directory assertion.

**Correct example.**

```md
Read [Domain model](../subsystems/domain-model.md) first.
```

**Incorrect example.**

```md
Read [Domain model](../subsystems/001-domain.md) first.
```

`docs/subsystems/001-domain.md` does not exist, so the link fails. A new document that no index links fails too: the file exists, but nothing under `docs/` reaches it.

**Exception.** The operator. A policy change is recorded under `.agents/notes/`.

## Class JSDoc

**Rule.** Give every class declaration in `src/` a `/** … */` block before it, saying what the class is for. A blank line may separate the block from the declaration.

**Defect it prevents.** An undocumented class whose responsibility a reader has to reconstruct from its code.

**How it is detected.** `tests/class-docs.spec.ts`; run `./node_modules/.bin/vitest run tests/class-docs.spec.ts`.

**Correct example.**

```ts
/** Queues effects durably, with one handler per kind. */
export class Effects {}
```

**Incorrect example.**

```ts
// Queues effects durably, with one handler per kind.
export class Effects {}
```

The block must be a JSDoc block (`/**`) and must be the last comment before the declaration; a `//` comment or code between them fails.

**Exception.** The operator. A policy change is recorded under `.agents/notes/`.

## Bilingual copy and placeholders

**Rule.** Panel copy lives in `src/client/locales.ts` as a `[zh, en]` pair: both entries exist, name the same `{placeholders}`, and say the same thing. Every refusal code in `USER_ERRORS` and every reason code in `REASONS` except `said` has words in both languages, the fixed health entries the application reports have `health.<name>` labels, and reason texts that agents read use the glossary's words. Change both languages in one change.

**Defect it prevents.** A key that exists in one language only, a placeholder that one language fills and the other leaves empty, a refusal or reason with no words, or model-facing text that uses a retired term.

**How it is detected.** `tests/locales.spec.ts`; run `./node_modules/.bin/vitest run tests/locales.spec.ts`. It checks the placeholders, the non-empty pairs, the reason and `USER_ERRORS` codes, the fixed application health entries and the glossary words; Source health labels and `sync:` entries are not checked.

**Correct example.**

```ts
const TEXT = { 'reason.retried': ['已重试', 'Retried'] }
```

**Incorrect example.**

```ts
const TEXT = { 'reason.retried': ['已重试 {ticket}', 'Retried {ticketId}'] }
```

**Exception.** The operator decides a wording or translation exception. A policy change is recorded under `.agents/notes/`.

## Stylesheet discipline

**Rule.** `src/client/client.css` styles only classes a component uses, including the `dt-<prefix>-${…}` template prefixes. Write one rule per line, name each selector once within its block, and nest only `@media`, `@container` and `@supports` blocks. A component and its classes change together.

**Defect it prevents.** Dead CSS that no component uses, duplicated or split rules that drift apart, and markup that loses the class its style expects.

**How it is detected.** `tests/styles.spec.ts`; run `./node_modules/.bin/vitest run tests/styles.spec.ts`.

**Correct example.**

```css
.dt-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; line-height: 20px; }
```

**Incorrect example.**

```css
/* Incorrect: a multi-line rule, and a class no component uses. */
.dt-unused {
  color: red;
}
```

**Exception.** The operator. A policy change is recorded under `.agents/notes/`.

## Model-facing surface drift and size budget

**Rule.** Everything a model reads is a checked surface: tool names and schemas, system prompts, skills and session inputs. Text may name only registered tools, schema options that exist, registered environment variables and glossary words from [Domain model](../subsystems/domain-model.md); retired terms stay out. The combined length of each role's system prompt and tool definitions stays within its budget — 59,000 characters for the main Session and 43,200 for a worker — and the word limits from `src/infra/text.ts` apply. Change the text and the schema together; lower a budget when the surface shrinks, and raise one only as a deliberate decision.

**Defect it prevents.** A prompt that tells a model to call a tool that does not exist, a stale term that contradicts the glossary, prose that grows the injected surface past its budget, and a word limit that the text no longer enforces.

**How it is detected.** `tests/model-surface.spec.ts`; run `./node_modules/.bin/vitest run tests/model-surface.spec.ts`.

**Correct example.**

```text
Ask the person in the Thread for the decision.
```

**Incorrect example.**

```text
Ask the member in the topic for the decision.
```

**Exception.** The operator decides a budget or wording change. Raise a budget only with a stated reason; a policy change is recorded under `.agents/notes/`.

## Bundle patch and preset contract

**Rule.** `cordis.patch.yml` is read with the same entry-list dialect DeepSeek Harness uses, and it must apply with no warnings. It inserts the three plugins in order and defines the two agent presets: `dsh-superagent-worker` and `dsh-superagent-router` (`WORKER_PRESET` and `ROUTER_PRESET` in `src/app/sessions.ts`). Keep each preset's id, its order, its 5-second shell and job waits, and the tools it keeps or leaves out — including the read-only file tools of the main Session — in the same change as the test's expectations.

**Defect it prevents.** A preset that drifts from the code that names it, since a Session cannot load without its preset; a tool available to the wrong role; and a wait long enough to hold back a person's message.

**How it is detected.** `tests/bundle-patch.spec.ts`; run `./node_modules/.bin/vitest run tests/bundle-patch.spec.ts`.

**Correct example.**

```yaml
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
  config:
    waitTimeoutMs: 5000
    maxWaitTimeoutMs: 5000
```

**Incorrect example.**

```yaml
# Incorrect: a wait that holds a step for a minute.
config:
  waitTimeoutMs: 60000
```

**Exception.** The operator. A policy change is recorded under `.agents/notes/`.

## Key-value keys in one registry

**Rule.** Every `kv` record's name lives in `src/kv.ts`, apart from the schema migration, and the code reads and writes records through their `KV` entry rather than a string literal.

**Defect it prevents.** An unnamed or duplicated record key, and a reader and a writer that spell the same key differently.

**How it is detected.** `tests/store.spec.ts`; run `./node_modules/.bin/vitest run tests/store.spec.ts`.

**Correct example.**

```ts
const masterId = store.get(KV.runtime.masterId)
```

**Incorrect example.**

```ts
const masterId = store.get('master-id')
```

**Exception.** The operator. A policy change is recorded under `.agents/notes/`.
