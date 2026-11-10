/** Pull request binding, lifecycle observation, and terminal IM notification helpers. */
import { z } from 'zod'
import { key, liveTicket, type Follow, type OutboundMessage, type ThreadFact, type Ticket } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import { sameName } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import { githubAddress, githubPage, githubThread, SOURCE, UserSchema } from './github-trigger.ts'

const PullSchema = z.looseObject({
  title: z.string().optional(), state: z.string(), html_url: z.string(), user: UserSchema,
  body: z.string().nullish(), created_at: z.string().optional(),
  merged: z.boolean().optional(), merged_at: z.string().nullish(), closed_at: z.string().nullish(), auto_merge: z.unknown().optional(),
  head: z.looseObject({ sha: z.string(), ref: z.string(), repo: z.looseObject({ full_name: z.string() }).nullish() }),
})
export type Pull = z.infer<typeof PullSchema> & { number: number }
export const readPull = async (ctx: SourceContext, number: number, signal?: AbortSignal): Promise<Pull> =>
  ({ ...await ctx.commands.withSignal(signal).api(PullSchema, `pulls/${number}`), number })
type PullTicket = Pick<Ticket, 'follows'> & Partial<Pick<Ticket, 'execution'>>
/** Legacy tickets used the default GitHub instance; a bound no-repository environment must never fall back to it. */
export const githubSourceOf = (ticket: Partial<Pick<Ticket, 'execution'>>): string | undefined =>
  ticket.execution?.environment ? ticket.execution.environment.sources.github : SOURCE
const pullNumber = (thread: string, source: string): number | undefined => {
  if (!thread.startsWith(`${source}:`)) return undefined
  const id = thread.slice(source.length + 1)
  return /^[1-9]\d*$/.test(id) ? Number(id) : undefined
}
export const pullsOf = (ticket: PullTicket, open = false, source = githubSourceOf(ticket)): number[] =>
  source ? (ticket.follows ?? []).filter(item => !open || !item.closed).flatMap(item => pullNumber(item.thread, source) ?? []) : []
export const pullOf = (ticket: PullTicket): number | undefined => pullsOf(ticket, true).at(-1) ?? pullsOf(ticket).at(-1)
/** True when the PR was opened by the agent account from a branch in this Source's repository (not a fork). */
export const agentPull = (pr: { user: { login: string }; head?: { repo?: { full_name: string } | null } | null },
  deployment: Pick<Deployment, 'github' | 'repository'>): boolean =>
  sameName(pr.user.login, deployment.github.login) && sameName(pr.head?.repo?.full_name ?? '', deployment.repository)
/** The final branch path segment is the ticket's short name, such as `agent/<name>`. */
export const ticketBranch = (ticket: Pick<Ticket, 'execution'>, ref: string): boolean =>
  !!ticket.execution?.name && ref.split('/').at(-1) === ticket.execution.name
const AUTO_MERGE_ON: ThreadFact = { label: { zh: '自动合并', en: 'Auto-merge' }, value: { zh: '已开启', en: 'on' } }

