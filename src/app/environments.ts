/** Named local execution environments: bounded discovery, validated Ticket binding, and immutable execution snapshots. */
import { join } from 'node:path'
import { key, UserError, type AssessmentOutcome, type EnvironmentBinding, type Execution, type Ticket, type Trigger } from '../core/index.ts'
import { GithubAccountsSchema, FeishuBotSchema, type Deployment, type FeishuBot, type Machine } from '../deployment.ts'
import { ticketExecution } from '../executor/dsh.ts'
import { KV } from '../kv.ts'
import { EnvironmentConfigSchema, type EnvironmentConfig, type ExecutionSelection, type Settings } from '../policy.ts'
import type { Store } from './store.ts'

/** Configuration captured at acceptance; account resolution is kept separately and never consults newer settings. */
export interface EnvironmentSnapshot {
  id: string
  revision: string
  directory: string
  config: EnvironmentConfig
  github?: { sourceId: string; repository: string; cli: string }
  feishu?: { sourceId: string; cli: string }
}
/** Resolved identities for a snapshot, not credentials; written once after the configured CLIs pass setup. */
export interface EnvironmentAccounts {
  github?: { repository: string; account: Deployment['github'] }
  feishu?: FeishuBot
}
/** Compare concrete execution identities, not display labels or credentials. CLI resolution itself is pinned too. */
function sameAccounts(before: EnvironmentAccounts, after: EnvironmentAccounts): boolean {
  const identity = (value: EnvironmentAccounts) => ({
    github: value.github ? [value.github.repository.toLowerCase(), value.github.account.cli, value.github.account.login.toLowerCase(),
      value.github.account.noreply.toLowerCase()] : null,
    feishu: value.feishu ? [value.feishu.cli, value.feishu.appId, value.feishu.brand, value.feishu.botId] : null,
  })
  return JSON.stringify(identity(before)) === JSON.stringify(identity(after))
}
/** Local executor input. Its state directory is private to the immutable environment revision. */
export interface ResolvedEnvironment {
  id: string
  revision: string
  title: string
  description: string
  directory: string
  prepare: string
  blockedCommands: string[]
  deployment: Deployment
  variables: Record<string, string | undefined>
}
/** A Source's missing legacy selection is explicitly the default environment, never an arbitrary available environment. */
export const selectionOf = (settings: Settings, sourceId: string): ExecutionSelection =>
  settings.sources[sourceId]?.execution ?? { mode: 'fixed', environmentId: 'default' }
/** Stable default roots preserve the legacy default directory and keep other environments separate. */
export const environmentRoot = (config: Pick<EnvironmentConfig, 'directory'>, stateDir: string, id: string): string =>
  config.directory || (id === 'default' ? join(stateDir, 'work') : join(stateDir, 'work', id))

/** Capture only execution-related Source fields; polling, membership and listening changes do not change the target. */
export function snapshotOf(settings: Settings, id: string, stateDir: string): EnvironmentSnapshot {
  const config = settings.environments[id]
  if (!config) throw new UserError('unknownEnvironment', { environment: id })
  const source = (sourceId: string, kind: string) => {
    const stored = settings.sources[sourceId]
    if ((stored?.kind ?? sourceId) !== kind) throw new UserError('sourceReference', { environment: id, source: sourceId, kind })
    return stored?.config ?? {}
  }
  const github = config.githubSource === null ? undefined : {
    sourceId: config.githubSource, ...GithubAccountsSchema.parse(source(config.githubSource, 'github')),
  }
  const feishu = config.feishuSource === null ? undefined : {
    sourceId: config.feishuSource, ...FeishuBotSchema.parse(source(config.feishuSource, 'feishu')),
  }
  const value = { id, config: EnvironmentConfigSchema.parse(config), directory: environmentRoot(config, stateDir, id),
    ...github ? { github } : {}, ...feishu ? { feishu } : {} }
  return { ...value, revision: key('execution-environment-v1', JSON.stringify(value)) }
}
/** The integration identities recorded on the Ticket for source-owned result and PR association. */
export function snapshotSources(snapshot: EnvironmentSnapshot): Record<string, string> {
  return { ...snapshot.github ? { github: snapshot.github.sourceId } : {}, ...snapshot.feishu ? { feishu: snapshot.feishu.sourceId } : {} }
}
/** Persist an immutable snapshot once; callers use this inside their own domain or migration transaction. */
export function keepSnapshot(store: Pick<Store, 'get' | 'set'>, snapshot: EnvironmentSnapshot): void {
  const name = KV.execution.snapshot(snapshot.id, snapshot.revision)
  const before = store.get(name)
  if (before && JSON.stringify(before) !== JSON.stringify(snapshot)) throw new Error('Execution snapshot identity collision')
  if (!before) store.set(name, snapshot)
}

