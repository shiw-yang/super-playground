// @vitest-environment jsdom
// The Execution status, a Ticket, and the Execution settings.
import { act } from 'react'
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, all, find, tab, click, type, text, field, at } from './fixtures/panel.tsx'
import { MEMBER, server, ticketSummary, threadSummary } from './fixtures/panel-server.ts'

usePanel()
const cardField = <E extends HTMLElement>(card: Element, name: string): E => {
  const label = [...card.querySelectorAll('label')].find(label => label.textContent === name)
  if (!label) throw new Error(`No field named ${name}`)
  return document.getElementById(label.htmlFor) as E
}
it.each([zh, en])('creates a named local environment and edits only that environment, in either language', async words => {
  at({ page: 'settings', query: { group: 'execution' } })
  await mount(words)
  await type(field<HTMLInputElement>(words.environmentId), 'default')
  await type(field<HTMLInputElement>(words.environmentNewTitle), 'QA laptop')
  expect((find(words.environmentCreate, '#dt-create-environment button') as HTMLButtonElement).disabled).toBe(true)
  expect(text()).toContain(words.configurationIdTaken.replace('{id}', 'default'))
  await type(field<HTMLInputElement>(words.environmentId), 'qa-laptop')
  await click(find(words.environmentCreate, '#dt-create-environment button'))
  const request = server.requests.find(request => request.path === 'settings/environment:qa-laptop')
  expect(request).toMatchObject({ method: 'PUT', body: { revision: 0, value: { title: 'QA laptop', enabled: true,
    githubSource: null, feishuSource: null, directory: '', prepare: '', blockedCommands: [] } } })
  const card = document.getElementById('dt-environment-qa-laptop')!
  expect(card.textContent).toContain('/srv/dsh-superagent/work/qa-laptop')
  await type(cardField<HTMLTextAreaElement>(card, words.environmentPurpose), 'Local quality checks')
  await type(cardField<HTMLInputElement>(card, words.executionDirectory), '/srv/qa work')
  await type(cardField<HTMLTextAreaElement>(card, words.prepareCommand), 'mkdir -p "$DSH_SUPERAGENT_DIR"')
  await type(cardField<HTMLInputElement>(card, words.blockedCommands), 'gh-personal, lark-personal ')
  await click(card.querySelector<HTMLElement>('[role="switch"]')!)
  await click(find(words.save, '#dt-environment-qa-laptop button'))
  expect(server.settings.environments['qa-laptop']).toMatchObject({ title: 'QA laptop', description: 'Local quality checks', enabled: false,
    directory: '/srv/qa work', prepare: 'mkdir -p "$DSH_SUPERAGENT_DIR"', blockedCommands: ['gh-personal', 'lark-personal'] })
  expect(server.settings.environments.default).toMatchObject({ enabled: true, directory: '', blockedCommands: ['gh-personal'] })
  expect(server.requests.filter(request => request.path === 'settings/environment:qa-laptop').map(request =>
    (request.body as { revision: number }).revision)).toEqual([0, 1])
  expect(server.requests.some(request => request.path === 'settings/executor')).toBe(false)
})

it('filters account Source choices by kind and preserves an unavailable saved reference without fallback', async () => {
  server.settings.sources['repo-two'] = { kind: 'github', enabled: true, config: { repository: 'acme/other', cli: 'gh-other' } }
  server.settings.sources['chat-two'] = { kind: 'feishu', enabled: true, config: { cli: 'lark-other' } }
  server.settings.environments.default!.githubSource = 'missing-repo'
  at({ page: 'settings', query: { group: 'execution' } })
  await mount(en)
  const github = field<HTMLSelectElement>(en.environmentGithubSource), feishu = field<HTMLSelectElement>(en.environmentFeishuSource)
  expect([...github.options].map(option => option.value)).toEqual(['', 'missing-repo', 'github', 'repo-two'])
  expect(github.value).toBe('missing-repo')
  expect(github.selectedOptions[0]!.textContent).toBe('missing-repo (unavailable)')
  expect([...feishu.options].map(option => option.value)).toEqual(['', 'chat-two', 'feishu'])
  await type(github, 'repo-two')
  await type(feishu, 'chat-two')
  await click(en.save)
  expect(server.settings.environments.default).toMatchObject({ githubSource: 'repo-two', feishuSource: 'chat-two' })
})

