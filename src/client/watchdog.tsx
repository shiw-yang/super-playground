/** Watchdog page, overview summary, scheduled-signal list for Triggers, and the Watchdog settings group. */
import { useState } from 'react'
import type { ApiResponse } from './api.ts'
import type { WatchdogTask } from '../policy.ts'
import { usePoll } from './api.ts'
import { Button, DisclosureRow, Icon, Input, Switch, Tag } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { settingsRoute } from './route.ts'
import { Field, Fields, ModelField, useBlockDraft, useSettings } from './settings-kit.tsx'
import { errorText } from './text.ts'
import { Hint, LabelValue, LoadState, Section, Stat, StatusHead, When } from './widgets.tsx'

type Watch = ApiResponse<'GET watchdog'>
type WatchTask = Watch['tasks'][number]

/** The next enabled task's scheduled time, if any. */
const nextTask = (watch: Watch): WatchTask | undefined => watch.tasks.filter(task => task.enabled && task.next_at)
  .sort((a, b) => (a.next_at ?? '').localeCompare(b.next_at ?? ''))[0]
const taskTone = (watch: Watch, task: WatchTask): 'ongoing' | 'idle' => watch.enabled && task.enabled ? 'ongoing' : 'idle'

function TaskRow({ watch, task }: { watch: Watch; task: WatchTask }) {
  const { t } = usePanel()
  const label = !watch.enabled ? t('watchdogDisabled') : !task.enabled ? t('watchdogTaskOff') : watch.busy ? t('watchdogBusy') : t('scheduledArmed')
  return <li className="dt-row">
    <div className="dt-row-main">
      <div className="dt-row-title"><span className="dt-mono">{task.id}</span> <Tag tone={taskTone(watch, task) === 'ongoing' ? 'outline' : 'quiet'}>{label}</Tag>
        <span className="dt-mono dt-hint"> {task.schedule}</span></div>
      <div className="dt-row-meta">
        <LabelValue label={t('watchdogNext')} value={task.next_at ? <When at={task.next_at ?? undefined} /> : t('watchdogNever')} />
        <LabelValue label={t('watchdogLast')} value={task.last_run?.at ? <When at={task.last_run.at ?? undefined} /> : t('watchdogNever')} />
        {task.report && <LabelValue label={t('watchdogReport')} value={task.report.summary} />}
        <span className="dt-row-actions"><OpenSession session={task.session_id} /></span>
      </div>
      {task.report?.proposals?.length ? <ul className="dt-list dt-hint">{task.report.proposals.map((proposal, index) => <li key={index}>{proposal}</li>)}</ul> : null}
    </div>
  </li>
}

function OpenSession({ session }: { session: string | null }) {
  const { t, openSession, notify } = usePanel()
  return <Button variant="outline" size="sm" icon={<Icon name="session" size={14} />} disabled={!session}
    onClick={() => { if (session) openSession(session).catch(failure => notify(errorText(failure))) }}>{t('openSession')}</Button>
}

