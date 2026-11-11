// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionOverview, navigateFromSession } from '../src/client/session-view.tsx'
import { zh } from '../src/client/locales.ts'
import { initialLocation } from '../src/client/route.ts'
import { settle, translator } from './fixtures/panel.tsx'
import { server, usePanelServer } from './fixtures/panel-server.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined
usePanelServer(() => { act(() => root?.unmount()); container?.remove(); root = undefined })
afterEach(() => sessionStorage.clear())

async function mount(sessionId: string, navigate = vi.fn()) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<SessionOverview sessionId={sessionId as SessionId} t={translator(zh)}
    navigate={navigate} openSession={async () => {}} />) })
  await settle()
  return { navigate, container }
}

it('shows the matching Ticket detail and routes its back action to Execution', async () => {
  const view = await mount('worker-t1')
  expect(view.container.textContent).toContain('修复回归')
  expect(view.container.textContent).toContain(zh.mandateDetails)
  const back = view.container.querySelector<HTMLButtonElement>('.dt-page-head button')
  expect(back).not.toBeNull()
  await act(async () => { back!.click() })
  expect(view.navigate).toHaveBeenCalledWith({ page: 'execution' })
})

it('refuses unrelated Sessions and worker IDs with no matching Ticket ownership', async () => {
  const ordinary = await mount('regular')
  expect(ordinary.container.textContent).toContain(zh.sessionOverviewUnavailable)
  expect(server.requests.some(request => request.path.startsWith('tickets/'))).toBe(false)
  act(() => root?.unmount()); ordinary.container.remove(); root = undefined
  server.ticketDetails.t1 = { ...server.ticketDetails.t1!, sessionId: 'worker-other' }
  const mismatch = await mount('worker-t1')
  expect(mismatch.container.textContent).toContain(zh.sessionOverviewUnavailable)
  expect(mismatch.container.textContent).not.toContain('修复回归')
})

it('remembers a linked record before selecting the management panel', () => {
  const select = vi.fn()
  navigateFromSession({ page: 'trigger', id: 'feishu:one' }, select)
  expect(select).toHaveBeenCalledOnce()
  expect(initialLocation().route).toEqual({ page: 'trigger', id: 'feishu:one' })
})
