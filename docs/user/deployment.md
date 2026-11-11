# Deployment

Use this guide to install and operate dsh-superagent: what runs, the accounts, installation, machine configuration, start and stop, setup checks, upgrades and troubleshooting. The behavior this deployment runs is described in the [subsystem references](../subsystems/README.md), and its design is [the design](../design.md).

## What runs

- **A dedicated DeepSeek Harness profile**, called `superagent` in this guide. Create it from the Web profile template. It loads the bundle and serves its panel on `127.0.0.1`. Keep it separate from the profile you work in for independent state, restarts and upgrades. Worker subprocesses receive per-Ticket environment overlays; the plugin does not mutate process-wide `PATH` or git settings.
- **An agent GitHub account.** The agent comments, pushes branches and opens pull requests as this account, through a GitHub CLI signed in only as that account.
- **Optional:** a Feishu bot for chat requests.

Plugin configuration holds the state directory and machine limits. Use the panel for everything else: named Source instances for repositories, accounts and execution selection; Policy for allowed lists; and Execution for shared scheduling and named local environment profiles. Several Source instances can use the same GitHub or Feishu kind. All execution remains on this machine; [Implementation status](../status.md) records the remote-environment and credential-boundary gaps.

### Permissions and isolation

The bundle defines `dsh-superagent-worker` for Executors and `dsh-superagent-router` for the main Session. They appear in the DeepSeek Harness preset list but are intended only for dsh-superagent. Do not select them for personal Sessions or disable their configuration rows. The application needs them to create and resume its Sessions.

Opening a blank managed Session in the Web UI can select the profile's default preset. dsh-superagent restores its role-specific preset before the first turn.

Both presets run with `danger-full-access` as the operator's OS user and read messages from subscribed Threads. Account wrappers choose the agent's credentials by default; they do not isolate the process. A worker can execute programs by path and read the operator's home directory. For isolation, use a dedicated OS account containing only the agent's credentials.

The settings groups, the management API and the configuration-reload rule are in [Configuration](../subsystems/configuration.md).

## Prerequisites

- Node.js 22.19+ or 24+, pnpm, git 2.32+, Python 3.8+ and tmux
- GitHub CLI (`gh`) 2.48 or later. Source CLI fields must point to `gh` or `lark-cli` wrappers; the host relies on their subcommands and output formats.
- A repository on github.com; GitHub Enterprise Server is not supported. To create a checkout per Ticket, keep a local clone from which the prepare command can add worktrees. Install `git-lfs` if that repository uses Git LFS.
- A model provider configured for DeepSeek Harness. dsh-superagent uses the profile's default model unless the Eval or Execution settings name another.
- For Feishu: `lark-cli` (tested with 1.0.90) and a Feishu or Lark app with a bot

## Accounts

### Agent GitHub account

1. Create a GitHub user account for the agent and give it write access to the repository. A GitHub App cannot be the agent, because dsh-superagent reads the account's notifications.
2. Give it a GitHub CLI that uses only its own credentials:

   ```sh
   mkdir -p ~/.local/bin
   cat > ~/.local/bin/gh-agent <<'EOF'
   #!/bin/sh
   GH_CONFIG_DIR="$HOME/.config/gh-agent" exec gh "$@"
   EOF
   chmod +x ~/.local/bin/gh-agent
   gh-agent auth login
   gh-agent api user --jq .login
   ```

   Sign in as the agent account; the last command prints its login. dsh-superagent reads the login the same way.

### Feishu bot (optional)

1. Create a self-built app with the bot capability. Grant it the permissions to receive message events, read and send chat messages, and read chat members, then publish the app version.
2. Give the bot its own `lark-cli` configuration, restricted to the bot identity, and a wrapper:

   ```sh
   LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent" lark-cli config init --app-id <cli_…> --app-secret-stdin
   LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent" lark-cli config strict-mode bot --global
   cat > ~/.local/bin/lark-bot <<'EOF'
   #!/bin/sh
   export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent"
   exec lark-cli "$@"
   EOF
   chmod +x ~/.local/bin/lark-bot
   ```

   The first command reads the app secret from standard input. Use a separate configuration directory: `lark-cli` allows one profile per app id, and your personal configuration may already contain a user login for that app.

   The host refuses a CLI that can act as a user. It reads the app id, Feishu/Lark brand and bot `open_id` from the bot configuration.

   Both configurations share the keychain entry for the app secret. To remove only the bot configuration, delete its directory; do not run `lark-cli config remove`, which would affect the shared secret.

## Install

