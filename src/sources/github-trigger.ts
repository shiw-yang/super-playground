/** Normalizes GitHub issues, pull requests, comments, reviews, and CI transitions into domain Triggers. */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import { escapeRegExp, sameName } from '../infra/text.ts'
import type { SourceContext } from './host.ts'

export const SOURCE = 'github'
export interface GithubIdentity { id: string; repository: string }
export const githubIdentity = (ctx: Pick<SourceContext, 'id' | 'deployment'>): GithubIdentity =>
  ({ id: ctx.id, repository: ctx.deployment.repository })
export const githubThread = (number: number | string, source = SOURCE): string => `${source}:${number}`
const sourceOf = (identity?: GithubIdentity): string => identity?.id ?? SOURCE
const repositoryMeta = (identity?: GithubIdentity): { repository?: string } =>
  identity && identity.id !== SOURCE ? { repository: identity.repository.toLowerCase() } : {}
const triggerKey = (prefix: string, identity: GithubIdentity | undefined, ...parts: string[]): string =>
  identity && identity.id !== SOURCE ? key(prefix, identity.id, identity.repository.toLowerCase(), ...parts) : key(prefix, ...parts)
/** GitHub reply address; named instances retain their canonical repository and legacy addresses remain unchanged. */
export const githubChannel = (number: number, url?: string, identity?: GithubIdentity): ChannelRef =>
  ({ source: sourceOf(identity), thread: githubThread(number, sourceOf(identity)),
    address: { number: String(number), ...repositoryMeta(identity), ...(url ? { url } : {}) } })
export const githubPage = (repository: string, number: number, pr = false): string =>
  `https://github.com/${repository}/${pr ? 'pull' : 'issues'}/${number}`
/** Parses a web or API URL for an Issue, PR, or review comment in `repository`; returns undefined for other URLs or repositories. */
export function githubAddress(url: string, repository: string): { number: number; pr: boolean; discussion?: number } | undefined {
  const address = /^https:\/\/(?:api\.github\.com\/repos|github\.com)\/([^/]+\/[^/]+)\/(issues|pulls?)\/(\d+)\/?(?:#discussion_r(\d+)|#[\w-]*)?$/i
  const match = address.exec(url)
  if (!match || !sameName(match[1]!, repository)) return undefined
  return { number: Number(match[3]), pr: match[2]!.toLowerCase() !== 'issues', ...match[4] ? { discussion: Number(match[4]) } : {} }
}
/** GitHub returns a deleted account as `null` and displays it as `ghost`. */
export const UserSchema = z.looseObject({ login: z.string(), type: z.string().optional() }).nullable()
  .transform(user => user ?? { login: 'ghost', type: 'User' })
/** A comment/review, including inline location and review-thread root when GitHub supplies them. */
export const CommentSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), user: UserSchema, html_url: z.string().nullish(),
  created_at: z.string().nullish(), updated_at: z.string().nullish(), submitted_at: z.string().nullish(),
  state: z.string().nullish(), commit_id: z.string().nullish(),
  path: z.string().nullish(), line: z.number().nullish(), original_line: z.number().nullish(), diff_hunk: z.string().nullish(),
  in_reply_to_id: z.number().nullish(),
})
export type GithubComment = z.infer<typeof CommentSchema>
/** An Issue as `issues/<number>` returns it; GitHub sets `pull_request` when the number is a pull request. */
export const IssueSchema = CommentSchema.extend({
  number: z.number(), title: z.string(), state: z.string(), created_at: z.string(), html_url: z.string(),
  pull_request: z.looseObject({ url: z.string() }).nullish(),
})
export type GithubIssue = z.infer<typeof IssueSchema>
type Opened = Pick<GithubIssue, 'number' | 'title' | 'body' | 'user' | 'created_at' | 'html_url'>
export interface PullRef { number: number; isPr: boolean; url?: string; prAuthor?: string }
/** Regular accounts are people; GitHub Apps and bot logins never originate explicit work. */
export const isHumanLogin = (user: { login: string; type?: string }): boolean =>
  !/\[bot\]$/.test(user.login) && (!user.type || user.type === 'User')
