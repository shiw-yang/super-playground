/** The external Watchdog loop: cron tasks, the prompt a task sends, its tools, and its Session at startup. */
import { expect, it, vi } from 'vitest'
import type { HealthEntry } from '../src/infra/health.ts'
import { KV } from '../src/kv.ts'
import { Watchdog, type WatchdogHost } from '../src/app/watchdog.ts'
import { watchdogTools } from '../src/app/tools/watchdog.ts'
import { startRuntime } from './fixtures/host.ts'
import type { WatchdogConfig } from '../src/policy.ts'

const config = (overrides: Partial<WatchdogConfig> = {}): WatchdogConfig => ({ enabled: true, model: null, tasks: [
  { id: 'patrol', schedule: '*/15 * * * *', prompt: '', enabled: true },
  { id: 'daily', schedule: '0 9 * * *', prompt: '', enabled: true },
  { id: 'weekly', schedule: '0 9 * * 1', prompt: '', enabled: true },
], ...overrides })

function fakeHost(overrides: Partial<WatchdogHost> = {}) {
  const values = new Map<string, unknown>()
  const prompt = vi.fn(async () => {})
  const busy = vi.fn(() => false)
  const health = { get: () => undefined, set: vi.fn(), release: vi.fn() } as unknown as HealthEntry
  const host = {
    sessions: { prompt, busy }, sessionId: (task: string) => `watchdog-${task}`, store: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value) },
      tickets: { open: () => [] } }, health, settings: () => config(),
    lifetime: new AbortController().signal, now: () => new Date('2026-11-11T10:00:00+08:00'), ensure: async () => {}, ...overrides,
  } as unknown as WatchdogHost
  return { host, values, prompt, busy, health }
}

it('prompts the Watchdog Session with an enabled task and records the cycle by task id', async () => {
  const { host, values, prompt, health } = fakeHost()
  const watchdog = new Watchdog(host)
  expect(await watchdog.run('patrol')).toBe('prompted')
  expect(prompt).toHaveBeenCalledWith('watchdog-patrol', expect.stringContaining('watchdog:patrol:'), expect.stringContaining('Watchdog patrol.'), 'queue')
  expect(values.get(KV.watchdog.lastRun('patrol'))).toContain('watchdog:patrol:')
  expect(health.set).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'ready', detail: expect.stringContaining('last patrol cycle') }))
  expect(await watchdog.run('nope')).toBe('unknown')
})

it('skips a cycle while the Watchdog Session still runs, and stays silent when disabled', async () => {
  const busy = fakeHost()
  busy.busy.mockReturnValue(true)
  expect(await new Watchdog(busy.host).run('daily')).toBe('busy')
  expect(busy.prompt).not.toHaveBeenCalled()
  const disabled = fakeHost({ settings: () => config({ enabled: false }) })
  expect(await new Watchdog(disabled.host).run('weekly')).toBe('disabled')
  expect(disabled.prompt).not.toHaveBeenCalled()
})

it('reports the host state and records a task report, delivering it to the main Session', async () => {
  const set = vi.fn(), notify = vi.fn()
  const tools = watchdogTools({ store: { tickets: { open: () => [] } as never, set }, effects: { pending: kind => kind === 'relay' },
    health: () => ({ runtime: { state: 'ready', detail: 'ok' } }), executorLoad: () => 2, sessions: { notify },
    now: () => new Date('2026-11-11T10:00:00+08:00') })
  const execute = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args, new AbortController().signal)
  expect(await execute('watchdog_status', {})).toMatchObject({ at: '2026-11-11T02:00:00.000Z', health: { runtime: { state: 'ready' } },
    load: { running: 2, open_tickets: 0, waiting_for_person: 0 }, effects: { relay: true, notice: false } })
  expect(await execute('watchdog_report', { task: 'daily', summary: 'Two failures repeat.', report: 'Ticket t1 and t2 both failed at prepare.',
    proposals: ['Check the prepare command.'] })).toEqual({ recorded: true, task: 'daily' })
  expect(set).toHaveBeenCalledWith(KV.watchdog.report('daily'), expect.objectContaining({ summary: 'Two failures repeat.',
    report: 'Ticket t1 and t2 both failed at prepare.', proposals: ['Check the prepare command.'] }))
  expect(notify).toHaveBeenCalledWith('watchdog:daily', expect.objectContaining({ task: 'daily' }), 'Two failures repeat.')
})