export interface EnvironmentsHost {
  readonly store: Pick<Store, 'settings' | 'get' | 'set' | 'triggers'>
  readonly machine: Machine
  /** Current setup identities, only when they match these captured connection settings. No I/O. */
  knownAccounts(snapshot: EnvironmentSnapshot): EnvironmentAccounts | undefined
  /** Resolve the captured connections, not the current Source settings. Used for migrated legacy snapshots. */
  resolveAccounts(snapshot: EnvironmentSnapshot): Promise<EnvironmentAccounts>
}
/**
 * Resolves Source selection rules behind one interface and binds a Ticket before its launch effect is queued.
 * Keeps snapshot and account records outside the domain; retries read those records rather than re-selecting a target.
 * Runtime uses this module for Router candidates, Executor bindings and local subprocess configuration.
 */
export class Environments {
  private readonly resolving = new Map<string, Promise<EnvironmentAccounts>>()
  /** Historical references not checked by current Source setup are verified once per Runtime before use. */
  private readonly verified = new Set<string>()
  constructor(private readonly host: EnvironmentsHost) {}

  /** Bounded model-facing choices contain purpose and repository, never commands, credential paths or secret values. */
  candidates(trigger: Trigger) {
    const settings = this.host.store.settings(), selection = selectionOf(settings, trigger.source)
    const ids = selection.mode === 'fixed' ? [selection.environmentId] : selection.allowedEnvironmentIds
    const snapshots = ids.map(id => {
      try { return { id, snapshot: snapshotOf(settings, id, this.host.machine.stateDir) } }
      catch (error) { return { id, error: error instanceof Error ? error.message : String(error) } }
    })
    const revision = key('execution-routing-v1', trigger.source, JSON.stringify(selection),
      JSON.stringify(snapshots.map(item => [item.id, item.snapshot?.revision ?? item.error])))
    const candidates = snapshots.map(({ id, snapshot, error }) => {
      const config = settings.environments[id]
      const compatible = !!snapshot && this.compatible(trigger, snapshot)
      const accounts = snapshot && this.host.knownAccounts(snapshot)
      const saved = snapshot && this.host.store.get(KV.execution.accounts(id, snapshot.revision))
      const changed = !!(accounts && saved && !sameAccounts(saved, accounts))
      const available = !!config?.enabled && compatible && !!accounts && !changed
      return { id, title: config?.title ?? id, description: config?.description.slice(0, 240) ?? '',
        ...(config?.description.length ?? 0) > 240 ? { description_chars: config!.description.length, read: `settings/environment:${id}` } : {},
        ...snapshot?.github ? { repository: snapshot.github.repository } : {}, available,
        ...available ? {} : { reason: error ?? (!config?.enabled ? 'disabled' : !compatible ? 'repository_mismatch' : changed ? 'account_changed' : 'setup_required') } }
    })
    return { mode: selection.mode, revision, ...selection.mode === 'fixed' ? { environment_id: selection.environmentId } : {}, candidates }
  }

  /** Resolve a repository for assessment reads without binding, provisioning or expanding the Source's candidates. */
  repositorySource(trigger: Trigger, requested?: string): string {
    const settings = this.host.store.settings(), selection = selectionOf(settings, trigger.source)
    const id = selection.mode === 'fixed' ? selection.environmentId : requested
    if (!id) throw new UserError('environmentRequired', { source: trigger.source })
    if (selection.mode === 'fixed' && requested !== undefined && requested !== id
      || selection.mode === 'router' && !selection.allowedEnvironmentIds.includes(id)) throw new UserError('environmentNotAllowed', {
      environment: requested ?? id, source: trigger.source,
    })
    const candidate = this.candidates(trigger).candidates.find(candidate => candidate.id === id)
    if (!candidate?.available) throw new UserError('environmentUnavailable', { environment: id, reason: candidate?.reason ?? 'not configured' })
    const snapshot = snapshotOf(settings, id, this.host.machine.stateDir)
    if (!snapshot.github) throw new UserError('githubSourceUnavailable', { source: 'none' })
    return snapshot.github.sourceId
  }

  /** Validate selection and record its snapshot; the Engine is the sole writer of the returned Ticket execution value. */
  bind(ticket: Ticket, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>): Execution {
    const { store, machine } = this.host
    const trigger = store.triggers.get(ticket.origin.triggerId)
    if (!trigger) throw new UserError('unknownTrigger')
    const settings = store.settings(), selection = selectionOf(settings, trigger.source), choices = this.candidates(trigger)
    const id = selection.mode === 'fixed' ? selection.environmentId : outcome.environmentId
    if (!id || selection.mode === 'router' && !outcome.executionRevision) throw new UserError('environmentRequired', { source: trigger.source })
    if (outcome.executionRevision !== undefined && outcome.executionRevision !== choices.revision) throw new UserError('environmentSelectionStale')
    if (selection.mode === 'fixed' && outcome.environmentId !== undefined && outcome.environmentId !== id
      || selection.mode === 'router' && !selection.allowedEnvironmentIds.includes(id)) {
      throw new UserError('environmentNotAllowed', { environment: outcome.environmentId ?? id, source: trigger.source })
    }
    const snapshot = snapshotOf(settings, id, machine.stateDir)
    if (!snapshot.config.enabled) throw new UserError('environmentDisabled', { environment: id })
    if (!this.compatible(trigger, snapshot)) throw new UserError('environmentRepository', { environment: id })
    const accounts = this.host.knownAccounts(snapshot)
    if (!accounts) throw new UserError('environmentUnavailable', { environment: id, reason: 'The configured accounts have not passed setup' })
    this.checkAccounts(snapshot, accounts)
    keepSnapshot(store, snapshot)
    const accountKey = KV.execution.accounts(id, snapshot.revision)
    if (!store.get(accountKey)) store.set(accountKey, accounts)
    const environment: EnvironmentBinding = { id, revision: snapshot.revision, sources: snapshotSources(snapshot),
      selectedBy: selection.mode, sourceId: trigger.source, routingRevision: choices.revision,
      ...outcome.environmentReason ? { reason: outcome.environmentReason } : {} }
    const execution = ticketExecution(ticket, outcome, settings, snapshot.directory)
    return { ...execution, directory: join(snapshot.directory, execution.name), environment }
  }

