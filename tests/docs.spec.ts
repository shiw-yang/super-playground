import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs')
/** Local-only working material, excluded from git and not shipped; it is not part of the checked set. */
const LOCAL_ONLY = ['docs/agent-roadmap/']
/** The entry documents the documentation structure relies on. */
const ENTRY_DOCS = [
  'README.md',
  'AGENTS.md',
  'docs/README.md',
  'docs/AGENTS.md',
  'docs/design.md',
  'docs/status.md',
  'docs/architecture.md',
  'docs/development.md',
  'docs/testing.md',
  'docs/subsystems/README.md',
  'docs/cookbook/README.md',
  'docs/user/index.md',
  'docs/i18n/README.md',
  'docs/defensive-patterns/README.md',
  '.agents/notes/README.md',
]
const roots = ['README.md', 'AGENTS.md']
const markdown = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
  .map(entry => relative(ROOT, join(entry.parentPath, entry.name)))
const notes = markdown(join(ROOT, '.agents', 'notes'))
const docs = markdown(DOCS).filter(path => !LOCAL_ONLY.some(prefix => path.startsWith(prefix))).sort()
const docsSet = new Set(docs)
/** Every shipped markdown document: root entries, the docs tree and the design notes. */
const documents = [...roots, ...docs, ...notes]
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
/** Document text without code: links and prose inside code are examples, not links or prose. */
const content = (path: string): string => read(path).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
/** Relative link targets of a document, without external links and anchors. */
function targets(file: string): string[] {
  return [...content(file).matchAll(/\]\(([^)]+)\)/g)].flatMap(match => {
    const target = match[1]!.trim().replace(/^<|>$/g, '').split(/\s+/)[0]!.split('#')[0]
    return target && !/^[a-z]+:/i.test(target) ? [target] : []
  })
}
/** The repo-relative files a document links to, if they are part of the docs set (directories dropped). */
function docLinks(file: string): string[] {
  return targets(file)
    .map(target => relative(ROOT, resolve(dirname(join(ROOT, file)), target)).replace(/\/$/, ''))
    .filter(target => docsSet.has(target))
}
/** Every document under docs reachable from `start` by following links between documents. */
function reachableFrom(start: string): Set<string> {
  const seen = new Set([start])
  const queue = [start]
  while (queue.length) {
    for (const next of docLinks(queue.pop()!)) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}
/**
 * Read a two-column table under `## <heading>` of a document; return the repo-relative file paths of its first column.
 * Bare filenames inherit the directory of the preceding path in the same cell.
 */
function table(path: string, heading: string): string[] {
  const lines = read(path).split('\n')
  const start = lines.indexOf(`## ${heading}`)
  if (start < 0) return []
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  // The first two rows are the header and its separator.
  const rows = lines.slice(start, end < 0 ? undefined : end).filter(line => line.startsWith('| ')).slice(2)
  return rows.flatMap(row => {
    let directory = ''
    return [...row.split('|')[1]!.matchAll(/`([^`]+)`/g)].map(([, name]) => {
      if (!name!.includes('/')) return join(directory, name!)
      directory = dirname(name!)
      return name!
    })
  })
}
/** The anchor GitHub assigns to a heading: lowercased, punctuation removed, spaces replaced by hyphens. */
const slug = (text: string): string => text.trim()
  .replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
const headings = (path: string): string[] => [...read(path).matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => slug(match[1]!))
/** Anchors of a document's local links, each with the file it points at (itself for a bare `#…`). */
function anchorTargets(file: string): Array<{ path: string; anchor: string }> {
  return [...content(file).matchAll(/\]\(([^)]+)\)/g)].flatMap(match => {
    const raw = match[1]!.trim().replace(/^<|>$/g, '').split(/\s+/)[0]!
    if (/^[a-z]+:/i.test(raw)) return []
    const [path, anchor] = raw.split('#')
    if (!anchor || (path && !path.endsWith('.md'))) return []
    return [{ path: path || file, anchor }]
  })
}
const files = (directory: string): string[] => readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => relative(ROOT, join(entry.parentPath, entry.name)))

describe('documentation', () => {
  it('keeps the entry documents the structure relies on', () => {
    expect(ENTRY_DOCS.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
  it('keeps no numbered documents', () => {
    expect(docs.filter(path => /^docs\/\d{3}-/.test(path))).toEqual([])
  })
  it('resolves every local link in every shipped document', () => {
    const missing = documents.flatMap(file => targets(file).filter(target => !existsSync(resolve(dirname(join(ROOT, file)), target))).map(target => `${file} → ${target}`))
    expect(missing).toEqual([])
  })
  it('resolves every anchor to a heading in its target document', () => {
    const missing = documents.flatMap(file => anchorTargets(file).flatMap(({ path, anchor }) => {
      const target = relative(ROOT, resolve(dirname(join(ROOT, file)), path))
      return existsSync(join(ROOT, target)) && !headings(target).includes(anchor) ? [`${file} → ${path}#${anchor}`] : []
    }))
    expect(missing).toEqual([])
  })
  it('reaches every document under docs from the documentation index', () => {
    const reached = reachableFrom('docs/README.md')
    expect(docs.filter(path => !reached.has(path))).toEqual([])
  })
  it('links every subsystem page from the subsystem index', () => {
    const linked = new Set(docLinks('docs/subsystems/README.md'))
    const pages = docs.filter(path => path.startsWith('docs/subsystems/') && path !== 'docs/subsystems/README.md')
    expect(pages.filter(path => !linked.has(path))).toEqual([])
  })
  it('links every cookbook page from the cookbook index', () => {
    const linked = new Set(docLinks('docs/cookbook/README.md'))
    const pages = docs.filter(path => path.startsWith('docs/cookbook/') && path !== 'docs/cookbook/README.md')
    expect(pages.filter(path => !linked.has(path))).toEqual([])
  })
  it('does not link local-only material from shipped documentation', () => {
    const linked = documents.filter(file => targets(file).some(target => /(^|\/)(research|agent-roadmap)\//.test(target)))
    expect(linked).toEqual([])
  })
  it('leaves no merge conflict markers in any document', () => {
    expect(documents.filter(path => /^(<{7}|>{7}) /m.test(read(path)))).toEqual([])
  })
  it('writes documentation prose in English', () => {
    const chinese = /[\u4e00-\u9fff]/
    expect(documents.filter(path => chinese.test(content(path)))).toEqual([])
  })
  it('lists every module of src in the Modules table of docs/architecture.md, and only files that exist', () => {
    const modules = table('docs/architecture.md', 'Modules')
    expect(files('src').filter(path => !modules.includes(path))).toEqual([])
    expect(modules.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
  it('lists every test in the Test catalog of docs/testing.md, and only files that exist', () => {
    const catalog = table('docs/testing.md', 'Test catalog')
    expect(files('tests').filter(path => /\.spec\.tsx?$/.test(path) && !catalog.includes(path))).toEqual([])
    expect(catalog.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
})