it('keeps two environment drafts separate while saving another environment revision', async () => {
  server.settings.environments.other = { ...server.settings.environments.default!, title: 'Other', githubSource: null }
  server.revisions['environment:other'] = 5
  at({ page: 'settings', query: { group: 'execution' } })
  await mount(en)
  const first = document.getElementById('dt-environment-default')!, other = document.getElementById('dt-environment-other')!
  await type(cardField<HTMLInputElement>(first, en.environmentTitle), 'Main repository')
  await type(cardField<HTMLInputElement>(other, en.environmentTitle), 'Other tasks')
  await click(find(en.save, '#dt-environment-other button'))
  expect(server.settings.environments.default!.title).toBe('Default')
  expect(cardField<HTMLInputElement>(first, en.environmentTitle).value).toBe('Main repository')
  await click(find(en.save, '#dt-environment-default button'))
  expect(server.settings.environments.other!.title).toBe('Other tasks')
  expect(server.requests.filter(request => request.method === 'PUT').map(request => [request.path,
    (request.body as { revision: number }).revision])).toEqual([['settings/environment:other', 5], ['settings/environment:default', 0]])
})

it('lists Tickets under Execution by who they wait on, with the Executor state and its pause as an action', async () => {
  server.tickets.open = [ticketSummary(), ticketSummary({ id: 't2', title: '执行中的工单', threads: [{ key: 'github:7',
    source: 'github', title: '#7 x', facts: { number: { value: '#7' }, autoMerge: { label: { zh: '自动合并', en: 'Auto-merge' },
      value: { zh: '已开启', en: 'on' } } } }] })]
  await mount()
  await click(zh['tab.execution'])
  expect(document.querySelector('.dt-status-title')?.textContent).toBe(zh.statusTitle)
  expect(server.requests.some(request => request.path === 'tickets?state=open&limit=20')).toBe(true)
  expect(text()).toContain(zh.executorRunning)
  expect(all('.dt-chip').map(chip => chip.textContent)).toContain('GitHub#7自动合并已开启')
  await click(zh.idleLabel)
  expect(server.requests.some(request => request.path === 'tickets?state=idle&limit=20')).toBe(true)
  expect(text()).toContain('执行器结束了当前回合')
  await click(zh['ticket.ended'])
  expect(text()).toContain('旧工单')
  expect(text()).toContain(zh['outcome.stopped'])
  expect(all('.dt-status-line .dt-lv').map(item => item.textContent)).toEqual(['执行中 2 / 3', '排队 0'])
  // The pause is its own action: an Execution settings draft started before it still saves.
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(tab(zh['tab.settings']).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['promptPart.runtime/work'])
  await type(field<HTMLInputElement>(zh.maxWorkers), '4')
  await click(tab(zh['tab.execution']))
  await click(zh.pauseProcessing)
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'executor/pause')).toMatchObject({ method: 'POST', body: { paused: true } })
  expect(text()).toContain(zh.processingPaused)
  expect(find(zh.resumeProcessing).textContent).toBe(zh.resumeProcessing)
  await click(tab(zh['tab.settings']))
  await click(zh.save)
  expect(server.settings).toMatchObject({ paused: true, executor: { maxWorkers: 4 } })
})

it('stops an open Ticket from its page after confirmation', async () => {
  await mount()
  await click('修复回归')
  await click(zh.stop)
  expect(server.requests.some(request => request.path.endsWith('/stop'))).toBe(false)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('停止“修复回归”')
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'tickets/t1/stop' && request.method === 'POST')).toBe(true)
})

