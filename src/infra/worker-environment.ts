/** Host subprocess decorator: immutable Worker overlays follow asynchronous execution, never process.env. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import s from '@deepseek-ai/schemastery'
import { SubprocessRuntime, scrubbedParentEnv, type SubprocessHandle, type SubprocessSpawnSpec,
  type SubprocessTerminalEnvironment, type SubprocessTerminalHandle, type SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>
export interface PreparedWorkerEnvironment { prepare: string; env: WorkerEnvironment }
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The unmodified local provider captured inside the bundle's private subprocess realm. */
    superagentNativeSubprocess: SubprocessRuntime
    /** Host-wide execution scope, also reached by tools whose closures retain a shared preset context. */
    workerEnvironmentScope: WorkerEnvironmentScope
  }
}

/**
 * Carries one immutable environment through a tool's asynchronous lifetime, including background starters.
 * Exact-Agent bindings cover other attributed host operations; disposal revokes future attributed spawns without killing unrelated processes.
 */
export class WorkerEnvironmentScope extends Service {
  private readonly storage = new AsyncLocalStorage<{ env: WorkerEnvironment; binding?: { active: boolean } }>()
  private readonly bindings = new WeakMap<Agent, { active: boolean; env: WorkerEnvironment }>()
  private readonly released = new WeakSet<Agent>()
  private closed = false
  constructor(ctx: Context) {
    super(ctx, 'workerEnvironmentScope')
    ctx.effect(() => () => { this.closed = true; this.storage.disable() })
  }
  /** Establish one Agent's non-tool default; the returned disposer also revokes detached callbacks retaining its exact binding. */
  bind(agent: Agent, env: WorkerEnvironment): () => void {
    this.assertOpen()
    const previous = this.bindings.get(agent)
    if (previous) previous.active = false
    const binding = { active: true, env: Object.freeze({ ...env }) }
    this.bindings.set(agent, binding); this.released.delete(agent)
    return () => {
      binding.active = false
      if (this.bindings.get(agent) !== binding) return
      this.bindings.delete(agent); this.released.add(agent)
    }
  }
  /** Preserve one exact async chain; a supplied Agent's binding may be revoked after the tool returns. */
  run<T>(env: WorkerEnvironment, operation: () => T, agent?: Agent): T {
    this.assertOpen()
    const binding = agent && this.bindings.get(agent)
    if (agent && !binding?.active) throw new Error('The Worker execution environment was released')
    return this.storage.run({ env: Object.freeze({ ...env }), ...binding ? { binding } : {} }, operation)
  }
  /** Current explicit scope wins; an Agent's causal context is only an attribution fallback, never authorization. */
  current(): WorkerEnvironment | undefined {
    this.assertOpen()
    const scoped = this.storage.getStore()
    if (scoped?.binding && !scoped.binding.active) throw new Error('The Worker execution environment was released')
    if (scoped) return scoped.env
    const agent = this.ctx.agents.currentInitiator()
    if (!agent) return undefined
    if (this.released.has(agent)) throw new Error('The Worker execution environment was released')
    return this.bindings.get(agent)?.env
  }
  private assertOpen(): void { if (this.closed) throw new Error('The Worker execution environment provider is stopping') }
}

/**
 * Decorates the real Host subprocess provider instead of replacing shell tools or changing global environment variables.
 * Every handle, cancellation signal, argv, cwd and stdio disposition is delegated unchanged; only the explicit environment layer changes.
 */
