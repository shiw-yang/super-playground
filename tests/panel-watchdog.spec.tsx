// @vitest-environment jsdom
/** The Watchdog surfaces: the overview block, the scheduled signals on Triggers, the page, and its settings group. */
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { all, click, field, find, mount, tab, text, usePanel } from './fixtures/panel.tsx'
import { server } from './fixtures/panel-server.ts'

usePanel()

const enable = () => { server.settings = { ...server.settings, watchdog: { ...server.settings.watchdog, enabled: true } } }

it('shows the Watchdog on the overview and one scheduled signal per task on Triggers', async () => {
  enable()
  await mount()
  expect(text()).toContain(zh.watchdogIdle)
  await click(tab(zh['tab.trigger']))
  expect(text()).toContain(zh.scheduledSignals)
  for (const task of server.settings.watchdog.tasks) expect(text()).toContain(task.id)
  expect(text()).toContain('*/15 * * * *')
})

it('opens the Watchdog page and its Session', async () => {
  enable()
  await mount()
  await click(tab(zh['tab.watchdog']))
  expect(text()).toContain(zh.watchdogIdle)
  expect(text()).toContain('patrol')
  await click(find(zh.openSession))
  expect(server.opened.some(id => id.startsWith('watchdog-session-'))).toBe(true)
})

it('edits and saves the Watchdog task list in Settings', async () => {
  await mount()
  await click(tab(zh['tab.settings']))
  await click(find(zh['settingsGroup.watchdog'], '.dt-settings-link'))
  expect(field(zh.watchdogTaskId)).toBeTruthy()
  const before = server.requests.filter(request => request.method === 'PUT' && request.path === 'settings/watchdog').length
  const enabled = find(zh.watchdogEnabled, '[role="switch"]')
  await click(enabled)
  await click(zh.save)
  expect(server.requests.filter(request => request.method === 'PUT' && request.path === 'settings/watchdog').length).toBe(before + 1)
  expect(server.settings.watchdog.enabled).toBe(true)
})
