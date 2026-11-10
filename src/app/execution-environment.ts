/** Non-secret execution facts shared by prepare commands, Worker prompts and management views. */
import { join } from 'node:path'
import type { Ticket, Trigger } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import type { EnvironmentConfig, Settings } from '../policy.ts'
import type { Localized, VariableSpec } from '../sources/kind.ts'
import type { SourceRegistry } from '../sources/registry.ts'

/** Variables registered by the Executor; `ticket` entries are populated only for a bound Ticket. */
export const EXECUTOR_VARIABLES: readonly (VariableSpec & { ticket?: true })[] = [
  { key: 'DSH_SUPERAGENT_DIR', ticket: true, description: { zh: '这个工单的执行目录；执行器 Session 在其中工作', en: 'This ticket\'s directory; the executor Session works in it' } },
  { key: 'DSH_SUPERAGENT_NAME', ticket: true, description: { zh: '工单的短名，也是执行目录的名字', en: 'The ticket\'s short name, also its directory\'s name' } },
  { key: 'DSH_SUPERAGENT_TICKET', ticket: true, description: { zh: '工单 id', en: 'The ticket id' } },
  { key: 'DSH_SUPERAGENT_ENVIRONMENT', ticket: true, description: { zh: '工单绑定的执行环境 id', en: 'This ticket\'s bound environment' } },
  { key: 'DSH_SUPERAGENT_BLOCKED_COMMANDS', description: { zh: '这个执行环境禁止调用的命令，以空格分隔；不要运行它们', en: 'Commands blocked in this execution environment, separated by spaces; never run them' } },
]
export interface Variable { key: string; value: string; description: Localized; owner: string }
/** Legacy display default only; actual Ticket roots come from immutable environment snapshots. */
export const executionRoot = (settings: Settings, stateDir: string): string => settings.environments.default?.directory || join(stateDir, 'work')

/** Declarations are labeled by instance, so a selected profile can show only its integrations. */
export function declaredVariables(sources: SourceRegistry, settings?: Settings): { owner: string; enabled: boolean; variables: readonly VariableSpec[] }[] {
  return [{ owner: 'executor', enabled: true, variables: EXECUTOR_VARIABLES },
    ...sources.instances(settings).flatMap(instance => {
      const variables = sources.kind(instance.id, settings)?.environment?.variables
      return variables ? [{ owner: instance.id, enabled: instance.enabled, variables }] : []
    })]
}
interface EnvironmentFacts {
  config: Pick<EnvironmentConfig, 'blockedCommands'>
  sources: Record<string, string>
  sourceConfigs?: Record<string, Record<string, unknown>>
}
/** Render only selected integration facts. An unbound Router has no ambient execution repository or account. */
export function environmentOf(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings;
  environment?: EnvironmentFacts; ticket?: { id: string; name: string; directory: string; environmentId?: string }; trigger?: Trigger }): Variable[] {
  const { deployment, sources, settings, ticket, trigger, environment } = input
  const executor: Record<string, string> = { DSH_SUPERAGENT_BLOCKED_COMMANDS: environment?.config.blockedCommands.join(' ') ?? '',
    ...ticket ? { DSH_SUPERAGENT_DIR: ticket.directory, DSH_SUPERAGENT_NAME: ticket.name, DSH_SUPERAGENT_TICKET: ticket.id,
      DSH_SUPERAGENT_ENVIRONMENT: ticket.environmentId ?? '' } : {} }
  const result: Variable[] = EXECUTOR_VARIABLES.filter(spec => !spec.ticket || ticket).map(spec => ({ key: spec.key,
    value: executor[spec.key] ?? '', description: spec.description, owner: 'executor' }))
  for (const [kindId, id] of Object.entries(environment?.sources ?? {})) {
    const kind = sources.allKinds().find(kind => kind.kind === kindId), extension = kind?.environment
    if (!extension) continue
    const config = environment?.sourceConfigs?.[id] ?? settings.sources[id]?.config ?? {}
    const values = extension.values({ deployment, config, sourceId: id, ...trigger ? { trigger } : {} })
    for (const spec of extension.variables) result.push({ key: spec.key, value: values[spec.key] ?? '', description: spec.description, owner: id })
  }
  return result
}
/** A Ticket's root, integration references and account facts come from the same bound environment snapshot. */
export function ticketEnvironment(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket: Ticket;
  environment: EnvironmentFacts; trigger?: Trigger }) {
  const { ticket, trigger, ...rest } = input
  const values = { id: ticket.id, name: ticket.execution?.name ?? '', directory: ticket.execution?.directory ?? '',
    environmentId: ticket.execution?.environment?.id ?? '' }
  return environmentOf({ ...rest, ticket: values, ...trigger ? { trigger } : {} })
}
export function environmentLines(variables: Variable[]): string {
  return variables.map(variable => `- ${variable.key} = ${JSON.stringify(variable.value)}: ${variable.description.en}.`).join('\n')
}
