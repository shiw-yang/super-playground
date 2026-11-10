# Interface copy in two languages

The interface shows one language at a time, Chinese or English, and the documentation and prompts are English only. This page is the rule for both: where the bilingual copy lives, how a pair is written, and how the English-only surfaces stay English.

## What is bilingual

**Panel copy** lives in `src/client/locales.ts`. Every dictionary entry is one `[zh, en]` pair, Chinese first and English second, and the file asserts that shape:

```ts
const TEXT = {
  // ...
  searchFound: ['找到 {tickets} 个工单、{threads} 个线程、{items} 条触发', 'Found {tickets} Tickets, {threads} Threads and {items} Triggers'],
  lang: ['zh', 'en'],
} as const satisfies Record<string, readonly [string, string]>
export type DshSuperagentKey = keyof typeof TEXT
const language = (index: 0 | 1) => Object.fromEntries(
  Object.entries(TEXT).map(([key, pair]) => [key, pair[index]])) as Record<DshSuperagentKey, string>
export const zh = language(0), en = language(1)
```

The client plugin registers both dictionaries under the `dshSuperagent` namespace (`src/client/index.tsx`), and pages read copy through `t(key, values)`, typed as `T = Translate<DshSuperagentKey>` in `src/client/text.ts`. `language(0)` builds `zh` and `language(1)` builds `en`.

**Source-declared copy** is bilingual too. A Source kind declares its `title`, `description`, field labels and option labels, Channel link labels and execution-variable descriptions as `Localized` objects `{ zh, en }` (`src/sources/kind.ts`); the panel chooses the active language with `localized()` in `src/client/text.ts`. A new Source therefore writes both languages for its form; [008 Cookbook: Add a Source](../008-cookbook.md#add-a-source) shows the declarations.

**Plugin metadata** lives beside the dictionaries: `locale/en.json` and `locale/zh.json` hold `meta.title` and `meta.description`, and `package.json` exports and ships them as `./locale/*.json`.

**English only:** documentation, prompts, code comments and tool descriptions. [000 Philosophy](../000-philosophy.md) states the rule — the interface is localized, but documents, code comments, prompts and tool descriptions use English — and [004 Prompts](../004-prompts.md) states that prompt text is English. `tests/docs.spec.ts` rejects Chinese prose in documentation (code samples are ignored).

## Pairing rules

- **One key, one pair.** The Chinese entry is index 0 and the English entry is index 1; both are non-empty, and the Chinese language comes first in the source.
- **Same placeholders.** The `{name}` placeholders in both entries must match as a set; `tests/locales.spec.ts` compares them. Never rename or translate a placeholder, and keep it in both entries.
- **Same meaning.** The two entries say the same thing, one in plain Chinese and one in plain English; neither adds information the other lacks.
- **Code-worded categories keep their key shape.** `reason.<code>` words a Decision reason (`src/core/reasons.ts`), `userError.<code>` a host refusal (`src/core/errors.ts`), `health.<name>` a health entry, `setup.<code>` a setup problem and `healthCode.<code>` a fixed health text. For enum values the panel words `<group>.<key>` through `valueLabel` in `src/client/text.ts`, so the names are `decision.*`, `strength.*`, `mode.*`, `stage.*`, `assignment.*` and `report.*`.
- **Language-specific punctuation lives in its own pair,** not inside prose: `listSeparator`, `labelSeparator` and `lang`.
- **Labels follow [005 Panel](../005-panel.md):** a label says whom a row waits for and what it needs, not an internal status code. Glossary terms use the domain terms of [001 Domain model](../001-domain.md).

## How to add or change copy

1. Edit both entries of the key in the same change, in `[zh, en]` order.
2. Keep every `{placeholder}` name in both entries; when a sentence needs a new value, add it to both entries and pass it at the call site.
3. Word a new host code in both languages when the code is added: a new `REASONS` code needs `reason.<code>`, a new `USER_ERRORS` code needs `userError.<code>`, and a new health entry or fixed health text needs `health.<name>` or `healthCode.<code>`. A new setup problem needs both entries beside the host's English text.
4. Read the copy in the panel through `t(key, values)`, or through `localized(t, value)` for Source-declared copy. A new key is typed automatically through `DshSuperagentKey`.
5. Run the check below; it fails while a pair is missing, empty or has unmatched placeholders, and while a reason code, refusal or health entry has no words in both languages.

## Checks

- `./node_modules/.bin/vitest run tests/locales.spec.ts`: the same placeholders in both languages, no empty entry, every reason code (except `said`), every user-error code and the fixed application health entries worded (Source health labels and `sync:` entries are not checked), and the glossary's words for reasons.
- `./node_modules/.bin/vitest run tests/styles.spec.ts`: not a copy check, but run it when the same change edits the panel's markup or stylesheet; it keeps the stylesheet to classes a component uses, with one rule per line.
- The full suite and the per-change check matrix are in [testing.md](../testing.md).

## What is not translated

- **Documentation:** `README.md`, `SETUP.md` and everything under `docs/` are English, and `tests/docs.spec.ts` rejects Chinese prose in documentation (code samples are ignored).
- **Prompts:** `prompts/*.md` and `prompts/team/*.md` are English, and the built-in prompt text built from them is English.
- **Code comments, tool descriptions, and the English text the log and the management API share:** a management API refusal carries its English text in `error`, and setup problems appear in the panel's language while the log and the API show English text.
- **Source content is data, not interface copy.** The panel localizes placeholder labels inside message text through `readableMarkers` in `src/client/text.ts`, but it does not rewrite what a person wrote.

## Who decides exceptions

The operator decides wording and translation exceptions. When an exception changes a rule on this page, record it in a design note under [Design notes](../../.agents/notes/README.md) so the next writer follows it, and update this page. The documentation index is [docs/README.md](../README.md).
