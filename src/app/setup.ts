/** Per-Source account checks and readiness, independent of Worker process environments and other Source instances. */
import type { Context } from '@deepseek-ai/cordis'
import { UserError } from '../core/index.ts'
import { SETUP_FIELDS, GithubAccountsSchema, FeishuBotSchema, resolveDeployment, resolveFeishuBot, workerProbe,
  type Deployment, type Machine } from '../deployment.ts'
import { agentVariables, withoutDirectory, workerBin } from '../infra/environment.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'
import type { EnvironmentAccounts, EnvironmentSnapshot } from './environments.ts'

export interface SetupHost {
  readonly context: Context
  readonly machine: Machine
  readonly lifetime: AbortSignal
  settings(): Settings
  restart(): void
}
const sourceKind = (id: string, settings: Settings) => settings.sources[id]?.kind ?? id
const setupFields = (settings: Settings) => JSON.stringify({
  sources: Object.entries(settings.sources).sort(([a], [b]) => a.localeCompare(b)).map(([id, source]) => [id, source.kind ?? id,
    ...(SETUP_FIELDS[source.kind ?? id] ?? []).map(field => source.config[field] ?? '')]),
  connections: Object.entries(settings.environments).map(([id, environment]) => [id, environment.githubSource, environment.feishuSource]),
})
/** New Source instances and changed connection references restart polling; workspace edits do not. */
export const setupChanged = (before: Settings, after: Settings): boolean => setupFields(before) !== setupFields(after)
const signature = (kind: string, config: unknown) => JSON.stringify(kind === 'github' ? GithubAccountsSchema.parse(config) : FeishuBotSchema.parse(config))

/**
 * Resolves each configured Source account independently and never modifies process.env or shared command shims.
 * Runtime uses per-instance readiness for intake and immutable account snapshots for Worker environments.
 * Settings probes proposed connections before saving; a missing account does not disable unrelated healthy environments.
 */
export class Setup {
  private readonly resolved = new Map<string, { kind: string; signature: string; deployment: Deployment }>()
  readonly problems: Record<string, SetupProblem> = {}
  private ran = false
  private usable = false
  problem?: SetupProblem
  feishuProblem?: SetupProblem
  private readonly path: string
  constructor(private readonly host: SetupHost) {
    this.path = withoutDirectory(process.env.PATH ?? '', workerBin(host.machine.stateDir))
  }
  /** Host transports have no ambient GitHub token or operator git overrides, and no Worker's environment. */
  get commandEnvironment(): Record<string, string | undefined> {
    return { ...agentVariables(this.host.machine.stateDir), GIT_CONFIG_GLOBAL: '/dev/null', PATH: this.path }
  }
  private empty(): Deployment { return { ...this.host.machine, repository: '', github: { cli: '', login: '', noreply: '' } } }
  /** Legacy overview facts only. Business operations must select deploymentFor(sourceId) or a Ticket snapshot. */
  get deployment(): Deployment {
    if (!this.ran || !this.usable) throw new Error(`dsh-superagent is waiting for setup: ${this.problem?.detail ?? 'setup has not run'}`)
    const github = this.resolved.get('github')?.deployment, feishu = this.resolved.get('feishu')?.deployment.feishu
    return { ...this.empty(), ...github, ...feishu ? { feishu } : {} }
  }
  get deployments(): Record<string, Deployment> { return Object.fromEntries([...this.resolved].map(([id, value]) => [id, value.deployment])) }
  deploymentFor(sourceId: string): Deployment {
    if (!this.configured(sourceId)) throw new Error(this.problems[sourceId]?.detail ?? `Source ${sourceId} has not passed setup for its current configuration`)
    // Optional unconfigured Feishu exposes no bot, so its loops report the explicit unset-CLI health state.
    return this.resolved.get(sourceId)?.deployment ?? this.empty()
  }
  configured(sourceId?: string): boolean {
    if (sourceId === undefined) return this.usable
    if (!this.ran || this.host.lifetime.aborted || this.problems[sourceId]) return false
    const settings = this.host.settings(), kind = sourceKind(sourceId, settings), config = settings.sources[sourceId]?.config ?? {}
    if (kind !== 'github' && kind !== 'feishu') return true
    const resolved = this.resolved.get(sourceId)
    if (resolved) return resolved.kind === kind && resolved.signature === signature(kind, config)
    return kind === 'feishu' && !FeishuBotSchema.parse(config).cli
  }
  problemFor(sourceId: string): SetupProblem | undefined { return this.problems[sourceId] }

