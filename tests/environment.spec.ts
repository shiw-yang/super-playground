import { execFile, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SENSITIVE_ENV_PATTERN, type SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GIT_LOCATION, agentVariables, credentialHelper, materializeWorkerEnvironment, runAsWorker, verifyDirectory, withoutDirectory, workerBin, workerGitConfig, writeEnvironment }
  from '../src/infra/environment.ts'
import { CliError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { gitEnv } from './fixtures/git.ts'

// Git and shell subprocesses can exceed the 5s default timeout when the test suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 })
const exec = promisify(execFile)
let dir: string
const program = (path: string, body: string): string => { writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); return path }
/** Worker shell environment after DSH strips credential-shaped variables. */
const workerEnv = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !SENSITIVE_ENV_PATTERN.test(entry[0])))
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'environment-')); mkdirSync(join(dir, 'real')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('worker shims', () => {
  it('run a wrapper that calls `gh` by name without reaching the shim again, and keep the caller\'s other PATH entries', async () => {
    program(join(dir, 'real', 'gh'), 'echo "{\\"login\\":\\"agent-bot\\",\\"config\\":\\"$GH_CONFIG_DIR\\",\\"path\\":\\"$PATH\\"}"')
    const wrapper = program(join(dir, 'gh-agent'), `GH_CONFIG_DIR=${dir}/agent-config exec gh "$@"`)
    await writeEnvironment(testDeployment({ stateDir: dir, github: { ...testDeployment().github, cli: wrapper }, feishu: undefined }), [])
    const bin = workerBin(dir)
    const path = [bin, join(dir, 'venv'), join(dir, 'real'), '/usr/bin', '/bin'].join(':')
    const { stdout } = await exec('gh', ['api', 'user'], { env: { PATH: path }, timeout: 10_000 })
    expect(JSON.parse(stdout)).toEqual({ login: 'agent-bot', config: `${dir}/agent-config`, path: [join(dir, 'venv'), join(dir, 'real'), '/usr/bin', '/bin'].join(':') })
  })
  it('blocks gh auth setup-git before the real CLI can rewrite the shared credential helper', async () => {
    const wrapper = program(join(dir, 'gh-agent'), `git config --global credential.https://github.com.helper personal-helper`)
    await writeEnvironment(testDeployment({ stateDir: dir, github: { ...testDeployment().github, cli: wrapper } }), [])
    const before = readFileSync(workerGitConfig(dir), 'utf8')
    const env = workerEnv({ PATH: process.env.PATH, ...agentVariables(dir) })
    for (const args of [['auth', 'setup-git'], ['--repo', 'acme/widgets', 'auth', 'setup-git', '--hostname', 'github.com']]) {
      await expect(exec(join(workerBin(dir), 'gh'), args, { env })).rejects.toMatchObject({
        code: 1, stderr: expect.stringContaining('auth setup-git is blocked'),
      })
      expect(readFileSync(workerGitConfig(dir), 'utf8')).toBe(before)
    }
  })
  it('preserves ordinary gh arguments, including auth status and a global repo option', async () => {
    const wrapper = program(join(dir, 'gh-agent'), `printf '%s\\n' "$@"`)
    await writeEnvironment(testDeployment({ stateDir: dir, github: { ...testDeployment().github, cli: wrapper } }), [])
    for (const args of [['auth', 'status'], ['--repo', 'auth', 'issue', 'list'], ['api', 'repos/acme/widgets']]) {
      expect((await exec(join(workerBin(dir), 'gh'), args)).stdout).toBe(args.join('\n') + '\n')
    }
  })
  it('makes git fail closed after a worker changes the shared GitHub helper', async () => {
    const realGit = (await exec('sh', ['-c', 'command -v git'])).stdout.trim()
    program(join(dir, 'real', 'git'), `echo called >> '${join(dir, 'git-calls')}'\n[ "$1" = push ] && exit 0\nexec '${realGit}' "$@"`)
    await writeEnvironment(testDeployment({ stateDir: dir }), [])
    const env = workerEnv({ PATH: [workerBin(dir), join(dir, 'real'), process.env.PATH].join(':'), ...agentVariables(dir) })
    await expect(exec('git', ['--version'], { cwd: dir, env })).resolves.toMatchObject({ stdout: expect.stringContaining('git version') })
    await exec('git', ['init', '-q', 'repo with spaces'], { cwd: dir, env })
    expect((await exec('git', ['-C', 'repo with spaces', 'status', '--porcelain'], { cwd: dir, env })).stdout).toBe('')
    writeFileSync(join(dir, 'git-calls'), '')
    // Same mutation as gh auth setup-git, with no real credentials or remote involved.
    await exec(realGit, ['config', '--global', 'credential.https://github.com.helper', '!personal-gh auth git-credential'], { env })
    await expect(exec('git', ['push', 'origin', 'HEAD'], { cwd: dir, env })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('GitHub credential helper changed'),
    })
    // Only the config probe may reach git; the requested push must never execute.
    expect(readFileSync(join(dir, 'git-calls'), 'utf8').trim().split('\n')).toHaveLength(1)
  })
  it('refuses git when the shared helper is missing, malformed or adds another account', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir }), [])
    const env = workerEnv({ PATH: process.env.PATH, ...agentVariables(dir) })
    const original = readFileSync(workerGitConfig(dir), 'utf8')
    for (const config of ['', '[credential', `${original}\n[credential "https://github.com"]\n helper = personal-helper\n`]) {
      writeFileSync(workerGitConfig(dir), config)
      await expect(exec(join(workerBin(dir), 'git'), ['push', 'origin', 'HEAD'], { cwd: dir, env })).rejects.toMatchObject({
        code: 1, stderr: expect.stringMatching(/Cannot verify the GitHub credential helper|GitHub credential helper changed/),
      })
    }
  })
  it('make `lark-cli` fail without a Feishu bot and each blocked command fail with the agent\'s login', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir, feishu: undefined }), ['personal-gh'])
    const bin = workerBin(dir)
    await expect(exec(join(bin, 'lark-cli'), ['im', '+chat-list'])).rejects.toMatchObject({ code: 1, stderr: 'lark-cli is unavailable: this installation has no Feishu bot.\n' })
    await expect(exec(join(bin, 'personal-gh'), [])).rejects.toMatchObject({ code: 1, stderr: 'personal-gh is blocked in this installation; use gh, which acts as agent-bot.\n' })
  })
  it('keeps the protected gh, git and lark-cli shims when blocked commands name them', async () => {
    const gh = program(join(dir, 'gh-agent'), 'echo gh "$@"'), lark = program(join(dir, 'lark-bot'), 'echo lark "$@"')
    const base = testDeployment()
    await writeEnvironment(testDeployment({ stateDir: dir, github: { ...base.github, cli: gh }, feishu: { ...base.feishu!, cli: lark } }), ['gh', 'git', 'lark-cli'])
    const bin = workerBin(dir)
    expect([(await exec(join(bin, 'gh'), ['api', 'user'])).stdout, (await exec(join(bin, 'lark-cli'), ['im'])).stdout]).toEqual(['gh api user\n', 'lark im\n'])
    expect(readdirSync(bin)).toContain('git')
    expect(readFileSync(join(bin, 'git'), 'utf8')).toContain('GitHub credential helper changed')
  })
  it('replace only what dsh-superagent wrote and refuse anything else in its places', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir }), ['old-cli'])
    await writeEnvironment(testDeployment({ stateDir: dir }), [])
    expect(readdirSync(workerBin(dir)).sort()).toEqual(['gh', 'git', 'lark-cli'])
    // A file that merely contains the marker on a later line, a symlink to a shim, and a foreign gitconfig are all rejected.
    writeFileSync(join(workerBin(dir), 'notes'), `notes\nmore\n${readFileSync(join(workerBin(dir), 'gh'), 'utf8').split('\n')[1]}\n`)
    await expect(writeEnvironment(testDeployment({ stateDir: dir }), [])).rejects.toThrow(`${join(workerBin(dir), 'notes')} was not written by dsh-superagent`)
    rmSync(join(workerBin(dir), 'notes'))
    symlinkSync(join(workerBin(dir), 'gh'), join(workerBin(dir), 'link'))
    await expect(writeEnvironment(testDeployment({ stateDir: dir }), [])).rejects.toThrow('link was not written by dsh-superagent')
    rmSync(join(workerBin(dir), 'link'))
    writeFileSync(workerGitConfig(dir), '[user]\n\tname = someone\n')
    await expect(writeEnvironment(testDeployment({ stateDir: dir }), [])).rejects.toThrow(`${workerGitConfig(dir)} was not written by dsh-superagent`)
    expect(readFileSync(workerGitConfig(dir), 'utf8')).toBe('[user]\n\tname = someone\n')
  })
  it('replaces the files it wrote under the project\'s earlier names', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir }), ['old-cli', 'older-cli'])
    const legacy = (file: string, name: string) => writeFileSync(file, readFileSync(file, 'utf8').replace('Written by dsh-superagent', `Written by ${name}`))
    legacy(join(workerBin(dir), 'old-cli'), 'dsh-tag'); legacy(join(workerBin(dir), 'older-cli'), 'dsh-freelancer'); legacy(workerGitConfig(dir), 'dsh-go')
    await writeEnvironment(testDeployment({ stateDir: dir }), [])
    expect(readdirSync(workerBin(dir)).sort()).toEqual(['gh', 'git', 'lark-cli'])
    expect(readFileSync(workerGitConfig(dir), 'utf8')).toContain('Written by dsh-superagent')
  })
})

