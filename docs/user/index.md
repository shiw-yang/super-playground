# Using dsh-superagent

dsh-superagent is the operator's hosted Super-agent. It listens through named GitHub and optional Feishu Sources; turns authorized requests into Tickets bound to local execution environments; works on each Ticket in its own DeepSeek Harness Session and directory; and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

This page is the operator's route through the documentation. Every detail lives in the linked document.

## What it does today

- It takes requests from named GitHub repository and Feishu chat Sources: an allowed person asks for work, and an authorized request becomes a Ticket.
- A Source either fixes one local environment or lets the Router choose within an explicit allowlist. Several repositories and accounts can coexist on this machine.
- Each Ticket keeps its accepted environment snapshot, Session and directory through attachment, resume, retry and restart. The result goes back to the original conversation.
- The **Superagent** panel shows Tickets that need a person, system health and the history of one piece of work.
- Coding is the current workload. Team affairs on chat are partial, and enterprise affairs, remote execution and OS-level isolation are not established by these local profiles: [Implementation status](../status.md) records the exact scope and remaining gaps.

## Set it up

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read docs/cookbook/setup.md in this repository and set up dsh-superagent with me.

[Setup](../cookbook/setup.md) is what the agent follows: it probes the machine, asks one short question at a time, shows the full plan once, then installs and configures everything. Steps that need your hands, such as creating the agent's GitHub account or entering an app secret, go into one message with the exact commands to run in your own terminal; never type a secret into the chat.

## Make your first request

From an account on the Source's allowed list, comment `@<agent login> <request>` on an issue in the repository. With Feishu, mention the bot in a configured chat instead. When the request is accepted as new work in an allowed environment, **Overview** shows a Ticket; GitHub polls by default once a minute. The agent acknowledges the request, works in its own Session and directory, and delivers in the original conversation. A mention added by editing an Issue's body is not received; post a new comment. See [Try it](deployment.md#try-it).

## Supervise and act

Open **Superagent** in the DeepSeek Harness Web sidebar. The panel answers three questions in order: does anything need me now, is the system healthy, and what is the history of one piece of work. Its tabs are **Overview**, **Source**, **Trigger**, **Eval**, **Execution** and **Settings**. Overview lists Tickets that need a person, current problems and Executor cards with the bound environment; Execution shows Executor state, **Pause processing** and Tickets with their actions. In an Executor Session, choose **Overview** beside Chat and Trajectory to see its Ticket details. The bundle also hides the sidebar workspace browser; [Panel](../subsystems/panel.md) describes what remains available and explains every page, label and action.

In a Ticket, **Verification report** shows the latest supplied Worker snapshot: checks, their outcomes and limitations, with expandable evidence and reported revision. Earlier snapshots remain available. This is the Worker's account of the reported revision, not an independent acceptance or a check of the current head; a missing report is not a pass. Inspect failed and not-run checks, and confirm the evidence applies to the revision you intend to review. [Verification evidence](../subsystems/execution.md#verification-evidence) explains the report.

## Configure

Account setup is per Source; a failed account makes environments referencing it unavailable without stopping unrelated healthy ones. Configure **Settings → Sources** for instance accounts and fixed/Router selection, and **Settings → Execution** for shared capacity and named local profiles. Eval holds each Source's Policy; Prompts and Deployment hold instructions and machine limits. [Configuration](../subsystems/configuration.md) describes the exact fields.

Give each environment a purpose the Router can distinguish. On each Source, choose either one fixed environment or an explicit allowlist of environments for Router selection; the allowlist is configured on the Source, not the environment. Selecting an environment does not authorize a request. Editing a profile affects new Tickets, not old work; disabling it refuses further execution of bound Tickets until re-enabled, but does not kill processes already running. A different repository needs a new Source identity once the old Source has durable work. [Named local environments](../subsystems/configuration.md#named-local-environments) explains these lifecycle rules.

## Run, upgrade and recover

- **Run:** `scripts/dsh-superagent start` starts the service and `status` reports process ids, health and setup problems. The `status` exit code tells whether the service runs normally, needs a restart, has a failing part, or waits for setup. [Start and stop](deployment.md#start-and-stop)
- **Upgrade:** stop at a safe point and back up the complete state directory, external workspace roots and backing clones before upgrading; then start the service and inspect the status. [Upgrade](deployment.md#upgrade)
- **Recover:** create the hourly check in the DeepSeek Harness profile you normally use, not in `superagent`, so it keeps running when the agent service is down and can restart it after a failure. [Hourly check](deployment.md#hourly-check)
- **Troubleshoot:** setup problems appear on Overview with a link to the fix; the log and the management API show the English text of each problem. [Troubleshooting](deployment.md#troubleshooting)

## Your responsibility

Every message the agent sends costs your colleagues' attention, and you are responsible for it. Start narrow, tune for less noise, do not use the agent to produce volume, and own what it says. [Principles: Responsibility](principles.md#responsibility) explains what this asks of the operator. The deployment runs on one machine as your OS user with the permissions and isolation limits described in [Permissions and isolation](deployment.md#permissions-and-isolation).

## Design and status

- [The Super-agent design](../design.md) is the authority for intended behavior, restated from the article as obligations.
- [Implementation status](../status.md) is the honest account of how far this implementation gets toward it.

## Where developers start

- [AGENTS.md](../../AGENTS.md) gives a coding agent this repository's rules and reading paths.
- [Documentation](../README.md) is the documentation index and the map of which documents each change updates.
