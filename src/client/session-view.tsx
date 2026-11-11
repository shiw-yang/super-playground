/** Ticket detail in the Conversation view of an Executor Session. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ApiError, usePoll } from './api.ts'
import { PanelProvider, usePanel } from './provider.tsx'
import { remember, type Route } from './route.ts'
import type { T } from './text.ts'
import { TicketPage } from './ticket.tsx'
import { Hint, LoadState } from './widgets.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.view': { kind: 'list'; scope: 'session'; owner: {
      inspectCall: ((callId: string) => void) | undefined
      viewRequest: unknown
      openView: (view: string, focus: string) => void
      completeViewRequest: () => void
    } }
  }
}

function WorkerTicket({ id, sessionId }: { id: string; sessionId: string }) {
  const { t, call } = usePanel()
  const { data, error } = usePoll(() => call('GET tickets/:id', { id }), [id])
  if (error instanceof ApiError && error.missing) return <Hint>{t('sessionOverviewUnavailable')}</Hint>
  if (!data) return <LoadState error={error} loading />
  if (data.id !== id || data.sessionId !== sessionId) return <Hint>{t('sessionOverviewUnavailable')}</Hint>
  return <TicketPage id={id} />
}

/** The ticket endpoint confirms that the Executor Session belongs to the requested Ticket. */
export function SessionOverview({ sessionId, t, navigate, openSession }: {
  sessionId: SessionId; t: T; navigate: (route: Route) => void; openSession: (id: string) => Promise<void>
}) {
  const id = sessionId.startsWith('worker-') ? sessionId.slice('worker-'.length) : ''
  return <PanelProvider t={t} navigate={navigate} openSession={openSession} back={() => navigate({ page: 'execution' })}
    backLabel={t('tab.execution')}>
    <div className="dt-page"><main className="dt-column dt-main">
      {id ? <WorkerTicket key={sessionId} id={id} sessionId={sessionId} /> : <Hint>{t('sessionOverviewUnavailable')}</Hint>}
    </main></div>
  </PanelProvider>
}

/** Open a related management view in the existing central panel. */
export function navigateFromSession(route: Route, selectPanel: () => void): void {
  remember({ route, stack: [] })
  selectPanel()
}
