# Generate the tool and configuration catalogs from source

Status: proposed (2026-11-07). Not implemented. No `docs/tool-catalog.md` or `docs/config-catalog.md` exists today, and no generator exists.

## Context

The two surfaces a person configures or an agent calls are documented by hand in the reference documents:

- The model-facing interface in [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md): 14 main-Session tools, 6 Executor tools and the `orchestrator_read` resources. The definitions live in [src/app/tools/main.ts](../../../src/app/tools/main.ts), [src/app/tools/executor.ts](../../../src/app/tools/executor.ts) and [src/app/tools/tool.ts](../../../src/app/tools/tool.ts) as `tool({ name, description, schema, execute })` values, with a zod schema each.
- The settings surface in [Configuration](../../../docs/subsystems/configuration.md) "Settings" and "Management API": the `policy`, `eval`, `executor` and `source` blocks and the pause setting. The blocks are declared in [src/app/settings.ts](../../../src/app/settings.ts), their zod schemas and defaults in [src/policy.ts](../../../src/policy.ts), the plugin configuration in [src/deployment.ts](../../../src/deployment.ts), and the shared bounds in [src/limits.ts](../../../src/limits.ts).

Hand-maintained tables drift when a tool, a setting field, a default or a bound changes. The repository already treats model-facing drift as a test failure: [tests/model-surface.spec.ts](../../../tests/model-surface.spec.ts) checks the registered tools, prompts, skills and inputs against the schemas they are built from and against a per-role size budget. [The documentation index](../../../docs/README.md) records that the two catalogs are absent because there is no generator, not because the information is unimportant.

## Proposal

When the tool and settings surface stops changing between changes, add two documents generated from the code, plus the generator and its test:

- `docs/tool-catalog.md`: one entry per application tool, with its name, role (main Session or Executor Session), purpose (the description the model reads), and a schema summary (field, type, bounds, default). `orchestrator_read` is generated from `readTool`, including its resource grammar; the `orchestrator_read` resource list can stay in [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md) until its grammar in `src/app/resources.ts` is stable too.
- `docs/config-catalog.md`: one entry per settings block and field, with type, default and bound; the plugin configuration keys from `src/deployment.ts`; and the source configuration fields each Source kind declares. Values that are not settings, such as the prepare command and the blocked-commands list, keep their existing reference in [Configuration](../../../docs/subsystems/configuration.md).

The generator is a small script (for example `scripts/generate-catalogs.ts`, run by a `pnpm` script) that imports the modules rather than parsing their text:

| Reads | Produces |
| --- | --- |
| [src/app/tools/main.ts](../../../src/app/tools/main.ts), [src/app/tools/executor.ts](../../../src/app/tools/executor.ts), [src/app/tools/tool.ts](../../../src/app/tools/tool.ts) | Tool entries: name, role, description, schema summary |
| [src/app/settings.ts](../../../src/app/settings.ts) | Settings blocks, save origins and the fields each origin may change |
| [src/policy.ts](../../../src/policy.ts) | Field types, defaults and validation, including `DEFAULT_RULES` |
| [src/deployment.ts](../../../src/deployment.ts) | Plugin configuration keys, descriptions and defaults |
| [src/limits.ts](../../../src/limits.ts) | Bounds shared by the schemas and the panel forms |
| [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md), [Configuration](../../../docs/subsystems/configuration.md) "Settings" | The hand-written reference sections the catalogs replace or point from |

**How it would be checked.** A test (`tests/catalogs.spec.ts`, new) imports the same extraction and rendering functions, renders both catalogs in memory, and compares them with the committed files; a difference fails and names the file and section, like a snapshot. The generator's output header states that the file is generated and must not be edited by hand. Because the repository has no CI (`.github/` is absent), the test is the enforcement, and `package.json` gets a script for regenerating both files. The catalogs are added to the [documentation index](../../../docs/README.md) when they exist, so the index-completeness check covers them.

**When to do it.** Only after the tool and settings surface stabilizes: no new tool, settings field, default or bound across a run of changes. Until then the interface reference stays in [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md) and the settings reference in [Configuration](../../../docs/subsystems/configuration.md), as [the documentation index](../../../docs/README.md) records. [The documentation-structure note](../implemented/2026-11-07-documentation-structure.md) records the migration that placed them there; the catalogs remain out of the current change.

## Cost

- **Generator code, test and command to maintain.** Tool schemas are code, so the generator must import them; some tool descriptions are built from runtime constants (`IM_WORDS`, `NOTE_WORDS`, resource grammar), so the generator either loads those constants or duplicates a small table. Source configuration fields come from each Source kind's declaration, so the config catalog needs the Source registry level, not just the core settings.
- **Regeneration in the same change.** Any change to a tool, a settings field, a default or a bound must regenerate both files; without CI, the drift check is a test that fails the whole suite, which is the strongest check available but is still only run when the suite is run.
- **Three copies until the old tables are removed.** While [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md) and [Configuration](../../../docs/subsystems/configuration.md) keep their hand-written tables, the same facts exist in code, in those pages and in the generated catalogs. One source of truth requires replacing the hand-written tables with pointers to the catalogs in the same change; that replacement is a second migration on top of the generator.
- **Formatting churn and review cost.** The generator pins its output format; a format change rewrites both files. Reviewers must not hand-edit generated files, and a reviewer cannot judge a generated file's accuracy from the diff alone — the test and the generator are what carry the contract.
- **Scope risk.** The catalogs are only worth generating for surfaces that are data-shaped enough to extract (names, descriptions, schemas, defaults). Panel copy, prompt text and resource pages are prose and stay in their documents; pulling them in would make the generator brittle and the catalogs unreliable.

## Links

- [the documentation-structure note](../implemented/2026-11-07-documentation-structure.md) — the decision that kept these catalogs out of the current change.
- [Model-facing interfaces](../../../docs/subsystems/model-interfaces.md), [Configuration](../../../docs/subsystems/configuration.md) — the current references the catalogs would replace or point from.
- [src/app/tools/main.ts](../../../src/app/tools/main.ts), [src/app/tools/executor.ts](../../../src/app/tools/executor.ts), [src/app/tools/tool.ts](../../../src/app/tools/tool.ts), [src/app/settings.ts](../../../src/app/settings.ts), [src/policy.ts](../../../src/policy.ts), [src/deployment.ts](../../../src/deployment.ts), [src/limits.ts](../../../src/limits.ts) — the sources the generator would read.
- [tests/model-surface.spec.ts](../../../tests/model-surface.spec.ts) — the existing drift check on the model-facing surface; a catalog test would be its documentation-side counterpart.
- [package.json](../../../package.json) — where a regeneration script and the check would be declared.