/** Binds only the ticket's execution repository, and permits only one open ticket to own a PR within that Source. */
export function claimPull(ctx: SourceContext, ticketId: string, pr: Pull): string | undefined {
  const ticket = ctx.tickets.get(ticketId)
  if (!ticket || !liveTicket(ticket)) return 'Ticket ended because its PR was closed'
  if (githubSourceOf(ticket) !== ctx.id) return 'PR belongs to another execution Source'
  const address = githubAddress(pr.html_url, ctx.deployment.repository)
  if (!address?.pr || address.number !== pr.number) return 'PR belongs to another repository'
  const source = ctx.triggers.get(ticket.origin.triggerId)
  const started = source?.source === ctx.id && source.meta.isPr === true && source.meta.number === pr.number
  const opened = agentPull(pr, ctx.deployment) && ticketBranch(ticket, pr.head.ref)
  if (!started && !opened) {
    const { login } = ctx.deployment.github
    return `PR does not belong to this ticket: use the source PR or a PR by ${login} from a branch whose last path segment is DSH_SUPERAGENT_NAME; omit pr_number when no PR exists`
  }
  const owner = ctx.tickets.open().find(item => pullsOf(item, true, ctx.id).includes(pr.number))
  if (owner && owner.id !== ticketId) return 'PR already belongs to another active ticket'
  const follow = ticket.follows?.find(item => item.thread === githubThread(pr.number, ctx.id))
  if (pr.state === 'open' && (!follow || follow.closed || (opened && !follow.own))) bind(ctx, ticketId, pr, opened)
  return undefined
}
/** Reconciles a PR with only the tickets bound to this instance, even when other repositories use the same branch name. */
export async function observePull(ctx: SourceContext, pr: Pull): Promise<boolean> {
  const ended = pr.state === 'closed' || !!pr.merged
  if (ended) closePull(ctx, pr)
  else {
    const candidates = agentPull(pr, ctx.deployment)
      ? ctx.tickets.open().filter(ticket => githubSourceOf(ticket) === ctx.id && ticketBranch(ticket, pr.head.ref)) : []
    const ticket = candidates.length === 1 ? candidates[0]! : undefined
    const reopened = ticket?.follows?.some(item => item.thread === githubThread(pr.number, ctx.id) && item.closed)
    if (ticket && (reopened || pullsOf(ticket, true, ctx.id).every(number => number === pr.number))) claimPull(ctx, ticket.id, pr)
  }
  ctx.threads.describe(githubThread(pr.number, ctx.id), { facts: { autoMerge: !ended && pr.auto_merge != null ? AUTO_MERGE_ON : null } })
  return ended
}
function bind(ctx: SourceContext, ticketId: string, pr: Pull, own: boolean): void {
  ctx.atomic(() => {
    ctx.tickets.bindThread(ticketId, { source: ctx.id, id: String(pr.number) }, own)
    ctx.threads.patch(githubThread(pr.number, ctx.id), { number: pr.number, isPr: true, url: pr.html_url, prAuthor: pr.user.login,
      ...ctx.id !== SOURCE ? { repository: ctx.deployment.repository.toLowerCase() } : {} })
  })
}
/** Reports closure only to tickets following this exact instance's Thread; subscriptions remain for later follow-ups. */
function closePull(ctx: SourceContext, pr: Pull): void {
  if (!ctx.tickets.open().some(ticket => pullsOf(ticket, true, ctx.id).includes(pr.number))) return
  const at = pr.merged_at ?? pr.closed_at ?? new Date().toISOString()
  ctx.tickets.threadClosed({ source: ctx.id, id: String(pr.number) }, pr.merged ? 'merged' : 'closed', at)
}
/** Idempotent IM notices for the last closed PR, resolved through the ticket's bound Source rather than a global repository. */
export function pullEndNotices(ticket: Ticket, request: string, repositoryOf: string | ((source: string) => string | undefined)): OutboundMessage[] {
  const source = githubSourceOf(ticket)
  if (!source) return []
  const repository = typeof repositoryOf === 'string' ? repositoryOf : repositoryOf(source)
  if (!repository) return []
  const outcome = ticket.ended?.outcome
  const follows = (ticket.follows ?? []).filter(item => item.closed && pullNumber(item.thread, source) !== undefined)
  const latest = (items: Follow[]) => items.sort((a, b) => b.closed!.at.localeCompare(a.closed!.at))[0]
  const follow = latest(follows.filter(item => item.own)) ?? latest(follows)
  if ((outcome !== 'merged' && outcome !== 'closed') || !follow) return []
  const number = pullNumber(follow.thread, source)!
  const url = githubPage(repository, number, true)
  const chinese = /\p{Script=Han}/u.test(request) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(request)
  const text = chinese
    ? outcome === 'merged' ? `[PR #${number}](${url}) 已合并。` : `[PR #${number}](${url}) 已关闭，未合并。`
    : outcome === 'merged' ? `[PR #${number}](${url}) has merged.` : `[PR #${number}](${url}) was closed without merging.`
  return ticket.channels.filter(channel => channel.source !== SOURCE && channel.source !== source && !channel.address.repository).map(channel => ({
    id: source === SOURCE ? key('pr-terminal', String(number), channel.source, JSON.stringify(channel.address), outcome)
      : key('pr-terminal', source, repository.toLowerCase(), String(number), channel.source, JSON.stringify(channel.address), outcome),
    channel, text, kind: 'notice', ticketId: ticket.id }))
}