/** Formats an inline review comment's file:line and the trailing lines of its diff hunk. */
export function reviewPlace(comment: GithubComment): string {
  const line = comment.line ?? comment.original_line
  const hunk = (comment.diff_hunk ?? '').split('\n').slice(-3).join('\n')
  return [`${comment.path}${line != null ? `:${line}` : ''}`, hunk].filter(Boolean).join('\n')
}
function commentText(comment: GithubComment, kind: 'conversation' | 'inline' | 'review'): string {
  const decided = kind === 'review' && comment.state && comment.state !== 'COMMENTED'
  const decision = decided ? `${comment.state} review of commit ${comment.commit_id ?? 'unknown'}` : ''
  const place = kind === 'inline' && comment.path ? reviewPlace(comment) : ''
  return [decision, place, comment.body ?? ''].filter(Boolean).join('\n\n')
}
export const mentions = (text: string, login: string): boolean =>
  new RegExp(`(?:^|[^a-zA-Z0-9_@])@${escapeRegExp(login)}(?![a-zA-Z0-9_-])`, 'i').test(text)
const author = (user: { login: string; type?: string }, agent: string, source: string) =>
  ({ actor: { source, id: user.login }, human: isHumanLogin(user) && !sameName(user.login, agent) })
/** Builds a comment/review Trigger; instance and repository scope prevent collisions in every read path. */
export function commentTrigger(comment: GithubComment, ref: PullRef, kind: 'conversation' | 'inline' | 'review', agent: string,
  identity?: GithubIdentity): Trigger {
  const source = sourceOf(identity)
  const at = comment.updated_at ?? comment.submitted_at ?? comment.created_at ?? new Date().toISOString()
  const version = comment.updated_at ?? comment.submitted_at ?? ''
  const id = triggerKey('github-comment', identity, comment.html_url ?? `github:${ref.number}`, String(comment.id), version)
  return { id, source, threads: [{ source, id: String(ref.number) }], ...author(comment.user, agent, source), at,
    text: commentText(comment, kind),
    ...(mentions(comment.body ?? '', agent) ? { addressed: 'mention' as const } : {}),
    channel: githubChannel(ref.number, comment.html_url ?? undefined, identity),
    ...(comment.html_url ?? ref.url ? { url: comment.html_url ?? ref.url } : {}),
    meta: { ...repositoryMeta(identity), number: ref.number, isPr: ref.isPr, ...(ref.prAuthor ? { prAuthor: ref.prAuthor } : {}), commentId: comment.id, kind,
      ...comment.path ? { path: comment.path, line: comment.line ?? comment.original_line ?? null } : {},
      ...comment.in_reply_to_id ? { inReplyTo: comment.in_reply_to_id } : {} } }
}
/** New Issue body, preserving the legacy default instance's persisted ID exactly. */
export function issueTrigger(issue: Opened, agent: string, identity?: GithubIdentity): Trigger {
  const source = sourceOf(identity)
  const body = issue.body ?? ''
  return { id: triggerKey('github-issue', identity, String(issue.number)), source,
    threads: [{ source, id: String(issue.number) }], ...author(issue.user, agent, source), at: issue.created_at,
    text: `${issue.title}\n\n${body}`,
    ...(mentions(body, agent) ? { addressed: 'mention' as const } : {}),
    channel: githubChannel(issue.number, issue.html_url, identity), url: issue.html_url,
    meta: { ...repositoryMeta(identity), number: issue.number, isPr: false, kind: 'issue' } }
}
/** PRs share the repository's Issue number sequence and use the same scoped body identity. */
export function pullTrigger(pull: Opened, agent: string, identity?: GithubIdentity): Trigger {
  const trigger = issueTrigger(pull, agent, identity)
  return { ...trigger, meta: { ...trigger.meta, isPr: true, prAuthor: pull.user.login, kind: 'pull' } }
}
/** Default-branch CI has no person to reply to and therefore no channel. */
export function branchCiTrigger(branch: string, sha: string, revision: number, summary: string, url: string, identity?: GithubIdentity): Trigger {
  const source = sourceOf(identity)
  return { id: triggerKey('github-ci', identity, `branch:${branch}`, String(revision)), source,
    threads: [{ source, id: `ci:${branch}` }], actor: { source, id: '' }, human: false, at: new Date().toISOString(),
    text: summary, url, meta: { ...repositoryMeta(identity), ci: true, branch, sha, revision } }
}
export function ciTrigger(pr: { number: number; html_url: string; user: { login: string } }, revision: number, summary: string,
  identity?: GithubIdentity): Trigger {
  const source = sourceOf(identity)
  return { id: triggerKey('github-ci', identity, String(pr.number), String(revision)), source, threads: [{ source, id: String(pr.number) }],
    actor: { source, id: '' }, human: false, at: new Date().toISOString(),
    text: summary, channel: githubChannel(pr.number, undefined, identity), url: pr.html_url,
    meta: { ...repositoryMeta(identity), number: pr.number, isPr: true, prAuthor: pr.user.login, ci: true, revision } }
}
