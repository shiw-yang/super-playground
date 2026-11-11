# Panel

Open **Superagent** in the DeepSeek Harness Web sidebar to supervise the agent. The panel prioritizes work that needs a person, then system health and history. This page is the panel reference for the implementation; it builds on [Principles](../user/principles.md), the [Domain model](domain-model.md), [Authorization](authorization.md), [Execution](execution.md) and [Prompts](prompts.md), and the design it implements is [the design](../design.md).

The bundle hides the sidebar workspace browser while its client plugin is loaded, including its heading, workspace controls, Session search and Session list. Pinned and active Sessions, their status indicators and row actions are therefore hidden there too. New Session, the Superagent entry and the other global sidebar navigation remain visible. The workspace service, Session catalog and data are not removed, and the panel can still open its linked Sessions. The host still handles workspace shortcuts: a shortcut may act or open a dialog even when its sidebar control is hidden. The rule depends on the host's slot markup; verify it again when upgrading DeepSeek Harness.

## Three questions

Opening the panel answers three questions, in this order:

1. Does anything need me now?
2. Is the system healthy and doing the right things?
3. What is the history of one piece of work, from Trigger through Eval to Ticket?

## Tabs

The tabs follow the workflow: **Overview**, **Source**, **Trigger**, **Eval**, **Execution**, and **Settings**. Overview surfaces reported setup problems; the Source page shows per-instance problems and links to the relevant setting.

| Tab | Shows |
| --- | --- |
| Overview | Tickets needing action, system problems, activity counts for the last 24 hours, and one box per Executor with its stage and latest report. Each block links to its detailed page |
| Source | Source state, configured execution-environment tags, setup problems and non-zero counts. Fixed selection shows one environment; Router selection shows its allowlist. Filtered Triggers and dropped messages cover the same 24-hour window as Overview |
| Trigger | Threads filtered by Subscribed, Evaluating, New Triggers in 24 h, or All Threads. Each Thread shows its Triggers newest first, Decisions and Subscriptions |
| Eval | Decisions with their reason and matched rules |
| Execution | Executor state, Pause processing, and Tickets filtered by Open, Pending, Working, Waiting for a Trigger or Ended. Ticket details show actions, authorization, waiting Inputs, Subscriptions and Assignments |
| Settings | Sources, Eval, Execution, Prompts and Deployment. Each group includes its save history |

### Reading individual records

Each Source's environment tags show the current targets for new Tickets, with configured titles and IDs on hover. Disabled environments and missing references remain visible with warning labels; a disabled Source retains its configured tags. These are configuration references, not a guarantee that a particular Trigger passes admission or account checks. Existing Tickets keep their own stored bindings.

A dropped message links to its Ticket, or to its Thread when it has no Ticket. The Source page explains whether its conversation disappeared or the Source stopped listening to it.

A human follow-up still owned by an Executor is marked **Delivered to Ticket**, without an Eval. The Thread also shows hand-back reasons and context-only Subscriptions. **Evaluate again** can send that follow-up to Eval, or retry a Trigger with no effective judgement: one filtered by its Source, an unavailable Eval, or a delivered message with neither a non-stop Decision nor an Executor acknowledgement.

Ticket details show the originating Trigger, Decision and reason, scope and Policy version, plus the bound environment's id, snapshot revision and selection provenance. These are the Ticket's stored facts, not the environment currently offered to new work. Assignments and secondary details are folded below the immediate actions. **Retry** is available for failed Input delivery or a Ticket waiting for a person after a blocked or failed Report. Ended Tickets show outcomes such as **Pull request merged** or **Stopped by a person**.

