# Development

This page covers the environment, the commands, the repository layout and the build for someone changing the code. The repository rules are in [AGENTS.md](../AGENTS.md); [documentation index](README.md) is the documentation index and the map of what to update for each change; [Testing and verification](testing.md) owns the test catalog and the per-change checks; [Architecture](architecture.md) maps the source tree file by file.

## Prerequisites

- Node.js `^22.19.0 || >=24.0.0` and pnpm `11.7.0`, as `engines` and `packageManager` in `package.json` declare.
- Dependencies from `pnpm-lock.yaml`, installed with pnpm; the repository uses pnpm as its package manager.
- DeepSeek Harness `^0.2.1-alpha.2`: `engines.dsh` in `package.json` names the supported range. The DeepSeek Harness packages are peer and development dependencies of this package, so a running installation is needed only to load or deploy the built bundle, not to typecheck, test or build.
- `git` and `python3` on `PATH` for the tests that start real local processes: see [Prerequisites in Testing and verification](testing.md).
- Deployment needs more than development does, such as tmux, a GitHub CLI and optionally a Feishu bot CLI; [Deployment](user/deployment.md) lists those under Prerequisites, and [Setup](cookbook/setup.md) is the operator procedure.

## Install

```sh
pnpm install
pnpm build
```

`pnpm install` installs the dependencies and the test runner; `pnpm build` writes the bundles to `lib/`, which is not in git and is required before a profile can load the bundle. The deployment guide runs the same two commands in its Install section.

## Commands

| Command | Runs | Use when |
| --- | --- | --- |
| `pnpm build` | `tsdown`: the Node entries (`lib/index.js`, `lib/github-watch.js`, `lib/feishu-watch.js`) with type declarations, and `lib/client.js` | Build the bundles under `lib/` before a profile can load them |
| `pnpm typecheck` | `tsc --noEmit` | Check types across `src/`, `tests/` and `tsdown.config.ts` |
| `pnpm test` | `vitest run` | Run the whole test suite, once |
| `pnpm check` | `pnpm typecheck && pnpm test && pnpm build` | The delivery gate, before you report a change |
| `./node_modules/.bin/vitest run tests/docs.spec.ts` | vitest over the named files | Run one spec file while working |

The scripts in `package.json` are the authority for what each command does. When `pnpm` cannot run in your environment, the same tools are installed under `node_modules/.bin/`: `vitest`, `tsc` and `tsdown`, for example `./node_modules/.bin/tsc --noEmit`. [Testing and verification](testing.md) lists the full set of test commands and the per-change check matrix.

## Repository layout

| Path | Holds |
| --- | --- |
| `src/` | The plugin source. `src/core/` is the domain model, the Engine and its ports; `src/app/` composes the application and holds the Store, effects, prompts, settings, HTTP routes and views; `src/executor/` runs one Session and directory per Ticket; `src/sources/` holds the GitHub and Feishu Sources and Channels; `src/infra/` holds the CLI transport, the process environment and the health board; `src/client/` is the panel. The file-by-file map is the module table in [Architecture](architecture.md) |
| `src/index.ts`, `src/deployment.ts`, `src/policy.ts`, `src/setup.ts`, `src/admission.ts`, `src/limits.ts`, `src/kv.ts`, `src/navigation.ts` | The top-level modules: the plugin entry, the plugin configuration, the Policy, setup problems, the admission table, the shared bounds of settings fields, the key-value registry, and the navigation to a Session |
| `tests/` | The 61 spec files and `tests/fixtures/`; [Testing and verification](testing.md) owns both |
| `prompts/` | The built-in prompt text, one sentence per line, joined into paragraphs by `promptFile` (`src/app/skill-files.ts`) |
| `skills/` | The bundled Source skills, `dsh-superagent-github` and `dsh-superagent-feishu`, each as `SKILL.md` |
| `locale/` | `en.json` and `zh.json`, the plugin metadata in both languages; `package.json` exports them as `./locale/*.json` |
| `scripts/` | `dsh-superagent`, the service control script: `start`, `stop`, `restart` and `status` for one DSH profile |
| `examples/` | `profile.cordis.patch.yml`, the machine-configuration example the deployment guide copies |
| `docs/` | The documentation: [`README.md`](README.md) (the index and change map), [`AGENTS.md`](AGENTS.md) (documentation rules), `design.md`, `status.md`, `architecture.md`, `development.md`, `testing.md`, and the `subsystems/`, `user/`, `cookbook/`, `i18n/`, `defensive-patterns/` and `evidence/` trees. `docs/agent-roadmap/` is local-only working material, git-excluded and not shipped |
| `.agents/` | `.agents/notes/`, the design notes by status; `.agents/worktrees/` holds other tasks' git worktrees and is not part of the change |
| `research/` | Local-only research material, git-excluded and not shipped |
| `cordis.patch.yml` | The bundle layer: it inserts the three plugins and defines the worker and router agent presets |
| `lib/` | The build output of `pnpm build`, git-ignored; `package.json` points its `main`, `types` and `exports` into it |
| `node_modules/` | Installed dependencies, git-ignored |
| `.artifacts/` | The service script's startup logs (`dsh-superagent-<profile>-<date>-<time>-<pid>.log`) and its control files under `.artifacts/control/profiles/<profile>/`, git-ignored |
| `package.json`, `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json`, `pnpm-lock.yaml` | The toolchain configuration: scripts, the two builds, the test include pattern and type settings |

