/** Tools the external Watchdog Session uses to inspect the host and to report a cycle's conclusion. */
import { z } from 'zod'
import { ticketStage } from '../../core/stage.ts'
import { latestAssignment, waitsForPerson } from '../../core/model.ts'
import type { Health } from '../../sources/host.ts'
import { KV } from '../../kv.ts'
import type { Effects } from '../effects.ts'
import type { Sessions } from '../sessions.ts'
import type { Store } from '../store.ts'
import { tool, type Tool } from './tool.ts'

/** Host dependencies of the Watchdog tools. */
export interface WatchdogToolsHost {
  readonly store: Pick<Store, 'tickets' | 'set'>
  readonly effects: Pick<Effects, 'pending'>
  health(): Readonly<Record<string, Health>>
  executorLoad(): number
  readonly sessions: Pick<Sessions, 'notify'>
  now?(): Date
}

const EFFECT_KINDS = ['assessment', 'launch', 'delivery', 'relay', 'notice', 'reply'] as const

/** One report a Watchdog cycle writes; the value is also injected into the main Session as a notice. */
export const WatchdogReportSchema = z.object({
  task: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).describe('The configured task that produced this report.'),
  summary: z.string().trim().min(1).max(600).describe('One compact paragraph: what is wrong or worth knowing, and what you propose.'),
  report: z.string().trim().min(1).max(8000).describe('The evidence and reasoning, naming Ticket IDs and resource IDs.'),
  proposals: z.array(z.string().trim().min(1).max(1000)).max(10).optional()
    .describe('Concrete changes a person or the next cycle can decide on; omit when there is none.'),
}).strict()

function nowOf(host: WatchdogToolsHost): Date { return host.now?.() ?? new Date() }

/**
 * The Watchdog's two tools: `watchdog_status` reads the host's health, load, pending effects and open Tickets, and
 * `watchdog_report` records a cycle's conclusion and injects it into the main Session. Both are registered only on the
 * Watchdog Session, whose prompt forbids answering people or doing work.
 */
export function watchdogTools(host: WatchdogToolsHost): Tool[] {
  return [
    tool({
      name: 'watchdog_status',
      description: 'Read the host\'s health, worker load, pending effects and open Tickets. Use it at the start of every cycle; '
        + 'follow a Ticket\'s read pointer with orchestrator_read when its state does not explain what is happening.',
      schema: z.object({}).strict(),
      execute: async () => {
        const at = nowOf(host), tickets = host.store.tickets.open()
        const age = (iso: string | undefined) => iso === undefined ? undefined : Math.max(0, at.getTime() - Date.parse(iso))
        return {
          at: at.toISOString(),
          health: host.health(),
          load: { running: host.executorLoad(), open_tickets: tickets.length, waiting_for_person: tickets.filter(ticket => waitsForPerson(ticket)).length },
          effects: Object.fromEntries(EFFECT_KINDS.map(kind => [kind, host.effects.pending(kind)])),
          tickets: tickets.map(ticket => {
            const assignment = latestAssignment(ticket)
            return { ticket_id: ticket.id, title: ticket.title, stage: ticketStage(ticket), read: `ticket/${ticket.id}`,
              ...(assignment ? { assignment: { state: assignment.state, started_at: assignment.startedAt, age_ms: age(assignment.startedAt),
                ...(assignment.report ? { report_state: assignment.report.state, reported_at: assignment.report.at, report_age_ms: age(assignment.report.at) } : {}) } } : {}),
              ...(ticket.attention ? { attention: ticket.attention.question } : {}), ...(ticket.delivery ? { delivery_error: ticket.delivery.error } : {}) }
          }),
        }
      },
    }),
    tool({
      name: 'watchdog_report',
      description: 'Record one cycle\'s conclusion and deliver it to the main Session. Use the smallest summary that names what is wrong, '
        + 'the evidence, and the proposed change; write nothing when the cycle found nothing a person must know.',
      schema: WatchdogReportSchema,
      execute: async args => {
        const value = { at: nowOf(host).toISOString(), summary: args.summary, report: args.report, ...(args.proposals ? { proposals: args.proposals } : {}) }
        host.store.set(KV.watchdog.report(args.task), value)
        host.sessions.notify(`watchdog:${args.task}`, { ...value, task: args.task }, args.summary)
        return { recorded: true, task: args.task }
      },
    }),
  ]
}