it('shows a Ticket with its stage, its Mandate details with the Trigger and Decision behind it, its Threads, and the rest behind disclosures', async () => {
  await mount()
  await click(all('.dt-open').find(button => button.textContent === '修复回归')!)
  expect(document.querySelector('.dt-page-title h2')?.textContent).toBe('修复回归')
  // Verification has its own section even on legacy tickets, without inventing a successful check.
  expect(all('.dt-section-title').map(title => title.querySelector('.dt-section-name')?.textContent)).toEqual([zh.verificationTitle, '授权详情', '未送达的输入', '订阅的线程'])
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh.executingLabel)
  expect(document.querySelector('.dt-status-line .dt-stage .dt-spinner')).not.toBeNull()
  // A Thread this Ticket follows reads as subscribed on its page, though no other Ticket follows it.
  expect(all('.dt-list .dt-ticket .dt-stage').map(stage => stage.textContent)).toContain(zh.threadSubscribed)
  expect(all('.dt-list .dt-ticket .dt-stage').map(stage => stage.textContent)).not.toContain(zh.threadUnsubscribed)
  expect(all('.dt-status-line .dt-lv').map(item => item.textContent)).toEqual(['授权 明确', '发起 飞书 · Alice', expect.stringMatching(/^更新 /)])
  for (const expected of ['修复登录页回归', '点名方式@ 智能体', '名单里的人明确请求，由主 Session 接单', '未送达：等待派工运行',
    'Alice：顺便改标题']) expect(text()).toContain(expected)
  expect(all('.dt-chip').map(chip => chip.textContent)).toContain('飞书团队群')
  await click(zh['term.channel'])
  expect(all('.dt-disclosure-body a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['飞书消息',
    'https://applink.feishu.cn/client/chat/open?openChatId=oc_1'], ['GitHub #42', 'https://github.com/acme/widgets/issues/42']])
  await click(zh['term.environment'])
  expect(all('.dt-disclosure-body .dt-table tr').map(row => row.textContent)).toEqual(['DSH_SUPERAGENT_DIR/w/t1',
    'DSH_SUPERAGENT_GITHUB_NUMBER—'])
  await click(document.querySelector<HTMLElement>('.dt-trigger-link')!)
  expect(tab(zh['tab.trigger']).getAttribute('aria-selected')).toBe('true')
})

it('reports a missing Ticket instead of rendering an empty page', async () => {
  at({ page: 'execution', id: 'missing' })
  await mount()
  expect(document.querySelector('.dt-hint')?.textContent).toBe(zh.ticketNotFound)
})

