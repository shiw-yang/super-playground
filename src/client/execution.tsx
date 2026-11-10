/** Execution status view (active Tickets and pause control) and Execution settings group (Executor capacity and workspace environment). */
import { useRef, useState } from 'react'
import { TICKET_FILTERS, type TicketFilter } from '../app/api.ts'
import type { EnvironmentConfig } from '../policy.ts'
import { LIMITS } from '../limits.ts'
import { usePoll, type SettingsView, type SourceView, type StateView } from './api.ts'
import { Button, DisclosureRow, Icon, InfoTip, Input, Pill, Switch } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel, usePanelData } from './provider.tsx'
import { TicketLine } from './rows.tsx'
import { ConfigHistory, Field, Fields, ModelField, numberOf, useBlockCreate, useBlockDraft, useSettings } from './settings-kit.tsx'
import { localized } from './text.ts'
import { ConfirmButton, Hint, LabelValue, LoadMore, LoadState, Section, StatusHead } from './widgets.tsx'

export function ExecutionStatus({ filter: current, state, reload }: {
  filter: TicketFilter; state: StateView; reload: () => Promise<void>
}) {
  const { t, call, navigate } = usePanel()
  const [limit, setLimit] = useState(20)
  const { data, error, reload: reloadTickets } = usePoll(() => call('GET tickets', { query: { state: current, limit } }), [current, limit])
  const { paused, load: { maxWorkers } } = state
  // Pausing uses its own block revision so toggling pause does not invalidate an open Execution settings draft.
  const pause = async () => { await call('POST executor/pause', { body: { paused: !paused } }); await reload() }
  const status = state.setup.problem ? { tone: 'warning', label: t('executorWaitingSetup') } : paused ? { tone: 'warning',
    label: t('processingPaused') }
    : { tone: 'ongoing', label: t('executorRunning') }
  const action = paused ? 'resumeProcessing' : 'pauseProcessing'
  return <>
    <StatusHead hint={t('executionStatusIntro')} settings="execution" />
    <div className="dt-row-meta dt-status-line">
      <span className="dt-status-text" data-state={status.tone}>{status.label}</span>
      {!state.setup.problem && <>
        <LabelValue label={t('executingLabel')}
          value={`${state.load.running} / ${maxWorkers}`} /><LabelValue label={t('queuedLabel')} value={state.load.queued} />
      </>}
      <ConfirmButton variant="outline" icon={paused ? 'play' : 'pause'} label={t(action)} title={t(action)} message={t(paused
        ? 'resumeProcessingConfirm' : 'pauseProcessingConfirm')}
        onConfirm={pause} />
    </div>
    <div className="dt-filters">
      {TICKET_FILTERS.map(value => <Pill key={value} active={current === value}
        onClick={() => { setLimit(20); navigate({ page: 'execution', query: value === 'open' ? {} : { filter: value } },
          true) }}>{t(`ticketFilter.${value}`)}</Pill>)}
    </div>
    {current === 'idle' && <Hint>{t('idleHint')}</Hint>}
    <LoadState error={error} loading={!data} />
    {data && (data.items.length ? <ul className="dt-list">{data.items.map(ticket => ticket.stage === 'person'
      ? <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reloadTickets} /> : <TicketLine key={ticket.id} ticket={ticket} />)}</ul> : <Hint>{t('none')}</Hint>)}
    {data?.next_offset != null && <LoadMore onMore={() => setLimit(limit + 20)} />}
  </>
}