The **Verification report** section shows the last submitted verification snapshot separately from the Ticket's current state, with a short brief when provided and expandable full details. Failed and not-run checks appear before passed ones; a pass with notes is marked as limited. Expand a check for its criterion, method, notes and evidence, and **Technical details** for the reported revision, time and Assignment. Earlier snapshots remain available in reverse submission order. A missing report is not a pass, and missing limitations do not mean everything was verified. Only HTTP(S) evidence links are clickable. The report is a Worker's account of the reported revision, not independent acceptance or proof of the current code: the host does not compare it with the current head. See [Execution](execution.md#verification-evidence).

## Settings groups

- **Sources:** one card per named Source instance with its id, kind, switch, fields, verified account facts and execution selection. Choose one fixed environment or let the Router choose from an explicit allowlist. **Create Source** adds a disabled instance of an installed kind; configure its account and listening scope before enabling it. GitHub also offers receive-all switches for new Issues, pull requests, comments and default-branch CI. Polling and read limits are under Advanced.
- **Eval:** the Policy version and rules, followed by **On each Source** and the Eval settings. Each installed Source's Policy tab has the fields its kind supplies, such as allowed and bot lists or an admission table. A configured Feishu membership sync runs at startup and on **Sync now**; save or discard a Policy draft before syncing. The admission table distinguishes receiving scope, sender membership and whether the message addresses the agent. Eval settings select the accept mode, timeout and assessment model.
- **Execution:** shared worker model and concurrency, followed by named local environment cards. Each card edits its title, purpose, enabled state, directory root, prepare command, blocked commands and optional GitHub and Feishu Source references. **Create environment** adds a new profile; each card has its own revision and save bar. Clicking an available variable inserts it into that card's prepare command. Saved changes affect new Tickets; existing Tickets retain their binding, and disabling their environment refuses further execution without killing processes already running.
- **Prompts:** **Edit** changes team sections, built-in parts and skills. **Full prompt** shows the assembled text and compares it with saved text or defaults. **History** lists versions. Edited built-in parts are marked changed and can be reset; templates list their required placeholders.

  An upgrade that changes an overridden default marks it **Default updated** (`默认内容已更新`). The panel compares the old and new defaults above the team's text. If the old default was not recorded, it compares the team's text with the new default instead. Choose **Keep my text** or **Use the new default**. Overrides for removed parts are listed below the tab bar and dropped on the next save.
- **Deployment:** startup problems with **Check again**, the state directory and machine limits. Saved limits apply without restart. The DeepSeek Harness Plugin Manager exposes the same page.

## Search

The header search finds Triggers by text, id, Feishu message id or a stored link, such as a GitHub comment URL. A Feishu link missing from the original message becomes searchable only after the host reads it during the current process lifetime.

Search also finds Threads by references such as `#12` or a GitHub URL, and Tickets by title or a matching Thread.

## Principles

1. **Focus on what matters.** Every element answers one of the three questions, or it is removed. A number appears only when it changes what the supervisor does.
2. **Precise definitions.** Categories have checkable definitions, are mutually exclusive and cover every case, as the Ticket stages do. A label says whom a row waits for and what it needs, not an internal status code.
3. **One place per concept.** Source state belongs in Source; Threads and Triggers in Trigger; Decisions in Eval; Tickets in Execution. Settings are grouped by the concept they configure. Overview summarizes these pages and links to them instead of becoming another detailed view.
4. **Domain structure.** The panel uses the domain terms. Internal identifiers appear only in folded details, and names replace identifiers where they can be resolved.
5. **Honest state.** A count equals the length of the list it links to, and no state contradicts another fact.
6. **Quiet by default.** Healthy states take no extra space. Problems must be actionable; a one-off network error is not enough. Rows needing a person offer their action directly. Keep page explanations to one sentence and put further detail in the (?) tooltip. Destructive actions require confirmation.
7. **Consistent controls.** Use DeepSeek Harness design tokens and control behavior. The same information should look the same throughout the panel. Each settings block has one save bar, visible only while changes exist, a save runs or a save fails.

Related: [Subsystems](README.md), [the design](../design.md), [implementation status](../status.md).