/** The Watchdog tab: status, one row per configured task, the last report and the Session it runs in. */
export function WatchdogPage() {
  const { t, call, navigate } = usePanel()
  const { data, error } = usePoll(() => call('GET watchdog'), [])
  if (!data) return <LoadState error={error} loading />
  return <>
    <StatusHead hint={t('watchdogIntro')} settings="watchdog" />
    <div className="dt-row-meta dt-status-line">
      <span className="dt-status-text" data-state={data.enabled ? (data.busy ? 'ongoing' : 'ready') : 'idle'}>
        {data.enabled ? (data.busy ? t('watchdogBusy') : t('watchdogIdle')) : t('watchdogDisabled')}
      </span>
      <LabelValue label={t('watchdogTasks')} value={data.tasks.length} />
      {data.health?.detail && <span className="dt-hint">{data.health.detail}</span>}
    </div>
    {data.enabled && <Section title={t('watchdogNext')} hint={t('watchdogNextHint')}>
      {nextTask(data) ? <Hint>{t('watchdogNextTask', { task: nextTask(data)!.id })} <When at={nextTask(data)!.next_at ?? undefined} /></Hint>
        : <Hint>{t('watchdogNoTasks')}</Hint>}
    </Section>}
    <Section title={t('watchdogTasks')} count={data.tasks.length} action={<Button variant="ghost" size="sm"
      icon={<Icon name="settings" size={14} />} onClick={() => navigate(settingsRoute('watchdog'))}>{t('tab.settings')}</Button>}>
      {data.tasks.length ? <ul className="dt-list">{data.tasks.map(task => <TaskRow key={task.id} watch={data} task={task} />)}</ul>
        : <Hint>{t('watchdogNoTasks')}</Hint>}
    </Section>
    <Section title={t('watchdogReports')} hint={t('watchdogReportsHint')}>
      {data.tasks.some(task => task.report) ? <ul className="dt-list">{data.tasks.filter(task => task.report).map(task => <li
        key={task.id} className="dt-row"><div className="dt-row-main">
          <div className="dt-row-title"><span className="dt-mono">{task.id}</span> <When at={task.report!.at} /></div>
          <p className="dt-clamp">{task.report!.summary}</p>
          {task.report!.report !== task.report!.summary && <p className="dt-hint dt-clamp">{task.report!.report}</p>}
        </div></li>)}</ul> : <Hint>{t('watchdogNoReport')}</Hint>}
    </Section>
  </>
}

/** A compact system-status strip on the overview, below the work sections rather than a peer of them. */
export function WatchdogSummary() {
  const { t, call, navigate } = usePanel()
  const { data } = usePoll(() => call('GET watchdog'), [])
  if (!data) return null
  const next = nextTask(data)
  return <div className="dt-row-meta" aria-label={t('tab.watchdog')}>
    <span className="dt-row-label">{t('tab.watchdog')}</span>
    {data.enabled ? <>
      <span>{data.busy ? t('watchdogBusy') : t('watchdogIdle')}</span>
      <span>{t('watchdogNext')} {next?.next_at ? <When at={next.next_at ?? undefined} /> : t('watchdogNever')}</span>
      <span>{t('watchdogTasks')} {data.tasks.filter(task => task.enabled).length}</span>
    </> : <span>{t('watchdogDisabledHint')}</span>}
    <span className="dt-row-actions"><button type="button" className="dt-textlink dt-more-link"
      onClick={() => navigate({ page: 'watchdog' })}>{t('details')}</button></span>
  </div>
}

/** The scheduled-signal section on the Triggers page. */
export function ScheduledSignals() {
  const { t, call, navigate } = usePanel()
  const { data } = usePoll(() => call('GET watchdog'), [])
  if (!data) return null
  return <Section title={t('scheduledSignals')} count={data.tasks.length} hint={t('scheduledSignalsHint')}
    action={<button type="button" className="dt-textlink dt-more-link" onClick={() => navigate({ page: 'watchdog' })}>{t('details')}</button>}>
    {data.tasks.length ? <ul className="dt-list">{data.tasks.map(task => <li key={task.id} className="dt-row dt-link">
      <div className="dt-row-main">
        <div className="dt-row-title"><button type="button" className="dt-open" onClick={() => navigate({ page: 'watchdog' })}>
          <span className="dt-mono">{task.id}</span></button> <Tag tone={task.enabled && data.enabled ? 'outline' : 'quiet'}>
          {!data.enabled ? t('watchdogDisabled') : task.enabled ? t('scheduledArmed') : t('watchdogTaskOff')}</Tag></div>
        <div className="dt-row-meta"><span className="dt-mono">{task.schedule}</span>
          <LabelValue label={t('watchdogNext')} value={task.next_at ? <When at={task.next_at ?? undefined} /> : t('watchdogNever')} />
          <LabelValue label={t('watchdogLast')} value={task.last_run?.at ? <When at={task.last_run.at ?? undefined} /> : t('watchdogNever')} />
        </div>
      </div></li>)}</ul> : <Hint>{data.enabled ? t('watchdogNoTasks') : t('watchdogDisabledHint')}</Hint>}
  </Section>
}