  /** Read the bound snapshot without checking enabled state, so ended Tickets and audit views remain readable. */
  snapshot(ticket: Ticket): EnvironmentSnapshot {
    const binding = ticket.execution?.environment
    const snapshot = binding && this.host.store.get(KV.execution.snapshot(binding.id, binding.revision))
    if (!binding || !snapshot) throw new UserError('environmentSnapshotMissing', { environment: binding?.id ?? 'legacy' })
    return snapshot
  }
  /** Explicit disable blocks execution; routing edits alone never move or revoke an already-bound Ticket. */
  assertEnabled(ticket: Ticket): void {
    const snapshot = this.snapshot(ticket)
    if (!this.host.store.settings().environments[snapshot.id]?.enabled) throw new UserError('environmentDisabled', { environment: snapshot.id })
  }
  /** Construct only this snapshot's local integration context; absent integrations have no ambient account fallback. */
  deployment(ticket: Ticket): Deployment {
    const snapshot = this.snapshot(ticket), accounts = this.host.store.get(KV.execution.accounts(snapshot.id, snapshot.revision))
    return { ...this.host.machine, stateDir: join(this.host.machine.stateDir, 'environments', snapshot.id, snapshot.revision),
      repository: accounts?.github?.repository ?? snapshot.github?.repository ?? '',
      github: accounts?.github?.account ?? { cli: snapshot.github?.cli ?? '', login: '', noreply: '' },
      ...accounts?.feishu ? { feishu: accounts.feishu } : {} }
  }
  /** Resolve legacy identities once, preserving the captured Source configuration across restarts and later settings edits. */
  async resolve(ticket: Ticket, variables: Record<string, string | undefined> = {}): Promise<ResolvedEnvironment> {
    this.assertEnabled(ticket)
    const snapshot = this.snapshot(ticket), accountKey = KV.execution.accounts(snapshot.id, snapshot.revision)
    const known = this.host.knownAccounts(snapshot)
    if (known) {
      this.checkAccounts(snapshot, known)
      if (!this.host.store.get(accountKey)) this.host.store.set(accountKey, known)
    } else if (!this.verified.has(accountKey)) {
      let pending = this.resolving.get(accountKey)
      if (!pending) {
        pending = this.host.resolveAccounts(snapshot).then(accounts => {
          this.checkAccounts(snapshot, accounts)
          if (!this.host.store.get(accountKey)) this.host.store.set(accountKey, accounts)
          this.verified.add(accountKey)
          return accounts
        }).finally(() => { this.resolving.delete(accountKey) })
        this.resolving.set(accountKey, pending)
      }
      await pending
    }
    this.assertEnabled(ticket)
    const { title, description, prepare, blockedCommands } = snapshot.config
    return { id: snapshot.id, revision: snapshot.revision, title, description, directory: snapshot.directory,
      prepare, blockedCommands, deployment: this.deployment(ticket), variables }
  }
  private checkAccounts(snapshot: EnvironmentSnapshot, resolved: EnvironmentAccounts): void {
    const saved = this.host.store.get(KV.execution.accounts(snapshot.id, snapshot.revision))
    if (saved && !sameAccounts(saved, resolved)) throw new UserError('environmentAccountChanged', { environment: snapshot.id })
  }
  private compatible(trigger: Trigger, snapshot: EnvironmentSnapshot): boolean {
    const settings = this.host.store.settings(), instance = settings.sources[trigger.source]
    if ((instance?.kind ?? trigger.source) !== 'github') return true
    const target = this.host.knownAccounts(snapshot)?.github?.repository ?? snapshot.github?.repository ?? ''
    const repository = typeof trigger.meta.repository === 'string' ? trigger.meta.repository
      : snapshot.github?.sourceId === trigger.source ? target : String(instance?.config.repository ?? '')
    return !!snapshot.github && (!repository || repository.toLowerCase() === target.toLowerCase())
  }
}
