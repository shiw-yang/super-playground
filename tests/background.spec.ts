/** A worker's background work in DSH: waiting for its shell jobs and subagents, and stopping them. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { expect, it, vi } from 'vitest'
import { stopSubagents, untilQuiet } from '../src/executor/background.ts'
import { jobRegistry } from './fixtures/host.ts'

/**
 * A context with DSH's job registry and its tree-wide subagent service, and an idle worker agent with one live
 * descendant, `child-1`; a Session the Executor cannot resolve has no live agent.
 */
function setup(waitForTreeWork: (agent: Agent) => Promise<boolean>, live = true) {
  const jobs = jobRegistry()
  const agent = { id: 'worker-t1', status: 'idle', whenIdle: async () => {}, inbox: { nextTurn: [], nextStep: [] }, cancel: vi.fn() } as unknown as
    Agent & { status: string; cancel: ReturnType<typeof vi.fn> }
  const subagents = {
    waitForTreeWork: vi.fn(waitForTreeWork),
    listDescendants: vi.fn(async () => [{ id: 'child-1' }]),
    interrupt: vi.fn(),
  }
  const services: Record<string, unknown> = { jobs: jobs.service, subagents }
  const ctx = { get: (name: string) => services[name], agents: { get: (id: string) => id === 'child-1' && live ? agent : undefined } } as unknown as Context
  return { ctx, agent, jobs, subagents }
}

it('is not quiet when an end during the subagent check woke the worker, whose own idle looks again', async () => {
  const { ctx, agent, jobs } = setup(async () => {
    // The job settles meanwhile, and its end wakes the worker.
    jobs.end(id); (agent as { status: string }).status = 'running'
    return false
  })
  const id = jobs.run('worker-t1')
  expect(await untilQuiet(ctx, agent, new AbortController().signal)).toBe(false)
})

it('stops waiting for subagents that never settle once the host stops', async () => {
  let joining!: () => void
  const joined = new Promise<void>(resolve => { joining = resolve })
  const { ctx, agent } = setup(() => { joining(); return new Promise(() => {}) })
  const stop = new AbortController()
  const quiet = untilQuiet(ctx, agent, stop.signal)
  // The host stops while the wait for its subagents runs.
  await joined
  stop.abort()
  expect(await quiet).toBe(false)
})

it('looks at the jobs only when one ends, not at each output of a noisy one', async () => {
  const { ctx, agent, jobs } = setup(async () => false)
  const id = jobs.run('worker-t1')
  const stop = new AbortController()
  const quiet = untilQuiet(ctx, agent, stop.signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  const looked = jobs.service.list.mock.calls.length
  for (let line = 0; line < 100; line++) jobs.output(id)
  expect(jobs.service.list.mock.calls.length).toBe(looked)
  jobs.end(id)
  expect(await quiet).toBe(true)
})

it('joins a worker\'s subagents once for the looks that wait on them, as DSH cannot cancel the join', async () => {
  const { ctx, agent, subagents } = setup(() => new Promise(() => {}))
  for (let look = 0; look < 3; look++) {
    const stop = new AbortController()
    const quiet = untilQuiet(ctx, agent, stop.signal)
    stop.abort()
    expect(await quiet).toBe(false)
  }
  expect(subagents.waitForTreeWork).toHaveBeenCalledTimes(1)
})

it('interrupts the live descendants and waits for their tree', async () => {
  const { ctx, agent, subagents } = setup(async () => false)
  await stopSubagents(ctx, agent)
  expect(subagents.listDescendants).toHaveBeenCalledWith('worker-t1')
  expect(subagents.interrupt).toHaveBeenCalledWith('child-1', { kind: 'ancestor', agent })
  expect(subagents.waitForTreeWork).toHaveBeenCalledWith(agent)
  // The turn an interrupted descendant's end woke is cancelled after the wait, as a release was before.
  expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
})

it('stops nothing for a descendant that already ended', async () => {
  const { ctx, agent, subagents } = setup(async () => false, false)
  await stopSubagents(ctx, agent)
  expect(subagents.listDescendants).toHaveBeenCalledWith('worker-t1')
  expect(subagents.interrupt).not.toHaveBeenCalled()
  expect(agent.cancel).not.toHaveBeenCalled()
})

it('gives up a tree wait that does not end within 10 seconds, and cancels the turn its ends woke', async () => {
  const { ctx, agent } = setup(() => new Promise(() => {}))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    let stopped = false
    const stopping = stopSubagents(ctx, agent).then(() => { stopped = true })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await stopping
  } finally { vi.useRealTimers() }
  expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: false })
})
