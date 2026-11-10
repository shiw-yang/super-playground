/** Outbox delivery when processing is paused or a Source kind registers late. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OutboundMessage } from '../src/core/index.ts'
import { Commands } from '../src/infra/commands.ts'
import { Outbox, type OutboxHost } from '../src/app/outbox.ts'
import { SettingsSchema } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { githubKind } from '../src/sources/github.ts'
import { feishuKind } from '../src/sources/feishu.ts'
import { githubChannel } from '../src/sources/github-trigger.ts'
import { feishuChannel } from '../src/sources/feishu-trigger.ts'
import { testDeployment } from './fixtures/deployment.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.sendReplies() } finally { vi.useRealTimers() }
}

it('resolves delivery accounts from each channel at send time, independently of the ticket target and other Sources', async () => {
  const settings = SettingsSchema.parse({ sources: {
    alpha: { kind: 'github', config: { repository: 'acme/one', cli: '/fake/alpha' } },
    beta: { kind: 'github', config: { repository: 'acme/two', cli: '/fake/beta' } },
    chatone: { kind: 'feishu', config: {} },
  } })
  const sources = new SourceRegistry(() => settings)
  sources.register(githubKind); sources.register(feishuKind)
  const alpha = new Commands(() => testDeployment({ repository: 'acme/one' }), {}, new AbortController().signal, 'alpha')
  const rotated = new Commands(() => testDeployment({ repository: 'acme/two', github: { cli: '/fake/rotated', login: 'new-bot', noreply: 'new@example.test' } }), {}, new AbortController().signal, 'beta')
  let current = alpha
  const commandsFor = vi.fn((id: string) => id === 'alpha' ? alpha : current)
  let deliver!: (id: string) => Promise<void>
  const effects: OutboxHost['effects'] = { enqueue: vi.fn(), cancel: vi.fn(), idle: async () => {},
    handle: (_kind, run) => { deliver = id => run({} as never, id) } }
  const box = new Outbox({ store: h.runtime.store, effects, sources, commandsFor, paused: () => false })
  const send = vi.spyOn(sources, 'send').mockResolvedValue('sent')
  for (const id of ['alpha', 'beta']) box.send({ id: `reply-${id}`, ticketId: 'one-ticket', kind: 'reply', text: 'Done',
    channel: githubChannel(12, undefined, { id, repository: id === 'alpha' ? 'acme/one' : 'acme/two' }) })
  // Rotation happened after enqueue. The outbound Source owns delivery credentials, not the ticket's execution snapshot.
  current = rotated
  await deliver('reply-alpha')
  settings.sources.beta!.enabled = false
  await expect(deliver('reply-beta')).rejects.toThrow('Source is off')
  expect(commandsFor.mock.calls).toEqual([['alpha']])
  settings.sources.beta!.enabled = true
  await deliver('reply-beta')
  expect(send.mock.calls.map(([message, commands]) => [message.channel.source, commands])).toEqual([['alpha', alpha], ['beta', rotated]])
  expect(box.status('reply-alpha')).toBe('sent')
  expect(box.status('reply-beta')).toBe('sent')
  expect(() => box.send({ id: 'long-im', kind: 'reply', text: 'word '.repeat(101), channel: feishuChannel('oc_team', 'om_reply', false, 'chatone') }))
    .toThrow('maximum is 100')
})

it('holds every message while processing is paused, and sends it once processing resumes', async () => {
  const lark = vi.mocked(Commands.prototype.lark)
  await h.runtime.settings.pause(true, 'panel')
  lark.mockClear()
  h.runtime.outbox.send({ id: 'held', channel: feishu('1', 'x').channel!, text: '已合并。', kind: 'notice' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('held'), lark.mock.calls.length]).toEqual(['pending', 0])
  await h.runtime.settings.pause(false, 'panel')
  await h.runtime.pump(); await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('held')).toBe('sent')
  expect(JSON.stringify(lark.mock.calls)).toContain('已合并。')
})

it('keeps a message for a Source that is not installed waiting, and sends it once the Source\'s kind registers', async () => {
  const sent: OutboundMessage[] = []
  const probe: SourceKind<Record<string, never>> = { kind: 'probe', title: { zh: '探针', en: 'Probe' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async (_host, message) => { sent.push(message); return 'sent' }, link: () => ({ url: '', label: { zh: '探针', en: 'Probe' } }) } }
  h.runtime.outbox.send({ id: 'waiting', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('waiting'), h.runtime.health.reply?.state]).toEqual(['pending', 'ready'])
  h.runtime.sources.register(probe)
  // A message whose Source was not installed is tried again after 5 seconds.
  await at(5000)
  expect([h.runtime.outbox.status('waiting'), sent.map(message => message.id)]).toEqual(['sent', ['waiting']])
})