it('creates the Watchdog Session at startup when its settings enable it and delivers a cycle to it', async () => {
  const host = await startRuntime(store => store.saveSettings({ ...store.settings(), watchdog: config() }))
  try {
    expect(host.agents.has(host.runtime.watchdog.sessionId('patrol'))).toBe(true)
    expect(host.controller.create.mock.calls.some(([args]) => (args as { sessionId: string; agentPreset?: string }).sessionId === host.runtime.watchdog.sessionId('patrol')
      && (args as { agentPreset?: string }).agentPreset === 'dsh-superagent-watchdog')).toBe(true)
    const names = [...host.tools.get(host.runtime.watchdog.sessionId('patrol'))!.keys()]
    expect(names).toEqual(expect.arrayContaining(['watchdog_status', 'watchdog_report', 'orchestrator_read']))
    expect(await host.runtime.watchdog.run('patrol')).toBe('prompted')
    const delivered = host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === host.runtime.watchdog.sessionId('patrol')).at(-1)
    expect(delivered?.text).toContain('Watchdog patrol.')
    const status = await host.runTool(host.runtime.watchdog.sessionId('patrol'), 'watchdog_status', {})
    expect(status).toMatchObject({ load: { open_tickets: 0, waiting_for_person: 0 }, effects: { relay: false } })
    await host.runTool(host.runtime.watchdog.sessionId('patrol'), 'watchdog_report', { task: 'daily', summary: 'No worker is stuck.', report: 'All clear.' })
    await host.runtime.effects.idle('notice')
    expect(host.agents.get(host.runtime.masterId)!.inject).toHaveBeenCalledWith(expect.objectContaining({
      content: [expect.objectContaining({ text: expect.stringContaining('No worker is stuck.') })] }))
  } finally { await host.stop() }
})

it('arms one cron timer per enabled task and starts a cycle when it fires', async () => {
  vi.useFakeTimers()
  try {
    const { host, prompt } = fakeHost({ now: () => new Date(Date.now()) })
    const watchdog = new Watchdog(host)
    await watchdog.start()
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    expect(prompt).toHaveBeenCalledWith('watchdog-patrol', expect.stringContaining('watchdog:patrol:'), expect.stringContaining('Watchdog patrol.'), 'queue')
    watchdog.stop()
  } finally { vi.useRealTimers() }
})

it('applies a saved task list without a restart and schedules the new task', async () => {
  const host = await startRuntime(store => store.saveSettings({ ...store.settings(), watchdog: config() }))
  try {
    const revision = host.runtime.store.blockRevision('watchdog')
    const saved = { ...host.runtime.store.settings().watchdog, tasks: [{ id: 'custom', schedule: '*/5 * * * *', prompt: '', enabled: true }] }
    await host.runtime.settings.save('watchdog', saved, revision, 'panel')
    expect(host.runtime.store.settings().watchdog.tasks.map(task => task.id)).toEqual(['custom'])
    expect(await host.runtime.watchdog.run('custom')).toBe('prompted')
    expect(host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === host.runtime.watchdog.sessionId('custom')).at(-1)?.text)
      .toContain('Run this Watchdog cycle.')
  } finally { await host.stop() }
})

it('enables the Watchdog and creates its Session from a settings save without a restart', async () => {
  const host = await startRuntime()
  try {
    expect(host.agents.has(host.runtime.watchdog.sessionId('patrol'))).toBe(false)
    const revision = host.runtime.store.blockRevision('watchdog')
    const saved = await host.runtime.settings.save('watchdog', config(), revision, 'panel')
    expect(saved.restarting).toBe(false)
    expect(host.agents.has(host.runtime.watchdog.sessionId('patrol'))).toBe(true)
    expect(await host.runtime.watchdog.run('patrol')).toBe('prompted')
  } finally { await host.stop() }
})