Run this block once, on a machine that has no `superagent` profile yet:

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
git clone <this repository> dsh-superagent && cd dsh-superagent
pnpm install && pnpm build
dsh superagent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile superagent add "link:$PWD"
```

The pinned version above is public; other versions must satisfy `engines.dsh` in `package.json`.

The fourth command creates `~/.dsh/profiles/superagent` from the DeepSeek Harness Web template. The fifth installs this bundle. Set `DSH_HOME` to relocate the default `~/.dsh` directory.

Run the profile-creation command only for a new installation. If the profile already exists, that command replaces it and deletes its `cordis.patch.yml`, including machine configuration. Do not use it for upgrades.

## Machine configuration

Copy [examples/profile.cordis.patch.yml](../../examples/profile.cordis.patch.yml) to `~/.dsh/profiles/superagent/cordis.patch.yml`, replacing that file, and replace every `<placeholder>`. For Feishu, also enable the `dsh-superagent-feishu` entry there. The `webserver` entry sets the panel's port.

| Key | Required | Meaning |
| --- | --- | --- |
| `stateDir` | yes | Absolute path: the database, lock, immutable environment artifacts under `environments/<id>/<revision>/` and, by default, Ticket directories under `work`. Back it up before upgrades; separately back up any configured workspace root outside it |
| `promptMaxChars`, `admissionContextMaxPages`, `admissionContextTimeoutMs` | no | The largest saved prompt configuration, and how many Thread pages one assessment reads within what time |

After the first start, edit machine limits in **Settings → Deployment** or the DeepSeek Harness Plugin Manager. Changes apply without restart. `stateDir` cannot be changed there. Invalid values or unknown configuration keys prevent startup; the log identifies the key. The bundle also hides the sidebar workspace browser while its client plugin is loaded; see [Panel](../subsystems/panel.md) for the remaining navigation and actions.

## Start and stop

```sh
scripts/dsh-superagent start
scripts/dsh-superagent status
```

`start` runs `dsh --profile superagent` in tmux session `dsh-superagent`, or `dsh-<profile>` for another profile. It waits up to one minute for the runtime to become ready or report a setup requirement. On a first run it prints the missing setup information. It refuses duplicate instances, including ones started outside this script.

`stop` and `restart` request graceful shutdown and wait up to five minutes for Executors. They never force-kill the process or touch other tmux sessions.

`status` prints process ids, health and setup problems. For a different profile or port, use `--profile` and `--url`, or set `DSH_SUPERAGENT_PROFILE` and `DSH_SUPERAGENT_URL`.

`status`, `start` and `restart` exit with one of four codes:

| Code | Meaning |
| --- | --- |
| 0 | The service runs normally |
| 1 | It does not run, runs twice, does not answer, or its runtime reports an error; a restart may fix it |
| 2 | It runs, but a part other than the runtime, such as a Source or a Policy sync (`sync:<source id>`), reports an error; a restart does not fix it |
| 3 | It runs and waits for setup; a restart does not fix it |

A Source that is still starting counts as normal operation. So does a Feishu bot that setup could not check.

`status` returns failed parts and their details under `errors`, and setup requirements under `setup`. `start` and `restart` print those problems as lines; they exit 1 if the service never comes up. Only an intentional `stop` pauses automatic recovery.

Each profile stores logs and control files under `.artifacts/`:

- Startup logs: `dsh-superagent-<profile>-<date>-<time>-<pid>.log`, where the pid belongs to the script. The newest 20 are kept.
- Control files: `control/profiles/<profile>/`, containing the stop marker, lock and process id.

Open the URL printed in the log, then choose **Superagent** in the sidebar.

### Hourly check

Create the hourly check in the DeepSeek Harness profile you normally use, not in `superagent`. It must keep running when the agent service is down. Ask an agent in that profile to create an hourly schedule using this prompt, with the checkout path filled in:

```text
Check dsh-superagent: run `scripts/dsh-superagent --profile superagent status` in <checkout>. Exit 0: do nothing and say nothing. Exit 2: do not restart; tell me each part under `errors` with its detail, unless you already told me about the same ones. Exit 3: do not restart; tell me what `setup` says setup needs, unless you already told me. If it reports manually_stopped: true, leave it stopped. Otherwise (exit 1) run `scripts/dsh-superagent --profile superagent --respect-stop restart`, which exits the same way: 0 means it recovered, so say nothing; 2 and 3 are reported as above; if it exits 1 or fails otherwise, read the newest .artifacts/dsh-superagent-superagent-*.log and the Troubleshooting section of docs/user/deployment.md, fix what you can, and tell me what was wrong and what you did.
```

`--respect-stop` preserves an intentional stop. Only `stop` writes the marker; `start` clears it. `restart` writes no marker, so the check can recover a restart whose shutdown timed out.

## Setup checks

Setup uses the DeepSeek Harness subprocess service, whose parent-environment filtering removes variables with credential-shaped names such as KEY, PASSWORD, SECRET or TOKEN. Source commands and setup probes use explicit account-scoped environments, not a Worker's overlay.

Each GitHub instance checks its repository and the agent's push access. A Feishu instance with a configured CLI checks its bot-only identity. An optional Feishu instance with no CLI exposes no account and reports paused/unset-CLI health; it does not borrow another bot or make an environment that references it available. These checks publish per-instance readiness; Worker artifact generation happens separately when the bound snapshot is resolved for execution.

For each immutable environment revision, the host writes artifacts below `<stateDir>/environments/<id>/<revision>/`:

- **Command shims** in `worker-bin`, first on the Worker's `PATH`: `gh` runs the selected Source's CLI but refuses `gh auth setup-git`; `git` checks that the effective github.com credential helper matches the captured CLI before running the requested command; `lark-cli` runs the selected bot CLI; blocked commands fail. An absent integration has a refusing shim. A shim removes its own directory from `PATH` before running its target.
- **git configuration** in `worker-gitconfig`: replaces the operator's global and system git configuration for that subprocess. It selects the captured agent CLI as the github.com credential helper, rewrites GitHub SSH addresses to HTTPS and defines Git LFS filters. Personal git settings such as an HTTP proxy do not apply. No commit identity is set here; git requires an explicit one and never prompts for credentials. Ambient GitHub tokens, git location/config overrides and operator identity variables are removed.

The bundle isolates the existing native subprocess provider into a private service realm, captures it, and installs the Worker overlay provider through the `./worker-environment` export. The original provider still launches local processes. An asynchronous scope around actual Worker tool execution carries the overlay through concurrent tools, nested subagents and preset-shared shell closures. Host operations outside a Worker scope keep their own explicit environment. Missing provider composition fails closed rather than using ambient operator credentials.

A file in a revision's `worker-bin` or `worker-gitconfig` that dsh-superagent did not write refuses environment preparation. A Ticket directory whose local/worktree git configuration adds credentials fails the Ticket. The successful-preparation marker is written only after the command and directory checks pass. A failed write or preparation can be retried without overwriting another revision.

Do not run `gh auth setup-git` in a worker, even through the agent CLI wrapper: it can discard the wrapper's credential-directory selection. If git reports that the credential helper changed, stop work and have the operator repair the deployment; do not bypass the shims. These checks are default-path guardrails, not protection against a process deliberately using absolute paths or overriding its environment.

Ordinary subprocess overlays support deletion tombstones (`undefined`). The current PTY API accepts string values only, so a bound terminal request fails closed when required ambient removals cannot be honored; the Worker model has no terminal tools. This is not a claim of an OS security boundary or secret-proof execution.

## Try it

From an allowed GitHub account, open an Issue or post a comment containing `@<agent login> <request>`. Within a polling interval (one minute by default), Overview should show a Ticket. The agent acknowledges the request, works in its own Session and directory, and delivers in the original conversation. For Feishu, mention the bot in a configured chat.

## Upgrade

1. Wait until no Executor is in the middle of a turn, then run `scripts/dsh-superagent stop` and confirm that it stopped. If graceful stop times out, resolve that before continuing; do not force-kill it.
2. Back up the entire `<stateDir>`, every configured workspace root outside it and any local clones backing linked worktrees while the service is stopped, keeping their paths and contents together. The database uses SQLite WAL mode: a copy of `orchestrator.sqlite` alone while it is open is not a consistent backup. Preserve any database sidecar files with the state directory.
3. Run `git pull && pnpm install && pnpm build`.
4. Run `scripts/dsh-superagent start` and inspect its status. The intentional stop prevents the hourly check from restarting the service during the backup and upgrade; `start` clears it.

On startup, an interrupted Assignment without a settled latest report is replaced with a recovery note; a settled one without later delivered input keeps its Session. Team text and overridden prompt parts are retained; parts without overrides follow the new defaults. Review parts marked **Default updated** after upgrading.

The schema 10 → 11 → 12 upgrade preserves legacy Trigger/Thread ids and Ticket directories. Schema 12 moves global executor root, prepare and blocked-command fields into the `default` environment, gives legacy Sources fixed-default routing, and binds old Tickets to a captured default snapshot. Only historically started or used Assignments receive a one-time legacy preparation marker, allowing a verified existing checkout to be adopted without rerunning preparation. A directory left by failure before execution started is not adopted. Resolved account identities are captured separately when needed. No live Ticket is moved to a new root or account selection. This build refuses databases older than schema 10; preserve the old state and use a new state directory rather than expecting an automatic migration.

A database migrated by a newer version cannot be opened by an older one. Rollback therefore requires the pre-upgrade backup. Keep the full bundle composition, including its scoped subprocess helper. After upgrading DeepSeek Harness itself, restart the running instance so the panel loads matching artifacts.

### Agent presets

The worker and router presets move shell commands to the background after 5 seconds. A Session cannot load without its preset. Keep the `dsh-superagent-worker` and `dsh-superagent-router` rows in `cordis.patch.yml` while their Sessions are in use; otherwise resume fails with `agent-preset/not-found`.

## Troubleshooting

Setup problems appear on the overview with a link to the fix, in the panel's language; the log and the API show the English text below.

| Symptom | Cause and fix |
| --- | --- |
| `No enabled execution environment has working account references.` | Enable an environment or repair its Source connections in Execution settings; a profile without integrations can be used for local work |
| `The agent GitHub CLI is not set.` | Set the agent's CLI on the GitHub card |
| `The agent GitHub CLI was not found.` | Set the wrapper's absolute path, or a command name on `PATH` |
| `The agent GitHub CLI cannot read its account` | Sign the wrapper in with `auth login` |
| `@… cannot read …` or `@… cannot push to …` | Give the agent account write access to the repository |
| `The GitHub Source names no repository.` | Set the repository, `owner/name`, on the GitHub card |
| A Ticket fails with `The prepare command failed: …` | The output names the cause. Fix an external prerequisite and retry the same captured command. A changed prepare command needs a new Ticket; saving a profile does not migrate the failed one |
| `git does not read the github.com credential configuration dsh-superagent writes` | Install git 2.32 or later |
| A Ticket fails with `The git configuration of the repository in … sets …` | Remove the named credential or `http.*.extraheader` settings from the clone's `.git/config` |
| `… was not written by dsh-superagent` | Inspect the named revision artifact as the operator; preserve the foreign file and use a clean environment/state location. Do not overwrite it or remove another environment's artifacts |
| `The bot lark-cli allows user identities` | Point the Feishu Source at a bot-only configuration, as in Feishu bot above |
| `The bot lark-cli does not work.` or `The bot identity of app … is …` | Check the configuration's app id and secret |
| `The Feishu bot is not a member of the chat.` | Add the bot to the chat in the chat's settings; the next attempt succeeds |
| `status` exits 2 | A part reports an error, which a restart does not fix: `errors` names each part, as listed under Management API in [Configuration](../subsystems/configuration.md), with its detail; each part clears its own entry once it works again |
| `status` exits 3 | Setup waits: `setup` says what is missing, and the overview links to the setting that fixes it |
| `status` exits 1 | The service does not run, runs twice, does not answer, or its runtime reports an error; the output and the newest log say which |
| `… timed out after 90 s`, `… was stopped by …`, `… exited with code …` or `… could not run: …` | A CLI failed without printing why; run the named program by hand as the operator's user to see its own message |
| The panel says dsh-superagent is not answering | It is restarting, or did not start because of its configuration; the DeepSeek Harness log names the cause |
| `dsh-superagent configuration has keys it does not use` (log) | Remove the named keys; the message says where each value lives now |
| The log says the plugin is incompatible with the running dsh | Install a DeepSeek Harness version within the `engines.dsh` range |
| The panel shows "Failed to load plugins" after a DeepSeek Harness upgrade | Restart the running instance |
| Nothing happens after a mention | Check that the author is admitted by that Source instance, the Source is on, processing is not paused, and its fixed environment or Router choices are available. On GitHub, a mention added by editing an Issue's body is not received; mention the agent in a comment |
| An environment selection is stale or unavailable | Reread `trigger/<id>` as the Router for current choices. Repair that environment's setup or choose an allowed available target for new work; never silently move an existing Ticket |
| A bound environment is disabled | Re-enable it to continue the same snapshot, or create a new Ticket for another environment. A retry does not reselect |
| `environmentAccountChanged` | The checked account identity differs from the snapshot, even if its CLI path is unchanged. Restore the captured account or configure a new account reference for new Tickets; retry never overwrites the old identity |
| An optional Feishu Source reports that its bot CLI is unset | Configure that instance's bot-only CLI or leave the listener disabled. No bot account is inferred from another Source |
| A Source's kind or repository change is refused | The id has durable use. Add a new named Source instead of repurposing its history and Channels |
