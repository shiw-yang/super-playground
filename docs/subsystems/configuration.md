# Configuration

This page is the configuration reference for the implementation: the settings groups, the management API that reads and saves them, and the rule for when a change applies without a restart. It builds on the [Domain model](domain-model.md) and [Authorization](authorization.md); the design it implements is [the design](../design.md). The operator procedure around them is [Deployment](../user/deployment.md).

## Settings

Setup checks accounts per Source instance. A failing account stops that instance and makes environments that reference it unavailable, without disabling unrelated healthy environments. At least one enabled, usable environment is needed for execution. Overview and the Source cards list missing requirements. If you fix something outside the application, such as CLI authentication, choose **Check again**.

1. **Sources.** Set each GitHub instance's repository (`owner/name`) and agent CLI, for example `/home/me/.local/bin/gh-agent`. Requests normally arrive through that account's notifications. A new Issue or comment mentioning the account arrives on the next poll; adding a mention by editing an existing Issue body does not. Post a new comment instead. For each Feishu instance, set its bot CLI, chats, each chat's receive-all or mentions-only mode, and whether to receive direct messages. Choose a fixed execution environment or a Router allowlist for each Source.
2. **Policy.** The two example rules can be edited or removed. Under **On each Source**, configure allowed senders, admission and bots separately for each instance. With Feishu, choose a chat to sync allowed senders from, at startup and on **Sync now**. Execution selection does not grant permission to start work; [Authorization](authorization.md) defines that gate.
3. **Execution.** Set the shared worker model and concurrency separately from each environment's purpose, root, prepare command, blocked commands and optional GitHub/Feishu Source references. A blank root means `<stateDir>/work` for `default` or `<stateDir>/work/<id>` for another environment. To give each Ticket a checkout of its selected repository:

   ```sh
   git -C /home/me/src/widgets fetch --no-tags "https://github.com/$DSH_SUPERAGENT_GITHUB_REPOSITORY.git" "${DSH_SUPERAGENT_GITHUB_PR_HEAD:-HEAD}:refs/dsh-superagent/$DSH_SUPERAGENT_TICKET" &&
   git -C /home/me/src/widgets worktree add -b "agent/$DSH_SUPERAGENT_NAME" "$DSH_SUPERAGENT_DIR" "refs/dsh-superagent/$DSH_SUPERAGENT_TICKET"
   ```

   Use the clone for that environment, make the command safe to retry after partial failure, and list personal CLIs as blocked commands. A successful prepared marker, not mere directory existence, prevents repeated preparation of new Tickets.
4. **Prompts.** Set the team sections: the GitHub disclosure line, review bots, the commit author and the auto-merge condition.
5. **Watchdog.** Enable the demo external control loop, choose its Session model, and edit its cron task list; see [Watchdog](watchdog.md). Saving the block re-arms the tasks immediately; enabling it creates the Session, and a model change restarts the service.

### Named local environments

Use one Source instance per repository or bot/listening configuration. Its stable id is separate from its adapter kind: for example, `github-widgets` and `github-tools` both use `kind: "github"`. Trigger and Thread identity, cursors, health, account resolution and Policy parts are instance-scoped. Once an instance has durable work, its kind and GitHub repository cannot be repurposed; create a new named Source for a different repository. Replies retain the original Channel and Source instance even when execution was selected through another integration.

An environment holds references to Source instances, not credentials. `githubSource` and `feishuSource` are either a matching instance id or `null`. A disabled listener can still supply an explicitly referenced account; its listening switch is not an environment switch. With no integration selected, its CLI shim refuses use rather than inheriting an operator account.

For a GitHub Trigger, the selected environment must reference a GitHub Source for the same repository; a different repository or no GitHub integration makes that choice unavailable. Fixed selection does not fall back to another environment. Feishu Triggers can select any otherwise available environment in their configured choices. Each Source has its own Policy part, including its allowed senders; an execution choice does not share another Source's authorization.

The sample prepare command uses the originating PR head only when the selected environment's `githubSource` matches the Trigger's first Thread Source instance. Otherwise `DSH_SUPERAGENT_GITHUB_NUMBER` and `DSH_SUPERAGENT_GITHUB_PR_HEAD` are empty, even if two GitHub instances reference the same repository, and the command fetches `HEAD`. If a GitHub Source must prepare the originating PR head, select an environment that references that Source instance.

Acceptance records a concrete environment snapshot, including root and raw connection references, with a content-hash revision. Resolved account identities are stored separately, once. New acceptance and later execution compare available verified identities with that record; a mismatch returns `environmentAccountChanged` without overwriting it. Historical connection references outside current Source setup are probed before their first use in each Runtime. Attachment, resume, retry and restart reuse the original snapshot. Editing the profile, its Source connections or routing does not migrate an existing Ticket; disabling the environment refuses further execution until it is enabled again. A different execution target requires a new Ticket.