const firstSentence = (text: string): string => /^[^。；;.]*(?:[。；;]|\.(?=\s|$))?/.exec(text)?.[0] ?? text
function EnvironmentVariables({ groups, sources,
  onPick }: { groups: SettingsView['environment']['variables']; sources: SourceView[]; onPick: (key: string) => void }) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const owner = (id: string) => id === 'executor' ? t('term.executor') : localized(t, sources.find(source => source.id === id)?.title ?? id)
  const count = groups.reduce((sum, group) => sum + group.variables.length, 0)
  return <DisclosureRow icon={<Icon name="hash" />} title={<>{t('environmentVariables')} <span className="dt-count">{count}</span></>}
    open={open} onToggle={() => setOpen(!open)}>
    <div className="dt-disclosure-body">
      <Hint>{t('environmentPick')}</Hint>
      <table className="dt-table">
        <thead><tr><th>{t('environmentKey')}</th><th>{t('environmentDescription')}</th><th>{t('environmentOwner')}</th></tr></thead>
        <tbody>{groups.flatMap(group => group.variables.map(variable => <tr key={variable.key}>
          <td><button type="button" className="dt-textlink dt-mono" onClick={() => onPick(variable.key)}>{variable.key}</button></td>
          <td title={localized(t, variable.description)}>{firstSentence(localized(t, variable.description))}</td>
          <td>{owner(group.owner)}{!group.enabled && <span className="dt-hint"> · {t('sourceOff')}</span>}</td>
        </tr>))}</tbody>
      </table>
    </div>
  </DisclosureRow>
}
function ExecutorSettings() {
  const { t } = usePanel()
  const { blocks } = useSettings().settings
  const saved = { ...blocks.executor.value, maxWorkers: String(blocks.executor.value.maxWorkers) }
  const draft = useBlockDraft('executor', saved, blocks.executor.revision,
    value => ({ ...value, maxWorkers: numberOf(value.maxWorkers) }))
  const value = draft.value
  return <form id="dt-executor-settings" className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('term.executor')}<InfoTip text={t('executorIntro')} /></h2>
      <Section title={t('executorModel')} hint={t('executorModelHint')}><ModelField id="dt-worker-model" value={value.model}
        onChange={model => draft.edit({ ...value, model })} /></Section>
      <Field label={t('maxWorkers')} hint={t('maxWorkersHint')}>
        <Input type="number" min={LIMITS.maxWorkers.min} max={LIMITS.maxWorkers.max} required value={value.maxWorkers}
          onChange={event => draft.edit({ ...value, maxWorkers: event.target.value })} />
      </Field>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}