function TaskEditor({ task, onChange, onRemove }: { task: WatchdogTask; onChange: (next: WatchdogTask) => void; onRemove: () => void }) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const edit = (patch: Partial<WatchdogTask>) => onChange({ ...task, ...patch })
  const preview = task.prompt.replace(/\s+/g, ' ').trim().slice(0, 90)
  return <li className="dt-card">
    <div className="dt-card-head">
      <div className="dt-row-main"><div className="dt-row-title"><span className="dt-card-title">{task.id}</span></div></div>
      <Button size="sm" className="dt-error-text" icon={<Icon name="trash" size={14} />} onClick={onRemove}>{t('remove')}</Button>
    </div>
    <div className="dt-grid3">
      <Field label={t('watchdogTaskId')}><Input value={task.id} onChange={event => edit({ id: event.target.value })} /></Field>
      <Field label={t('watchdogSchedule')}><Input className="dt-mono" value={task.schedule}
        onChange={event => edit({ schedule: event.target.value })} /></Field>
      <div className="dt-field"><span className="dt-field-head">{t('watchdogTaskOn')}</span>
        <Switch checked={task.enabled} onChange={enabled => edit({ enabled })} label={t('watchdogTaskOn')} /></div>
    </div>
    <DisclosureRow icon={<Icon name="message" />} title={t('watchdogPrompt')} open={open} onToggle={() => setOpen(!open)}
      collapsedContent={<span className="dt-hint dt-clamp">{preview}</span>}>
      <div className="dt-disclosure-body">
        <textarea className="dt-textarea dt-mono" rows={4} maxLength={8000} aria-label={t('watchdogPrompt')}
          value={task.prompt} onChange={event => edit({ prompt: event.target.value })} />
      </div>
    </DisclosureRow>
  </li>
}

/** The Watchdog settings group: enable it, choose the Session model, and edit the cron task list. */
export function WatchdogSettings() {
  const { t } = usePanel()
  const { settings } = useSettings()
  const saved = settings.blocks.watchdog
  const draft = useBlockDraft('watchdog', saved.value, saved.revision)
  const value = draft.value
  const tasks = value.tasks as WatchdogTask[]
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  const change = (index: number, task: WatchdogTask) => edit({ tasks: tasks.map((item, at) => at === index ? task : item) })
  const add = () => edit({ tasks: [...tasks, { id: `task-${tasks.length + 1}`, schedule: '0 9 * * *', prompt: '', enabled: true }] })
  return <form id="dt-watchdog-settings" className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('tab.watchdog')}</h2>
      <Hint>{t('watchdogSettingsIntro')}</Hint>
      <section className="dt-section">
        <h2 className="dt-section-title"><span className="dt-section-name">{t('watchdogStatus')}</span></h2>
        <div className="dt-switch-row"><div className="dt-field-head">{t('watchdogEnabled')}</div>
          <Switch checked={value.enabled} onChange={enabled => edit({ enabled })} label={t('watchdogEnabled')} /></div>
        <ModelField id="dt-watchdog-model" value={value.model} onChange={model => edit({ model })} />
        <Hint>{t('watchdogModelHint')}</Hint>
      </section>
      <Section title={t('watchdogTasks')} count={tasks.length} hint={t('watchdogTasksHint')}
        action={<Button variant="outline" size="sm" icon={<Icon name="plus" size={14} />} onClick={add}>{t('watchdogAddTask')}</Button>}>
        {tasks.length ? <ul className="dt-list dt-cards">{tasks.map((task, index) => <TaskEditor key={index} task={task}
          onChange={next => change(index, next)} onRemove={() => edit({ tasks: tasks.filter((_item, at) => at !== index) })} />)}</ul>
          : <Hint>{t('watchdogNoTasks')}</Hint>}
      </Section>
      <Hint>{t('watchdogScheduleHint')}</Hint>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}
