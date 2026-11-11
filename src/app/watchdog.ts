/**
 * The external Watchdog control loop: one long-lived Session driven by a configurable list of cron-scheduled messages.
 * Each task reads the host's state, judges whether Workers are progressing, and reports or intervenes within the authority
 * its prompt grants. It is deliberately not a Router or a Worker: it never accepts requests or does a Ticket's work.
 * This is the demo implementation of the design's D25-D27; the design remains the authority.
 */
import type { HealthEntry } from '../infra/health.ts'
import { KV } from '../kv.ts'
import { nextCron } from '../cron.ts'
import type { WatchdogConfig, WatchdogTask } from '../policy.ts'
import { watchdogTaskPrompt } from './context.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'

/** The fixed prompt of a task with no inline text and no packaged file. */
const DEFAULT_TASK_PROMPT = 'Run this Watchdog cycle. Read the host state with watchdog_status, judge what is wrong or worth '
  + 'knowing, and report with watchdog_report only what a person must know or act on. End the turn otherwise.'

/** Host dependencies of the Watchdog loop. */
export interface WatchdogHost {
  readonly sessions: Pick<Sessions, 'prompt' | 'busy'>
  readonly store: Pick<Store, 'get' | 'set' | 'tickets'>
  readonly health: HealthEntry
  /** The Session that runs one configured task. */
  sessionId(taskId: string): string
  /** The current watchdog settings, read on every cycle and reload. */
  settings(): WatchdogConfig
  /** Ensure one task's Session exists; called when a settings save enables it at runtime. */
  ensure(taskId: string): Promise<void>
  readonly lifetime: AbortSignal
  /** Clock injection for tests; the real loop uses the wall clock. */
  now?(): Date
}

/** What a task sends: its inline prompt, else the packaged prompt for its id, else the generic cycle prompt. */
export function watchdogPromptOf(task: WatchdogTask): string {
  return task.prompt.trim() || watchdogTaskPrompt(task.id) || DEFAULT_TASK_PROMPT
}

/**
 * Arms one cron timer per enabled task and asks the Watchdog Session to work when it fires. A cycle is skipped while the
 * Watchdog's previous turn still runs, so a slow cycle cannot pile up. `reload` re-arms after a settings save; a disabled
 * Watchdog stays silent, and an invalid task reports the error on the `watchdog` health entry instead of stopping the host.
 */
export class Watchdog {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private stopped = false
  constructor(private readonly host: WatchdogHost) {
    host.lifetime.addEventListener('abort', () => this.stop(), { once: true })
  }
  /** Arm every enabled task from the current settings. Called at startup and after a settings save. */
  async start(): Promise<void> { await this.reload() }
  /** Re-read the settings and re-arm; a disabled Watchdog records that and clears every timer. */
  async reload(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    if (this.stopped) return
    const config = this.host.settings()
    if (!config.enabled) {
      this.host.health.set({ state: 'ready', detail: 'Watchdog is disabled', at: this.now().toISOString() })
      return
    }
    const errors: string[] = [], armed: string[] = []
    for (const task of config.tasks) {
      if (!task.enabled) continue
      try { await this.host.ensure(task.id); this.arm(task); armed.push(task.id) }
      catch (error) { errors.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    this.host.health.set(errors.length
      ? { state: 'error', detail: `Watchdog tasks could not be scheduled: ${errors.join('; ')}`, at: this.now().toISOString() }
      : { state: 'ready', detail: armed.length ? `Watchdog is waiting for ${armed.join(', ')}` : 'No Watchdog task is enabled',
        at: this.now().toISOString() })
  }
  /** Clear every timer; the Session itself is disposed by Runtime's shutdown. */
  stop(): void {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
  /**
   * Start one task now, if the Watchdog is enabled and idle. Its message is the task's prompt followed by the cycle time.
   * @returns whether the Session was asked, was busy, unknown, or the Watchdog is disabled.
   */
  async run(id: string): Promise<'prompted' | 'busy' | 'disabled' | 'unknown' | 'failed'> {
    const config = this.host.settings()
    if (!config.enabled || this.stopped) return 'disabled'
    const task = config.tasks.find(item => item.id === id)
    if (!task || !task.enabled) return 'unknown'
    const sessionId = this.host.sessionId(task.id)
    if (this.host.sessions.busy(sessionId)) return 'busy'
    const at = this.now(), requestId = `watchdog:${task.id}:${at.toISOString()}`
    try {
      await this.host.sessions.prompt(sessionId, requestId,
        `${watchdogPromptOf(task)}\nCycle time: ${at.toISOString()}.`, 'queue')
      this.host.store.set(KV.watchdog.lastRun(task.id), requestId)
      this.host.health.set({ state: 'ready', detail: `The last ${task.id} cycle started at ${at.toISOString()}`, at: at.toISOString() })
      return 'prompted'
    } catch (error) {
      this.host.health.set({ state: 'error', detail: `The ${task.id} cycle could not start: ${error instanceof Error ? error.message : String(error)}`,
        at: at.toISOString() })
      return 'failed'
    }
  }
  /** The request ID of the last cycle `id` started, or undefined before its first run. */
  lastRun(id: string): string | undefined { return this.host.store.get(KV.watchdog.lastRun(id)) }
  /** The latest report `id` wrote, or undefined. */
  report(id: string) { return this.host.store.get(KV.watchdog.report(id)) }
  /** The next occurrence of `id` after now, or undefined when the task is disabled or its expression is invalid. */
  nextAt(id: string, now = this.now()): Date | undefined {
    const config = this.host.settings(), task = config.tasks.find(item => item.id === id)
    if (!config.enabled || !task?.enabled) return undefined
    try { return nextCron(task.schedule, now) } catch { return undefined }
  }
  /** The Session one task runs in. */
  sessionId(taskId: string): string { return this.host.sessionId(taskId) }
  /** Every configured task's Session id. */
  sessionIds(): string[] { return this.host.settings().tasks.map(task => this.host.sessionId(task.id)) }
  /** Whether one task, or any task, has a turn running. */
  busy(taskId?: string): boolean {
    return taskId === undefined ? this.sessionIds().some(id => this.host.sessions.busy(id)) : this.host.sessions.busy(this.host.sessionId(taskId))
  }
  /** Current settings, for views and the settings page. */
  config(): WatchdogConfig { return this.host.settings() }
  private arm(task: WatchdogTask): void {
    const now = this.now(), due = nextCron(task.schedule, now), delay = Math.max(1, due.getTime() - now.getTime())
    // Node timers cap a delay at about 24.8 days; a farther occurrence re-arms instead of firing early.
    const timer = setTimeout(() => {
      this.timers.delete(task.id)
      if (this.now().getTime() < due.getTime()) { this.arm(task); return }
      void this.run(task.id).finally(() => { if (!this.stopped) this.armIfStillConfigured(task.id) })
    }, Math.min(delay, 2_147_000_000))
    timer.unref?.()
    this.timers.set(task.id, timer)
  }
  /** After a fired cycle, re-arm only when the task still exists and is enabled; a save's `reload` replaces this timer. */
  private armIfStillConfigured(id: string): void {
    const config = this.host.settings(), task = config.tasks.find(item => item.id === id)
    if (config.enabled && task?.enabled && !this.stopped) { try { this.arm(task) } catch (error) {
      this.host.health.set({ state: 'error', detail: `The ${id} cycle could not be rescheduled: ${error instanceof Error ? error.message : String(error)}`,
        at: this.now().toISOString() })
    } }
  }
  private now(): Date { return this.host.now?.() ?? new Date() }
}
