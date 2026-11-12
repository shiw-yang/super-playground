# Watchdog

This page is the reference for the demo implementation of the design's external control loop (D25–D27 of [the design](../design.md); gaps are in [Implementation status](../status.md)). The operator procedure is in [Deployment](../user/deployment.md).

## What it is

The Watchdog is a configurable control loop beside the Router and the Workers: **one DeepSeek Harness Session per enabled task**. It never accepts a request, answers a person or does a Ticket's work.

A task is a name, a five-field local-time cron expression, a prompt and an enable switch. When a task is due, the loop sends its prompt to that task's Session; the prompt decides what to inspect and how to report. Nothing about a task's purpose is fixed in code: the task list is configuration, and each Session has its own context and conversation history.

## Configuration

The `watchdog` settings block, edited in **Settings → Watchdog**:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Run the tasks and keep their Sessions |
| `model` | `null` | Model of every Watchdog Session; `null` keeps the Executor/default model. A change restarts the service |
| `tasks` | three example tasks | Up to 20 entries: `{ id, schedule, prompt, enabled }` |
| `tasks[].id` | — | Stable name, `[a-z][a-z0-9-]{0,63}`; `watchdog_report` names it |
| `tasks[].schedule` | — | Five-field cron (`minute hour day-of-month month day-of-week`); `7` is Sunday |
| `tasks[].prompt` | `''` | Inline prompt; the settings page shows and saves the effective prompt |
| `tasks[].enabled` | `true` | Whether the task is armed |

The initial settings contain three example tasks — `patrol` (`*/15 * * * *`), `daily` (`0 9 * * *`) and `weekly` (`0 9 * * 1`) — with prompts in [`prompts/watchdog/`](../../prompts/watchdog/). They are defaults, not a fixed feature: edit, disable, add or remove tasks freely.

Cron fields accept `*`, a number, a range, a step and comma-separated lists. The schema validates expressions and duplicate ids. Saving re-arms the tasks and creates missing Sessions; a model change restarts the service. Machine configuration has no Watchdog keys.

## Sessions and tools

`Runtime` creates one Session per enabled task with the `dsh-superagent-watchdog` preset, the state directory as workspace and the configured model. Its id is `watchdog-<task>-<state-directory key>`, so a restart resumes it. Each Session receives the main Session's application tools plus:

- `watchdog_status`: health, Executor load, waiting effect kinds, and open Tickets with stages, assignment ages, attention and read pointers.
- `watchdog_report`: stores the task's summary, evidence and proposals in `KV` (`watchdog-report:<task>`) and injects it as a notice into the main Session.

The application tools let a task read any Ticket, retry, request status, pause, and save prompts or settings. This demo gives every task all of them; per-task authority and approval are not implemented (D24/D27).

## Driver and panel

`Watchdog` (`src/app/watchdog.ts`) arms one `setTimeout` per enabled task from `src/cron.ts`. A cycle is skipped while that Session still runs. A started cycle records `watchdog-last-run:<task>` and updates the `watchdog` health entry; an invalid task reports there instead of stopping the host. Timers are process-local and stop at shutdown.

The panel lists a compact Watchdog status strip on **Overview**, its scheduled signals on **Triggers**, and adds a **Watchdog** page with one Open Session button per task. The management API adds `GET watchdog`.

## Limits

- Sessions are process-local, so they cannot act when the process or host is stuck (D25's external failure domain).
- Tasks have no shared memory; cross-task alignment uses Tickets and reports.
- The cron is local time with five fields: no seconds, per-task timezone or holidays.
- Long-horizon memory is open (D29).
