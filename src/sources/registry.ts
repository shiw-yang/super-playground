/** Registry of installed Source kinds, their configured instances, and the Engine's SourceScope implementation. */
import type { ChannelRef, OutboundMessage, ScopeResult, SourceScope, Trigger } from '../core/index.ts'
import type { Commands } from '../infra/commands.ts'
import { HealthBoard, type HealthEntry } from '../infra/health.ts'
import { AdmissionTableSchema, type Settings } from '../policy.ts'
import type { ChannelLink, ChannelLinks, SourceExecution, SourceInstance, SourceKind, TriggerContext, VariableSpec } from './kind.ts'

type StoredInstance = { kind?: string; enabled: boolean; config: Record<string, unknown>; execution?: SourceExecution }
const defaultExecution = (): SourceExecution => ({ mode: 'fixed', environmentId: 'default' })
const entryName = (kind: string, id: string, name: string): string => id === kind ? name : name === kind ? id : `${id}:${name}`

/**
 * Manages installed kinds separately from configured instance identities and implements SourceScope for the Engine.
 * Resolves instance policy, channels, context readers and health entries without crossing account or repository scopes.
 */
export class SourceRegistry implements SourceScope {
  private readonly kinds = new Map<string, SourceKind>()
  private readonly health = new Map<string, Map<string, HealthEntry>>()
  constructor(private readonly settings: () => Settings, private readonly board: Pick<HealthBoard, 'claim'> = new HealthBoard(),
    private readonly registered: (kind: SourceKind) => () => void = () => () => {}) {}