describe('agent git configuration', () => {
  it('ignores the operator\'s global and system git configuration, also after DSH drops credential-shaped variables', async () => {
    const home = join(dir, 'home'); mkdirSync(home)
    // Operator configuration that rewrites HTTPS to SSH, enables commit signing, and sets a credential helper.
    writeFileSync(join(home, '.gitconfig'), '[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n[commit]\n\tgpgsign = true\n[credential]\n\thelper = osxkeychain\n')
    const deployment = testDeployment({ stateDir: dir, github: { ...testDeployment().github, cli: '/opt/agent tools/gh' } })
    await writeEnvironment(deployment, [])
    // Operator identity variables and git's fallback from the OS username must not apply to worker commits.
    // Pin the locale: the refusal below is asserted by its English wording, whatever the operator's locale is.
    const env = workerEnv({ PATH: process.env.PATH, HOME: home, LC_ALL: 'C', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.abbrev', GIT_CONFIG_VALUE_0: '12', GIT_AUTHOR_NAME: 'Operator', GIT_COMMITTER_EMAIL: 'operator@example.com', ...agentVariables(dir) })
    const git = async (...args: string[]): Promise<string> => (await exec('git', args, { cwd: dir, env })).stdout.trim()
    await git('init', '-q', 'repo')
    await exec('git', ['-C', 'repo', 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git'], { cwd: dir, env })
    expect(await git('-C', 'repo', 'remote', 'get-url', '--push', 'origin')).toBe('https://github.com/acme/widgets.git')
    expect(await git('config', '--show-origin', '--get-all', 'credential.https://github.com.helper')).toBe(`file:${workerGitConfig(dir)}\t${credentialHelper('/opt/agent tools/gh')}`)
    expect(await git('config', '--get-all', 'credential.helper')).toBe('')
    await expect(git('config', 'commit.gpgsign')).rejects.toThrow()
    await expect(git('config', 'core.abbrev')).rejects.toThrow()
    expect(env).not.toHaveProperty('GIT_AUTHOR_NAME')
    expect(env).not.toHaveProperty('GIT_COMMITTER_EMAIL')
    await expect(git('-C', 'repo', 'commit', '--allow-empty', '-q', '-m', 'without identity')).rejects.toMatchObject({ stderr: expect.stringContaining('no email was given') })
    await git('-C', 'repo', '-c', 'user.name=Alice', '-c', 'user.email=alice@example.com', 'commit', '--allow-empty', '-q', '-m', 'with identity')
    expect(await git('-C', 'repo', 'log', '-1', '--format=%an <%ae> / %cn <%ce>')).toBe('Alice <alice@example.com> / Alice <alice@example.com>')
  })
})

it('fails instead of asking the operator\'s askpass helpers when the agent\'s credential helper has no answer', async () => {
  const log = join(dir, 'asked')
  const askpass = program(join(dir, 'askpass'), `echo asked >> ${log}; echo operator-secret`)
  const agent = program(join(dir, 'real', 'gh'), 'exit 0')
  const deployment = testDeployment({ stateDir: dir, github: { ...testDeployment().github, cli: agent } })
  await writeEnvironment(deployment, [])
  const env = workerEnv({ PATH: process.env.PATH, HOME: dir, GIT_ASKPASS: askpass, SSH_ASKPASS: askpass, ...agentVariables(dir) })
  await exec('git', ['init', '-q', 'repo'], { cwd: dir, env })
  await exec('git', ['-C', 'repo', 'config', 'core.askPass', askpass], { cwd: dir, env })
  const fill = exec('git', ['-C', 'repo', 'credential', 'fill'], { cwd: dir, env, timeout: 10_000 })
  fill.child.stdin?.end('protocol=https\nhost=github.com\n\n')
  await expect(fill).rejects.toMatchObject({ stderr: expect.stringContaining('terminal prompts disabled') })
  expect(() => readFileSync(log, 'utf8')).toThrow()
})

it('removes every spelling of a directory from PATH and keeps the other entries', () => {
  mkdirSync(join(dir, 'state', 'worker-bin'), { recursive: true })
  symlinkSync(join(dir, 'state'), join(dir, 'link'))
  const bin = join(dir, 'state', 'worker-bin')
  expect(withoutDirectory([`${bin}/`, join(dir, 'link', 'worker-bin'), '/usr/bin', 'node_modules/.bin'].join(':'), bin)).toBe('/usr/bin:node_modules/.bin')
})

/** Minimal SubprocessRuntime backed by child_process.spawn with an isolated global git config. */
const subprocess = (config: string): SubprocessRuntime => ({
  spawn: ({ argv, cwd, env }: { argv: readonly string[]; cwd: string; env?: Record<string, string | undefined> }) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: { ...gitEnv({ GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' }), ...env } })
    const output = { stdout: '', stderr: '' }
    child.stdout.on('data', chunk => { output.stdout += String(chunk) })
    child.stderr.on('data', chunk => { output.stderr += String(chunk) })
    const reader = (name: 'stdout' | 'stderr') => ({ readFrom: () => ({ text: output[name], nextOffset: 0, lossy: false }) })
    const done = new Promise(resolve => child.on('close', code => resolve({ exitCode: code, signal: null })))
    return { done, collected: { stdout: reader('stdout'), stderr: reader('stderr') } }
  },
}) as unknown as SubprocessRuntime
describe('ticket directory check', () => {
  const signal = new AbortController().signal
  const env = () => gitEnv({ GIT_CONFIG_GLOBAL: join(dir, 'global'), GIT_CONFIG_NOSYSTEM: '1' })
  const git = (...args: string[]) => exec('git', args, { cwd: dir, env: env() })
  const check = (directory: string) => verifyDirectory(join(dir, directory), subprocess(join(dir, 'global')), signal)
  beforeEach(() => { writeFileSync(join(dir, 'global'), '[credential]\n\thelper = global-helper\n') })
  it('passes a directory whose repository adds no credentials, and one outside any repository', async () => {
    await git('init', '-q', 'repo')
    await expect(check('repo')).resolves.toBeUndefined()
    // When no config key matches at all, git config --get-regexp exits with status 1.
    writeFileSync(join(dir, 'global'), '')
    await expect(check('real')).resolves.toBeUndefined()
  })
  it('names the credential settings of the repository\'s own configuration', async () => {
    await git('init', '-q', 'repo')
    await git('-C', 'repo', 'config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic x')
    await expect(check('repo')).rejects.toThrow('sets http.https://github.com/.extraheader')
  })
  it('fails when git cannot read the repository\'s configuration, instead of passing it', async () => {
    await git('init', '-q', 'repo')
    writeFileSync(join(dir, 'repo', '.git', 'config'), '[core\n')
    await expect(check('repo')).rejects.toThrow(/bad config/)
  })
  it('reports a failed command\'s exit status', async () => {
    const failing = ['sh', '-c', 'echo nope >&2; exit 3']
    const error = await runAsWorker(subprocess(join(dir, 'global')), failing, dir, signal).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CliError)
    expect(error).toMatchObject({ message: 'nope', exitCode: 3 })
  })
})

describe('immutable local execution revisions', () => {
  it('deduplicates a revision within one Runtime lifetime and rebuilds and verifies it in the next', async () => {
    const stateDir = join(dir, 'revision')
    const environment = { id: 'default', revision: 'v1', title: 'Default', description: '', directory: dir,
      prepare: '', blockedCommands: [], variables: {}, deployment: testDeployment({ stateDir }) }
    const native = subprocess(join(dir, 'unused-global')), verified = vi.spyOn(native, 'spawn')
    const first = new AbortController()
    await Promise.all([materializeWorkerEnvironment(environment, native, first.signal), materializeWorkerEnvironment(environment, native, first.signal)])
    expect(verified).toHaveBeenCalledTimes(1)
    const config = workerGitConfig(stateDir), original = readFileSync(config, 'utf8')
    writeFileSync(config, `${original}# same-lifetime marker\n`)
    await materializeWorkerEnvironment(environment, native, first.signal)
    expect(verified).toHaveBeenCalledTimes(1)
    expect(readFileSync(config, 'utf8')).toContain('same-lifetime marker')
    first.abort()
    await materializeWorkerEnvironment(environment, native, new AbortController().signal)
    expect(verified).toHaveBeenCalledTimes(2)
    expect(readFileSync(config, 'utf8')).toBe(original)
  })

  it('writes no files and starts no verification for a pre-aborted Runtime lifetime', async () => {
    const before = readdirSync(dir), stateDir = join(dir, 'must-not-be-created')
    const environment = { id: 'default', revision: 'v1', title: 'Default', description: '', directory: dir,
      prepare: '', blockedCommands: [], variables: {}, deployment: testDeployment({ stateDir }) }
    const native = subprocess(join(dir, 'unused-global')), verified = vi.spyOn(native, 'spawn'), lifetime = new AbortController()
    lifetime.abort(new Error('Runtime already stopped'))
    await expect(materializeWorkerEnvironment(environment, native, lifetime.signal)).rejects.toThrow('Runtime already stopped')
    expect(verified).not.toHaveBeenCalled()
    expect(readdirSync(dir)).toEqual(before)
  })

  it('evicts a failed verification so the same Runtime lifetime can retry materialization', async () => {
    const environment = { id: 'default', revision: 'v1', title: 'Default', description: '', directory: dir,
      prepare: '', blockedCommands: [], variables: {}, deployment: testDeployment({ stateDir: join(dir, 'retry-revision') }) }
    const native = subprocess(join(dir, 'unused-global')), verified = vi.spyOn(native, 'spawn'), lifetime = new AbortController()
    verified.mockImplementationOnce(() => ({ done: Promise.resolve({ exitCode: 1, signal: null }), collected: {} }) as never)
    await expect(materializeWorkerEnvironment(environment, native, lifetime.signal)).rejects.toThrow('git 2.32 or later')
    await expect(materializeWorkerEnvironment(environment, native, lifetime.signal)).resolves.toMatchObject({ prepare: '' })
    expect(verified).toHaveBeenCalledTimes(2)
  })

  it('runs simultaneous real shells with different CLI accounts and git configs without changing the host', async () => {
    const before = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_DIR: process.env.GIT_DIR }
    const native = subprocess(join(dir, 'unused-global')), signal = new AbortController().signal
    const create = async (id: string) => {
      const cli = program(join(dir, `gh-${id}`), `printf '%s\\n' '${id}'`)
      return materializeWorkerEnvironment({ id, revision: 'v1', title: id, description: '', directory: join(dir, `work-${id}`),
        prepare: `prepare-${id}`, blockedCommands: [], deployment: testDeployment({ stateDir: join(dir, 'environments', id, 'v1'),
          github: { cli, login: id, noreply: `${id}@example.invalid` } }), variables: { DSH_SUPERAGENT_ENVIRONMENT: id } }, native, signal)
    }
    const [a, b] = await Promise.all([create('a'), create('b')])
    const run = async (env: Record<string, string | undefined>) => (await exec('sh', ['-c',
      'gh api user; git config --get-all credential.https://github.com.helper; printf "%s\\n" "$DSH_SUPERAGENT_ENVIRONMENT"'], { cwd: dir, env })).stdout
    const result = await Promise.all([run(a.env), run(b.env)])
    expect(result[0]).toBe(`a\n${credentialHelper(join(dir, 'gh-a'))}\na\n`)
    expect(result[1]).toBe(`b\n${credentialHelper(join(dir, 'gh-b'))}\nb\n`)
    expect(a.env.GIT_CONFIG_GLOBAL).not.toBe(b.env.GIT_CONFIG_GLOBAL)
    expect({ PATH: process.env.PATH, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_DIR: process.env.GIT_DIR }).toEqual(before)
  })

  it('keeps local git usable without a GitHub connection and refuses gh rather than selecting an ambient account', async () => {
    const stateDir = join(dir, 'no-github')
    const { env } = await materializeWorkerEnvironment({ id: 'local', revision: 'v1', title: 'Local', description: '', directory: dir,
      prepare: '', blockedCommands: [], variables: {}, deployment: testDeployment({ stateDir, repository: '', github: { cli: '', login: '', noreply: '' }, feishu: undefined }) },
    subprocess(join(dir, 'unused-global')), new AbortController().signal)
    await exec('git', ['init', '-q', 'local-repository'], { cwd: dir, env })
    expect((await exec('git', ['-C', 'local-repository', 'status', '--porcelain'], { cwd: dir, env })).stdout).toBe('')
    expect((await exec('git', ['config', '--get-all', 'credential.https://github.com.helper'], { cwd: dir, env })).stdout).toBe('\n')
    await expect(exec('gh', ['api', 'user'], { cwd: dir, env })).rejects.toMatchObject({ stderr: expect.stringContaining('no GitHub connection') })
    expect(readFileSync(workerGitConfig(stateDir), 'utf8')).not.toContain('auth git-credential')
  })
})

describe('the repository the host\'s environment names', () => {
  it('is left alone by the tests\' git and named in no worker\'s environment, as when they run inside `git rebase --exec`', async () => {
    // A scratch repository stands for the one under test, which `git rebase --exec` names in GIT_DIR and GIT_WORK_TREE.
    await exec('git', ['init', '-q', 'scratch'], { cwd: dir, env: gitEnv() })
    const config = () => readFileSync(join(dir, 'scratch', '.git', 'config'), 'utf8')
    const before = config()
    vi.stubEnv('GIT_DIR', join(dir, 'scratch', '.git')); vi.stubEnv('GIT_WORK_TREE', join(dir, 'scratch'))
    // The operator's limit on git's search for a repository names none, and stays.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dir)
    try {
      // What the tests do: a repository of their own, checked as a ticket directory.
      await exec('git', ['init', '-q', 'repo'], { cwd: dir, env: gitEnv({ GIT_CONFIG_GLOBAL: join(dir, 'global'), GIT_CONFIG_NOSYSTEM: '1' }) })
      writeFileSync(join(dir, 'global'), '')
      await expect(verifyDirectory(join(dir, 'repo'), subprocess(join(dir, 'global')), new AbortController().signal)).resolves.toBeUndefined()
      expect(readdirSync(join(dir, 'repo'))).toContain('.git')
      expect(config()).toBe(before)
      // The worker environment, which workers' shells and the host's own commands get, names no repository.
      const env = workerEnv({ ...process.env, ...agentVariables(dir) })
      for (const name of GIT_LOCATION) expect(env, name).not.toHaveProperty(name)
      expect(env.GIT_CEILING_DIRECTORIES).toBe(dir)
    } finally { vi.unstubAllEnvs() }
  })
})