## Development workflow

1. Read the entry documents before changing anything: [`README.md`](../README.md), [the documentation index](README.md), [the design](design.md) and [implementation status](status.md). The design decides intended behavior; the implementation follows it.
2. Work in the checkout assigned to your task. Other tasks may have git worktrees under `.agents/worktrees/` or scratch worktrees under `.artifacts/`; they belong to those tasks and are not yours to edit.
3. Make the smallest change that meets the behavior, and keep the design authority: if the code and the design disagree, fix the code or record the gap in [implementation status](status.md); do not weaken the design.
4. Keep the implementation documents true in the same change: the subsystem page for the behavior, [Architecture](architecture.md) for structure, and the entry documents (`README.md`, `docs/cookbook/setup.md`, this page) for how the project is run. `docs/README.md` has the matrix of change to document.
5. Add or update the tests that pin the behavior, then run the narrowest suite that covers the change. [Testing and verification](testing.md) has the layers, the fixtures and the check matrix.
6. Run `pnpm check`, or name the narrower commands you ran when the full gate cannot run. There is no CI: nothing else runs the checks for you, so report exactly what you ran and what it returned.
7. A code change ends with the checks, not with a live deployment. Do not commit, push, deploy, restart the service, change dependencies or send a real channel message unless the task asks for it.

## Build and packaging

`tsdown.config.ts` defines two builds:

- A Node build with three ESM entries: `index` from `src/index.ts`, `github-watch` from `src/sources/github.ts` and `feishu-watch` from `src/sources/feishu.ts`. It writes to `lib/`, targets ES2024, emits type declarations and cleans `lib/` first. The DeepSeek Harness packages, `zod` and `proper-lockfile` are left external rather than bundled.
- A browser build with one CommonJS entry, `client` from `src/client/index.tsx`, written to `lib/client.js` without declarations. React and React DOM are external. The output is wrapped in DeepSeek Harness's module-loader form, `window.__ModuleLoader__.load({ id: "dsh-superagent", … })`, and this build appends to `lib/` after the Node build cleans it.

`package.json` ties the package together: `main` and `types` point at `lib/index.js` and `lib/index.d.ts`, `exports` maps `.`, `./client`, `./github-watch`, `./feishu-watch` and `./locale/*.json`, and `files` ships `lib`, `cordis.patch.yml`, the locale JSON files, `README.md`, `prompts` and `skills`. Under `dsh`, `bundle.patch` names `cordis.patch.yml` and `client` declares the `web` platform and the client packages the panel injects.

The deployment loads the built `lib/` through a profile's bundle; building is a local step and the profile is set up, started and upgraded separately. [Deployment](user/deployment.md) owns Install, Machine configuration, Start and stop and Upgrade; [Setup](cookbook/setup.md) is the operator procedure.

## Where to go next

- [AGENTS.md](../AGENTS.md) states the repository rules, the task reading paths and the verify gate.
- [documentation index](README.md) indexes the documentation and maps a change to the documents to update.
- [Testing and verification](testing.md) has the suites, the commands, the per-change checks and the test catalog.
- [Architecture](architecture.md) is the developer guide to the implementation and the file-by-file module table.
- [Deployment](user/deployment.md) and [Setup](cookbook/setup.md) cover installing, configuring and operating a deployment.