it('links a question to its Channel, folds consecutive automated messages among Inputs, and shows field explanations in a hover tooltip',
  async () => {
  const ci = (id: string, at: string, failed: number) => ({ id, kind: 'trigger' as const, triggerId: `c${id}`, at, delivered: true,
    trigger: { id: `c${id}`, actor: { source: 'github', id: '' }, human: false,
      preview: `CI of PR #42 at abc1234: 10 checks, ${failed} failed, 0 running.`, thread: 'github:42' } })
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, stage: 'person', action: 'answer', attention: { id: 'q1', question: '需要确认按钮颜色' }, inputs: [ci('i3',
    '2026-09-22T00:06:00Z', 1), ci('i2', '2026-09-22T00:05:00Z', 0)] }
  await mount()
  await click(all('.dt-open').find(button => button.textContent === '修复回归')!)
  expect(all('.dt-banner a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['去飞书回答',
    'https://applink.feishu.cn/client/chat/open?openChatId=oc_1']])
  await click('已送达的输入 · 2')
  expect(all('.dt-disclosure-body .dt-row-title').map(title => title.textContent)).toEqual(['自动通知：CI of PR #42 at abc1234: 10 checks, 1 failed, 0 running.'])
  await click('同一发送者之前还有 1 条自动消息')
  expect(text()).toContain('CI of PR #42 at abc1234: 10 checks, 0 failed, 0 running.')
  await click(zh['tab.eval'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  expect(text()).not.toContain('到期后记为未完成')
  const tip = field(zh.evalTimeout).closest('.dt-field')!.querySelector<HTMLElement>('.dt-info')!
  await act(async () => { tip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('到期后记为未完成')
  expect(tip.closest('.dt-field')!.textContent).not.toContain('到期后记为未完成')
  await act(async () => { tip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

it('offers a Ticket awaiting review its review place and Session in the page head', async () => {
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, stage: 'person', action: 'review', threads: [threadSummary(),
    { ...threadSummary({ key: 'github:42', source: 'github', title: '#42 Fix login' }), url: 'https://github.com/acme/widgets/pull/42' }] }
  at({ page: 'execution', id: 't1' })
  await mount()
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh['stage.review'])
  expect(all('.dt-page-head a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['打开 GitHub 原文',
    'https://github.com/acme/widgets/pull/42']])
})

it('keeps what a person types in the Execution settings, converting it once on save', async () => {
  await mount()
  await click(zh['tab.execution'])
  await click(find(zh['tab.settings'], '.dt-status-head button'))
  const blocked = () => field<HTMLInputElement>(zh.blockedCommands), root = () => field<HTMLInputElement>(zh.executionDirectory),
    workers = () => field<HTMLInputElement>(zh.maxWorkers)
  // A separator typed before the next command, a space inside a path and a cleared number stay as typed.
  await type(blocked(), 'gh-personal ')
  expect(blocked().value).toBe('gh-personal ')
  await type(blocked(), 'gh-personal, gh-other')
  await type(root(), '/srv/my work ')
  expect(root().value).toBe('/srv/my work ')
  await type(workers(), '')
  expect(workers().value).toBe('')
  await type(workers(), '2')
  await click(find(zh.save, '#dt-environment-default button'))
  expect(server.requests.find(request => request.path === 'settings/environment:default')?.body).toMatchObject({ revision: 0,
    value: { blockedCommands: ['gh-personal', 'gh-other'], directory: '/srv/my work ' } })
  expect(server.settings.environments.default).toMatchObject({ blockedCommands: ['gh-personal', 'gh-other'], directory: '/srv/my work' })
  // Saving an environment neither submits nor overwrites the independent Executor draft.
  expect(workers().value).toBe('2')
  expect(server.settings.executor.maxWorkers).toBe(3)
  await click(find(zh.save, '#dt-executor-settings button'))
  expect(server.settings.executor).toEqual({ model: null, maxWorkers: 2 })
})

it('says why an Input was not delivered on its Ticket\'s page, in either language', async () => {
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, stage: 'person', action: 'delivery', deliveryError: 'feishu: message recalled' }
  at({ page: 'execution', id: 't1' })
  await mount()
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh['stage.delivery'])
  expect(document.querySelector('.dt-banner.dt-danger')?.textContent).toBe(`${zh.deliveryFailedPrefix}feishu: message recalled`)
  expect(text()).toContain(zh.inputRetryHint)
  expect(text()).not.toContain(zh.inputWaitingHint)
  expect(document.querySelector('.dt-status-line')?.textContent).toMatch(/9月\d+日/)
  await remount(en)
  expect(document.querySelector('.dt-status-line')?.textContent).toMatch(/Sep \d+/)
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(en['stage.delivery'])
  expect(document.querySelector('.dt-banner.dt-danger')?.textContent).toBe(`${en.deliveryFailedPrefix}feishu: message recalled`)
  expect(text()).toContain(en.inputRetryHint)
})

it('tells a Ticket or Thread that does not exist from a dsh-superagent that is not answering', async () => {
  at({ page: 'execution', id: 't9' })
  await mount()
  expect(text()).toContain(zh.ticketNotFound)
  // While dsh-superagent restarts, DSH's web server answers every route with an empty 404.
  at({ page: 'execution', id: 't1' })
  server.down = true
  await remount()
  expect(text()).not.toContain(zh.ticketNotFound)
  expect(text()).toContain(zh.hostNotRunning)
  at({ page: 'trigger', id: 'feishu:oc_1:om_root' })
  await remount()
  expect(text()).not.toContain(zh.threadNotFound)
  expect(text()).toContain(zh.hostNotRunning)
})

it('gives a Ticket a bot\'s message started its basis, marks a Thread it follows for context, and an Input it handed back', async () => {
  const t1 = server.ticketDetails.t1!
  server.ticketDetails.t1 = { ...t1, mandate: { ...t1.mandate, strength: 'inferred', basis: { via: 'bot', sender: '评审机器人',
    observation: { mode: 'auto' } } },
  basis: { facts: [{ name: 'sender', value: '评审机器人' }, { name: 'bot' }, { name: 'mode', value: 'auto' }], legacy: false },
  threads: [threadSummary(), { ...threadSummary({ key: 'github:7', title: '#7 相关 Issue' }), context: true }],
  inputs: [{ id: 'i1', kind: 'trigger', triggerId: 'e2', at: '2026-09-22T00:03:00Z', delivered: true, trigger: { id: 'e2',
    actor: { source: 'feishu', id: MEMBER, name: { zh: 'Alice', en: 'Alice' } }, human: true, preview: '顺便加一个页面',
    thread: 'feishu:oc_1:om_root', handback: { reason: 'Asks for a new page', at: '2026-09-22T00:05:00Z' } } }] }
  at({ page: 'execution', id: 't1' })
  await mount()
  const facts = () => all('.dt-kv > div').map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])
  expect(facts()).toEqual(expect.arrayContaining([[zh['basis.sender'], '评审机器人'], [zh['basis.bot'], zh.yes], [zh['basis.mode'], zh['mode.auto']]]))
  expect(all('.dt-list .dt-ticket').map(row => row.querySelector('.dt-tag')?.textContent)).toEqual([undefined, zh.contextOnly])
  await click(zh.deliveredInputs.replace('{count}', '1'))
  expect(text()).toContain('已交回评估：Asks for a new page')
  await remount(en)
  expect(facts()).toEqual(expect.arrayContaining([[en['basis.bot'], en.yes]]))
  expect(all('.dt-list .dt-ticket').map(row => row.querySelector('.dt-tag')?.textContent)).toEqual([undefined, en.contextOnly])
  await click(en.deliveredInputs.replace('{count}', '1'))
  expect(text()).toContain('Handed back for an Eval: Asks for a new page')
})

