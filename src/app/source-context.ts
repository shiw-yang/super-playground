/** Scoped runtime context exposed to each Source kind, isolating Sources from direct Store or Engine access. */
import type { EngineForSources, ReceiveResult, Trigger } from '../core/index.ts'
import { SETUP_FIELDS, type Deployment } from '../deployment.ts'
import type { Commands } from '../infra/commands.ts'
import type { SetupProblem } from '../setup.ts'
import type { SourceContext } from '../sources/host.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import { KV, type Key } from '../kv.ts'
import type { Outbox } from './outbox.ts'
import type { Store } from './store.ts'

export interface SourceContextDeps {
  readonly store: Pick<Store, 'atomic' | 'get' | 'set' | 'delete' | 'keys' | 'threads' | 'tickets' | 'triggers' | 'read'>
  readonly outbox: Pick<Outbox, 'send'>
  readonly engine: Pick<EngineForSources, 'bindThread' | 'threadClosed'>
  readonly sources: SourceRegistry
  commandsFor(sourceId: string): Commands
  deploymentFor(sourceId: string): Deployment
  readonly ready: Promise<void>
  /** Runtime shutdown cancels this context even when its connection settings still match. */
  readonly lifetime?: AbortSignal
  /** Frozen Worker contexts supply their immutable snapshot revision instead of a live Source signature. */
  generation?(): string
  configured(sourceId?: string): boolean
  problemFor(sourceId: string): SetupProblem | undefined
  /** Hands a Trigger to the Engine and schedules the pass that assesses it. */
  receive(trigger: Trigger): ReceiveResult | Promise<ReceiveResult>
}

/**
 * Builds one Source generation. Connection changes and shutdown cancel intake and all writes, including late responses.
 * Polling/listening settings stay live within a generation; health reports also become no-ops after unregistration.
 */
export function sourceContextOf(deps: SourceContextDeps, kind: { kind: string; health: readonly string[] }, id = kind.kind): SourceContext {
  const { store } = deps
  const health = deps.sources.healthEntries(kind.health, id)
  const currentGeneration = deps.generation ?? (() => {
    const instance = deps.sources.instance(id)
    return instance && JSON.stringify([instance.kind, ...(SETUP_FIELDS[instance.kind] ?? []).map(field => instance.config[field] ?? '')])
  })
  const generation = currentGeneration()
  let stale = generation === undefined
  const active = (): boolean => {
    stale ||= !!deps.lifetime?.aborted || generation !== currentGeneration()
    return !stale
  }
  const assertActive = (): void => {
    if (!active()) throw new DOMException(`Source ${id} stopped or its connection configuration changed`, 'AbortError')
  }
  const namespace = id === kind.kind ? '' : KV.sources.state(id, '')
  const scoped = <V>(name: Key<V>): Key<V> => (namespace && !name.startsWith(KV.sources.labels.prefix) ? KV.sources.state(id, name) : name) as Key<V>
  return {
    id, kind: kind.kind,
    get deployment() { return deps.deploymentFor(id) },
    commands: deps.commandsFor(id),
    ready: deps.ready,
    configured: () => active() && deps.configured(id),
    get problem() { return deps.problemFor(id) },
    config: <C extends Record<string, unknown>>(sourceId = id) => {
      if (!active()) return undefined
      const instance = deps.sources.instance<C>(sourceId)
      return instance?.enabled ? instance.config : undefined
    },
    receive: trigger => {
      assertActive()
      if (trigger.source !== id) throw new Error(`Source ${id} cannot ingest an event for ${trigger.source}`)
      return deps.receive(trigger)
    },
    atomic: work => { assertActive(); return store.atomic(work) },
    state: {
      get: name => store.get(scoped(name)),
      set: (name, value) => { assertActive(); const target = scoped(name); if (value === undefined) store.delete(target); else store.set(target, value) },
      keys: family => namespace && !family.prefix.startsWith(KV.sources.labels.prefix)
        ? store.keys(`${namespace}${family.prefix}`).map(name => name.slice(namespace.length)) : store.keys(family),
    },
    threads: {
      get: key => store.threads.get(key),
      subscribed: source => store.read.subscribedThreads(source),
      describe: (key, description) => { assertActive(); store.threads.describe(key, description) },
      patch: (key, meta) => { assertActive(); store.threads.patchMeta(key, meta) },
    },
    tickets: {
      get: id => store.tickets.get(id),
      open: () => store.tickets.open(),
      bindThread: (id, thread, own) => { assertActive(); deps.engine.bindThread(id, thread, own) },
      threadClosed: (thread, outcome, at) => { assertActive(); deps.engine.threadClosed(thread, outcome, at) },
    },
    triggers: { get: id => store.triggers.get(id), latest: thread => store.read.threadTriggers(thread, 1)[0] },
    notify: message => { assertActive(); deps.outbox.send(message) },
    report: (entry, value) => {
      if (!kind.health.includes(entry)) throw new Error(`The ${kind.kind} Source has no health entry ${entry}`)
      if (active()) health.get(entry)?.set(value)
    },
  }
}