  /** Probe Sources without selecting a process-wide account; publish readiness after every independent result is known. */
  async run(settings: Settings): Promise<boolean> {
    this.resolved.clear()
    for (const id of Object.keys(this.problems)) delete this.problems[id]
    this.problem = undefined; this.feishuProblem = undefined
    const ids = new Set(Object.keys(settings.sources).filter(id => settings.sources[id]!.enabled || !!settings.sources[id]!.config.cli))
    for (const environment of Object.values(settings.environments)) if (environment.enabled) {
      if (environment.githubSource) ids.add(environment.githubSource)
      if (environment.feishuSource) ids.add(environment.feishuSource)
    }
    await Promise.all([...ids].map(async id => {
      const kind = sourceKind(id, settings), config = settings.sources[id]?.config ?? {}
      if (kind !== 'github' && kind !== 'feishu') return
      // An optional Feishu listener without a CLI reports its own missing-bot health, not a global setup failure.
      if (kind === 'feishu' && !FeishuBotSchema.parse(config).cli) return
      try {
        const deployment = await this.resolveSource(kind, config)
        this.resolved.set(id, { kind, signature: signature(kind, config), deployment })
      } catch (error) {
        if (!(error instanceof SetupError)) throw error
        this.problems[id] = { ...error.problem, sourceId: id }
        this.host.context.logger.warn('dsh-superagent Source %s needs setup: %s', id, error.message)
      }
    }))
    this.ran = true
    this.feishuProblem = this.problems.feishu
    this.usable = Object.values(settings.environments).some(environment => environment.enabled
      && (!environment.githubSource || this.resolved.has(environment.githubSource))
      && (!environment.feishuSource || !!this.resolved.get(environment.feishuSource)?.deployment.feishu))
    if (!this.usable) this.problem = Object.values(this.problems)[0] ?? new SetupError('noEnvironment').problem
    return this.usable
  }
  /** A setup retry never changes bindings; it probes Source configuration again in a fresh Runtime. */
  check(): void {
    if (this.configured() && !Object.keys(this.problems).length) throw new UserError('setupComplete')
    this.restart()
  }
  restart(): void { setTimeout(this.host.restart, 0) }
  /** Check proposed Source/account references without publishing them into the running Source contexts. */
  async checkAccounts(block: SettingsBlock, settings: Settings): Promise<void> {
    const ids = block.startsWith('source:') ? [block.slice(7)] : block.startsWith('environment:')
      ? [settings.environments[block.slice(12)]?.githubSource, settings.environments[block.slice(12)]?.feishuSource].filter((id): id is string => !!id)
      : []
    for (const id of ids) {
      const kind = sourceKind(id, settings), instance = settings.sources[id], config = instance?.config ?? {}
      if (kind !== 'github' && kind !== 'feishu') continue
      const needed = Object.values(settings.environments).some(environment => environment.enabled
        && (environment.githubSource === id || environment.feishuSource === id))
      if (instance?.enabled === false && !needed) continue
      try { await this.resolveSource(kind, config) }
      catch (error) {
        if (error instanceof SetupError) error.sourceId = id
        throw error
      }
    }
  }
  /** No process-wide environment is installed, so shutdown has nothing to restore. */
  restore(): void {}
  /** Return current identities only when setup checked exactly the connection fields captured by this snapshot. */
  knownAccounts(snapshot: EnvironmentSnapshot): EnvironmentAccounts | undefined {
    const result: EnvironmentAccounts = {}
    if (snapshot.github) {
      const target = this.resolved.get(snapshot.github.sourceId)
      if (target?.kind !== 'github' || target.signature !== signature('github', snapshot.github)) return undefined
      result.github = { repository: target.deployment.repository, account: target.deployment.github }
    }
    if (snapshot.feishu) {
      const target = this.resolved.get(snapshot.feishu.sourceId)
      if (target?.kind !== 'feishu' || target.signature !== signature('feishu', snapshot.feishu) || !target.deployment.feishu) return undefined
      result.feishu = target.deployment.feishu
    }
    return result
  }
  /** Resolve historical snapshots from their own saved account references, never from newer Source settings. */
  async resolveAccounts(snapshot: EnvironmentSnapshot): Promise<EnvironmentAccounts> {
    const known = this.knownAccounts(snapshot)
    if (known) return known
    const result: EnvironmentAccounts = {}
    if (snapshot.github) {
      const deployment = await this.resolveSource('github', snapshot.github)
      result.github = { repository: deployment.repository, account: deployment.github }
    }
    if (snapshot.feishu) result.feishu = (await this.resolveSource('feishu', snapshot.feishu)).feishu!
    return result
  }
  private probe() {
    const { context, machine, lifetime } = this.host
    return workerProbe(context.superagentNativeSubprocess, machine.stateDir, machine.stateDir, lifetime)
  }
  private async resolveSource(kind: 'github' | 'feishu', config: unknown): Promise<Deployment> {
    if (kind === 'github') return resolveDeployment(this.host.machine, config, this.probe(), this.path)
    const feishu = await resolveFeishuBot(this.host.machine, config, this.probe(), this.path)
    if (!feishu) throw new SetupError('feishuNoApp')
    return { ...this.empty(), feishu }
  }
}
