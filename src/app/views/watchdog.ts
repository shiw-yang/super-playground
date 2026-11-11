/** Watchdog view for the overview, the Triggers page and the Watchdog page: tasks, next runs, last runs and reports. */
import type { WatchdogConfig } from '../../policy.ts'
import type { Health } from '../../sources/host.ts'
import { KV } from '../../kv.ts'
import type { Store } from '../store.ts'

/** A report a Watchdog cycle wrote, as stored in `KV.watchdog.report`. */
export type WatchdogReportView = { at: string; summary: string; report: string; proposals?: string[] }
/** Host dependencies of the Watchdog view. */
export interface WatchdogViewHost {
  readonly store: Pick<Store, 'get'>
  readonly watchdog: {
    sessionId(taskId: string): string
    config(): WatchdogConfig
    busy(): boolean
    nextAt(id: string): Date | undefined
    lastRun(id: string): string | undefined
    report(id: string): WatchdogReportView | undefined
  }
  readonly health: Readonly<Record<string, Health>>
  now?(): Date
}
export type WatchdogView = ReturnType<typeof watchdogView>

/** Build the panel's Watchdog state: whether it runs, its Session, and one row per configured task. */
export function watchdogView(host: WatchdogViewHost) {
  const config = host.watchdog.config(), now = host.now?.() ?? new Date()
  const lastRun = (id: string) => {
    const request = host.watchdog.lastRun(id)
    if (!request) return null
    const prefix = `watchdog:${id}:`
    return { request_id: request, at: request.startsWith(prefix) ? request.slice(prefix.length) : null }
  }
  return {
    enabled: config.enabled,
    busy: host.watchdog.busy(),
    updated_at: now.toISOString(),
    health: host.health.watchdog ?? null,
    tasks: config.tasks.map(task => {
      const report = host.watchdog.report(task.id)
      return {
        id: task.id,
        schedule: task.schedule,
        enabled: task.enabled,
        prompt: task.prompt,
        session_id: config.enabled ? host.watchdog.sessionId(task.id) : null,
        next_at: host.watchdog.nextAt(task.id)?.toISOString() ?? null,
        last_run: lastRun(task.id),
        report: report ? { at: report.at, summary: report.summary, report: report.report, ...(report.proposals ? { proposals: report.proposals } : {}) } : null,
      }
    }),
  }
}