  /** Registers one adapter kind and claims separate health entries for each configured instance. */
  register<C extends Record<string, unknown>>(kind: SourceKind<C>): () => void {
    if (this.kinds.has(kind.kind)) throw new Error(`Source kind already registered: ${kind.kind}`)
    const synced = kind.health.find(name => name.startsWith('sync:'))
    if (synced) throw new Error(`Source kind ${kind.kind} declares the health entry ${synced}, which another part reports`)
    const descriptor = kind as unknown as SourceKind
    const entries = new Map<string, HealthEntry>()
    const release = () => { for (const entry of entries.values()) entry.release(); this.health.delete(kind.kind) }
    this.kinds.set(kind.kind, descriptor)
    this.health.set(kind.kind, entries)
    let unregistered: () => void
    try {
      for (const instance of this.instances().filter(instance => instance.kind === kind.kind)) this.claimHealth(descriptor, instance.id)
      unregistered = this.registered(descriptor)
    } catch (error) { this.kinds.delete(kind.kind); release(); throw error }
    return () => { this.kinds.delete(kind.kind); release(); unregistered() }
  }
  /** Names on the shared board, including the instance namespace, in the kind's declaration order. */
  healthNames(id: string): string[] {
    const kind = this.kind(id)
    return kind?.health.map(name => entryName(kind.kind, id, name)) ?? []
  }
  /** Entries are returned under declared names; references from an old registration remain inert after disposal. */
  healthEntries(names: readonly string[], id?: string): Map<string, HealthEntry> {
    if (id !== undefined) {
      const kind = this.kind(id)
      if (!kind) return new Map()
      this.claimHealth(kind, id)
      const entries = this.health.get(kind.kind)
      return new Map(names.flatMap(name => {
        const entry = entries?.get(entryName(kind.kind, id, name))
        return entry ? [[name, entry] as const] : []
      }))
    }
    return new Map(names.flatMap(name => {
      const entry = [...this.health.values()].map(entries => entries.get(name)).find(Boolean)
      return entry ? [[name, entry] as const] : []
    }))
  }
  private claimHealth(kind: SourceKind, id: string): void {
    const entries = this.health.get(kind.kind)!
    for (const declared of kind.health) {
      const name = entryName(kind.kind, id, declared)
      if (entries.has(name)) continue
      try { entries.set(name, this.board.claim(name, { state: 'starting', detail: '' })) }
      catch { throw new Error(`Source kind ${kind.kind} declares the health entry ${name}, which another part reports`) }
    }
  }
  /** Looks up an instance's adapter, also accepting a kind name for creating a new instance. */
  kind(id: string, settings = this.settings()): SourceKind | undefined { return this.kinds.get(settings.sources[id]?.kind ?? id) }
  allKinds(): SourceKind[] { return [...this.kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind)) }
  /** A kind with no stored instances retains its legacy default; named instances do not create an extra listening account. */
  instances(settings = this.settings()): (SourceInstance & { installed: boolean })[] {
    const records = new Map<string, StoredInstance | undefined>(Object.entries(settings.sources))
    for (const kind of this.kinds.values()) {
      if (!records.has(kind.kind) && ![...records].some(([id, stored]) => (stored?.kind ?? id) === kind.kind)) records.set(kind.kind, undefined)
    }
    const instances = [...records].map(([id, stored]) => {
      const kind = this.kinds.get(stored?.kind ?? id)
      return kind ? { ...this.resolve(id, kind, stored), installed: true }
        : { id, kind: stored?.kind ?? id, enabled: stored?.enabled ?? false, config: stored?.config ?? {},
          execution: stored?.execution ?? defaultExecution(), installed: false }
    })
    return instances.sort((a, b) => Number(b.installed) - Number(a.installed) || a.id.localeCompare(b.id))
  }
  instance<C extends Record<string, unknown>>(id: string, settings = this.settings()): SourceInstance<C> | undefined {
    return this.instances(settings).find(instance => instance.id === id && instance.installed) as SourceInstance<C> | undefined
  }
  validate(id: string, value: { kind?: string; enabled: boolean; config: unknown; execution?: SourceExecution }): StoredInstance {
    const stored = this.settings().sources[id]
    const kindId = value.kind ?? stored?.kind
    const kind = this.kinds.get(kindId ?? id)
    if (!kind) throw new Error(`Source kind not installed: ${kindId ?? id}`)
    const execution = value.execution ?? stored?.execution
    return { ...kindId !== undefined ? { kind: kindId } : {}, enabled: value.enabled, config: kind.schema.parse(value.config),
      ...execution !== undefined ? { execution } : {} }
  }
  /** Policy parts are keyed by instance identity; an unloaded adapter's part remains stored for its return. */
  validatePolicy(parts: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown> & { allowed: { id: string; name?: string }[] }> {
    return Object.fromEntries(Object.entries(parts).map(([id, part]) => {
      const policy = this.kind(id)?.policy
      const { admission, ...rest } = part
      return [id, policy ? { ...policy.schema.parse(rest), admission: AdmissionTableSchema.parse(admission ?? {}) } : part as Record<string, unknown> & { allowed: { id: string; name?: string }[] }]
    }))
  }
  policyPart(id: string, settings = this.settings()) {
    const policy = this.kind(id, settings)?.policy
    if (!policy) return undefined
    const { admission, ...rest } = settings.policy.sources[id] ?? {}
    const parsed = policy.schema.safeParse(rest)
    return { ...parsed.success ? parsed.data : policy.schema.parse({}), admission: AdmissionTableSchema.safeParse(admission ?? {}).data ?? {} }
  }
  channelAllowed(channel: { source: string; address: Record<string, string> }, settings = this.settings()): boolean {
    const kind = this.kind(channel.source, settings)
    const instance = this.instance(channel.source, settings)
    return !!kind && !!instance?.enabled && (kind.channel?.allowed?.(channel.address, instance.config) ?? true)
  }
  /** Declarations belong to kinds; execution chooses the values of one bound instance of each kind. */
  declarations(): { kind: string; variables: readonly VariableSpec[] }[] {
    return this.allKinds().flatMap(kind => kind.environment ? [{ kind: kind.kind, variables: kind.environment.variables }] : [])
  }
  environments(settings = this.settings()) {
    return this.instances(settings).flatMap(instance => {
      const kind = this.kinds.get(instance.kind)
      return kind?.environment && instance.enabled ? [{ id: instance.id, kind, environment: kind.environment, config: instance.config }] : []
    })
  }
  /** The caller supplies Commands scoped to the destination instance, never a process-global account. */
  async send(message: OutboundMessage, commands: Commands): Promise<'sent' | 'gone' | 'waiting'> {
    const kind = this.kind(message.channel.source)
    if (!kind) return 'waiting'
    return kind.channel ? kind.channel.send({ commands }, message) : 'gone'
  }
  link(channel: ChannelRef, links: ChannelLinks): ChannelLink {
    const instance = this.instance(channel.source)
    const repository = instance?.config.repository
    const scoped = typeof repository === 'string' && repository ? { ...links, repository } : links
    const link = this.kind(channel.source)?.channel?.link(channel.address, scoped)
    return link ?? { url: '', label: { zh: channel.source, en: channel.source } }
  }
  find(query: string): { threads: string[]; terms: string[] } {
    const found = this.instances().flatMap(instance => {
      const kind = this.kinds.get(instance.kind)
      return kind?.find ? [kind.find(query, instance)] : []
    })
    return { threads: [...new Set(found.flatMap(item => item.threads))], terms: [...new Set(found.flatMap(item => item.terms))] }
  }
  repliesTo(trigger: Trigger): string | undefined { return this.kind(trigger.source)?.repliesTo?.(trigger) }
  threadContext(trigger: Trigger, settings = this.settings()): TriggerContext | undefined {
    const kind = this.kind(trigger.source, settings)
    const context = kind?.threadContext
    const instance = this.instance(trigger.source, settings)
    if (!kind || !context || !instance) return undefined
    const { config } = instance
    return {
      messageId: context.messageId(trigger),
      read: (commands, part, cursor) => context.read(commands, trigger, part, cursor, config),
      images: text => context.images?.(text) ?? [],
      image: async (agent, commands, message, key, stateDir, signal) => {
        if (!context.image) throw new Error(`The ${kind.kind} Source has no images`)
        return context.image(agent, commands, trigger, message, key, stateDir, signal)
      },
    }
  }
  scope(input: { source: string; meta: Record<string, unknown> }, settings = this.settings()): ScopeResult {
    const kind = this.kind(input.source, settings)
    const stored = settings.sources[input.source]
    if (!kind) return stored ? { listened: false, reason: 'source_not_installed' } : { listened: true, observed: false }
    const instance = this.instance(input.source, settings)
    if (!instance?.enabled) return { listened: false, reason: 'source_disabled' }
    return kind.scope ? kind.scope({ meta: input.meta }, instance.config) : { listened: true, observed: false }
  }
  private resolve(id: string, kind: SourceKind, stored: StoredInstance | undefined): SourceInstance {
    const parsed = kind.schema.safeParse(stored?.config ?? {})
    return { id, kind: kind.kind, enabled: parsed.success && (stored?.enabled ?? true), config: parsed.success ? parsed.data : kind.schema.parse({}),
      execution: stored?.execution ?? defaultExecution() }
  }
}
