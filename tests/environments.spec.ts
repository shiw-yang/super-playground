/** Environment selection, immutable Ticket snapshots, legacy migration and both Router acceptance paths. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Engine, UserError, type AssessmentOutcome, type Ticket, type Trigger } from '../src/core/index.ts'
import { Environments, snapshotOf, type EnvironmentAccounts, type EnvironmentSnapshot } from '../src/app/environments.ts'
import { Store, SCHEMA_VERSION } from '../src/app/store.ts'
import { EnvironmentConfigSchema, ExecutionSelectionSchema, SettingsSchema } from '../src/policy.ts'
import { KV } from '../src/kv.ts'
import { testMachine } from './fixtures/deployment.ts'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

const opened: Store[] = [], directories: string[] = []
let host: Host | undefined
const request = (id = 'request', source = 'feishu'): Trigger => ({ id, source, threads: [{ source, id }], actor: { source, id: 'alice' },
  human: true, addressed: 'mention', at: '2026-11-09T00:00:00.000Z', text: 'Fix the sign-in label', meta: {} })
const accepted = (extra: object = {}): Extract<AssessmentOutcome, { kind: 'accept' }> => ({ kind: 'accept', title: 'Fix sign-in',
  name: 'fix-sign-in', scope: 'Fix the sign-in label', reason: 'Explicit request', ...extra })
const ticketOf = (trigger: Trigger): Ticket => ({ id: `ticket-${trigger.id}`, title: 'Fix sign-in', decisionId: 'decision',
  mandate: { strength: 'explicit', policyVersion: 'p1', basis: { via: 'addressed', addressed: 'mention', source: trigger.source },
    actor: trigger.actor, scope: 'Fix the sign-in label' }, channels: [], assignments: [], inputs: [], undelivered: [],
  origin: { triggerId: trigger.id, triggerIds: [trigger.id] }, createdAt: trigger.at, updatedAt: trigger.at })
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'environment-contract-'))
  directories.push(directory)
  const store = new Store(join(directory, 'orchestrator.sqlite')); opened.push(store)
  store.saveSettings(SettingsSchema.parse({
    environments: {
      default: { title: 'Frontend', description: 'Frontend labels', prepare: 'prepare-frontend', githubSource: 'github' },
      backend: { title: 'Backend', description: 'Backend APIs', prepare: 'prepare-backend', githubSource: 'github-backend' },
      plain: { title: 'Documents', description: 'Local documents without a code repository' },
    },
    sources: {
      github: { kind: 'github', enabled: true, config: { repository: 'acme/frontend', cli: '/configured/gh-frontend' } },
      'github-backend': { kind: 'github', enabled: true, config: { repository: 'acme/backend', cli: '/configured/gh-backend' } },
      feishu: { kind: 'feishu', enabled: true, config: {}, execution: { mode: 'router', allowedEnvironmentIds: ['default', 'backend', 'plain'] } },
    },
  }))
  const accounts = (snapshot: EnvironmentSnapshot): EnvironmentAccounts => snapshot.github ? {
    github: { repository: snapshot.github.repository, account: { cli: snapshot.github.cli, login: snapshot.github.sourceId,
      noreply: `${snapshot.github.sourceId}@users.noreply.github.com` } },
  } : {}
  const resolveAccounts = vi.fn(async (snapshot: EnvironmentSnapshot) => accounts(snapshot))
  const environments = new Environments({ store, machine: testMachine({ stateDir: directory }), knownAccounts: accounts, resolveAccounts })
  const bind = (trigger: Trigger, outcome = accepted()) => {
    store.triggers.save(trigger)
    const ticket = ticketOf(trigger)
    ticket.execution = store.atomic(() => environments.bind(ticket, outcome)); store.tickets.save(ticket)
    return ticket
  }
  return { directory, store, environments, resolveAccounts, bind }
}
afterEach(async () => {
  await host?.stop(); host = undefined
  for (const store of opened.splice(0)) store.close()
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(join(tmpdir(), 'environment-contract-'))) throw new Error('Unexpected test cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
})

it('separates scheduling and environment schemas, requiring explicit nonempty Router choices', () => {
  const defaults = SettingsSchema.parse({})
  expect(defaults.executor).toEqual({ model: null, maxWorkers: 3 })
  expect(defaults.environments.default).toMatchObject({ githubSource: 'github', directory: '', prepare: '' })
  expect(ExecutionSelectionSchema.safeParse({ mode: 'router', allowedEnvironmentIds: [] }).success).toBe(false)
  expect(ExecutionSelectionSchema.safeParse({ mode: 'router', allowedEnvironmentIds: ['a', 'a'] }).success).toBe(false)
  expect(EnvironmentConfigSchema.safeParse({ directory: '../outside' }).success).toBe(false)
})

it('resolves fixed Source binding in code and refuses a Router override before writing any snapshot', () => {
  const { store, environments, bind } = setup()
  const trigger = request('fixed', 'github')
  store.triggers.save(trigger)
  expect(() => environments.bind(ticketOf(trigger), accepted({ environmentId: 'backend' }))).toThrow(UserError)
  expect(store.keys(KV.execution.snapshot)).toEqual([])
  const ticket = bind(trigger)
  expect(ticket.execution?.environment).toMatchObject({ id: 'default', selectedBy: 'fixed', sourceId: 'github', sources: { github: 'github' } })
  expect(ticket.execution?.directory).toBe(join(environments.snapshot(ticket).directory, ticket.execution!.name))
})

it('requires an allowed environment and current revision for Router selection, never falling back', () => {
  const { store, environments, bind } = setup(), trigger = request()
  store.triggers.save(trigger)
  const choices = environments.candidates(trigger)
  expect(() => environments.bind(ticketOf(trigger), accepted())).toThrow(new UserError('environmentRequired', { source: 'feishu' }))
  expect(() => environments.bind(ticketOf(trigger), accepted({ environmentId: 'backend' }))).toThrow(UserError)
  expect(() => environments.bind(ticketOf(trigger), accepted({ environmentId: 'invented', executionRevision: choices.revision })))
    .toThrow(new UserError('environmentNotAllowed', { environment: 'invented', source: 'feishu' }))
  const settings = store.settings()
  store.saveSettings({ ...settings, environments: { ...settings.environments, backend: { ...settings.environments.backend!, prepare: 'new-command' } } })
  expect(() => environments.bind(ticketOf(trigger), accepted({ environmentId: 'backend', executionRevision: choices.revision })))
    .toThrow(new UserError('environmentSelectionStale'))
  const ticket = bind(trigger, accepted({ environmentId: 'backend', executionRevision: environments.candidates(trigger).revision,
    environmentReason: 'The request names the API' }))
  expect(ticket.execution?.environment).toMatchObject({ id: 'backend', selectedBy: 'router', reason: 'The request names the API' })
})

it('keeps candidate discovery bounded to metadata and rejects incompatible GitHub repository targets', () => {
  const { store, environments } = setup()
  const trigger = request('repo', 'github'), settings = store.settings()
  store.saveSettings({ ...settings, sources: { ...settings.sources, github: { ...settings.sources.github!, execution: { mode: 'router',
    allowedEnvironmentIds: ['default', 'backend'] } } } })
  store.triggers.save(trigger)
  const choices = environments.candidates(trigger)
  expect(choices.candidates).toContainEqual(expect.objectContaining({ id: 'backend', available: false, reason: 'repository_mismatch' }))
  expect(JSON.stringify(choices)).not.toMatch(/configured\/gh|prepare-frontend|prepare-backend/)
  expect(() => environments.bind(ticketOf(trigger), accepted({ environmentId: 'backend', executionRevision: choices.revision })))
    .toThrow(new UserError('environmentRepository', { environment: 'backend' }))
  expect(() => environments.repositorySource(trigger, 'backend')).toThrow(UserError)
})

it('freezes config, target account and directory across edits, while disable blocks execution explicitly', async () => {
  const { store, environments, bind } = setup(), trigger = request('frozen', 'github')
  const ticket = bind(trigger), binding = structuredClone(ticket.execution!.environment!)
  const before = await environments.resolve(ticket)
  const settings = store.settings()
  store.saveSettings({ ...settings, environments: { ...settings.environments, default: { ...settings.environments.default!,
    directory: '/another/root', prepare: 'new-prepare', githubSource: 'github-backend' } },
    sources: { ...settings.sources, github: { ...settings.sources.github!, execution: { mode: 'fixed', environmentId: 'backend' },
      config: { repository: 'acme/changed', cli: '/another/account' } } } })
  const after = await environments.resolve(ticket)
  expect([after.prepare, after.directory, after.deployment.github, after.deployment.repository]).toEqual([
    before.prepare, before.directory, before.deployment.github, before.deployment.repository,
  ])
  expect(ticket.execution!.environment).toEqual(binding)
  const current = store.settings()
  store.saveSettings({ ...current, environments: { ...current.environments, default: { ...current.environments.default!, enabled: false } } })
  await expect(environments.resolve(ticket)).rejects.toThrow(new UserError('environmentDisabled', { environment: 'default' }))
  expect(environments.snapshot(ticket).revision).toBe(binding.revision)
})

it('refuses account drift behind the same CLI path on restart and on new acceptance without changing the saved identity', async () => {
  const { store, directory, environments, bind } = setup(), trigger = request('identity', 'github')
  const ticket = bind(trigger), snapshot = environments.snapshot(ticket)
  const accountKey = KV.execution.accounts(snapshot.id, snapshot.revision), saved = store.get(accountKey)!
  const changed: EnvironmentAccounts = { github: { ...saved.github!, account: { ...saved.github!.account, login: 'another-account' } } }
  const probe = vi.fn(async () => changed)
  const restarted = new Environments({ store, machine: testMachine({ stateDir: directory }), knownAccounts: () => changed, resolveAccounts: probe })
  expect(restarted.candidates(trigger).candidates).toContainEqual(expect.objectContaining({ id: 'default', available: false, reason: 'account_changed' }))
  await expect(restarted.resolve(ticket)).rejects.toThrow(new UserError('environmentAccountChanged', { environment: 'default' }))
  const next = request('new-identity', 'github'); store.triggers.save(next)
  expect(() => restarted.bind(ticketOf(next), accepted())).toThrow(new UserError('environmentAccountChanged', { environment: 'default' }))
  expect(store.get(accountKey)).toEqual(saved)
  expect(probe).not.toHaveBeenCalled()
  // A historical CLI no longer referenced by current Source setup must be probed once in the new Runtime, not trusted from storage.
  const historical = new Environments({ store, machine: testMachine({ stateDir: directory }), knownAccounts: () => undefined, resolveAccounts: probe })
  await expect(historical.resolve(ticket)).rejects.toThrow(UserError)
  expect(probe).toHaveBeenCalledTimes(1)
  probe.mockResolvedValue(saved)
  await historical.resolve(ticket); await historical.resolve(ticket)
  expect(probe).toHaveBeenCalledTimes(2)
  expect(store.get(accountKey)).toEqual(saved)
})

it('allows a local no-repository environment without inheriting any default account', async () => {
  const { environments, bind } = setup(), trigger = request('plain')
  const ticket = bind(trigger, accepted({ environmentId: 'plain', executionRevision: environments.candidates(trigger).revision }))
  expect(ticket.execution!.environment!.sources).toEqual({})
  const environment = await environments.resolve(ticket)
  expect(environment.deployment).toMatchObject({ repository: '', github: { cli: '', login: '', noreply: '' } })
  expect(environment.deployment.feishu).toBeUndefined()
})

it('retry and restart keep the original environment binding and do not call the selector again', () => {
  const { store, environments } = setup(), trigger = request('lifecycle', 'github')
  const binder = vi.fn((ticket: Ticket, outcome: Extract<AssessmentOutcome, { kind: 'accept' }>) => ({ ...ticket, execution: environments.bind(ticket, outcome) }))
  const started = vi.fn()
  const engine = new Engine({ repo: store, scope: { scope: () => ({ listened: true, observed: false }) },
    policy: () => ({ version: 'v1', paused: false, evalTimeoutMs: 10000, gate: () => ({ admissible: true, strength: 'explicit',
      basis: { via: 'addressed', addressed: 'mention' } }), revalidate: () => true, admitsInferred: () => true }),
    assessor: { request: () => {} }, executor: { start: started, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} }, prepareTicket: binder })
  engine.receive(trigger)
  const decision = engine.decide(trigger.id, accepted()), id = decision.ticketId!
  const original = structuredClone(store.tickets.get(id)!.execution)
  const first = store.tickets.get(id)!.assignments.at(-1)!
  engine.assignmentStarted(id, first.id); engine.report(id, { state: 'failed', summary: 'Retry needed' }); engine.retryTicket(id)
  const second = store.tickets.get(id)!.assignments.at(-1)!
  engine.assignmentStarted(id, second.id); engine.assignmentInterrupted(id, second.id)
  expect(binder).toHaveBeenCalledTimes(1)
  expect(started).toHaveBeenCalledTimes(3)
  expect(store.tickets.get(id)!.execution).toEqual(original)
  const repeated = engine.decide(trigger.id, accepted({ environmentId: 'backend' }))
  expect(repeated.ticketId).toBe(id)
  expect(binder).toHaveBeenCalledTimes(1)
})

it('migrates schema 11 settings and existing Ticket directories transactionally, without re-preparing or reidentifying them', () => {
  const { directory, store } = setup(), trigger = request('legacy', 'github')
  store.triggers.save(trigger)
  const ticket = ticketOf(trigger)
  ticket.execution = { name: 'legacy-work', directory: '/retained/worktree', assignment: 'Keep working' }
  ticket.assignments = [{ id: 'legacy-assignment', state: 'ended', createdAt: trigger.at, startedAt: trigger.at }]
  store.tickets.save(ticket)
  const versionKey = KV.settings.version(store.get(KV.settings.revision)!)
  const version = store.get(versionKey)!, settings = store.settings()
  const { environments: _environments, ...legacy } = settings
  store.db.prepare('UPDATE kv SET value=? WHERE key=?').run(JSON.stringify({ ...version,
    settings: { ...legacy, executor: { ...legacy.executor, directory: '/legacy/root', prepare: 'legacy-prepare', blockedCommands: ['private-cli'] } } }), versionKey)
  store.set(KV.store.schema, 11)
  store.close(); opened.splice(opened.indexOf(store), 1)
  const next = new Store(join(directory, 'orchestrator.sqlite')); opened.push(next)
  expect(next.get(KV.store.schema)).toBe(SCHEMA_VERSION)
  expect(next.settings().executor).toEqual({ model: null, maxWorkers: 3 })
  expect(next.settings().environments.default).toMatchObject({ directory: '/legacy/root', prepare: 'legacy-prepare', blockedCommands: ['private-cli'] })
  const upgraded = next.tickets.get(ticket.id)!
  expect(upgraded.execution).toMatchObject({ name: 'legacy-work', directory: '/retained/worktree', assignment: 'Keep working',
    environment: { id: 'default', selectedBy: 'legacy' } })
  const binding = upgraded.execution!.environment!
  expect(next.get(KV.execution.snapshot(binding.id, binding.revision))?.github).toMatchObject({ repository: 'acme/frontend', cli: '/configured/gh-frontend' })
  expect(next.get(KV.execution.prepared(ticket.id))).toEqual({ directory: '/retained/worktree', revision: binding.revision, legacy: true })
})

it('uses the same validated environment choice through explicit and inferred Router tools', async () => {
  host = await startRuntime(store => {
    const settings = store.settings()
    store.saveSettings({ ...settings, environments: { ...settings.environments,
      other: { ...settings.environments.default!, title: 'Other', directory: '', prepare: '' } },
      sources: { ...settings.sources, feishu: { ...settings.sources.feishu!, execution: { mode: 'router', allowedEnvironmentIds: ['default', 'other'] } } } })
  })
  const h = host, explicit = feishu('61', '@bot Fix the label'), inferred = feishu('62', 'Fix the label', { mentions: [] })
  h.runtime.receive(explicit); h.runtime.receive(inferred); await h.runtime.idle()
  const choice = (trigger: Trigger) => ({ environment_id: 'other', execution_revision: h.runtime.environments.candidates(trigger).revision })
  await expect(h.route({ kind: 'accept', trigger_id: explicit.id, title: 'Fix', worktree_name: 'fix-label', acknowledgement: 'Fixing the label.' }))
    .rejects.toThrow('Choose an execution environment')
  expect(h.runtime.store.tickets.list()).toHaveLength(0)
  const routed = await h.route({ kind: 'accept', trigger_id: explicit.id, title: 'Fix', worktree_name: 'fix-label', acknowledgement: 'Fixing the label.', ...choice(explicit) })
  await h.runTool(h.runtime.masterId, 'orchestrator_eval', { trigger_id: inferred.id })
  const proactive = await h.runTool(h.runtime.masterId, 'orchestrator_eval_decide', { trigger_id: inferred.id,
    decision: 'accept', title: 'Fix', scope: 'Fix label', reason: 'Requested wording fix', intent_evidence: 'Fix the label', worktree_name: 'fix-copy',
    acknowledgement: 'Fixing the wording.', rule_assessments: [{ rule_id: 'copy', matched: true, reason: 'Copy' }, { rule_id: 'visual', matched: false, reason: 'Not visual' }],
    direction: { implementation_requested: true, target_basis: 'specified', requires_design_decision: false, evidence: 'Fix the label' }, ...choice(inferred) })
  await h.runtime.idle()
  for (const result of [routed, proactive]) {
    const ticket = h.runtime.store.tickets.get((result.ticket as { ticket_id: string }).ticket_id)!
    expect(ticket.execution!.environment).toMatchObject({ id: 'other', selectedBy: 'router' })
    expect(ticket.assignments.at(-1)?.state).toBe('running')
  }
})
