/** Source status view (health, filtered Triggers, dropped replies) and Source settings cards. */
import { useEffect, useState } from 'react'
import type { ExecutionSelection } from '../policy.ts'
import type { FieldSpec } from '../sources/kind.ts'
import { usePoll, type DroppedReply, type SourceStatusRow, type SourceView } from './api.ts'
import { Button, DisclosureRow, Dot, Icon, InfoTip, Input, Switch, Tag } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { sourceMark } from './marks.ts'
import { usePanel, usePanelData } from './provider.tsx'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { ConfigHistory, Field, Fields, SourceField, useBlockCreate, useBlockDraft, useSettings } from './settings-kit.tsx'
import { actorName, healthText, localized, readableMarkers, reasonLabel, valueLabel, when } from './text.ts'
import { CheckSetupButton, Hint, LabelValue, LoadState, SetupMessage, StatusHead, When } from './widgets.tsx'

const selectionComplete = (value: ExecutionSelection) => value.mode === 'fixed' ? !!value.environmentId : value.allowedEnvironmentIds.length > 0
function SourceExecution({ value, onChange }: { value: ExecutionSelection; onChange: (value: ExecutionSelection) => void }) {
  const { t } = usePanel()
  const { environments } = useSettings().settings
  const selected = value.mode === 'fixed' ? [value.environmentId] : value.allowedEnvironmentIds
  const missing = selected.filter(id => id && !environments.some(environment => environment.id === id))
  const name = (id: string) => {
    const environment = environments.find(environment => environment.id === id)
    return environment ? `${environment.value.title} · ${id}${!environment.value.enabled ? ` · ${t('sourceOff')}` : ''}`
      : t('configurationUnavailable', { id })
  }
  return <div className="dt-form">
    <Field label={t('sourceExecutionMode')} hint={t('sourceExecutionHint')}>
      <select className="dt-select" value={value.mode} onChange={event => onChange(event.target.value === 'router'
        ? { mode: 'router', allowedEnvironmentIds: [] } : { mode: 'fixed', environmentId: '' })}>
        <option value="fixed">{t('sourceExecutionFixed')}</option>
        <option value="router">{t('sourceExecutionRouter')}</option>
      </select>
    </Field>
    {value.mode === 'fixed' ? <Field label={t('sourceFixedEnvironment')}>
      <select className="dt-select" value={value.environmentId} required onChange={event => onChange({ mode: 'fixed', environmentId: event.target.value })}>
        <option value="" disabled>{t('sourceChooseEnvironment')}</option>
        {missing.map(id => <option key={id} value={id} disabled>{name(id)}</option>)}
        {environments.map(environment => <option key={environment.id} value={environment.id}
          disabled={!environment.value.enabled}>{name(environment.id)}</option>)}
      </select>
    </Field> : <fieldset className="dt-fieldset">
      <legend className="dt-field-head">{t('sourceAllowedEnvironments')}</legend>
      <Hint>{t('sourceAllowlistHint')}</Hint>
      {[...environments.map(environment => environment.id), ...missing].map(id => <div className="dt-switch-row" key={id}>
        <label className="dt-environment-choice">
          <input type="checkbox" checked={value.allowedEnvironmentIds.includes(id)}
            disabled={!value.allowedEnvironmentIds.includes(id) && !environments.find(environment => environment.id === id)?.value.enabled}
            onChange={event => onChange({ mode: 'router', allowedEnvironmentIds: event.target.checked
              ? [...value.allowedEnvironmentIds, id] : value.allowedEnvironmentIds.filter(selected => selected !== id) })} />
          {name(id)}
        </label>
      </div>)}
      {!value.allowedEnvironmentIds.length && <p className="dt-error" role="alert">{t('sourceEnvironmentRequired')}</p>}
    </fieldset>}
  </div>
}
function CreateSource() {
  const { t } = usePanel()
  const { running } = usePanelData()
  const { sources, sourceKinds } = useSettings().settings
  const create = useBlockCreate()
  const [id, setId] = useState(''), [kind, setKind] = useState('')
  const [execution, setExecution] = useState<ExecutionSelection>({ mode: 'fixed', environmentId: '' })
  const duplicate = sources.some(source => source.id === id)
  const submit = async () => {
    if (duplicate || !id || !kind || !selectionComplete(execution)) return
    if (await create.run(`source:${id}`, { kind, enabled: false, config: {}, execution })) {
      setId(''); setKind(''); setExecution({ mode: 'fixed', environmentId: '' })
    }
  }
  return <form id="dt-create-source" aria-label={t('sourceCreate')} className="dt-form dt-block"
    onSubmit={event => { event.preventDefault(); void submit() }}>
    <Fields disabled={create.busy}>
      <h3 className="dt-block-title">{t('sourceCreate')}</h3>
      <Hint>{t('sourceCreateHint')}</Hint>
      <Field label={t('sourceId')} hint={t('configurationIdHint')}
        note={duplicate ? t('configurationIdTaken', { id }) : undefined}>
        <Input value={id} required pattern="[a-z][a-z0-9\-]{0,79}" maxLength={80} spellCheck={false}
          aria-invalid={duplicate} onChange={event => setId(event.target.value)} />
      </Field>
      <Field label={t('sourceKind')}>
        <select className="dt-select" required value={kind} onChange={event => setKind(event.target.value)}>
          <option value="" disabled>{t('sourceChooseKind')}</option>
          {sourceKinds.map(item => <option key={item.kind} value={item.kind}>{localized(t, item.title)}</option>)}
        </select>
      </Field>
      <SourceExecution value={execution} onChange={setExecution} />
      {id && kind && running > 0 && <Hint>{t('restartInterrupts', { count: running })}</Hint>}
      <div className="dt-row-buttons"><Button type="submit" variant="outline" icon={<Icon name="plus" />}
        disabled={duplicate || !id || !kind || !selectionComplete(execution)}>{t('sourceCreate')}</Button></div>
    </Fields>
  </form>
}
function SourceCard({ source }: { source: SourceView }) {
  const { t, call } = usePanel()
  const { running } = usePanelData()
  const { reload } = useSettings()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const refreshLabels = async () => { const { added } = await call('POST sources/:id/labels',
    { id: source.id }); await reload(); return added }
  const draft = useBlockDraft(`source:${source.id}`, source.value, source.revision)
  const value = draft.value
  const { problem, value: saved } = source
  const changed = (key: string) => String(value.config[key] ?? '') !== String(saved.config[key] ?? '')
  // Saving a modified setup-sensitive field restarts dsh-superagent, interrupting running Assignments.
  const restarts = draft.dirty && source.restarts.some(changed)
  const description = localized(t, source.description)
  // Hide derived facts for unsaved field edits until the new value is saved.
  const field = (spec: FieldSpec) => <SourceField key={spec.key} field={spec} value={value.config[spec.key]} saved={saved.config[spec.key]}
    labels={source.labels}
    refreshLabels={refreshLabels} fact={spec.type === 'fact' || !changed(spec.key) ? source.facts[spec.key] : undefined}
    onChange={next => draft.edit({ ...value, config: { ...value.config, [spec.key]: next } })} />
  const advanced = source.fields.filter(spec => spec.advanced)
  return <form id={`dt-source-${source.id}`} aria-label={`${localized(t, source.title)} · ${source.id}`} className="dt-card" onSubmit={event => {
    if (!selectionComplete(value.execution)) { event.preventDefault(); return }
    void draft.submit(event)
  }}>
    <Fields disabled={draft.busy}>
      <div className="dt-card-head">
        <div className="dt-row-main">
          <div className="dt-row-title">
            <span className="dt-card-title">{localized(t, source.title)}</span>{description && <InfoTip text={description} />}
            {!source.installed && <Tag tone="warning">{t('sourceNotInstalled')}</Tag>}
          </div>
          <div className="dt-row-meta"><span className="dt-mono">{source.id}</span></div>
        </div>
        {source.installed && <Switch checked={value.enabled} onChange={enabled => draft.edit({ ...value, enabled })}
          label={t('sourceEnable', { name: source.id === source.kind ? localized(t, source.title)
            : `${localized(t, source.title)} · ${source.id}` })} />}
      </div>
      {problem && <div className="dt-row-buttons">
        <p className="dt-error" role="status"><SetupMessage problem={problem} lead /></p><CheckSetupButton />
      </div>}
      {!source.installed && <Hint>{t('sourceNotInstalledHint')}</Hint>}
      {source.installed && source.fields.filter(spec => !spec.advanced).map(field)}
      {source.installed && <SourceExecution value={value.execution} onChange={execution => draft.edit({ ...value, execution })} />}
      {source.installed && advanced.length > 0 && <DisclosureRow icon={<Icon name="settings" />} title={t('advanced')} open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}>
        <div className="dt-disclosure-body">{advanced.map(field)}</div>
      </DisclosureRow>}
    </Fields>
    <SaveBar {...draft} status={restarts && running > 0 ? t('restartInterrupts', { count: running }) : undefined}
      onDiscard={draft.discard} />
  </form>
}