export class WorkerSubprocess extends SubprocessRuntime {
  private readonly handles = new Set<SubprocessHandle>()
  private readonly terminals = new Set<SubprocessTerminalHandle>()
  private readonly terminating = new WeakMap<SubprocessTerminalHandle, Promise<void>>()
  private readonly allocations = new Set<Promise<SubprocessTerminalHandle>>()
  private readonly lifetime = new AbortController()
  private closed = false
  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => () => this.shutdown())
  }
  private assertOpen(): void { if (this.closed) throw new Error('The Worker subprocess provider is stopping') }
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    this.assertOpen()
    const overlay = this.ctx.workerEnvironmentScope.current()
    return this.ctx.superagentNativeSubprocess.resolveExecutable(command,
      overlay ? Object.fromEntries(Object.entries({ ...env, ...overlay }).filter((entry): entry is [string, string] => entry[1] !== undefined)) : env, signal)
  }
  terminalEnvironment(signal?: AbortSignal): Promise<SubprocessTerminalEnvironment> {
    this.assertOpen()
    return this.ctx.superagentNativeSubprocess.terminalEnvironment(signal)
  }
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.assertOpen()
    const overlay = this.ctx.workerEnvironmentScope.current()
    const handle = this.ctx.superagentNativeSubprocess.spawn(overlay ? { ...spec, env: { ...spec.env, ...overlay } } : spec)
    this.handles.add(handle)
    // done reports only the direct command. A background descendant is owned until the native range is actually empty.
    const observe = async () => {
      try { if (await handle.waitForExit(this.lifetime.signal)) this.handles.delete(handle) }
      catch { /* Retain the handle so shutdown still attempts termination after a provider/observability failure. */ }
    }
    void handle.done.then(observe, observe)
    return handle
  }
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    this.assertOpen()
    const overlay = this.ctx.workerEnvironmentScope.current()
    if (overlay) {
      // The terminal API has no tombstones. Never silently preserve an ambient git override that ordinary spawn removes.
      const base = scrubbedParentEnv()
      if (Object.entries(overlay).some(([name, value]) => value === undefined && name in base)) {
        throw new Error('This Harness terminal API cannot remove ambient variables required by the Worker environment; use bash instead')
      }
      const env = Object.fromEntries(Object.entries({ ...spec.env, ...overlay }).filter((entry): entry is [string, string] => entry[1] !== undefined))
      spec = { ...spec, env }
    }
    const signal = AbortSignal.any([this.lifetime.signal, ...spec.signal ? [spec.signal] : []])
    const allocation = this.ctx.superagentNativeSubprocess.spawnTerminal({ ...spec, signal })
    this.allocations.add(allocation)
    let terminal: SubprocessTerminalHandle
    try { terminal = await allocation } finally { this.allocations.delete(allocation) }
    this.terminals.add(terminal)
    if (this.closed) {
      await this.terminateTerminal(terminal)
      throw new Error('The Worker subprocess provider stopped during terminal allocation')
    }
    // A terminal's done is also a top-level exit, not whole-session quiescence. The terminate contract proves cleanup.
    return new Proxy(terminal, { get: (target, property) => {
      if (property === 'terminate') return () => this.terminateTerminal(target)
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
  private terminateTerminal(terminal: SubprocessTerminalHandle): Promise<void> {
    let stopping = this.terminating.get(terminal)
    if (!stopping) {
      stopping = Promise.resolve().then(() => terminal.terminate()).then(() => { this.terminals.delete(terminal) }, error => {
        this.terminating.delete(terminal); throw error
      })
      this.terminating.set(terminal, stopping)
    }
    return stopping
  }
  /** Stop only handles admitted through this decorator, and report if the bounded join cannot prove their exit. */
  private async shutdown(): Promise<void> {
    this.closed = true
    this.lifetime.abort()
    const signal = AbortSignal.timeout(10_000)
    const ordinary = [...this.handles].map(async handle => {
      handle.terminate()
      if (!await handle.waitForExit(signal)) throw new Error('A subprocess range did not exit during provider shutdown')
      this.handles.delete(handle)
    })
    const terminals = [...this.terminals].map(terminal => boundedShutdown(this.terminateTerminal(terminal), signal))
    const allocating = [...this.allocations].map(allocation => boundedShutdown(allocation.then(terminal => this.terminateTerminal(terminal), () => {}), signal))
    const results = await Promise.allSettled([...ordinary, ...terminals, ...allocating])
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length) throw new AggregateError(errors, 'Some subprocesses could not be joined during provider shutdown; the native provider retains their ownership')
  }
}

/** Bound APIs without their own cancellation while retaining settlement handlers and cleaning the timeout listener. */
function boundedShutdown<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { reject(new Error('Subprocess provider shutdown timed out')) }
    if (signal.aborted) { void operation.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) }).catch(() => {})
  })
}

export const name = 'dsh-superagent-worker-environment'
export const Config = s.object({ mode: s.union(['capture', 'overlay']).required() })
/** Mount twice: capture in the native provider's private realm, then overlay in the Host realm. */
export function apply(ctx: Context, config: ReturnType<typeof Config>): void {
  if (config.mode === 'capture') {
    ctx.inject(['subprocess'], child => { child.provide('superagentNativeSubprocess', child.subprocess) })
  } else {
    ctx.inject(['superagentNativeSubprocess', 'agents'], child => {
      new WorkerEnvironmentScope(child)
      new WorkerSubprocess(child)
    })
  }
}

/** Required capability check: a missing bundle provider must fail, not run a Worker in the operator's environment. */
export function workerEnvironmentScope(ctx: Context): WorkerEnvironmentScope {
  const scope = ctx.get('workerEnvironmentScope')
  if (!scope) throw new Error('The dsh-superagent scoped subprocess provider is not installed; apply the complete bundle composition')
  return scope
}

type SessionLineage = Pick<Agent, 'id' | 'session'>
/** Find a Worker's Ticket through live or cold durable parent headers, including a descendant opened directly from the Web UI. */
export async function workerTicketId(ctx: Context, agent: SessionLineage): Promise<string | undefined> {
  let id: string | undefined = agent.id
  let parent = agent.session.header?.parentSession
  const visited = new Set<string>()
  while (id !== undefined && !visited.has(id)) {
    visited.add(id)
    if (id.startsWith('worker-')) return id.slice('worker-'.length)
    if (parent === undefined) return undefined
    id = parent
    const live = ctx.agents.get(parent)
    parent = live ? live.session.header.parentSession : (await ctx.sessionPersistence.stat(parent))?.header.parentSession
  }
  return undefined
}

/** Resolve and authorize before each tool, then preserve the overlay across the original dispatch waterfall. */
export async function bindWorkerEnvironment(ctx: Context, agent: Agent, resolve: () => Promise<PreparedWorkerEnvironment>,
  authorize?: () => void): Promise<() => void> {
  const scope = workerEnvironmentScope(ctx)
  const initial = await resolve()
  return agent.ctx.effect(() => {
    const unbind = scope.bind(agent, initial.env)
    const unlisten = agent.ctx.on('tools/execute', async (_execution, next) => {
      authorize?.()
      const current = await resolve()
      // A stop may race materialization after the upstream synchronous tool guard already admitted this call.
      authorize?.()
      return scope.run(current.env, next, agent)
    })
    return () => { unlisten(); unbind() }
  })
}
