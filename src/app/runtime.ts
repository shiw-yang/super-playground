/** Application composition root and lifecycle manager for dsh-superagent. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subprocess'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import { Engine, key, reasonText, UserError, type EngineForSettings, type ReceiveResult, type Ticket, type Trigger } from '../core/index.ts'
import { allowedSender, settingsPolicy } from '../policy.ts'
import { SourceRegistry } from '../sources/registry.ts'
import { Commands } from '../infra/commands.ts'
import { agentVariables, materializeWorkerEnvironment } from '../infra/environment.ts'
import type { PreparedWorkerEnvironment } from '../infra/worker-environment.ts'
import { Environments } from './environments.ts'
import type { Deployment, Machine } from '../deployment.ts'
import { environmentOf, ticketEnvironment, type Variable } from './execution-environment.ts'
import type { SetupProblem } from '../setup.ts'
import { DshExecutor, sourceTrigger, triggerMessage, workerSessionId } from '../executor/dsh.ts'
import { ticketCard } from './cards.ts'
import { MasterAssessor } from './assessment.ts'
import { KV } from '../kv.ts'
import { Store } from './store.ts'
import { evalsHealth } from './views/overview.ts'
import { TextCache } from './cache.ts'
import { Effects } from './effects.ts'
import { Prompts } from './prompts.ts'
import { registerHttp, type HttpHost } from './http.ts'
import type { LinkTarget } from './views/records.ts'
import { candidateCard, repliedTo, sourceLink, type LinkHost } from './links.ts'
import { eventNotice, followupNotice } from './notices.ts'
import { pullEndNotices } from '../sources/github-pull.ts'
import { HealthBoard, type HealthEntry } from '../infra/health.ts'
import { Outbox } from './outbox.ts'
import { Passes } from './passes.ts'
import { Setup } from './setup.ts'
import { feishuSettings } from '../sources/feishu.ts'
import { health, type Health, type SourceContext, type SourceHost } from '../sources/host.ts'
import { Sessions } from './sessions.ts'
import { Settings } from './settings.ts'
import { sourceContextOf, type SourceContextDeps } from './source-context.ts'
import type { ResourceHost } from './resources.ts'
import { mainTools, type MainToolsHost } from './tools/main.ts'
import { watchdogTools } from './tools/watchdog.ts'
import { Watchdog } from './watchdog.ts'
import type { RoleModel } from '../policy.ts'
import { executorTools, type ExecutorToolsHost } from './tools/executor.ts'

// Source plugins interact with dsh-superagent exclusively through the `SourceHost` service interface.
declare module '@deepseek-ai/cordis' { interface Context { orchestrator: SourceHost } }
const now = (): string => new Date().toISOString()

/**
 * Composition root of dsh-superagent that connects `Store`, `Setup`, `Engine`, `SourceRegistry`, `Effects`, `Outbox`, `Passes`, `Sessions`, `Settings`, `Prompts`, `DshExecutor`, and `MasterAssessor`.
 * Exposes the `SourceHost` service on the Cordis context for source plugins and coordinates startup, setup checks, HTTP route registration, and graceful shutdown.
 * Locks the state directory before opening SQLite so concurrent processes cannot corrupt or double-migrate state.
 */
