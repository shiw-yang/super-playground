// @vitest-environment jsdom
// The Settings groups, drafts, save bars and history.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Fields } from '../src/client/settings-kit.tsx'
import { expect, it, onTestFinished } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, settle, all, find, tab, click, type, text, field, at } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()
const cardField = <E extends HTMLElement>(card: Element, name: string): E => {
  const label = [...card.querySelectorAll('label')].find(label => label.textContent === name)
  if (!label) throw new Error(`No field named ${name}`)
  return document.getElementById(label.htmlFor) as E
}
it.each([zh, en])('creates a disabled Source instance with its own ID, kind and explicit environment, in either language', async words => {
  at({ page: 'settings', query: { group: 'source' } })
  await mount(words)
  const create = document.getElementById('dt-create-source')!
  const button = () => find(words.sourceCreate, '#dt-create-source button') as HTMLButtonElement
  expect([...field<HTMLSelectElement>(words.sourceKind).options].map(option => option.value)).toEqual(['', 'feishu', 'github'])
  await type(field<HTMLInputElement>(words.sourceId), 'github')
  await type(field<HTMLSelectElement>(words.sourceKind), 'github')
  expect(button().disabled).toBe(true)
  expect(create.textContent).toContain(words.configurationIdTaken.replace('{id}', 'github'))
  await type(field<HTMLInputElement>(words.sourceId), 'product-repo')
  expect(cardField<HTMLSelectElement>(create, words.sourceFixedEnvironment).value).toBe('')
  expect(button().disabled).toBe(true)
  await type(cardField<HTMLSelectElement>(create, words.sourceFixedEnvironment), 'default')
  await click(button())
  expect(server.requests.find(request => request.path === 'settings/source:product-repo')).toEqual({ path: 'settings/source:product-repo',
    method: 'PUT', body: { revision: 0, value: { kind: 'github', enabled: false, config: {}, execution: { mode: 'fixed', environmentId: 'default' } } } })
  const card = document.getElementById('dt-source-product-repo')!
  expect(card.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  expect(card.querySelector('.dt-card-title')?.textContent).toBe('GitHub')
  expect(card.textContent).toContain('product-repo')
  expect(server.settings.sources['product-repo']).toMatchObject({ kind: 'github', enabled: false })
  expect(server.settings.sources.github!.enabled).toBe(true)
})

it.each([zh, en])('requires an explicit nonempty Router allowlist and keeps a fixed selection empty when changing modes', async words => {
  server.settings.environments.qa = { ...server.settings.environments.default!, title: 'QA' }
  server.settings.environments.offline = { ...server.settings.environments.default!, title: 'Offline', enabled: false }
  at({ page: 'settings', query: { group: 'source' } })
  await mount(words)
  const card = document.getElementById('dt-source-feishu')!
  await type(cardField<HTMLSelectElement>(card, words.sourceExecutionMode), 'router')
  expect(card.textContent).toContain(words.sourceEnvironmentRequired)
  expect([...card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => !input.checked)).toBe(true)
  await click(find(words.save, '#dt-source-feishu button'))
  expect(server.requests.filter(request => request.method === 'PUT')).toHaveLength(0)
  const option = (title: string) => [...card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find(input => input.closest('label')?.textContent?.includes(title))!
  expect(option('Offline').disabled).toBe(true)
  await click(option('QA'))
  await click(find(words.save, '#dt-source-feishu button'))
  expect(server.settings.sources.feishu!.execution).toEqual({ mode: 'router', allowedEnvironmentIds: ['qa'] })
  expect(server.requests.find(request => request.path === 'settings/source:feishu')).toMatchObject({ body: { revision: 0,
    value: { kind: 'feishu', execution: { mode: 'router', allowedEnvironmentIds: ['qa'] } } } })
  await type(cardField<HTMLSelectElement>(card, words.sourceExecutionMode), 'fixed')
  const fixed = cardField<HTMLSelectElement>(card, words.sourceFixedEnvironment)
  expect(fixed.value).toBe('')
  expect(fixed.required).toBe(true)
  await type(fixed, 'default')
  await click(find(words.save, '#dt-source-feishu button'))
  expect(server.settings.sources.feishu!.execution).toEqual({ mode: 'fixed', environmentId: 'default' })
})

it.each([zh, en])('keeps missing environment references visible and localizes a rejected Source save', async words => {
  server.settings.sources.feishu!.execution = { mode: 'fixed', environmentId: 'missing-env' }
  at({ page: 'settings', query: { group: 'source' } })
  await mount(words)
  const card = document.getElementById('dt-source-feishu')!
  const fixed = cardField<HTMLSelectElement>(card, words.sourceFixedEnvironment)
  expect(fixed.value).toBe('missing-env')
  expect(fixed.selectedOptions[0]?.textContent).toBe(words.configurationUnavailable.replace('{id}', 'missing-env'))
  expect(fixed.selectedOptions[0]?.disabled).toBe(true)
  await click(card.querySelector<HTMLElement>('[role="switch"]')!)
  await act(async () => { card.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle()
  expect(card.querySelector('[role="alert"]')?.textContent).toBe(words['userError.unknownEnvironment'].replace('{environment}', 'missing-env'))
  expect(server.settings.sources.feishu!.execution).toEqual({ mode: 'fixed', environmentId: 'missing-env' })
  expect(fixed.value).toBe('missing-env')
})

it('offers every available provider even when a different provider is already selected', async () => {
  server.settings.executor.model = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' }
  server.models = { default: { provider: 'oauth-codex', model: 'gpt-6.1-terra' }, routableProviders: ['deepseek-official', 'oauth-codex'],
    failures: [], groups: [{ id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'Flash' }] },
      { id: 'oauth-codex', name: 'Codex', models: [{ id: 'gpt-6.1-terra', name: 'GPT',
        reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }] }
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(text()).toContain('oauth-codex / gpt-6.1-terra')
  const providers = field<HTMLSelectElement>('选择服务商')
  expect([...providers.options].map(option => option.value)).toContain('oauth-codex')
  await type(providers, 'oauth-codex')
  expect(field<HTMLInputElement>(zh.modelProvider).value).toBe('oauth-codex')
  expect(field<HTMLInputElement>(zh.modelName).value).toBe('')
  expect(field<HTMLInputElement>(zh.modelEffort).value).toBe('')
  await type(field<HTMLSelectElement>(zh.chooseModel), 'gpt-6.1-terra')
  await type(field<HTMLSelectElement>(zh.chooseEffort), 'high')
  await click(zh.save)
  expect(server.settings.executor.model).toEqual({ provider: 'oauth-codex', model: 'gpt-6.1-terra', reasoningEffort: 'high' })
})
it('keeps a person\'s own value where another save changed the same setting, and says so', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await type(field<HTMLInputElement>(zh.maxWorkers), '6')
  server.settings = { ...server.settings, executor: { ...server.settings.executor, maxWorkers: 4 } }
  server.revisions.executor = 1
  await click(zh.save)
  expect(document.querySelector('.dt-savebar [role="alert"]')?.textContent).toBe(zh.saveConflict)
  expect(field<HTMLInputElement>(zh.maxWorkers).value).toBe('6')
  await click(zh.save)
  expect(server.settings.executor.maxWorkers).toBe(6)
})

it('saves Eval, Executor and environment blocks independently and inserts a variable at the prepare command caret', async () => {
  server.settings.sources.github!.enabled = false
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  await click(zh['mode.auto'])
  await type(field<HTMLInputElement>(zh.evalTimeout), '180')
  const [provider, model] = all('.dt-model input')
  await type(provider as HTMLInputElement, 'worker-provider'); await type(model as HTMLInputElement, 'worker-model')
  await click(zh.save)
  expect(server.settings.eval).toEqual({ mode: 'auto', timeoutSeconds: 180, model: { provider: 'worker-provider', model: 'worker-model' } })
  await click(find(zh['promptPart.runtime/work'], '.dt-settings-link'))
  await type(field<HTMLInputElement>(zh.maxWorkers), '5')
  // An empty root uses the default directory, which the field names instead of looking set.
  expect(field<HTMLInputElement>(zh.executionDirectory).closest('.dt-field')!.querySelector('small')?.textContent).toBe('留空时用 /srv/dsh-superagent/work')
  await type(field<HTMLInputElement>(zh.executionDirectory), '/srv/work')
  // A variable picked from the list goes where the caret is in the prepare command.
  const prepare = field<HTMLTextAreaElement>(zh.prepareCommand)
  await type(prepare, 'git worktree add ')
  prepare.setSelectionRange(17, 17)
  await click('可用的环境变量 3')
  expect(all('.dt-table tbody tr').map(row => row.textContent)).toEqual(['DSH_SUPERAGENT_DIR工单的执行目录执行器', 'DSH_SUPERAGENT_NAME工单短名执行器',
    'DSH_SUPERAGENT_GITHUB_REPOSITORY仓库GitHub · 已关闭'])
  await click('DSH_SUPERAGENT_DIR')
  expect(field<HTMLTextAreaElement>(zh.prepareCommand).value).toBe('git worktree add "$DSH_SUPERAGENT_DIR"')
  await type(field<HTMLInputElement>(zh.blockedCommands), 'gh-personal  gh.other')
  const [workerProvider, workerModel, effort] = all('.dt-model input')
  await type(workerProvider as HTMLInputElement, 'worker-provider'); await type(workerModel as HTMLInputElement,
    'worker-model'); await type(effort as HTMLInputElement, 'high')
  expect([...field<HTMLSelectElement>(zh.chooseEffort).options].map(option => option.value)).toEqual(['', 'high'])
  await click(find(zh.save, '#dt-executor-settings button'))
  expect(server.settings.executor).toEqual({ maxWorkers: 5, model: { provider: 'worker-provider', model: 'worker-model', reasoningEffort: 'high' } })
  expect(server.settings.environments.default!.directory).toBe('')
  expect(field<HTMLTextAreaElement>(zh.prepareCommand).value).toBe('git worktree add "$DSH_SUPERAGENT_DIR"')
  await click(find(zh.save, '#dt-environment-default button'))
  expect(server.settings.environments.default).toEqual({ title: 'Default', description: '', enabled: true, directory: '/srv/work',
    prepare: 'git worktree add "$DSH_SUPERAGENT_DIR"', blockedCommands: ['gh-personal', 'gh.other'], githubSource: 'github', feishuSource: null })
  expect(server.requests.filter(request => request.method === 'PUT').map(request => [request.path,
    (request.body as { revision: number }).revision])).toEqual([['settings/eval', 1], ['settings/executor', 0], ['settings/environment:default', 0]])
})

it('loads configuration history on demand with localized changes, Source field labels and notified Tickets', async () => {
  server.history = { current: 3, policyVersion: 'abcdef1234567890', items: [{ revision: 3, savedAt: '2026-09-22T00:00:00Z',
    source: 'sync', policyVersion: 'abcdef1234567890', policyChanged: true, notified: [{ id: 't1', title: '修复回归' }], block: 'policy',
    changes: [{ code: 'mode', from: 'off', to: 'observe' }, { code: 'sourceRowsAdded', source: 'feishu', field: 'allowed', items: ['Bob'],
      part: true }, { code: 'sourceField', source: 'feishu', field: 'syncChat', from: '', to: 'oc_team', part: true }] }] }
  await mount()
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(server.requests.some(request => request.path === 'policy/history')).toBe(false)
  await click(zh.configHistory)
  for (const expected of ['第 3 次保存 · 从群同步', '生成策略版本 abcdef12', '接单模式：关闭 → 仅观察', '飞书 · 能发起工作的飞书用户 新增：Bob', '飞书 · 同步来源群：未设置 → oc_team',
    '因策略变更通知了 1 个进行中的工单：修复回归']) expect(text()).toContain(expected)
})

it('shows save and discard only while a settings block has edits, at the end of that block', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(all('.dt-savebar')).toHaveLength(0)
  await type(field<HTMLInputElement>(zh.maxWorkers), '6')
  expect(all('.dt-savebar')).toHaveLength(1)
  await type(field<HTMLInputElement>(zh.maxWorkers), '3')
  expect(all('.dt-savebar')).toHaveLength(0)
  await type(field<HTMLInputElement>(zh.maxWorkers), '6')
  await click(zh.discard)
  expect(all('.dt-savebar')).toHaveLength(0)
  // A save submitted from a field keeps the focus there; one from the bar hands it to the block when the bar closes.
  const workers = field<HTMLInputElement>(zh.maxWorkers)
  await type(workers, '5')
  workers.focus()
  await act(async () => { workers.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle()
  expect(server.settings.executor.maxWorkers).toBe(5)
  expect(document.activeElement).toBe(workers)
  await type(workers, '4')
  const save = find(zh.save)
  save.focus()
  await click(save)
  expect(all('.dt-savebar')).toHaveLength(0)
  expect(document.activeElement).toBe(workers.form)
  await click(find(zh['term.source'], '.dt-settings-link'))
  expect(all('.dt-savebar')).toHaveLength(0)
  const github = all('.dt-card').find(card => card.querySelector('.dt-card-title')?.textContent === 'GitHub')!
  await type(field<HTMLInputElement>('智能体的 GitHub CLI'), 'gh-other')
  expect(github.lastElementChild!.classList.contains('dt-savebar')).toBe(true)
  // The agent CLI is read by setup, so the bar warns that saving restarts dsh-superagent and interrupts running work.
  expect(github.lastElementChild!.textContent).toContain('2 个进行中的派工会中断')
})

it('gives the focus back to the field that had it once a block\'s save ends', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  onTestFinished(() => { act(() => { root.unmount() }); container.remove() })
  const render = (disabled: boolean) => act(async () => { root.render(<Fields disabled={disabled}><input aria-label="value" /></Fields>) })
  await render(false)
  const input = container.querySelector('input')!
  input.focus()
  await render(true)
  // jsdom does not blur a control when it becomes disabled; move focus away manually.
  const elsewhere = document.createElement('button'); document.body.append(elsewhere); elsewhere.focus(); elsewhere.remove()
  expect(document.activeElement).toBe(document.body)
  await render(false)
  expect(document.activeElement).toBe(input)
})

it('lists the settings groups stages first, opens each stage\'s group from its status, and returns to the last group opened',
  async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  expect(all('.dt-settings-link').map(link => link.textContent)).toEqual(['来源', '评估', '执行', '看门狗', '提示词', '部署'])
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['term.source'])
  for (const [tab, group] of [['来源', '来源'], ['评估', '评估'], ['执行', '执行'], ['看门狗', '看门狗']] as const) {
    await click(find(tab, '[role="tab"]'))
    await click(find(zh['tab.settings'], '.dt-status-head button'))
    expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(group)
  }
  // The Trigger stage has no settings, so its status offers none.
  await click(tab(zh['tab.trigger']))
  expect(all('.dt-status-head button').map(button => button.textContent)).not.toContain(zh['tab.settings'])
  await click(tab(zh['tab.settings']))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['settingsGroup.watchdog'])
  await click(tab(zh['tab.trigger']))
  await remount()
  await click(tab(zh['tab.settings']))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['settingsGroup.watchdog'])
})
