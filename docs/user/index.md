# Using dsh-superagent

dsh-superagent is the operator's hosted Super-agent. It listens to a GitHub repository and, optionally, Feishu; turns authorized requests into Tickets; works on each Ticket in its own DeepSeek Harness Session and directory; and answers in the conversation where the request was made, for example with a pull request. A web panel shows what needs a person.

This page is the operator's route through the documentation. Every detail lives in the linked document.

## What it does today

- It takes requests from one GitHub repository and, when configured, from Feishu chats: an allowed person asks the agent for work, and an authorized request becomes a Ticket.
- Each Ticket is executed in its own Session and directory, and the result is delivered back to the original conversation.
- The **Superagent** panel shows Tickets that need a person, system health and the history of one piece of work.
- Coding in one GitHub repository is the current workload. Team affairs on chat are partial, and enterprise affairs are target scope, not current capability: [Implementation status](../status.md) records what is implemented, partial or absent.

## Set it up

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read docs/cookbook/setup.md in this repository and set up dsh-superagent with me.

[Setup](../cookbook/setup.md) is what the agent follows: it probes the machine, asks one short question at a time, shows the full plan once, then installs and configures everything. Steps that need your hands, such as creating the agent's GitHub account or entering an app secret, go into one message with the exact commands to run in your own terminal; never type a secret into the chat.

## Make your first request

From an account on the Source's allowed list, comment `@<agent login> <request>` on an issue in the repository. Within a polling interval (one minute by default), **Overview** shows a Ticket; the agent acknowledges the request, works in its own Session and directory, and delivers in the original conversation. With Feishu, mention the bot in a configured chat instead. A mention added by editing an Issue's body is not received; post a new comment. See [Try it](deployment.md#try-it).

## Supervise and act

Open **Superagent** in the DeepSeek Harness Web sidebar. The panel answers three questions in order: does anything need me now, is the system healthy, and what is the history of one piece of work. Its tabs are **Overview**, **Source**, **Trigger**, **Eval**, **Execution** and **Settings**. Overview lists Tickets that need a person and current problems; Execution shows Executor state, **Pause processing** and Tickets with their actions. [Panel](../subsystems/panel.md) explains every page, label and action.

## Configure

Setup must succeed before polling or work starts; Overview lists missing requirements and links to the setting that fixes each one. Configure the deployment in **Settings**: Sources, Eval (including each Source's Policy), Execution, Prompts, and Deployment machine limits. [Configuration](../subsystems/configuration.md) describes each group and the exact fields.

## Run, upgrade and recover

- **Run:** `scripts/dsh-superagent start` starts the service and `status` reports process ids, health and setup problems. The `status` exit code tells whether the service runs normally, needs a restart, has a failing part, or waits for setup. [Start and stop](deployment.md#start-and-stop)
- **Upgrade:** stop work at a safe point, back up the database, upgrade the code, then restart and inspect the status. [Upgrade](deployment.md#upgrade)
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