it('words an ended Ticket by its outcome, on its row and its page, with a person\'s reason after it', async () => {
  const fields = { id: 't3', title: '已合并的工单', state: 'ended' as const, actions: { retry: false, stop: false },
    ended: { at: '2026-09-21T00:00:00Z', by: 'executor' as const, outcome: 'merged' as const } }
  server.tickets.ended = [ticketSummary(fields, { stage: 'ended' }), ...server.tickets.ended]
  server.ticketDetails.t3 = { ...server.ticketDetails.t1!, ...fields, stage: 'ended' }
  await mount()
  await click(zh['tab.execution'])
  await click(zh['ticket.ended'])
  expect(all('.dt-ticket-stage').map(stage => stage.textContent)).toEqual([zh['outcome.merged'], zh['outcome.stopped']])
  await click('已合并的工单')
  expect(document.querySelector('.dt-status-line .dt-stage')?.textContent).toBe(zh['outcome.merged'])
  expect(text()).toContain(zh['outcome.merged'])
  expect(text()).not.toContain('执行器结束')
  server.ticketDetails.t3 = { ...server.ticketDetails.t3, ended: { at: '2026-09-21T00:00:00Z', by: 'human', outcome: 'stopped',
    reason: '不需要了' } }
  await remount(en)
  expect(all('.dt-hint').map(hint => hint.textContent).find(line => line?.includes(en['outcome.stopped']))).toMatch(/Stopped by a person: 不需要了$/)
})

it('bounds the current blocked banner and retains its full legacy text on demand', async () => {
  const summary = `${'Detailed blocker '.repeat(100)}BLOCKER END`
  server.ticketDetails.t1 = { ...server.ticketDetails.t1!, stage: 'person', action: 'blocked', summary,
    actions: { retry: true, stop: true } }
  at({ page: 'execution', id: 't1' })
  await mount(en)
  const banner = document.querySelector<HTMLElement>('.dt-banner')!
  expect(banner.textContent).not.toContain('BLOCKER END')
  expect(banner.querySelector('.dt-event-text')?.textContent?.length).toBe(161)
  await click(banner.querySelector<HTMLElement>('button')!)
  expect(banner.textContent).toContain(summary)
})

it('uses the current assignment brief in the blocked banner, never a stale brief for a different summary', async () => {
  const ticket = server.ticketDetails.t1!
  const summary = 'Full blocker details '.repeat(50)
  server.ticketDetails.t1 = { ...ticket, stage: 'person', action: 'blocked', summary, actions: { retry: true, stop: true },
    assignments: [{ ...ticket.assignments[0]!, report: { state: 'blocked', at: '2026-09-22T00:05:00Z', summary,
      brief: { conclusion: 'Need a test account', blockers: ['Account unavailable'], nextSteps: ['Provide account'] } } }] }
  at({ page: 'execution', id: 't1' })
  await mount(en)
  expect(document.querySelector('.dt-banner')?.textContent).toContain('Need a test account')
  expect(document.querySelector('.dt-banner')?.textContent).not.toContain(summary)
  await click(en.reportOriginal)
  expect(document.querySelector('.dt-banner')?.textContent).toContain(summary)
  server.ticketDetails.t1 = { ...server.ticketDetails.t1!, summary: 'A newer unrelated blocker' }
  await remount(en)
  expect(document.querySelector('.dt-banner')?.textContent).toContain('A newer unrelated blocker')
  expect(document.querySelector('.dt-banner')?.textContent).not.toContain('Need a test account')
})

it('sends one stop for a double click on Confirm', async () => {
  at({ page: 'execution', id: 't1' })
  await mount()
  await click(zh.stop)
  const confirm = find(zh.confirm)
  await act(async () => { confirm.click(); confirm.click() })
  expect(server.requests.filter(request => request.path === 'tickets/t1/stop')).toHaveLength(1)
})
