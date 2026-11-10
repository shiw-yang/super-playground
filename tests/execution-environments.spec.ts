/** Real Cordis composition and fake local provider contracts for per-Worker subprocess execution. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec, SubprocessTerminalSpawnSpec, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/infra/worker-environment.ts'
import { bindWorkerEnvironment, workerEnvironmentScope, workerTicketId } from '../src/infra/worker-environment.ts'
import { DshExecutor, type ExecutorHost } from '../src/executor/dsh.ts'
import { Sessions, type SessionsHost } from '../src/app/sessions.ts'
import { KV } from '../src/kv.ts'
import type { Ticket } from '../src/core/index.ts'
import { SettingsSchema } from '../src/policy.ts'
import { deferred, waitUntil } from './fixtures/async.ts'

const disposers: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); vi.unstubAllEnvs() })
const request = (env?: Record<string, string | undefined>): SubprocessSpawnSpec => ({ argv: ['sh', '-c', 'probe'], cwd: '/workspace',
  graceMs: 1000, stdio: { stdin: 'ignore', stdout: { maxBytes: 100 }, stderr: { maxBytes: 100 } }, ...env ? { env } : {} })
const output = (text = '', exitCode = 0): SubprocessHandle => ({ stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
  collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } },
  done: Promise.resolve({ exitCode, signal: null }), terminate: vi.fn(), waitForExit: async () => true })

/** A consumer shared by several preset Agents: like the shipped Bash plugin, its closure retains this context. */
class SharedShell extends Service {
  constructor(ctx: Context) { super(ctx, 'sharedShell') }
  execute(spec: SubprocessSpawnSpec) { return this.ctx.subprocess.spawn(spec) }
}
async function mounted() {
  const ctx = new Context(), nativeCtx = ctx.isolate('subprocess'), initiator = new AsyncLocalStorage<Agent>()
  const live = new Map<SessionId, Agent>()
  ctx.provide('agents', { currentInitiator: () => initiator.getStore(), get: (id: SessionId) => live.get(id) } as never)
  const native = { spawn: vi.fn((_spec: SubprocessSpawnSpec) => output()),
    resolveExecutable: vi.fn(async (command: string, _env?: Readonly<Record<string, string>>) => command),
    terminalEnvironment: vi.fn(async () => ({ platform: 'posix' as const, defaultShell: '/bin/sh' })),
    spawnTerminal: vi.fn(async (_spec: SubprocessTerminalSpawnSpec) => ({ marker: 'terminal', done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: vi.fn(async () => {}) }) as unknown as SubprocessTerminalHandle) }
  nativeCtx.provide('subprocess', native as unknown as SubprocessRuntime)
  await nativeCtx.plugin(plugin, { mode: 'capture' })
  const overlay = await ctx.plugin(plugin, { mode: 'overlay' })
  await waitUntil(() => !!ctx.get('workerEnvironmentScope') && !!ctx.get('subprocess'))
  new SharedShell(ctx)
  const shell = ctx.get('sharedShell') as SharedShell
  // This closure was registered once, before any of the agents below existed.
  const presetTool = (spec = request()) => shell.execute(spec)
  const agent = (id: string, parentSession?: string) => {
    const value = { id: id as SessionId, session: { header: { parentSession: parentSession as SessionId | undefined }, snapshotEvents: () => [] } } as unknown as Agent
    const scoped = createScope(ctx, value)
    Object.assign(value, { ctx: scoped.ctx })
    live.set(value.id, value)
    disposers.push(async () => { live.delete(value.id); await scoped.dispose() })
    return value
  }
  disposers.push(() => ctx.fiber.dispose())
  return { ctx, nativeCtx, native, initiator, agent, live, presetTool, overlay }
}
const toolCall = <T>(ctx: Context, agent: Agent, next: () => Promise<T>) =>
  ctx.waterfall(scopeTarget({}, agent) as never, 'tools/execute', { agent } as never, next as never) as Promise<T>