export class Runtime extends Service implements SourceHost {
  readonly store: Store
  readonly setup: Setup
  readonly prompts: Prompts
  readonly effects: Effects
  readonly sources: SourceRegistry
  readonly commands: Commands
  readonly environments: Environments
  readonly sessions: Sessions
  readonly settings: Settings
  readonly executor: DshExecutor
  readonly assessor: MasterAssessor
  readonly outbox: Outbox
  readonly engine: Engine
  readonly passes: Passes
  readonly watchdog: Watchdog
  readonly ready: Promise<void>
  private readonly board = new HealthBoard()
  private readonly runtimeHealth = this.board.claim('runtime', { state: 'starting', detail: '' })
  private readonly watchdogHealth: HealthEntry
  /** Every Watchdog Session this Runtime created, including one whose task was later removed from settings. */
  private readonly watchdogSessions = new Set<string>()
  readonly masterId: string
  private readonly sourceLinks = new TextCache(200_000)
  private readonly stopped = new AbortController()
  private readonly disposers: (() => void)[] = []
  private releaseLock?: () => Promise<void>
  private closingFlag = false
  private stopping?: Promise<void>
  private readonly sourceDeps: SourceContextDeps
  private readonly toolHost: MainToolsHost & ExecutorToolsHost
  /** Non-zero while a main-Session tool is executing an Engine command, suppressing self-triggered domain event notices. */
  private quiet = 0
  constructor(ctx: Context, readonly machine: Machine, restart: () => void) {
    super(ctx, 'orchestrator')
    const runtime = this
    // Lock the state directory before opening the database so another process cannot migrate or write concurrently.
    mkdirSync(machine.stateDir, { recursive: true, mode: 0o700 })
    const compromised = (error: Error) => { this.runtimeHealth.set({ state: 'error', detail: error.message }); this.stopped.abort() }
    const release = lockSync(machine.stateDir, { stale: 30_000, onCompromised: compromised })
    this.releaseLock = async () => { release() }
    let opened: Store | undefined
    try {
      const report = (error: unknown) => { ctx.logger.warn('dsh-superagent: %s', String(error)) }
      const store = opened = this.store = new Store(join(machine.stateDir, 'orchestrator.sqlite'), report)
      const setup = this.setup = new Setup({ context: ctx, machine, lifetime: this.lifetime, settings: () => store.settings(), restart })
      const deployed = () => setup.configured()
        ? environmentOf({ deployment: setup.deployment, sources: this.sources, settings: store.settings() }) : undefined
      const feishu = () => setup.configured() && !!setup.deployment.feishu
      const prompts = this.prompts = new Prompts(store, () => machine.promptMaxChars.get(), deployed, feishu)
      const masterId = this.masterId = store.get(KV.runtime.masterId) ?? `orchestrator-${key(machine.stateDir)}`
      store.set(KV.runtime.masterId, masterId)
      this.commands = new Commands(() => setup.deploymentFor('github'), setup.commandEnvironment, this.lifetime, 'github')
      const commandsFor = (sourceId: string) => this.commandsFor(sourceId)
      const environments = this.environments = new Environments({ store, machine,
        knownAccounts: snapshot => setup.knownAccounts(snapshot), resolveAccounts: snapshot => setup.resolveAccounts(snapshot) })
      const board = this.board
      const effects = this.effects = new Effects(store, board)
      this.watchdogHealth = board.claim('watchdog', store.settings().watchdog.enabled
        ? { state: 'ready', detail: 'Watchdog is waiting for the first cycle', at: now() }
        : { state: 'ready', detail: 'Watchdog is disabled', at: now() })
      const sources = this.sources = new SourceRegistry(() => store.settings(), board, kind => {
        // Sync source member lists once startup completes when a source plugin loads dynamically.
        if (kind.policy?.sync) void this.ready?.then(() => this.settings.syncable().includes(kind.kind) ? this.settings.sync(kind.kind) : undefined)
          .catch(() => { /* sync() records its failure in health. */ })
        return () => {}
      })
      const links: LinkHost = { store, links: this.sourceLinks, commandsFor, sources, lifetime: this.lifetime }
      const link = (trigger: Trigger, signal?: AbortSignal) => sourceLink(links, trigger, signal)
      const environment = (ticket: Ticket) => this.ticketEnvironment(ticket)
      const resources: ResourceHost = { store, pages: new TextCache(4_000_000), prompts, sources, commandsFor,
        commandsForTicket: ticket => this.commandsForTicket(ticket), executionCandidates: trigger => environments.candidates(trigger), masterId, context: ctx,
        promptVersion: id => this.sessions.promptVersion(id), mayRead: (id, revision) => this.sessions.mayRead(id, revision),
        feishuPageSize: sourceId => feishuSettings(sources, sourceId).readPageSize, sourceLink: link }
      const sessions: Sessions = this.sessions = new Sessions({ context: ctx, store, prompts, effects, health: board.claim('models'), masterId,
        watchdogIds: () => this.watchdogSessionIds(),
        lifetime: this.lifetime,
        closing: () => this.closing(), environment, workerEnvironment: ticket => this.workerEnvironment(ticket),
        tools: (agent, ticket) => ticket ? executorTools(this.toolHost, ticket)
          : this.watchdogSessionIds().includes(agent.id)
            ? [...mainTools(this.toolHost, agent), ...watchdogTools({ store, effects, health: () => this.health,
              executorLoad: () => this.executor.activeCount(), sessions: { notify: (name, value, summary) => this.sessions.notify(name, value, summary) } })]
            : mainTools(this.toolHost, agent) })
      const policyChanged: EngineForSettings['policyChanged'] = (from, to, effects) => { this.engine.policyChanged(from, to, effects) }
      this.settings = new Settings({ store, sources, engine: { policyChanged }, health: board, context: ctx, lifetime: this.lifetime, sessions,
        sourceHost: this, setup, requestPass: () => { this.passes.request() }, watchdog: { reload: () => this.watchdog.reload() } })
      this.executor = new DshExecutor({ context: ctx, get engine() { return runtime.engine }, store, effects, health: board.claim('worker'), machine,
        lifetime: this.lifetime, sessions, closing: () => this.closing(), paused: () => this.paused(),
        bindExecution: (ticket, outcome) => environments.bind(ticket, outcome), workerEnvironment: ticket => this.workerEnvironment(ticket), sourceLink: link,
        repliedTo: trigger => repliedTo({ store, sources }, trigger) })
      this.watchdog = new Watchdog({ sessions, store, health: this.watchdogHealth, sessionId: task => this.watchdogSessionId(task),
        settings: () => store.settings().watchdog, lifetime: this.lifetime,
        ensure: task => this.ensureWatchdog(task) })
      this.assessor = new MasterAssessor({ get engine() { return runtime.engine }, commandsFor, get deployment() { return setup.deployment }, effects,
        executionCandidates: trigger => environments.candidates(trigger),
        repositoryCommands: (trigger, environmentId) => commandsFor(environments.repositorySource(trigger, environmentId)),
        settings: () => store.settings(), paused: () => this.paused(), threadContext: trigger => sources.threadContext(trigger),
        deliver: (id, text) => sessions.prompt(masterId, id, text, 'steer'), candidateCard: async candidate => ({
          ...await candidateCard(links, candidate), execution: environments.candidates(candidate.triggers.find(trigger =>
            trigger.id === candidate.thread.evaluating?.primary) ?? candidate.triggers.at(-1)!),
        }) })
      const outbox = this.outbox = new Outbox({ store, effects, sources, commandsFor, paused: () => this.paused() })
      const { assessor, executor } = this
      const policy = () => settingsPolicy(store.settings(), sources)
      const engine = this.engine = new Engine({ repo: store, scope: sources, policy, assessor, executor,
        outbox, prepareTicket: (ticket, outcome) => executor.prepare(ticket, outcome), emit: event => {
          // Notify the main Session only about domain events it did not initiate itself.
          const notice = this.quiet ? undefined : eventNotice(event, id => store.tickets.get(id))
          if (notice) sessions.notify(...notice)
          // A person's message that reached an open ticket is the ticket's; the main Session hears of it in the same transaction,
          // and of one for an ended ticket once it resumes, unless it routed the message there itself.
          const followed = !this.quiet && (event.type === 'trigger.received' || event.type === 'ticket.resumed' || event.type === 'trigger.followup')
          const followup = followed ? followupNotice(store, sources, event.data.triggerId) : undefined
          if (followup) sessions.relay(followup.id, followup.text)
          // Notify the ticket's conversations whenever it ends via a pull request.
          const ended = event.type === 'ticket.ended' ? store.tickets.get(event.data.ticketId) : undefined
          if (ended && setup.configured()) {
            const request = store.triggers.get(ended.origin.triggerId)?.text ?? ''
            for (const message of pullEndNotices(ended, request, sourceId => this.repositoryFor(ended, sourceId))) outbox.send(message)
          }
        } })
      // Update the `evals` health entry on every pass if an evaluation failed as unavailable within the last hour.
      const evals = board.claim('evals', { state: 'ready', detail: 'No unavailable Eval in the last hour' })
      const evaluateDue = () => { engine.evaluateDue(); evals.set(evalsHealth(store)) }
      const passes = this.passes = new Passes({ engine: { receive: trigger => engine.receive(trigger), evaluateDue }, effects,
        health: this.runtimeHealth, lifetime: this.lifetime, configured: () => setup.configured(), closing: () => this.closing() })
      this.sourceDeps = { store, engine, outbox, commandsFor, sources, lifetime: this.lifetime, get ready() { return runtime.ready },
        deploymentFor: id => this.sourceDeployment(id), configured: id => setup.configured(id), problemFor: id => setup.problemFor(id),
        receive: trigger => passes.receive(trigger) }
      this.toolHost = { context: ctx, engine, store, prompts, sessions, settings: this.settings, assessor, resources,
        githubFor: ticket => runtime.githubFor(ticket),
        requestPass: () => { passes.request() }, sendReplies: () => outbox.sent(),
        quietly: run => { this.quiet++; try { return run() } finally { this.quiet-- } } }
      this.ready = this.initialize()
    } catch (error) {
      // Release the database and state lock if initialization fails so an in-process restart can reacquire them.
      try { opened?.close() } finally { release() }
      throw error
    }
  }
  get health(): Readonly<Record<string, Health>> { return this.board.all }
  /** Aborted when dsh-superagent stops or loses its state directory lock, cancelling running reads and subprocesses. */
  get lifetime(): AbortSignal { return this.stopped.signal }
  context(kind: { kind: string; health: readonly string[] }, id = kind.kind): SourceContext { return sourceContextOf(this.sourceDeps, kind, id) }
  /** Each transport selects one Source account; no Worker or most-recent Source establishes a global default. */
  commandsFor(sourceId: string): Commands {
    return new Commands(() => this.sourceDeployment(sourceId), this.setup.commandEnvironment, this.lifetime, sourceId)
  }
  private sourceDeployment(sourceId: string): Deployment {
    const kind = this.sources.kind(sourceId)?.kind ?? this.store.settings().sources[sourceId]?.kind ?? sourceId
    return kind === 'github' || kind === 'feishu' ? this.setup.deploymentFor(sourceId)
      : { ...this.machine, repository: '', github: { cli: '', login: '', noreply: '' } }
  }
  /** A Worker's target reads use the same saved account identity as its subprocess environment. */
  commandsForTicket(ticket: Ticket): Commands {
    this.environments.assertEnabled(ticket)
    const deployment = this.environments.deployment(ticket)
    return new Commands(() => deployment, { ...this.setup.commandEnvironment, ...agentVariables(deployment.stateDir) },
      this.lifetime, ticket.execution?.environment?.sources.github)
  }
  private githubFor(ticket: Ticket): SourceContext {
    const sourceId = ticket.execution?.environment?.sources.github
    if (!sourceId) throw new UserError('githubSourceUnavailable', { source: 'none' })
    const deployment = this.environments.deployment(ticket)
    return sourceContextOf({ ...this.sourceDeps, generation: () => ticket.execution!.environment!.revision,
      deploymentFor: id => id === sourceId ? deployment : this.setup.deploymentFor(id),
      commandsFor: id => id === sourceId ? this.commandsForTicket(ticket) : this.commandsFor(id) },
    { kind: 'github', health: ['github'] }, sourceId)
  }
  private repositoryFor(ticket: Ticket, sourceId: string): string {
    if (ticket.execution?.environment?.sources.github === sourceId) return this.environments.deployment(ticket).repository
    return String(this.store.settings().sources[sourceId]?.config.repository ?? '')
  }
  private async workerEnvironment(ticket: Ticket): Promise<PreparedWorkerEnvironment> {
    const resolved = await this.environments.resolve(ticket)
    resolved.variables = Object.fromEntries(this.ticketEnvironment(ticket).map(variable => [variable.key, variable.value]))
    const prepared = await materializeWorkerEnvironment(resolved, this.ctx.superagentNativeSubprocess, this.lifetime)
    this.environments.assertEnabled(ticket)
    this.lifetime.throwIfAborted()
    return prepared
  }
  /** Resolved deployment; throws while waiting for setup (`!configured()`). */
  get deployment(): Deployment { return this.setup.deployment }
  configured(): boolean { return this.setup.configured() }
  get setupProblem(): SetupProblem | undefined { return this.setup.problem }
  /** Why the Feishu bot is unavailable even though the Feishu Source configures a CLI. */
  get feishuProblem(): SetupProblem | undefined { return this.setup.feishuProblem }
  links(): LinkTarget {
    return channel => {
      const resolved = this.setup.deployments[channel.source]
      const links = resolved ? { repository: resolved.repository, ...(resolved.feishu ? { feishu: resolved.feishu } : {}) } : {}
      return this.sources.link(channel, links)
    }
  }
  ticketEnvironment(ticket: Ticket): Variable[] {
    const trigger = sourceTrigger(this, ticket), snapshot = this.environments.snapshot(ticket)
    const sourceConfigs: Record<string, Record<string, unknown>> = {}
    if (snapshot.github) sourceConfigs[snapshot.github.sourceId] = snapshot.github
    if (snapshot.feishu) sourceConfigs[snapshot.feishu.sourceId] = snapshot.feishu
    return ticketEnvironment({ deployment: this.environments.deployment(ticket), sources: this.sources, settings: this.store.settings(), ticket,
      environment: { config: snapshot.config, sources: ticket.execution!.environment!.sources, sourceConfigs }, ...trigger ? { trigger } : {} })
  }
  checkSetup(): void { this.setup.check() }
  receive(trigger: Trigger): ReceiveResult { return this.passes.receive(trigger) }
  idle(): Promise<void> { return this.passes.idle() }
  pump(): Promise<void> { return this.passes.pump() }
  sendReplies(): Promise<void> { return this.outbox.sent() }
  private closing(): boolean { return this.closingFlag }
  /** The configured Watchdog model, or null to keep the Watchdog on the Executor's default model. */
  private watchdogModel(): RoleModel | null { return this.store.settings().watchdog.model }
  /** One task's Session id: the task name and the state directory's key keep it stable across restarts. */
  private watchdogSessionId(taskId: string): string { return `watchdog-${taskId}-${key(this.machine.stateDir)}` }
  /** Every configured task's Session id, plus Sessions created earlier for a task that has since been removed. */
  private watchdogSessionIds(): string[] { return [...new Set([...this.store.settings().watchdog.tasks.map(task => this.watchdogSessionId(task.id)), ...this.watchdogSessions])] }
  /** Ensure one task's Watchdog Session exists before a cycle or after a settings save enables it. */
  private async ensureWatchdog(taskId: string): Promise<void> {
    const id = this.watchdogSessionId(taskId)
    this.watchdogSessions.add(id)
    await this.sessions.ensure(id, this.machine.stateDir, `dsh-superagent watchdog ${taskId}`, 'watchdog', this.watchdogModel())
  }
  /** Hold evaluation, dispatch, and outbound delivery while paused or awaiting setup; sources still record incoming triggers. */
  private paused(): boolean { return !this.setup.configured() || this.store.settings().paused }
  private async initialize(): Promise<void> {
    // Register management HTTP routes before setup completes so operators can fix setup problems in the UI.
    this.disposers.push(registerHttp(this.ctx, this.httpHost()))
    if (!await this.setup.run(this.store.settings())) {
      this.runtimeHealth.set({ ...health('paused', 'setupPending'), at: now() })
      return
    }
    this.sessions.install()
    this.executor.install()
    await this.sessions.ensure(this.masterId, this.machine.stateDir, 'dsh-superagent orchestrator', 'orchestrator')
    for (const id of this.settings.syncable()) await this.settings.sync(id).catch(() => { /* sync() records its failure in health. */ })
    // If stop() was called while awaiting setup, session creation, or policy sync, do not start background loops.
    if (this.closing()) return
    await this.watchdog.start()
    this.executor.resume()
    this.passes.start()
    this.effects.start()
    this.runtimeHealth.set({ state: 'ready', detail: 'Orchestrator is ready', at: now() })
  }
  private httpHost(): HttpHost {
    const runtime = this
    const { store, sources, prompts, sessions, settings, engine, executor, watchdog, health, machine, masterId, ready, sourceLinks, setup, passes } = this
    return { store, sources, prompts, sessions, settings, engine, executor, watchdog, health, machine, masterId, ready, sourceLinks,
      get deployment() { return setup.deployment },
      get setupProblem() { return setup.problem }, get feishuProblem() { return setup.feishuProblem },
      get sourceProblems() { return setup.problems }, get sourceDeployments() { return setup.deployments },
      configured: () => setup.configured(), links: () => runtime.links(), ticketEnvironment: ticket => runtime.ticketEnvironment(ticket),
      checkSetup: () => { setup.check() }, requestPass: () => { passes.request() }, models: () => this.ctx.sessionController.modelCatalog() }
  }
  /** Idempotent stop; concurrent or repeated calls share the same shutdown promise. */
  stop(): Promise<void> { return this.stopping ??= this.shutdown() }
  private async shutdown(): Promise<void> {
    this.closingFlag = true; this.watchdog.stop(); const passes = this.passes.stop(); this.stopped.abort()
    try {
      this.assessor.stop()
      const ids = [this.masterId, ...this.watchdogSessionIds(), ...this.store.tickets.list().map(ticket => workerSessionId(ticket.id))]
      const agents = ids.map(id => this.ctx.agents.get(id as SessionId)).filter((agent): agent is Agent => agent !== undefined)
      for (const agent of agents) agent.cancel({ kind: 'user' }, { keepInbox: true })
      await Promise.allSettled([passes, this.effects.drain(), ...agents.map(agent => agent.whenIdle())])
      // The workers' jobs and subagents stop too: their ends would start worker turns without the tool limits released below.
      await this.executor.shutdown()
      this.executor.dispose()
      this.sessions.dispose()
      for (const dispose of this.disposers.reverse()) dispose()
      await this.ctx.sessionPersistence.flush()
    } finally {
      // Close the database before releasing the directory lock so another process cannot open the database mid-write; a compromised lock may already be released.
      this.setup.restore()
      try { this.store.close() } finally {
        const unreleased = (error: unknown) => { this.ctx.logger.warn('dsh-superagent could not release its state directory lock: %s',
          String(error)) }
        await this.releaseLock?.().catch(unreleased)
      }
    }
  }
}
