/** One batched GraphQL read that tells which polled Issues and pull requests changed, so unchanged ones cost no REST read. */
import { z } from 'zod'
import type { Commands } from '../infra/commands.ts'

/** What one change check learned about an Issue or pull request. */
export interface ProbeChange {
  /** GitHub's last update of the Issue or PR: a comment, review, edit, label, state or merge moves it. */
  updatedAt?: string
  state?: string
  merged?: boolean
  /** The head commit, whose checks are read when this pull request changed. */
  head?: string
  /** The overall CI state of the head commit, or `null` when no check or status reports one. */
  rollup?: string | null
}
/** One number the check covers, and whether it needs a pull request's state and CI fields. */
export interface ProbeTarget { number: number; checks: boolean }
/** Numbers per GraphQL call; a call with 100 aliases costs about one point of the separate GraphQL budget. */
export const PROBE_BATCH = 100
const NodeSchema = z.looseObject({ updatedAt: z.string(), state: z.string().nullish(), merged: z.boolean().nullish(),
  headRefOid: z.string().nullish(), statusCheckRollup: z.looseObject({ state: z.string().nullish() }).nullish() })
const AnswerSchema = z.looseObject({
  data: z.looseObject({ repository: z.record(z.string(), z.unknown()).nullish() }).nullish(),
  errors: z.array(z.looseObject({ message: z.string() })).nullish(),
})
/** One aliased field for a number; `checks` also asks for what an open Ticket's pull request polls. */
const field = (target: ProbeTarget): string =>
  `t${target.number}: issueOrPullRequest(number: ${target.number}) { ... on Issue { updatedAt } ... on PullRequest { updatedAt`
  + `${target.checks ? ' state merged headRefOid statusCheckRollup { state }' : ''} } }`
/**
 * Asks GitHub in batched GraphQL calls, which draw on the account's separate GraphQL budget, which of `targets` changed.
 * A number GitHub cannot answer for is absent from the result, so its own read decides what happened; a call that fails
 * throws, and the caller falls back to reading every target on its own.
 */
export async function probeChanges(commands: Commands, targets: readonly ProbeTarget[]): Promise<Map<number, ProbeChange>> {
  const [owner, name] = commands.deployment.repository.split('/')
  if (!owner || !name) throw new Error('The GitHub Source names no repository')
  const changes = new Map<number, ProbeChange>()
  for (let start = 0; start < targets.length; start += PROBE_BATCH) {
    const batch = targets.slice(start, start + PROBE_BATCH)
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${batch.map(field).join(' ')} } }`
    const answer = AnswerSchema.parse(await commands.graphql(query, { owner, name }))
    if (!answer.data?.repository) throw new Error(`GitHub GraphQL returned no repository${answer.errors?.[0]?.message ? `: ${answer.errors[0].message}` : ''}`)
    for (const target of batch) {
      const parsed = NodeSchema.safeParse(answer.data.repository[`t${target.number}`])
      if (!parsed.success) continue
      const value = parsed.data
      changes.set(target.number, { updatedAt: value.updatedAt, ...target.checks ? {
        ...value.state ? { state: value.state } : {}, ...value.merged != null ? { merged: value.merged } : {},
        ...value.headRefOid ? { head: value.headRefOid } : {}, rollup: value.statusCheckRollup?.state ?? null } : {} })
    }
  }
  return changes
}