These are same-machine profiles, not separate OS users, containers or remote machines. See [Permissions and isolation](../user/deployment.md#permissions-and-isolation) and the D23/D24 rows in [Implementation status](../status.md). The implemented decision record is [Bind Tickets to named local execution snapshots](<../../.agents/notes/implemented/2026-11-09-local-execution-environments.md>).

### Management API

The panel uses a local HTTP API that agents can also call. `docs/cookbook/setup.md` uses it to save settings, and the service script reads `GET state`.

Send requests to `http://127.0.0.1:<port>/orchestrator/api/` with `x-orchestrator-request: 1`. The host must be `127.0.0.1:<port>` or `localhost:<port>`. Missing headers or an `Origin` from another site receive 403.

API saves have the panel's permissions. They can change execution environment and setup account fields, unlike saves made through the main Session's tools. The header and same-origin check are not local-process authentication: a local process can send the required header without an `Origin` and obtain those permissions. Keep the server on loopback and the machine and local processes trusted; see [Permissions and isolation](../user/deployment.md#permissions-and-isolation).

Agents may rely on these routes and fields. The other routes in `src/app/api.ts` serve the panel and change with it.

| Request | Answer |
| --- | --- |
| `GET state` | What every page reads: `setup`, with `problem` and `feishuProblem`, each `null` or a setup problem with `place`, `code`, `values` and `detail`, and `accounts` once setup resolved them; this account summary is for the legacy default instances, not every named Source (use `GET settings` for per-instance facts and problems). Also `health`, an entry per part, below, with `state` (`starting`, `ready`, `paused` or `error`), `detail` and `at`; `load`, the Executor Sessions `running`, the Tickets `queued` and `maxWorkers`; `paused`; and `masterId` |
| `GET settings` | `blocks`: `policy`, `eval`, `executor` and `watchdog`, each with `value` and `revision`; `environments`: each profile's `id`, `value`, block `revision` and effective `root`; `sourceKinds`: installed adapters; `sources`: each instance's `id`, `kind`, `installed`, `value` (`kind`, `enabled`, `config`, `execution`), `revision`, form and setup `problem`; `policyVersion`; and `environment`, the legacy default-root display and variable declarations |
| `GET watchdog` | The demo Watchdog's `enabled`, `session_id`, `busy`, `health` and one row per task: `id`, `schedule`, `enabled`, `prompt`, `next_at`, `last_run` and `report` |
| `GET sources` | Each Source's status and `execution`: selection `mode` plus `environments` containing only configured target `id`, `title` and reference `state` (`configured`, `disabled` or `missing`); Source `state` (`missing`, `off`, `error`, `setup`, `starting`, `paused` or `ready`), the `health` of its parts, its setup `problem`, the last day's `stats`, the Triggers it `filtered` in that day, and the messages it `dropped` in that day, newest drop first, each with its `channel`, `preview`, `ticket` (`id` and `title`) when it was for one, its `thread` when the store has it, and `dropped.at` and `dropped.reason`, `channelGone` or `channelIgnored` |
| `PUT settings/<block>` with `{"value": …, "revision": n}` | Saves one block: `saved`, the block's new `revision`, `policy_changed` and `restarting`. `value` is the whole block, as `GET settings` holds it; a missing key takes its default. The `watchdog` block re-arms its tasks on save; a changed model restarts the service |
| `POST executor/pause` with `{"paused": true}` or `false` | Pauses or resumes processing: `paused` |
| `POST setup/check` | Runs setup again by restarting dsh-superagent: `restarting: true`. Refused when setup has nothing to fix |
| `POST policy-sync/<source id>` | Syncs that Source's allowed list now: `policy`, the Source's part as saved |
| `GET prompts`, `PUT prompts` with `{"config", "baseRevision"}` | Reads the prompt configuration: `current`, with its `revision` and `config`, `defaults`, `sections`, the team sections in the order Sessions read them, `skillName`, the pattern of a team skill's name, `builtin`, the names a team skill cannot take, and `skillPrefix`, which Sessions load a skill's name under. Or saves it: the new `revision` |
| `POST tickets/<id>/retry`, `POST tickets/<id>/stop` | Retries or stops a Ticket, as the panel does |

Health entries are grouped by responsibility:

| Entry | Reports |
| --- | --- |
| `runtime` | The application itself |
| `models` | Sessions waiting on a model-budget retry |
| `evals` | Unavailable Evals from the last hour with no later judgement or dismissal |
| `assessment`, `launch`, `delivery`, `relay`, `notice`, `reply` | Stored work described in [Execution](execution.md); delivery counts waiting work, while reply covers Channel messages |
| `worker` | Executor Session event handling; appears after its first failure |
| `watchdog` | The demo external control loop's cycles and last started cycle |
| `github`, `feishu`, `history`; named-instance equivalents `<id>` and `<id>:<entry>` | Instance-scoped Source polling, events and history recovery; legacy default instances keep their old names |
| `sync:<source id>` | Allowed-list synchronization |

A refusal has a status and `error`, its English text:

- 400: an invalid value (`issues`, each with its `path`), a failed account check (`setup`), a fixed refusal (`code` and `values`), or a body that is not JSON or is too large.
- 404: something that does not exist.
- 409: a stale revision.
- 500: anything else.

The blocks:

- `source:<id>`: `{"kind": "github", "enabled": true, "config": {…}, "execution": {"mode": "fixed", "environmentId": "default"}}`, or `execution: {"mode": "router", "allowedEnvironmentIds": ["widgets", "tools"]}`. The allowlist contains 1–20 distinct ids. Legacy instances keep ids `github` and `feishu`; omitted legacy selection is fixed to `default`. GitHub's config has `repository` and `cli`, and the switches `observeIssues`, `observePulls`, `observeComments` and `observeCi`, off by default. Feishu's has `cli`, `chats` as `[{"chatId": "oc_…", "name": "…", "listen": "mentions"}]` (or `"all"`), `directMessages`, and `otherChats` as `"none"` or `"mentions"`.
- `policy`: `{"rules": […], "sources": {"github": {"allowed": [{"id": "<login>"}], "bots": [{"id": "dependabot[bot]"}]}, "feishu": {"allowed": [{"id": "ou_…", "name": "…"}], "syncChat": "oc_…", "admission": {"oc_…": {"unlistedAddressed": "explicit"}}}}}`. `bots` lists the bots whose messages may become inferred candidates. An `admission` row is keyed by chat id, `other` or `direct` for Feishu, and by `issues`, `pulls`, `comments` or `ci` for GitHub; an unset cell takes its default (see [Authorization](authorization.md)).
- `eval`: `mode`, `timeoutSeconds` and `model`.
- `executor`: only `model` and `maxWorkers`, shared across environments. The processing pause is a setting of its own, `paused`, which `POST executor/pause` sets.
- `environment:<id>`: `title`, `description`, `enabled`, `directory`, `prepare`, `blockedCommands`, `githubSource` and `feishuSource`. The two Source references default to `null` in a newly created profile. `title` defaults to `Default`, `description`, `directory` and `prepare` to empty strings, `enabled` to `true`, and `blockedCommands` to `[]`. The initial `default` profile selects `github`. Ids match `[a-z][a-z0-9-]{0,79}`; a root is absolute or empty for its default. No credential value belongs in a profile or its description.

Read the current block revision before saving; a new named block starts at revision 0. Creating a named Source requires an explicit installed `kind`; an unknown Source without one returns 404. A save supplies the whole block, so preserve fields not being changed. Only management saves can change environment profiles, Source selection or account fields; the Router's settings tool cannot grant itself those privileges. Source kind and GitHub repository changes are refused after durable use.

Changing an account connection or environment Source reference checks the affected account before saving when the Source is enabled or required by an enabled environment. A disabled, unreferenced Source can be saved without that account check. A failed check returns 400 with details in `setup`. A changed setup-sensitive save, or any changed save while setup is pending, returns `restarting: true`; the API is temporarily unavailable while the application restarts. A no-op save returns `restarting: false`, even while setup is pending; after fixing an external account use **Check again** instead. Profile workspace edits and Source routing edits do not rebind Tickets. An account-wrapper path is pinned, not the credentials behind that external file: keep wrappers stable while bound Tickets still rely on them.

```sh
api=http://127.0.0.1:3082/orchestrator/api
source=$(curl -fsS -H 'x-orchestrator-request: 1' "$api/settings" | jq -e '.sources[] | select(.id == "github") | {value, revision}')
payload=$(printf '%s\n' "$source" | jq --arg cli "$HOME/.local/bin/gh-agent" '.value.config.repository = "acme/widgets" | .value.config.cli = $cli')
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' "$api/settings/source:github" -d "$payload"
```

## Configuration reload

Every plugin configuration key except `stateDir` is volatile. The panel's Deployment settings and DeepSeek Harness's Plugin Manager edit them through DeepSeek Harness's configuration form; the host writes `cordis.patch.yml` and updates the values in place, and dsh-superagent reads each limit when it uses it, so a change applies without a restart. A `stateDir` change remounts the plugin.

A changed settings save restarts dsh-superagent when setup is pending or when its setup inputs change: Source instance identity or kind, a GitHub Source's `repository` or `cli`, a Feishu Source's `cli`, the set of environment ids, or an environment's `githubSource` or `feishuSource` reference. A no-op save does not restart. With setup complete and those inputs unchanged, edits to an existing environment's workspace fields or enabled state, Source execution selection or listening settings apply without a restart; they do not migrate a bound Ticket. DeepSeek Harness's settings service does not serve the entry during a restart, so after its own restart dsh-superagent asks it to read the entry again, and an open form becomes editable again.

Related: [Subsystems](README.md), [the design](../design.md), [implementation status](../status.md).