function EnvironmentSource({ kind, value, onChange }: {
  kind: 'github' | 'feishu'; value: string | null; onChange: (id: string | null) => void
}) {
  const { t } = usePanel()
  const { sources } = useSettings().settings
  const options = sources.filter(source => source.kind === kind && source.installed)
  return <Field label={t(kind === 'github' ? 'environmentGithubSource' : 'environmentFeishuSource')} hint={t('environmentSourceHint')}>
    <select className="dt-select" value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
      <option value="">{t('environmentSourceNone')}</option>
      {value && !options.some(source => source.id === value) && <option value={value} disabled>
        {t('configurationUnavailable', { id: value })}
      </option>}
      {options.map(source => <option key={source.id} value={source.id}>
        {localized(t, source.title)} · {source.id}{!source.value.enabled ? ` · ${t('sourceOff')}` : ''}
      </option>)}
    </select>
  </Field>
}
function EnvironmentCard({ environment }: { environment: SettingsView['environments'][number] }) {
  const { t } = usePanel()
  const { sources, environment: variables } = useSettings().settings
  const { running } = usePanelData()
  // Preserve raw separators and paths while editing; normalize only at the save boundary.
  const saved = { ...environment.value, blockedCommands: environment.value.blockedCommands.join(' ') }
  const draft = useBlockDraft(`environment:${environment.id}`, saved, environment.revision,
    value => ({ ...value, blockedCommands: value.blockedCommands.split(/[\s,]+/).filter(Boolean) }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  const prepare = useRef<HTMLTextAreaElement>(null)
  const insert = (key: string) => {
    const field = prepare.current
    const at = field?.selectionStart ?? value.prepare.length, to = field?.selectionEnd ?? at
    edit({ prepare: `${value.prepare.slice(0, at)}"$${key}"${value.prepare.slice(to)}` })
    requestAnimationFrame(() => { field?.focus(); const caret = at + key.length + 3; field?.setSelectionRange(caret, caret) })
  }
  const groups = variables.variables.filter(group => group.owner === 'executor'
    || group.owner === value.githubSource || group.owner === value.feishuSource)
  const restarts = value.githubSource !== environment.value.githubSource || value.feishuSource !== environment.value.feishuSource
  return <form id={`dt-environment-${environment.id}`} aria-label={`${environment.value.title} · ${environment.id}`}
    className="dt-card" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <div className="dt-card-head">
        <div className="dt-row-main">
          <div className="dt-row-title"><span className="dt-card-title">{environment.value.title}</span></div>
          <div className="dt-row-meta"><span className="dt-mono">{environment.id}</span></div>
        </div>
        <Switch checked={value.enabled} label={t('environmentEnable', { name: environment.value.title })}
          onChange={enabled => edit({ enabled })} />
      </div>
      <Field label={t('environmentTitle')}><Input value={value.title} required maxLength={120}
        onChange={event => edit({ title: event.target.value })} /></Field>
      <Field label={t('environmentPurpose')} hint={t('environmentPurposeHint')}>
        <textarea className="dt-textarea" rows={2} maxLength={1500} value={value.description}
          onChange={event => edit({ description: event.target.value })} />
      </Field>
      <Field label={t('executionDirectory')} hint={t('executionDirectoryHint')} note={value.directory || environment.value.directory ? undefined
        : t('executionDirectoryDefault', { root: environment.root })}>
        <Input className="dt-mono" value={value.directory} placeholder={t('executionDirectoryEmpty')} spellCheck={false} pattern="/.*"
          onChange={event => edit({ directory: event.target.value })} />
      </Field>
      <EnvironmentSource kind="github" value={value.githubSource} onChange={githubSource => edit({ githubSource })} />
      <EnvironmentSource kind="feishu" value={value.feishuSource} onChange={feishuSource => edit({ feishuSource })} />
      <Field label={t('prepareCommand')} hint={t('prepareCommandHint')}>
        <textarea ref={prepare} className="dt-textarea dt-mono" rows={3} maxLength={LIMITS.prepareCommand} spellCheck={false}
          placeholder={t('prepareCommandEmpty')} value={value.prepare}
          onChange={event => edit({ prepare: event.target.value })} />
      </Field>
      <EnvironmentVariables groups={groups} sources={sources} onPick={insert} />
      <Field label={t('blockedCommands')} hint={t('blockedCommandsHint')}>
        <Input className="dt-mono" value={value.blockedCommands} placeholder={t('blockedCommandsNone')} spellCheck={false}
          onChange={event => edit({ blockedCommands: event.target.value })} />
      </Field>
    </Fields>
    <SaveBar {...draft} status={restarts && running > 0 ? t('restartInterrupts', { count: running }) : undefined}
      onDiscard={draft.discard} />
  </form>
}
function CreateEnvironment() {
  const { t } = usePanel()
  const { running } = usePanelData()
  const { environments } = useSettings().settings
  const create = useBlockCreate()
  const [id, setId] = useState(''), [title, setTitle] = useState('')
  const duplicate = environments.some(environment => environment.id === id)
  const submit = async () => {
    if (duplicate || !id || !title.trim()) return
    const value: EnvironmentConfig = { title, description: '', enabled: true, directory: '', prepare: '', blockedCommands: [],
      githubSource: null, feishuSource: null }
    if (await create.run(`environment:${id}`, value)) { setId(''); setTitle('') }
  }
  return <form id="dt-create-environment" aria-label={t('environmentCreate')} className="dt-form dt-block"
    onSubmit={event => { event.preventDefault(); void submit() }}>
    <Fields disabled={create.busy}>
      <h3 className="dt-block-title">{t('environmentCreate')}</h3>
      <Field label={t('environmentId')} hint={t('configurationIdHint')}
        note={duplicate ? t('configurationIdTaken', { id }) : undefined}>
        <Input value={id} required pattern="[a-z][a-z0-9\-]{0,79}" maxLength={80} spellCheck={false}
          aria-invalid={duplicate} onChange={event => setId(event.target.value)} />
      </Field>
      <Field label={t('environmentNewTitle')}><Input value={title} required maxLength={120}
        onChange={event => setTitle(event.target.value)} /></Field>
      {id && title.trim() && running > 0 && <Hint>{t('restartInterrupts', { count: running })}</Hint>}
      <div className="dt-row-buttons"><Button type="submit" variant="outline" icon={<Icon name="plus" />}
        disabled={duplicate || !id || !title.trim()}>{t('environmentCreate')}</Button></div>
    </Fields>
  </form>
}
export function ExecutionSettings() {
  const { t } = usePanel()
  const { environments } = useSettings().settings
  return <div className="dt-form">
    <ExecutorSettings />
    <Section title={t('environmentsTitle')} hint={t('environmentIntro')}>
      <Hint>{t('environmentsHint')}</Hint>
      {environments.map(environment => <EnvironmentCard key={environment.id} environment={environment} />)}
      <CreateEnvironment />
    </Section>
    <ConfigHistory blocks={['executor', 'pause', 'environment:']} />
  </div>
}
