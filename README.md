# dsh-superagent

> **Personal production line, forked from the DeepSeek Harness team's research prototype.** This repository started from [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) (MIT, DeepSeek Harness Team) and is being developed into one person's production Super-agent. It is not an official DeepSeek product, and it is no longer a reference prototype: the operator uses it for their own work, and the upstream prototype is the starting point, not the product.
>
> The design it follows is defined by *Exploring Super-agent Design: Towards a More Autonomous Agent System* (DeepSeek Harness Team, 2026) and restated in [the design](docs/design.md). [Implementation status](docs/status.md) is the honest account of what is implemented, what is not, and where this line deviates from the design.

dsh-superagent is the operator's personal **Super-agent**: a hosted agent that stays in the operator's real working environment and takes on the operator's work, so that they move up from executing steps to deciding and accepting results. It starts from the article's design and the upstream prototype, then grows feature by feature around the operator's daily work — coding first, then the team and enterprise affairs that come up in that work. The goal is the path from prototype to product for one person's real work.

- **The design comes from its definition, not from this code.** [The design](docs/design.md) restates the article's design as obligations: a resident Router and isolated Workers, event-driven intake and routing, asynchronous multi-channel interaction, separated compute/state/environment, and an external Watchdog. This fork is one implementation of that design. Where it differs, the implementation is incomplete, not the design.
- **The work is broader than code.** The unit of work is whatever the operator would otherwise hand to a teammate. Coding covers the work around a code review, not only typing code. Team affairs and enterprise affairs use the same architecture; supporting one is a Source, Channel, Policy rule, tool or prompt, not a new concept.
- **It grows from real use.** Features are chosen from the operator's daily needs and refined against real work, not copied from a generic roadmap. [Implementation status](docs/status.md) marks what is implemented, partial or absent.
- **What this fork does today.** Packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/), it listens to one GitHub repository and, optionally, Feishu. When someone allowed asks the agent for work, it opens a Ticket, works on it in its own DSH Session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [Principles](docs/user/principles.md) explains the principle and what it asks of the operator.

## Relationship to the upstream prototype

This fork keeps the git history and the MIT license of `deepseek-ai/dsh-superagent-prototype` (Copyright (c) 2026 DeepSeek Harness Team). Upstream remains the DeepSeek Harness team's research prototype; this fork is the operator's product line. Generally useful fixes may be proposed upstream, and upstream changes may be merged in when they serve the design and the operator's needs. This fork does not speak for the upstream project or for DeepSeek.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read docs/cookbook/setup.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [Setup](docs/cookbook/setup.md) is what it follows.

## First request

Comment `@<agent login> <request>` on an issue in the repository the agent watches, or mention the bot in an allowed Feishu chat. The agent opens a Ticket, works on it in its own DSH Session and answers in the original conversation, for example with a pull request. The **Superagent** panel in the DeepSeek Harness sidebar shows the work and anything that needs a person; [Using dsh-superagent](docs/user/index.md) is the operator's entry.

## Documentation

All committed documentation is written in English. Start with [the documentation index](docs/README.md): it says what each document is for and when to read it. A coding agent starts with [AGENTS.md](AGENTS.md) instead.

The documentation is grouped by role, not numbered:

- [The design](docs/design.md): the design definition, restated from the article as obligations. It is the authority for intended behaviour.
- [Implementation status](docs/status.md): how far this fork gets toward the design, with evidence and known deviations.
- [Architecture](docs/architecture.md) and [Subsystems](docs/subsystems/README.md): the classes, dependency rules and module index, and the precise behavior, types and protocols.
- [Using dsh-superagent](docs/user/index.md): setup, the first request, the panel and operations.
- [Development](docs/development.md) and [Testing and verification](docs/testing.md): environment, commands, test suites and the checks each change needs.
- [Cookbook](docs/cookbook/README.md): setup with an operator, and how to add a Source.

## Development

`pnpm install`, then `pnpm check` (typecheck, tests and build). [Development](docs/development.md) covers the environment, commands and repository layout; [Testing and verification](docs/testing.md) covers test suites and the checks each kind of change needs. If you are a coding agent, read [AGENTS.md](AGENTS.md) before you start.

## License

[MIT](LICENSE)