export function SourceSettings({ focus }: { focus?: string }) {
  const { sources } = useSettings().settings
  useEffect(() => { if (focus) document.getElementById(`dt-source-${focus}`)?.scrollIntoView?.({ block: 'start' }) }, [focus])
  return <div className="dt-form">
    {sources.map(source => <SourceCard key={source.id} source={source} />)}
    <CreateSource />
    <ConfigHistory blocks={['source:']} />
  </div>
}

function DroppedReplies({ items }: { items: DroppedReply[] }) {
  const { t, navigate } = usePanel()
  const [open, setOpen] = useState(false)
  // Link to the message's Ticket, or fall back to its Thread for messages queued before receipts recorded `ticketId`.
  const target = (item: DroppedReply): { route: Route; name: string } | undefined => item.ticket
    ? { route: { page: 'execution', id: item.ticket.id }, name: item.ticket.title }
    : item.thread ? { route: { page: 'trigger', id: item.thread }, name: t('term.thread') } : undefined
  return <DisclosureRow icon={<Icon name="dismiss" />} title={<>{t('sourceDroppedTitle')} <span
    className="dt-count">{items.length}</span></>} open={open}
    onToggle={() => setOpen(!open)}>
    <div className="dt-disclosure-body">
      <Hint>{t('sourceDroppedHint')}</Hint>
      <ul className="dt-list">{items.map(item => {
        const link = target(item)
        return <li key={item.id} className="dt-row"><Dot state="idle" /><div className="dt-row-main">
          <div className="dt-row-title dt-line">{readableMarkers(t, item.preview) || t('empty')}</div>
          <div className="dt-row-meta">
            <Tag tone="neutral">{reasonLabel(t, item.dropped.reason)}</Tag><When at={item.dropped.at} />
            {link && <button type="button" className="dt-textlink" onClick={() => navigate(link.route)}>{link.name}</button>}
          </div>
        </div></li>
      })}</ul>
    </div>
  </DisclosureRow>
}
function SourceRow({ source }: { source: SourceStatusRow }) {
  const { t, navigate } = usePanel()
  const { setup } = usePanelData()
  const [filteredOpen, setFilteredOpen] = useState(false)
  const { problem, dropped } = source
  const { dot, label: state } = sourceMark(t, source.state)
  const { received, filtered, lastAt } = source.stats
  // Omit healthy parts and suppress per-part notes when a setup problem already explains why the Source is stopped.
  const notes = source.enabled && !problem && !setup?.problem ? source.health.filter(item => item.state === 'error'
    || item.state === 'paused') : []
  return <li className="dt-row">
    <Dot state={dot} label={state} />
    <div className="dt-row-main">
      <div className="dt-row-title"><span className="dt-row-name">{localized(t, source.title)}</span><span className="dt-status-text"
        data-state={dot}>{state}</span><span className="dt-mono">{source.id}</span></div>
      <div className="dt-row-meta">
        {received > 0 && <LabelValue label={t('sourceReceivedLabel')}
          value={received} />}{filtered > 0 && <LabelValue label={t('sourceFilteredLabel')} value={filtered} />}
        {lastAt && <LabelValue label={t('sourceLatestLabel')} value={when(lastAt, t('lang'))} />}
      </div>
      <div className="dt-row-meta dt-source-environments" role="group" aria-label={t('sourceExecutionMode')}>
        <span>{t(source.execution.mode === 'fixed' ? 'sourceExecutionFixed' : 'sourceExecutionRouter')}</span>
        {source.execution.environments.map(environment => <Tag key={environment.id} title={environment.id}
          tone={environment.state === 'configured' ? 'neutral' : 'warning'}>
          {environment.title}{environment.state !== 'configured' && ` · ${t(environment.state === 'disabled'
            ? 'sourceEnvironmentDisabled' : 'sourceEnvironmentMissing')}`}
        </Tag>)}
      </div>
      {problem && <p className="dt-error">
        <SetupMessage problem={problem} lead /> <button type="button" className="dt-textlink"
          onClick={() => navigate(settingsRoute('source', { source: problem.sourceId ?? problem.place }))}>
          {t('sourceOpenSettings')}
        </button>
      </p>}
      {notes.map(item => <p key={item.name} className={item.state === 'error' ? 'dt-error dt-clamp' : 'dt-hint dt-clamp'}>
        {valueLabel(t, 'health', item.name)}{t('labelSeparator')}<span className={item.code ? undefined : 'dt-mono'}>{healthText(t,
          item)}</span>
      </p>)}
      {source.filtered.length > 0 && <DisclosureRow icon={<Icon name="filter" />} title={t('sourceFilteredTitle')} open={filteredOpen}
        onToggle={() => setFilteredOpen(!filteredOpen)}>
        <div className="dt-disclosure-body">
          <ul className="dt-list">{source.filtered.map(item => <li key={item.id} className="dt-row"><Dot state="idle" /><div
            className="dt-row-main">
            <div className="dt-row-title">{actorName(t, item.actor)}{t('labelSeparator')}{readableMarkers(t, item.preview)
              || t('empty')}</div>
            <div className="dt-row-meta"><Tag tone="neutral">{reasonLabel(t, item.reason)}</Tag><When at={item.at} /></div>
          </div></li>)}</ul>
        </div>
      </DisclosureRow>}
      {dropped.length > 0 && <DroppedReplies items={dropped} />}
    </div>
  </li>
}

export function SourceStatus() {
  const { t, call, navigate } = usePanel()
  const { setup } = usePanelData()
  const { data, error } = usePoll(() => call('GET sources'), [])
  // Global deployment setup problems halt all Sources and show at the top; Source-specific setup problems show on that Source's row.
  const elsewhere = setup?.problem?.place === 'deployment' ? setup.problem : undefined
  return <div className="dt-form">
    <StatusHead hint={t('sourceStatusIntro')} settings="source" />
    {elsewhere && <p className="dt-error">
      <SetupMessage problem={elsewhere} lead /> <button type="button" className="dt-textlink"
        onClick={() => navigate(elsewhere.code === 'noEnvironment' ? settingsRoute('execution') : elsewhere.sourceId
          ? settingsRoute('source', { source: elsewhere.sourceId }) : setupPage(elsewhere.place))}>{t('setupFixLink')}</button>
    </p>}
    <LoadState error={error} loading={!data} />
    {data && <ul className="dt-list">{data.map(source => <SourceRow key={source.id} source={source} />)}</ul>}
  </div>
}