describe('Host subprocess decorator', () => {
  it('reaches a shared preset consumer and isolates overlapping calls and their asynchronous descendants', async () => {
    const h = await mounted(), a = h.agent('worker-a'), b = h.agent('worker-b')
    const originalPath = process.env.PATH, gate = deferred(), afterReturn = deferred()
    await bindWorkerEnvironment(h.ctx, a, async () => ({ prepare: '', env: { PROFILE: 'a', PATH: '/a/bin', GIT_DIR: undefined } }))
    await bindWorkerEnvironment(h.ctx, b, async () => ({ prepare: '', env: { PROFILE: 'b', PATH: '/b/bin', GIT_DIR: undefined } }))
    let background!: Promise<void>
    const first = toolCall(h.ctx, a, async () => {
      await gate.promise
      h.presetTool(request({ DSH_SESSION_ID: a.id }))
      background = afterReturn.promise.then(() => { h.presetTool() })
      return 'a'
    })
    const second = toolCall(h.ctx, b, async () => {
      h.presetTool(request({ DSH_SESSION_ID: b.id }))
      gate.resolve()
      return 'b'
    })
    expect(await Promise.all([first, second])).toEqual(['a', 'b'])
    afterReturn.resolve(); await background
    expect(h.native.spawn.mock.calls.map(([spec]) => spec.env?.PROFILE)).toEqual(['b', 'a', 'a'])
    expect(h.native.spawn.mock.calls[0]![0].env).toMatchObject({ PATH: '/b/bin', DSH_SESSION_ID: 'worker-b' })
    expect(h.native.spawn.mock.calls[1]![0].env).toHaveProperty('GIT_DIR', undefined)
    expect(process.env.PATH).toBe(originalPath)
    const unrelated = request({ EXTRA: 'untouched' }); h.presetTool(unrelated)
    expect(h.native.spawn.mock.calls.at(-1)![0]).toBe(unrelated)
  })

  it('keeps nested child calls in their owning Ticket and binds a restored Agent before its first call', async () => {
    const h = await mounted(), parent = h.agent('worker-ticket'), child = h.agent('child', parent.id), nested = h.agent('nested', child.id)
    for (const member of [parent, child, nested]) {
      expect(await workerTicketId(h.ctx, member)).toBe('ticket')
      await bindWorkerEnvironment(h.ctx, member, async () => ({ prepare: '', env: { PROFILE: 'ticket' } }))
    }
    await toolCall(h.ctx, child, async () => { h.presetTool(); return undefined })
    await toolCall(h.ctx, nested, async () => { h.presetTool(); return undefined })
    const restored = h.agent('worker-ticket')
    await bindWorkerEnvironment(h.ctx, restored, async () => ({ prepare: '', env: { PROFILE: 'ticket' } }))
    await toolCall(h.ctx, restored, async () => { h.presetTool(); return undefined })
    expect(h.native.spawn.mock.calls.map(([spec]) => spec.env?.PROFILE)).toEqual(['ticket', 'ticket', 'ticket'])
  })

  it('uses the serial Sessions creation hook for a Web UI resume and a cold nested descendant', async () => {
    const h = await mounted(), ticket = { id: 'ticket' } as Ticket
    h.ctx.provide('tools', { get: () => undefined, restrict: () => () => {}, guard: () => () => {} } as never)
    h.ctx.provide('systemPrompt', { section: () => () => {} } as never)
    h.ctx.provide('skills', { register: () => () => {} } as never)
    h.ctx.provide('sessionPersistence', { stat: async (id: string) => id === 'cold-child' ? { header: { parentSession: 'worker-ticket' } } : undefined } as never)
    const release = deferred(), environment = vi.fn(async () => { await release.promise; return { prepare: '', env: { PROFILE: 'restored' } } })
    const sessions = new Sessions({ context: h.ctx, masterId: 'router', lifetime: new AbortController().signal, closing: () => false,
      store: { tickets: { get: (id: string) => id === 'ticket' ? ticket : undefined }, get: () => undefined, keys: () => [] },
      health: { set: () => {} }, effects: { handle: () => {} }, tools: () => [], environment: () => [], workerEnvironment: environment,
      prompts: { current: () => ({ revision: 1, config: {} }), skills: () => new Map() } } as unknown as SessionsHost)
    sessions.install(); disposers.push(() => sessions.dispose())
    const restored = h.agent('worker-ticket')
    let announced = false
    const ready = h.ctx.serial(scopeTarget(restored, restored), 'agent/created', { agent: restored, source: 'resume' }).then(() => { announced = true })
    await waitUntil(() => environment.mock.calls.length === 1)
    expect(announced).toBe(false)
    release.resolve(); await ready
    await toolCall(h.ctx, restored, async () => { h.presetTool(); return undefined })
    const child = h.agent('resumed-nested', 'cold-child')
    await h.ctx.serial(scopeTarget(child, child), 'agent/created', { agent: child, source: 'resume' })
    await toolCall(h.ctx, child, async () => { h.presetTool(); return undefined })
    expect(h.native.spawn.mock.calls.map(([spec]) => spec.env?.PROFILE)).toEqual(['restored', 'restored'])
  })

  it('refuses dispatch when a Ticket ends during environment resolution but still opens its historical Session', async () => {
    const h = await mounted(), ticket = { id: 'ticket' } as Ticket
    h.ctx.provide('tools', { get: () => undefined, restrict: () => () => {}, guard: () => () => {} } as never)
    h.ctx.provide('systemPrompt', { section: () => () => {} } as never)
    h.ctx.provide('skills', { register: () => () => {} } as never)
    const environment = vi.fn(async () => ({ prepare: '', env: { PROFILE: 'ticket' } }))
    const sessions = new Sessions({ context: h.ctx, masterId: 'router', lifetime: new AbortController().signal, closing: () => false,
      store: { tickets: { get: () => ticket }, get: () => undefined, keys: () => [] }, health: { set: () => {} }, effects: { handle: () => {} },
      tools: () => [], environment: () => [], workerEnvironment: environment,
      prompts: { current: () => ({ revision: 1, config: {} }), skills: () => new Map() } } as unknown as SessionsHost)
    sessions.install(); disposers.push(() => sessions.dispose())
    const agent = h.agent('worker-ticket')
    await h.ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'resume' })
    const pending = deferred()
    environment.mockImplementationOnce(async () => { await pending.promise; return { prepare: '', env: { PROFILE: 'ticket' } } })
    const dispatch = toolCall(h.ctx, agent, async () => { h.presetTool(); return undefined })
    await waitUntil(() => environment.mock.calls.length === 2)
    ticket.ended = { at: 'now', by: 'human', outcome: 'stopped' }
    pending.resolve()
    await expect(dispatch).rejects.toMatchObject({ code: 'ticketEnded' })
    expect(h.native.spawn).not.toHaveBeenCalled()
    // Opening an ended Session decorates its read-only historical view; liveness authorization is only for tool dispatch.
    const historical = h.agent('worker-ticket')
    await expect(h.ctx.serial(scopeTarget(historical, historical), 'agent/created', { agent: historical, source: 'resume' })).resolves.toBeUndefined()
    const before = environment.mock.calls.length
    await expect(toolCall(h.ctx, historical, async () => { h.presetTool(); return undefined })).rejects.toMatchObject({ code: 'ticketEnded' })
    expect(environment.mock.calls.length).toBe(before)
    expect(h.native.spawn).not.toHaveBeenCalled()
  })

  it('reconstructs nested lineage from cold headers without loading ancestor Agents', async () => {
    const h = await mounted(), nested = h.agent('nested', 'cold-child')
    const stat = vi.fn(async (id: string) => id === 'cold-child' ? { header: { parentSession: 'worker-ticket' } } : undefined)
    h.ctx.provide('sessionPersistence', { stat } as never)
    expect(await workerTicketId(h.ctx, nested)).toBe('ticket')
    expect(h.live.size).toBe(1)
    expect(stat).toHaveBeenCalledWith('cold-child')
  })

  it('refuses new tools once resolution is disabled and removes the per-agent listener on teardown', async () => {
    const h = await mounted(), agent = h.agent('worker-ticket')
    let enabled = true
    const release = await bindWorkerEnvironment(h.ctx, agent, async () => {
      if (!enabled) throw new Error('environment disabled')
      return { prepare: '', env: { PROFILE: 'ticket' } }
    })
    enabled = false
    await expect(toolCall(h.ctx, agent, async () => { h.presetTool(); return undefined })).rejects.toThrow('environment disabled')
    expect(h.native.spawn).not.toHaveBeenCalled()
    release()
    expect(() => h.initiator.run(agent, h.presetTool)).toThrow('environment was released')
  })

  it('keeps native handles and lookup/signal options intact and refuses unsupported terminal removals', async () => {
    const h = await mounted(), scope = workerEnvironmentScope(h.ctx), signal = new AbortController().signal
    const handle = output(); h.native.spawn.mockReturnValue(handle)
    expect(scope.run({ PATH: '/worker/bin' }, () => h.ctx.subprocess.spawn(request()))).toBe(handle)
    await scope.run({ PATH: '/worker/bin' }, () => h.ctx.subprocess.resolveExecutable('gh', { EXTRA: 'keep' }, signal))
    expect(h.native.resolveExecutable).toHaveBeenLastCalledWith('gh', { PATH: '/worker/bin', EXTRA: 'keep' }, signal)
    const terminal: SubprocessTerminalSpawnSpec = { argv: ['sh'], cwd: '/workspace', rows: 24, cols: 80, terminalType: 'xterm', graceMs: 1000 }
    await h.ctx.subprocess.spawnTerminal(terminal)
    expect(h.native.spawnTerminal).toHaveBeenLastCalledWith({ ...terminal, signal: expect.any(AbortSignal) })
    vi.stubEnv('GIT_DIR', '/ambient')
    await expect(scope.run({ GIT_DIR: undefined }, () => h.ctx.subprocess.spawnTerminal(terminal))).rejects.toThrow('cannot remove ambient variables')
    expect(h.native.spawnTerminal).toHaveBeenCalledTimes(1)
  })

  it('revokes detached future spawns on unbind while leaving already-started handles to their owner', async () => {
    const h = await mounted(), agent = h.agent('worker-ticket'), later = deferred()
    const release = await bindWorkerEnvironment(h.ctx, agent, async () => ({ prepare: '', env: { PROFILE: 'ticket' } }))
    let background!: Promise<SubprocessHandle>
    await toolCall(h.ctx, agent, async () => { background = later.promise.then(() => h.presetTool()); return undefined })
    release(); later.resolve()
    await expect(background).rejects.toThrow('environment was released')
    expect(h.native.spawn).not.toHaveBeenCalled()
  })

  it('joins unfinished native ranges on provider disposal without touching direct native calls', async () => {
    const h = await mounted(), exited = deferred(), provider = h.ctx.subprocess, scope = workerEnvironmentScope(h.ctx)
    const direct = output()
    const managed = { ...output(), terminate: vi.fn(() => exited.resolve()), waitForExit: vi.fn(async () => { await exited.promise; return true }) }
    h.native.spawn.mockReturnValueOnce(direct).mockReturnValueOnce(managed)
    h.nativeCtx.subprocess.spawn(request())
    expect(h.presetTool()).toBe(managed)
    // Direct command done already resolved, but its managed range is still running.
    await Promise.resolve()
    await h.overlay.dispose()
    expect(managed.terminate).toHaveBeenCalledTimes(1)
    expect(direct.terminate).not.toHaveBeenCalled()
    expect(managed.waitForExit).toHaveBeenCalled()
    expect(() => provider.spawn(request())).toThrow('provider is stopping')
    expect(() => scope.run({ PROFILE: 'late' }, () => {})).toThrow('provider is stopping')
  })

  it('delegates terminal output and memoizes cleanup, including pending allocations during disposal', async () => {
    const h = await mounted(), terminate = vi.fn(async () => {}), terminal = { done: Promise.resolve({ exitCode: 0, signal: null }),
      output: { marker: 'output' }, terminate, write: vi.fn(async () => {}) } as unknown as SubprocessTerminalHandle
    h.native.spawnTerminal.mockResolvedValueOnce(terminal)
    const spec: SubprocessTerminalSpawnSpec = { argv: ['sh'], cwd: '/workspace', rows: 24, cols: 80, terminalType: 'xterm', graceMs: 1000 }
    const managed = await h.ctx.subprocess.spawnTerminal(spec)
    expect(managed.output).toBe(terminal.output)
    expect(managed.done).toBe(terminal.done)
    await Promise.all([managed.terminate(), managed.terminate()])
    expect(terminate).toHaveBeenCalledTimes(1)
    h.native.spawnTerminal.mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('allocation aborted')), { once: true })
    }))
    const pending = h.ctx.subprocess.spawnTerminal(spec)
    const rejected = expect(pending).rejects.toThrow('allocation aborted')
    await h.overlay.dispose(); await rejected
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(h.native.spawnTerminal.mock.calls.at(-1)![0].signal?.aborted).toBe(true)
  })

  it('fails closed if the bundle provider is absent', async () => {
    const ctx = new Context()
    expect(() => workerEnvironmentScope(ctx)).toThrow('scoped subprocess provider is not installed')
    await ctx.fiber.dispose()
  })
})

async function executorFixture() {
  const h = await mounted(), directory = mkdtempSync(join(tmpdir(), 'scoped-prepare-'))
  disposers.push(() => rmSync(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'ticket'), records = new Map<string, unknown>()
  const ticket: Ticket = { id: 'ticket', title: 'Work', decisionId: 'decision', channels: [], createdAt: 'now', updatedAt: 'now',
    origin: { triggerId: 'missing', triggerIds: [] }, assignments: [{ id: 'assignment', state: 'pending', createdAt: 'now' }],
    inputs: [], undelivered: [], mandate: { strength: 'explicit', basis: { via: 'listed' }, policyVersion: 'v1', actor: { source: 'github', id: 'alice' }, scope: 'work' },
    execution: { name: 'ticket', directory: workspace, assignment: '',
      environment: { id: 'a', revision: 'revision-a', sources: {}, sourceId: 'github', selectedBy: 'fixed', routingRevision: 'route' } } }
  const handlers = new Map<string, (payload: { ticketId: string; assignmentId: string }) => Promise<void>>()
  const workerEnvironment = vi.fn(async () => ({ prepare: 'prepare-a', env: { PROFILE: 'a', DSH_SUPERAGENT_DIR: workspace } }))
  const ensure = vi.fn(async () => ({ inbox: { remove: () => {} } })), prompt = vi.fn(async () => {})
  const report = vi.fn((_id: string, value: { state: string; summary: string }) => {
    ticket.assignments[0]!.report = { ...value, at: 'now' } as never
    return ticket
  })
  const host = { context: h.ctx, machine: { stateDir: directory }, lifetime: new AbortController().signal, closing: () => false, paused: () => false,
    store: { tickets: { get: () => ticket, open: () => [ticket] }, triggers: { get: () => undefined }, settings: () => SettingsSchema.parse({}),
      get: (key: string) => records.get(key), set: (key: string, value: unknown) => records.set(key, value), atomic: (run: () => unknown) => run() },
    effects: { handle: (kind: string, run: (payload: { ticketId: string; assignmentId: string }) => Promise<void>) => handlers.set(kind, run) },
    sessions: { ensure, prompt, holds: async () => false, relay: vi.fn() }, workerEnvironment, bindExecution: () => ticket.execution,
    engine: { report, assignmentStarted: vi.fn() }, sourceLink: async () => ({}), repliedTo: () => undefined,
  } as unknown as ExecutorHost
  new DshExecutor(host)
  return { ...h, directory, workspace, records, ticket, workerEnvironment, ensure, prompt, report,
    launch: () => handlers.get('launch')!({ ticketId: ticket.id, assignmentId: ticket.assignments[0]!.id }) }
}

describe('preparation readiness', () => {
  it('does not adopt a partial directory and retries the pinned command before recording readiness', async () => {
    const h = await executorFixture()
    mkdirSync(h.workspace); writeFileSync(join(h.workspace, 'partial'), 'preserved')
    let failed = true
    h.native.spawn.mockImplementation(spec => spec.argv[0] === 'sh' ? output('', failed ? 1 : 0) : output())
    await h.launch()
    expect(h.report).toHaveBeenCalledWith('ticket', expect.objectContaining({ state: 'failed' }))
    expect(h.ensure).not.toHaveBeenCalled()
    expect(h.records.get(KV.execution.prepared('ticket'))).toBeUndefined()
    expect(readFileSync(join(h.workspace, 'partial'), 'utf8')).toBe('preserved')
    failed = false
    await h.launch()
    expect(h.native.spawn.mock.calls.filter(([spec]) => spec.argv[0] === 'sh').map(([spec]) => spec.argv[2])).toEqual(['prepare-a', 'prepare-a'])
    expect(h.records.get(KV.execution.prepared('ticket'))).toEqual({ revision: 'revision-a', directory: h.workspace })
    expect(h.ensure).toHaveBeenCalledTimes(1)
    await h.launch()
    expect(h.native.spawn.mock.calls.filter(([spec]) => spec.argv[0] === 'sh')).toHaveLength(2)
    expect(h.native.spawn.mock.calls.every(([spec]) => spec.env?.PROFILE === 'a')).toBe(true)
  })

  it('accepts a matching legacy marker only while the directory exists and still verifies git configuration', async () => {
    const h = await executorFixture()
    mkdirSync(h.workspace)
    h.records.set(KV.execution.prepared('ticket'), { revision: 'revision-a', directory: h.workspace, legacy: true })
    await h.launch()
    expect(h.native.spawn.mock.calls.filter(([spec]) => spec.argv[0] === 'sh')).toHaveLength(0)
    expect(h.native.spawn.mock.calls.some(([spec]) => spec.argv[0] === 'git')).toBe(true)
    expect(h.records.get(KV.execution.prepared('ticket'))).toEqual({ revision: 'revision-a', directory: h.workspace })
    rmSync(h.workspace, { recursive: true })
    await h.launch()
    expect(h.native.spawn.mock.calls.filter(([spec]) => spec.argv[0] === 'sh')).toHaveLength(1)
    expect(h.records.get(KV.execution.prepared('ticket'))).not.toHaveProperty('legacy')
  })

  it('checks availability before using an existing readiness marker', async () => {
    const h = await executorFixture()
    mkdirSync(h.workspace)
    h.records.set(KV.execution.prepared('ticket'), { revision: 'revision-a', directory: h.workspace })
    h.workerEnvironment.mockRejectedValue(new Error('environment disabled'))
    await h.launch()
    expect(h.native.spawn).not.toHaveBeenCalled()
    expect(h.ensure).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledWith('ticket', expect.objectContaining({ state: 'failed', summary: expect.stringContaining('environment disabled') }))
  })
})
